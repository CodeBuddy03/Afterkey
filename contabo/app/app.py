#!/usr/bin/env python3
"""AfterKey API — accounts, vault entries and the waiting list.

Runs on loopback only (127.0.0.1:8001) behind nginx, which terminates TLS and
sets X-Real-IP. Secrets live in /opt/afterkey/shared/afterkey.env and are read
once at import; nothing secret is ever returned to a browser.

What is stored:
  * subscribers — an email address from the waiting-list form
  * users       — email + PBKDF2-HMAC-SHA256 hash (600k rounds, per-user salt)
  * sessions    — SHA-256 of a random 32-byte token, never the token itself
  * resets      — SHA-256 of a single-use, one-hour reset token
  * entries     — the vault text a signed-in person wrote

Authentication is a cookie session with HttpOnly + Secure + SameSite=Lax.
State-changing requests must carry a same-origin Origin header and a JSON
content type, so a cross-site form cannot drive them.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
import ssl
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager, contextmanager
from html import escape
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse, JSONResponse

ENV_FILE = Path(os.environ.get("AFTERKEY_ENV", "/opt/afterkey/shared/afterkey.env"))
DATA_DIR = Path(os.environ.get("AFTERKEY_DATA", "/opt/afterkey/data"))
DB_PATH = DATA_DIR / "afterkey.db"
LOG_DIR = Path(os.environ.get("AFTERKEY_LOGS", "/opt/afterkey/logs"))

RESEND_URL = "https://api.resend.com/emails"

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s.]+(?:\.[^@\s.]+)+$")

# Waiting-list limits, sliding window over the attempts table.
IP_WINDOW_SECONDS = 15 * 60
IP_WINDOW_MAX = 5
IP_DAY_SECONDS = 24 * 60 * 60
IP_DAY_MAX = 20
GLOBAL_HOUR_MAX = 120

# Account limits.
LOGIN_IP_PER_15M = 12
LOGIN_EMAIL_PER_15M = 6
REGISTER_IP_PER_HOUR = 6
RESET_IP_PER_HOUR = 6

SESSION_COOKIE = "ak_session"
SESSION_DAYS = 30
RESET_MINUTES = 60

# Handoff: the link a recipient receives stays valid for a limited time and a
# limited number of opens, and the owner can close it at any moment.
RELEASE_DAYS = 14
RELEASE_MAX_VIEWS = 25

# Legacy access: what a named heir receives is the whole vault, read-only, for a
# year at a time. It is a read window, never a credential: no password, no reset,
# no right to change or send, and the owner can close it in one click.
LEGACY_DAYS = 365
LEGACY_MAX_HEIRS = 5
LEGACY_COOKIE = "ak_legacy"

# What a vault entry can be. The kind only groups the record for reading; it
# never changes who can see it.
ENTRY_KINDS = {"note", "message", "account", "document", "media", "place"}
KIND_LABELS = {
    "note": "Note",
    "message": "Message",
    "account": "Account",
    "document": "Document",
    "media": "Photo or video",
    "place": "Place",
}

# One attachment per entry. The file lives outside the web root and is served
# only through a route that checks the session first. The server decides the
# type from the stored name and magic bytes, never from the uploaded filename.
MEDIA_DIR = DATA_DIR / "media"
MEDIA_MAX_BYTES = 8 * 1024 * 1024
MEDIA_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "text/plain": ".txt",
}
MEDIA_MAGIC = {
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".gif": (b"GIF87a", b"GIF89a"),
    ".pdf": (b"%PDF-",),
    ".webp": (b"RIFF",),
    ".mp4": (b"\x00\x00\x00", b"ftyp"),
    ".webm": (b"\x1aE\xdf\xa3",),
    ".mp3": (b"ID3", b"\xff\xfb", b"\xff\xf3"),
    ".m4a": (b"\x00\x00\x00", b"ftyp"),
}

PBKDF2_ROUNDS = 600_000
PBKDF2_PREFIX = "pbkdf2_sha256"

log = logging.getLogger("afterkey")


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except OSError:
        return values
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        values[name.strip()] = value.strip().strip('"').strip("'")
    return values


ENV = load_env(ENV_FILE)
API_KEY = ENV.get("RESEND_API_KEY", "")
MAIL_FROM = ENV.get("MAIL_FROM", "AfterKey <no-reply@spidercrawler.site>")
ADMIN_EMAIL = ENV.get("ADMIN_EMAIL", "").strip()
CONTACT_EMAIL = ENV.get("CONTACT_EMAIL", ADMIN_EMAIL).strip() or ADMIN_EMAIL
PUBLIC_URL = ENV.get("PUBLIC_BASE_URL", "https://spidercrawler.site").rstrip("/")
SITE_NAME = "AfterKey"
ALLOWED_ORIGINS = {PUBLIC_URL, PUBLIC_URL.replace("https://", "http://")}
if PUBLIC_URL.endswith("spidercrawler.site"):
    ALLOWED_ORIGINS |= {"https://www.spidercrawler.site"}

DATA_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)


def setup_logging() -> None:
    log.setLevel(logging.INFO)
    handler = RotatingFileHandler(
        LOG_DIR / "api.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8"
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(handler)
    stdout = logging.StreamHandler()
    stdout.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
    log.addHandler(stdout)


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        yield conn
    finally:
        conn.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS subscribers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL UNIQUE,
    created_at  INTEGER NOT NULL,
    source      TEXT NOT NULL DEFAULT 'site',
    ip_hash     TEXT,
    user_agent  TEXT,
    admin_notified INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS attempts (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_hash  TEXT NOT NULL,
    ts       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_ip_ts ON attempts (ip_hash, ts);
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS limits (
    bucket TEXT NOT NULL,
    ts     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_limits_bucket_ts ON limits (bucket, ts);
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL UNIQUE,
    pw_hash     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    last_login  INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    ip_hash     TEXT,
    user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS resets (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  INTEGER NOT NULL,
    used_at     INTEGER
);
CREATE TABLE IF NOT EXISTS entries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    recipient     TEXT NOT NULL DEFAULT '',
    recipient_email TEXT NOT NULL DEFAULT '',
    release_rule  TEXT NOT NULL DEFAULT 'undecided',
    body          TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'sealed',
    released_at   INTEGER,
    release_token_hash TEXT,
    release_token_expires INTEGER,
    release_views INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_user ON entries (user_id);
CREATE TABLE IF NOT EXISTS heirs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL DEFAULT '',
    email         TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'ready',
    token_hash    TEXT,
    token_expires INTEGER,
    invited_at    INTEGER,
    claimed_at    INTEGER,
    last_seen     INTEGER,
    created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_heirs_user ON heirs (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_heirs_user_email ON heirs (user_id, email);
"""


ENTRY_COLUMNS = (
    ("kind", "TEXT NOT NULL DEFAULT 'note'"),
    ("secret", "TEXT NOT NULL DEFAULT ''"),
    ("link", "TEXT NOT NULL DEFAULT ''"),
    ("file_name", "TEXT NOT NULL DEFAULT ''"),
    ("file_type", "TEXT NOT NULL DEFAULT ''"),
    ("file_size", "INTEGER NOT NULL DEFAULT 0"),
    ("file_path", "TEXT NOT NULL DEFAULT ''"),
    ("status", "TEXT NOT NULL DEFAULT 'sealed'"),
    ("released_at", "INTEGER"),
    ("release_token_hash", "TEXT"),
    ("release_token_expires", "INTEGER"),
    ("release_views", "INTEGER NOT NULL DEFAULT 0"),
)


def migrate() -> None:
    """Add handoff columns to a database created before they existed."""
    with db() as conn:
        present = {row["name"] for row in conn.execute("PRAGMA table_info(entries)")}
        for name, ddl in ENTRY_COLUMNS:
            if name not in present:
                conn.execute(f"ALTER TABLE entries ADD COLUMN {name} {ddl}")


def init_db() -> None:
    with db() as conn:
        conn.executescript(SCHEMA)
    migrate()
    os.chmod(DB_PATH, 0o640)
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(MEDIA_DIR, 0o700)


IP_SALT: str = ""


def resolve_salt() -> str:
    with db() as conn:
        row = conn.execute("SELECT value FROM meta WHERE key='ip_salt'").fetchone()
        if row:
            return row["value"]
        value = os.urandom(32).hex()
        conn.execute("INSERT INTO meta (key, value) VALUES ('ip_salt', ?)", (value,))
        return value


def hash_ip(ip: str) -> str:
    return hmac.new(IP_SALT.encode(), ip.encode(), hashlib.sha256).hexdigest()[:32]


def client_ip(request: Request) -> str:
    """nginx sets X-Real-IP; the socket itself is always loopback here."""
    real = (request.headers.get("x-real-ip") or "").strip()
    if real and len(real) <= 64:
        return real
    fwd = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if fwd and len(fwd) <= 64:
        return fwd
    return request.client.host if request.client else "unknown"


def rate_limited(ip_hash: str, now: int) -> bool:
    with db() as conn:
        conn.execute("DELETE FROM attempts WHERE ts < ?", (now - IP_DAY_SECONDS,))
        window = conn.execute(
            "SELECT COUNT(*) AS c FROM attempts WHERE ip_hash=? AND ts >= ?",
            (ip_hash, now - IP_WINDOW_SECONDS),
        ).fetchone()["c"]
        if window >= IP_WINDOW_MAX:
            return True
        day = conn.execute(
            "SELECT COUNT(*) AS c FROM attempts WHERE ip_hash=? AND ts >= ?",
            (ip_hash, now - IP_DAY_SECONDS),
        ).fetchone()["c"]
        if day >= IP_DAY_MAX:
            return True
        hourly = conn.execute(
            "SELECT COUNT(*) AS c FROM attempts WHERE ts >= ?", (now - 3600,)
        ).fetchone()["c"]
        return hourly >= GLOBAL_HOUR_MAX


def bucket_hit(bucket: str, limit: int, window: int, now: int) -> bool:
    """True when this bucket is over its limit. Records the hit when it is not."""
    if not bucket:
        return False
    with db() as conn:
        conn.execute("DELETE FROM limits WHERE ts < ?", (now - 7 * 86400,))
        used = conn.execute(
            "SELECT COUNT(*) AS c FROM limits WHERE bucket=? AND ts >= ?",
            (bucket, now - window),
        ).fetchone()["c"]
        if used >= limit:
            return True
        conn.execute("INSERT INTO limits (bucket, ts) VALUES (?, ?)", (bucket, now))
    return False


def bucket_clear(bucket: str) -> None:
    with db() as conn:
        conn.execute("DELETE FROM limits WHERE bucket=?", (bucket,))


# ── passwords and sessions ───────────────────────────────────────


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)
    return f"{PBKDF2_PREFIX}${PBKDF2_ROUNDS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        prefix, rounds, salt_hex, digest_hex = stored.split("$")
        if prefix != PBKDF2_PREFIX:
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds)
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(user_id: int, ip_hash: str, user_agent: str) -> str:
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip_hash, user_agent)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                token_digest(token),
                user_id,
                now,
                now + SESSION_DAYS * 86400,
                ip_hash,
                user_agent[:200],
            ),
        )
    return token


def session_user(request: Request) -> sqlite3.Row | None:
    token = request.cookies.get(SESSION_COOKIE, "")
    if not token or len(token) > 200:
        return None
    with db() as conn:
        row = conn.execute(
            "SELECT u.id, u.email, u.created_at FROM sessions s"
            " JOIN users u ON u.id = s.user_id"
            " WHERE s.token_hash=? AND s.expires_at > ? AND u.deleted_at IS NULL",
            (token_digest(token), int(time.time())),
        ).fetchone()
    return row


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 86400,
        path="/",
        httponly=True,
        secure=True,
        samesite="lax",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        SESSION_COOKIE, path="/", httponly=True, secure=True, samesite="lax"
    )


# ── mail ─────────────────────────────────────────────────────────


def send_mail(to: str, subject: str, html: str, text: str, reply_to: str | None = None) -> bool:
    """One Resend call. Never raises; failures are logged without the key."""
    payload = json.dumps(
        {
            "from": MAIL_FROM,
            "to": [to],
            "reply_to": reply_to or CONTACT_EMAIL,
            "subject": subject,
            "html": html,
            "text": text,
        }
    ).encode()
    req = urllib.request.Request(
        RESEND_URL,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "AfterKey/1.0",
        },
    )
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            body = resp.read(400).decode("utf-8", "replace")
            log.info("resend ok to=%s status=%s body=%s", to, resp.status, body[:200])
            return 200 <= resp.status < 300
    except urllib.error.HTTPError as exc:
        detail = exc.read(400).decode("utf-8", "replace")
        log.warning("resend http error to=%s status=%s body=%s", to, exc.code, detail[:300])
    except Exception as exc:  # noqa: BLE001
        log.warning("resend transport error to=%s err=%s", to, type(exc).__name__)
    return False


def mail_shell(heading: str, body_html: str) -> str:
    return f"""<!doctype html><html><body style="margin:0;background:#080808;color:#F2F0EC;
font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:40px 0">
<tr><td align="center">
<table width="100%" style="max-width:520px;padding:0 24px">
<tr><td style="padding-bottom:24px;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#A0A0A0">
{SITE_NAME}</td></tr>
<tr><td style="font-size:22px;line-height:1.4;padding-bottom:16px;color:#F2F0EC">{heading}</td></tr>
{body_html}
<tr><td style="border-top:1px solid #292929;padding-top:18px;font-size:12px;color:#6F6B66">
{SITE_NAME} · <a href="{PUBLIC_URL}" style="color:#8F8B86">{urlparse(PUBLIC_URL).netloc}</a>
</td></tr>
</table></td></tr></table></body></html>"""


mail_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="afterkey-mail")


@asynccontextmanager
async def lifespan(_: FastAPI):
    global IP_SALT
    setup_logging()
    init_db()
    restoration.migrate()
    IP_SALT = resolve_salt()
    log.info(
        "afterkey api up db=%s sender=%s admin_set=%s key_set=%s",
        DB_PATH, MAIL_FROM, bool(ADMIN_EMAIL), bool(API_KEY),
    )
    yield
    mail_pool.shutdown(wait=False, cancel_futures=False)


app = FastAPI(
    title="AfterKey API",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    default_response_class=JSONResponse,
    lifespan=lifespan,
)


@app.middleware("http")
async def guard(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    try:
        del response.headers["server"]
    except KeyError:
        pass
    return response


async def json_body(request: Request) -> dict | None:
    try:
        raw = await request.body()
        if len(raw) > 32_768:
            return None
        data = json.loads(raw or b"{}")
    except (ValueError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


def same_origin(request: Request) -> bool:
    """Reject cross-site writes. Browsers always send Origin on JSON fetches."""
    origin = (request.headers.get("origin") or "").rstrip("/")
    if origin and origin not in ALLOWED_ORIGINS:
        return False
    ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    return ctype == "application/json"


# ── waiting list ────────────────────────────────────────────────


def add_subscriber(email: str, ip_hash: str, user_agent: str) -> bool:
    now = int(time.time())
    with db() as conn:
        cur = conn.execute(
            "INSERT OR IGNORE INTO subscribers (email, created_at, ip_hash, user_agent)"
            " VALUES (?, ?, ?, ?)",
            (email, now, ip_hash, user_agent[:200]),
        )
        return cur.rowcount == 1


def mark_notified(email: str) -> None:
    with db() as conn:
        conn.execute("UPDATE subscribers SET admin_notified=1 WHERE email=?", (email,))


@app.get("/api/health")
async def health() -> JSONResponse:
    return JSONResponse({"ok": True})


@app.post("/api/subscribe")
async def subscribe(request: Request) -> JSONResponse:
    ip = client_ip(request)
    ip_hash = hash_ip(ip)
    now = int(time.time())

    if rate_limited(ip_hash, now):
        log.info("rate limited ip_hash=%s", ip_hash[:8])
        return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)

    payload = await json_body(request)
    if payload is None:
        return JSONResponse({"ok": False, "error": "bad_request"}, status_code=400)

    email = str(payload.get("email", "")).strip().lower()
    if not email or len(email) > 254 or email.count("@") != 1 or not EMAIL_RE.match(email):
        with db() as conn:
            conn.execute("INSERT INTO attempts (ip_hash, ts) VALUES (?, ?)", (ip_hash, now))
        return JSONResponse({"ok": False, "error": "invalid_email"}, status_code=422)

    with db() as conn:
        conn.execute("INSERT INTO attempts (ip_hash, ts) VALUES (?, ?)", (ip_hash, now))

    user_agent = request.headers.get("user-agent", "")
    is_new = add_subscriber(email, ip_hash, user_agent)

    if is_new:
        log.info("subscribed ip_hash=%s", ip_hash[:8])
        text = (
            "You asked to hear from AfterKey when the first vaults open.\n\n"
            "You are on the list. When there is something real to say, one message "
            "will arrive from no-reply@spidercrawler.site. Nothing else.\n\n"
            "Ask any time and your address is removed:\n"
            f"{CONTACT_EMAIL}\n"
        )
        html = mail_shell(
            "You are on the list.",
            f"""<tr><td style="font-size:15px;line-height:1.7;color:#B8B4AE;padding-bottom:20px">
When the first vaults open, one message will arrive from this address. No newsletter,
no marketing, nothing else.</td></tr>
<tr><td style="font-size:15px;line-height:1.7;color:#B8B4AE;padding-bottom:28px">
Ask any time and your address is removed:
<a href="mailto:{CONTACT_EMAIL}" style="color:#F2F0EC">{CONTACT_EMAIL}</a></td></tr>""",
        )
        mail_pool.submit(send_mail, email, "You are on the AfterKey list", html, text)

        if ADMIN_EMAIL:
            admin_html = (
                "<div style=\"font-family:-apple-system,Segoe UI,sans-serif;background:#080808;"
                "color:#F2F0EC;padding:28px\">"
                "<p style=\"font-size:12px;letter-spacing:.14em;text-transform:uppercase;"
                "color:#A0A0A0;margin:0 0 14px\">AfterKey · waitlist</p>"
                f"<p style=\"font-size:20px;margin:0 0 18px\">{email}</p>"
                "<table style=\"font-size:14px;color:#B8B4AE;line-height:1.9\">"
                f"<tr><td style=\"color:#6F6B66;padding-right:14px\">when</td><td>{time.strftime('%Y-%m-%d %H:%M:%S %Z', time.localtime(now))}</td></tr>"
                f"<tr><td style=\"color:#6F6B66;padding-right:14px\">ip</td><td>{ip}</td></tr>"
                f"<tr><td style=\"color:#6F6B66;padding-right:14px\">agent</td><td>{user_agent[:120]}</td></tr>"
                "</table></div>"
            )

            def notify() -> None:
                if send_mail(ADMIN_EMAIL, f"New AfterKey signup: {email}", admin_html, f"New signup: {email}"):
                    mark_notified(email)

            mail_pool.submit(notify)

    return JSONResponse({"ok": True})


@app.post("/api/contact")
async def contact(request: Request) -> JSONResponse:
    """The page's contact form. Writes to the admin inbox, never to a public address."""
    if not same_origin(request):
        return JSONResponse({"ok": False, "error": "cross_origin"}, status_code=403)

    ip = client_ip(request)
    ip_hash = hash_ip(ip)
    now = int(time.time())
    if bucket_hit(f"contact:{ip_hash}", 4, 3600, now):
        return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)

    payload = await json_body(request)
    if payload is None:
        return JSONResponse({"ok": False, "error": "bad_request"}, status_code=400)

    if str(payload.get("company") or "").strip():
        log.info("contact honeypot ip_hash=%s", ip_hash[:8])
        return JSONResponse({"ok": True})

    name = clean(payload.get("name"), 80)
    email = normalise_email(payload.get("email"))
    message = str(payload.get("message") or "").strip()[:4000]

    if not email or len(message) < 10:
        return JSONResponse(
            {
                "ok": False,
                "error": "invalid",
                "message": "Add a reply address and a few words about what you need.",
            },
            status_code=422,
        )

    if not ADMIN_EMAIL:
        log.warning("contact form has no admin address configured")
        return JSONResponse({"ok": False, "error": "unavailable"}, status_code=503)

    safe_name = escape(name or "No name given")
    safe_email = escape(email)
    safe_message = escape(message).replace("\n", "<br>")
    html = mail_shell(
        "A message from the contact form.",
        f"""<tr><td style="font-size:15px;line-height:1.7;color:#F2F0EC;padding-bottom:18px">
{safe_message}</td></tr>
<tr><td style="font-size:13px;line-height:1.8;color:#8F8B86;border-top:1px solid #292929;padding-top:16px">
name {safe_name}<br>
reply {safe_email}<br>
when {time.strftime('%Y-%m-%d %H:%M %Z', time.localtime(now))}</td></tr>""",
    )
    text = (
        f"{message}\n\n"
        f"name: {name or 'not given'}\n"
        f"reply: {email}\n"
        f"when: {time.strftime('%Y-%m-%d %H:%M %Z', time.localtime(now))}\n"
    )
    subject = f"AfterKey contact: {name or email}"[:120]
    mail_pool.submit(send_mail, ADMIN_EMAIL, subject, html, text, email)
    log.info("contact message ip_hash=%s", ip_hash[:8])
    return JSONResponse({"ok": True})


# ── accounts ────────────────────────────────────────────────────


def normalise_email(value: object) -> str:
    email = str(value or "").strip().lower()
    if not email or len(email) > 254 or email.count("@") != 1 or not EMAIL_RE.match(email):
        return ""
    return email


def find_user(email: str) -> sqlite3.Row | None:
    with db() as conn:
        return conn.execute(
            "SELECT id, email, pw_hash, created_at FROM users WHERE email=? AND deleted_at IS NULL", (email,)
        ).fetchone()


@app.post("/api/auth/register")
async def register(request: Request) -> JSONResponse:
    if not same_origin(request):
        return JSONResponse({"ok": False, "error": "cross_origin"}, status_code=403)

    ip_hash = hash_ip(client_ip(request))
    now = int(time.time())
    if bucket_hit(f"register:{ip_hash}", REGISTER_IP_PER_HOUR, 3600, now):
        return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)

    payload = await json_body(request)
    if payload is None:
        return JSONResponse({"ok": False, "error": "bad_request"}, status_code=400)

    email = normalise_email(payload.get("email"))
    password = str(payload.get("password") or "")
    if not email:
        return JSONResponse({"ok": False, "error": "invalid_email"}, status_code=422)
    if len(password) < 10 or len(password) > 200:
        return JSONResponse(
            {"ok": False, "error": "weak_password", "message": "Use at least 10 characters."},
            status_code=422,
        )
    if find_user(email):
        return JSONResponse({"ok": False, "error": "exists"}, status_code=409)

    pw_hash = hash_password(password)
    try:
        with db() as conn:
            cur = conn.execute(
                "INSERT INTO users (email, pw_hash, created_at) VALUES (?, ?, ?)",
                (email, pw_hash, now),
            )
            user_id = cur.lastrowid
    except sqlite3.IntegrityError:
        return JSONResponse({"ok": False, "error": "exists"}, status_code=409)

    log.info("registered user_id=%s", user_id)
    token = create_session(user_id, ip_hash, request.headers.get("user-agent", ""))

    body_html = f"""<tr><td style="font-size:15px;line-height:1.7;color:#B8B4AE;padding-bottom:20px">
Your space is open. Sign in any time at
<a href="{PUBLIC_URL}/login" style="color:#F2F0EC">{urlparse(PUBLIC_URL).netloc}/login</a>.</td></tr>
<tr><td style="font-size:15px;line-height:1.7;color:#B8B4AE;padding-bottom:20px">
What you write in the vault is stored on this server and is only readable by your account.
Nothing is released until you name a recipient and confirm the handoff.</td></tr>"""
    mail_pool.submit(
        send_mail,
        email,
        "Your AfterKey space is open",
        mail_shell("Your space is open.", body_html),
        f"Your AfterKey space is open.\n\nSign in: {PUBLIC_URL}/login\n",
    )

    response = JSONResponse({"ok": True, "email": email}, status_code=201)
    set_session_cookie(response, token)
    return response


@app.post("/api/auth/login")
async def login(request: Request) -> JSONResponse:
    if not same_origin(request):
        return JSONResponse({"ok": False, "error": "cross_origin"}, status_code=403)

    ip = client_ip(request)
    ip_hash = hash_ip(ip)
    now = int(time.time())

    payload = await json_body(request)
    if payload is None:
        return JSONResponse({"ok": False, "error": "bad_request"}, status_code=400)

    email = normalise_email(payload.get("email"))
    password = str(payload.get("password") or "")
    if not email or not password or len(password) > 200:
        return JSONResponse({"ok": False, "error": "invalid"}, status_code=422)

    if bucket_hit(f"login-ip:{ip_hash}", LOGIN_IP_PER_15M, 900, now):
        return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)
    email_bucket = f"login-user:{hashlib.sha256(email.encode()).hexdigest()[:32]}"
    if bucket_hit(email_bucket, LOGIN_EMAIL_PER_15M, 900, now):
        return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)

    user = find_user(email)
    # Compare against a dummy hash when the address is unknown so the timing of
    # a wrong address and a wrong password is the same shape.
    stored = user["pw_hash"] if user else (
        f"{PBKDF2_PREFIX}${PBKDF2_ROUNDS}${'00' * 16}${'00' * 32}"
    )
    ok = verify_password(password, stored) and user is not None

    if not ok:
        log.info("login failed ip_hash=%s", ip_hash[:8])
        return JSONResponse(
            {"ok": False, "error": "invalid", "message": "Those details do not match an account."},
            status_code=401,
        )

    bucket_clear(email_bucket)
    with db() as conn:
        conn.execute("UPDATE users SET last_login=? WHERE id=?", (now, user["id"]))

    token = create_session(user["id"], ip_hash, request.headers.get("user-agent", ""))
    response = JSONResponse({"ok": True, "email": user["email"]})
    set_session_cookie(response, token)
    return response


@app.post("/api/auth/logout")
async def logout(request: Request) -> JSONResponse:
    if not same_origin(request):
        return JSONResponse({"ok": False, "error": "cross_origin"}, status_code=403)
    token = request.cookies.get(SESSION_COOKIE, "")
    if token:
        with db() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash=?", (token_digest(token),))
    response = JSONResponse({"ok": True})
    clear_session_cookie(response)
    return response


@app.get("/api/auth/me")
async def me(request: Request) -> JSONResponse:
    user = session_user(request)
    if not user:
        return JSONResponse({"ok": False, "error": "unauthenticated"}, status_code=401)
    return JSONResponse({"ok": True, "email": user["email"], "created_at": user["created_at"]})


@app.post("/api/auth/reset/request")
async def reset_request(request: Request) -> JSONResponse:
    if not same_origin(request):
        return JSONResponse({"ok": False, "error": "cross_origin"}, status_code=403)

    ip_hash = hash_ip(client_ip(request))
    now = int(time.time())
    if bucket_hit(f"reset:{ip_hash}", RESET_IP_PER_HOUR, 3600, now):
        return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)

    payload = await json_body(request)
    if payload is None:
        return JSONResponse({"ok": False, "error": "bad_request"}, status_code=400)

    email = normalise_email(payload.get("email"))
    if not email:
        return JSONResponse({"ok": False, "error": "invalid_email"}, status_code=422)

    user = find_user(email)
    if user:
        token = secrets.token_urlsafe(32)
        with db() as conn:
            conn.execute("DELETE FROM resets WHERE user_id=? AND used_at IS NULL", (user["id"],))
            conn.execute(
                "INSERT INTO resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                (token_digest(token), user["id"], now + RESET_MINUTES * 60),
            )
        link = f"{PUBLIC_URL}/reset?token={token}"
        html = mail_shell(
            "Choose a new password.",
            f"""<tr><td style="font-size:15px;line-height:1.7;color:#B8B4AE;padding-bottom:24px">
This link works once and expires in {RESET_MINUTES} minutes. If you did not ask for it,
ignore this message and nothing changes.</td></tr>
<tr><td style="padding-bottom:28px">
<a href="{link}" style="display:inline-block;background:#EDE9E1;color:#0A0A0A;text-decoration:none;
padding:14px 22px;border-radius:10px;font-weight:600">Reset password</a></td></tr>""",
        )
        mail_pool.submit(
            send_mail,
            email,
            "Reset your AfterKey password",
            html,
            f"Reset link (one hour, one use):\n{link}\n",
        )
        log.info("reset requested user_id=%s", user["id"])

    # Same answer whether or not the address exists.
    return JSONResponse({"ok": True})


@app.post("/api/auth/reset/confirm")
async def reset_confirm(request: Request) -> JSONResponse:
    if not same_origin(request):
        return JSONResponse({"ok": False, "error": "cross_origin"}, status_code=403)

    ip_hash = hash_ip(client_ip(request))
    now = int(time.time())
    if bucket_hit(f"reset-confirm:{ip_hash}", 20, 3600, now):
        return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)

    payload = await json_body(request)
    if payload is None:
        return JSONResponse({"ok": False, "error": "bad_request"}, status_code=400)

    token = str(payload.get("token") or "").strip()
    password = str(payload.get("password") or "")
    if not token or len(token) > 200:
        return JSONResponse({"ok": False, "error": "invalid_token"}, status_code=410)
    if len(password) < 10 or len(password) > 200:
        return JSONResponse(
            {"ok": False, "error": "weak_password", "message": "Use at least 10 characters."},
            status_code=422,
        )

    digest = token_digest(token)
    with db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT r.user_id, r.expires_at, r.used_at FROM resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=? AND u.deleted_at IS NULL", (digest,)
        ).fetchone()
        if not row or row["used_at"] or row["expires_at"] < now:
            return JSONResponse({"ok": False, "error": "expired"}, status_code=410)
        conn.execute(
            "UPDATE resets SET used_at=? WHERE token_hash=?", (now, digest)
        )
        conn.execute(
            "UPDATE users SET pw_hash=?, verified_at=COALESCE(verified_at,?) WHERE id=?", (hash_password(password), now, row["user_id"])
        )
        # Every other session for this account is now stale.
        conn.execute("DELETE FROM sessions WHERE user_id=?", (row["user_id"],))
        conn.commit()

    log.info("password reset user_id=%s", row["user_id"])
    return JSONResponse({"ok": True})


# ── vault entries ───────────────────────────────────────────────

RELEASE_RULES = {"on_confirm", "on_date", "undecided"}


def clean(value: object, limit: int) -> str:
    return str(value or "").strip()[:limit]


def safe_link(value: object) -> str:
    """Keep only an http(s) address. Anything else is stored as empty."""
    raw = str(value or "").strip()[:500]
    if not raw:
        return ""
    if not raw.lower().startswith(("https://", "http://")):
        return ""
    if any(ch in raw for ch in ("\n", "\r", " ", "\t", "<", ">")):
        return ""
    return raw


@app.get("/api/entries")
async def list_entries(request: Request) -> JSONResponse:
    user = session_user(request)
    if not user:
        return JSONResponse({"ok": False, "error": "unauthenticated"}, status_code=401)
    with db() as conn:
        rows = conn.execute(
            "SELECT id, title, recipient, recipient_email, release_rule, kind, body, secret,"
            " link, file_name, file_type, file_size, status, released_at, release_views,"
            " release_token_expires, created_at, updated_at"
            " FROM entries WHERE user_id=? ORDER BY created_at DESC",
            (user["id"],),
        ).fetchall()
    return JSONResponse({"ok": True, "entries": [dict(r) for r in rows]})


@app.post("/api/entries")
async def create_entry(request: Request) -> JSONResponse:
    if not same_origin(request):
        return JSONResponse({"ok": False, "error": "cross_origin"}, status_code=403)
    user = session_user(request)
    if not user:
        return JSONResponse({"ok": False, "error": "unauthenticated"}, status_code=401)

    ip_hash = hash_ip(client_ip(request))
    now = int(time.time())
    if bucket_hit(f"entry:{ip_hash}", 60, 3600, now):
        return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)

    payload = await json_body(request)
    if payload is None:
        return JSONResponse({"ok": False, "error": "bad_request"}, status_code=400)

    title = clean(payload.get("title"), 120)
    recipient = clean(payload.get("recipient"), 120)
    recipient_email = normalise_email(payload.get("recipient_email")) if payload.get("recipient_email") else ""
    rule = clean(payload.get("release_rule"), 20) or "undecided"
    kind = clean(payload.get("kind"), 20) or "note"
    secret = str(payload.get("secret") or "").strip()[:4000]
    link = safe_link(payload.get("link"))
    body = str(payload.get("body") or "")[:20000]

    if not title:
        return JSONResponse(
            {"ok": False, "error": "invalid_title", "message": "Give the entry a name."},
            status_code=422,
        )
    if rule not in RELEASE_RULES:
        rule = "undecided"
    if kind not in ENTRY_KINDS:
        kind = "note"
    if payload.get("recipient_email") and not recipient_email:
        return JSONResponse(
            {"ok": False, "error": "invalid_recipient", "message": "That recipient address is not valid."},
            status_code=422,
        )

    with db() as conn:
        cur = conn.execute(
            "INSERT INTO entries (user_id, title, recipient, recipient_email, release_rule, kind,"
            " secret, link, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user["id"], title, recipient, recipient_email, rule, kind, secret, link, body, now, now),
        )
        entry_id = cur.lastrowid
    log.info("entry created user_id=%s", user["id"])
    return JSONResponse({"ok": True, "id": entry_id}, status_code=201)


@app.delete("/api/entries/{entry_id}")
async def delete_entry(entry_id: int, request: Request) -> JSONResponse:
    if not same_origin(request):
        return JSONResponse({"ok": False, "error": "cross_origin"}, status_code=403)
    user = session_user(request)
    if not user:
        return JSONResponse({"ok": False, "error": "unauthenticated"}, status_code=401)
    with db() as conn:
        row = conn.execute(
            "SELECT file_path FROM entries WHERE id=? AND user_id=?", (entry_id, user["id"])
        ).fetchone()
        cur = conn.execute(
            "DELETE FROM entries WHERE id=? AND user_id=?", (entry_id, user["id"])
        )
    if cur.rowcount == 0:
        return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
    if row and row["file_path"]:
        drop_media(row["file_path"])
    return JSONResponse({"ok": True})


# ── attachments ─────────────────────────────────────────────────


def same_origin_only(request: Request) -> bool:
    """For raw uploads, which carry the file's own content type."""
    origin = (request.headers.get("origin") or "").rstrip("/")
    return not origin or origin in ALLOWED_ORIGINS


def drop_media(rel: str) -> None:
    try:
        path = (MEDIA_DIR / rel).resolve()
        if MEDIA_DIR.resolve() in path.parents:
            path.unlink(missing_ok=True)
    except OSError:
        log.warning("media delete failed")


def stored_media(entry: sqlite3.Row) -> Path | None:
    rel = str(entry["file_path"] or "").strip()
    if not rel:
        return None
    try:
        path = (MEDIA_DIR / rel).resolve()
    except OSError:
        return None
    if MEDIA_DIR.resolve() not in path.parents:
        return None
    return path if path.is_file() else None


def media_ok(suffix: str, head: bytes) -> bool:
    marks = MEDIA_MAGIC.get(suffix)
    if not marks:
        return True
    if suffix in {".mp4", ".m4a"}:
        return head[4:8] == b"ftyp" or any(head.startswith(m) for m in marks)
    if suffix == ".webp":
        return head.startswith(b"RIFF") and head[8:12] == b"WEBP"
    return any(head.startswith(m) for m in marks)


def media_url(prefix: str, entry_id: int, entry: sqlite3.Row) -> str:
    if not entry["file_path"]:
        return ""
    return f"{prefix}/{entry_id}/file" if prefix.startswith("/api/entries") else f"{prefix}/{entry_id}"


@app.post("/api/entries/{entry_id}/file")
async def upload_file(entry_id: int, request: Request) -> JSONResponse:
    if not same_origin_only(request):
        return JSONResponse({"ok": False, "error": "cross_origin"}, status_code=403)
    user = session_user(request)
    if not user:
        return JSONResponse({"ok": False, "error": "unauthenticated"}, status_code=401)

    ip_hash = hash_ip(client_ip(request))
    now = int(time.time())
    if bucket_hit(f"upload:{ip_hash}", 20, 3600, now):
        return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)

    with db() as conn:
        row = conn.execute(
            "SELECT id, file_path FROM entries WHERE id=? AND user_id=?",
            (entry_id, user["id"]),
        ).fetchone()
    if not row:
        return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)

    declared = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    suffix = MEDIA_TYPES.get(declared)
    if not suffix:
        return JSONResponse(
            {"ok": False, "error": "unsupported_type",
             "message": "Images, PDF, video, audio and text files only."},
            status_code=415,
        )

    try:
        length = int(request.headers.get("content-length") or 0)
    except ValueError:
        length = 0
    if length > MEDIA_MAX_BYTES:
        return JSONResponse({"ok": False, "error": "too_large"}, status_code=413)

    raw = await request.body()
    if not raw:
        return JSONResponse({"ok": False, "error": "empty"}, status_code=422)
    if len(raw) > MEDIA_MAX_BYTES:
        return JSONResponse({"ok": False, "error": "too_large"}, status_code=413)
    if not media_ok(suffix, raw[:16]):
        return JSONResponse({"ok": False, "error": "bad_file"}, status_code=415)

    rel = f"{user['id']}/{entry_id}-{secrets.token_hex(8)}{suffix}"
    target = MEDIA_DIR / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(target.parent, 0o700)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(raw)
    os.chmod(target, 0o600)

    name = clean(request.headers.get("x-file-name") or f"attachment{suffix}", 120)
    name = "".join(ch for ch in name if ch.isprintable() and ch not in '\\/<>:"|?*').strip()
    if not name:
        name = f"attachment{suffix}"
    if not name.lower().endswith(suffix):
        name = f"{name}{suffix}"

    # Retain previous attachments in private storage for recovery.
    with db() as conn:
        conn.execute(
            "UPDATE entries SET file_name=?, file_type=?, file_size=?, file_path=?, updated_at=?"
            " WHERE id=? AND user_id=?",
            (name, declared, len(raw), rel, now, entry_id, user["id"]),
        )
    log.info("media stored user_id=%s entry_id=%s bytes=%s", user["id"], entry_id, len(raw))
    return JSONResponse(
        {"ok": True, "file_name": name, "file_type": declared, "file_size": len(raw)},
        status_code=201,
    )


@app.get("/api/entries/{entry_id}/file")
async def read_owner_file(entry_id: int, request: Request) -> Response:
    user = session_user(request)
    if not user:
        return JSONResponse({"ok": False, "error": "unauthenticated"}, status_code=401)
    with db() as conn:
        row = conn.execute(
            "SELECT id, file_path, file_name, file_type FROM entries WHERE id=? AND user_id=?",
            (entry_id, user["id"]),
        ).fetchone()
    path = stored_media(row) if row else None
    if not path:
        return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
    return FileResponse(
        path,
        media_type=row["file_type"] or "application/octet-stream",
        filename=row["file_name"] or path.name,
        content_disposition_type="inline",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


# ── handoff ─────────────────────────────────────────────────────


def mask_email(address: str) -> str:
    """jane@example.com becomes ja**@example.com, so a wrong address learns little."""
    local, _, domain = address.partition("@")
    if not domain or not local:
        return "the sender"
    keep = local[:2] if len(local) > 2 else local[:1]
    return f"{keep}{'*' * max(1, len(local) - len(keep))}@{domain}"


def owned_entry(entry_id: int, user_id: int) -> sqlite3.Row | None:
    with db() as conn:
        return conn.execute(
            "SELECT id, title, recipient, recipient_email, body, status,"
            " release_token_hash FROM entries WHERE id=? AND user_id=?",
            (entry_id, user_id),
        ).fetchone()


@app.post("/api/entries/{entry_id}/release")
async def release_entry(entry_id: int, request: Request) -> JSONResponse:
    """Send the recipient a private link. The contents stay on this server."""
    if not same_origin(request):
        return JSONResponse({"ok": False, "error": "cross_origin"}, status_code=403)
    user = session_user(request)
    if not user:
        return JSONResponse({"ok": False, "error": "unauthenticated"}, status_code=401)

    ip_hash = hash_ip(client_ip(request))
    now = int(time.time())
    if bucket_hit(f"release:{ip_hash}", 20, 3600, now):
        return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)

    row = owned_entry(entry_id, user["id"])
    if not row:
        return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
    if not row["recipient_email"]:
        return JSONResponse(
            {
                "ok": False,
                "error": "no_recipient",
                "message": "Add the recipient's email to this entry first.",
            },
            status_code=422,
        )
    if row["status"] == "sent" and row["release_token_hash"]:
        return JSONResponse({"ok": False, "error": "already_sent"}, status_code=409)

    token = secrets.token_urlsafe(32)
    expires = now + RELEASE_DAYS * 86400
    with db() as conn:
        conn.execute(
            "UPDATE entries SET status='sent', released_at=?, release_token_hash=?,"
            " release_token_expires=?, release_views=0, updated_at=?"
            " WHERE id=? AND user_id=?",
            (now, token_digest(token), expires, now, entry_id, user["id"]),
        )

    link = f"{PUBLIC_URL}/release?token={token}"
    sender = mask_email(user["email"])
    heading = escape(row["title"])
    body_html = f"""<tr><td style="font-size:15px;line-height:1.7;color:#B8B4AE;padding-bottom:18px">
{sender} has asked that this reach you.</td></tr>
<tr><td style="font-size:15px;line-height:1.7;color:#F2F0EC;padding-bottom:22px">
{heading}</td></tr>
<tr><td style="font-size:15px;line-height:1.7;color:#B8B4AE;padding-bottom:26px">
The note itself is not in this email. Open the link below to read it. The link is private to you,
expires in {RELEASE_DAYS} days, and can be closed by the sender at any time.</td></tr>
<tr><td style="padding-bottom:30px">
<a href="{link}" style="display:inline-block;background:#EDE9E1;color:#0A0A0A;text-decoration:none;
padding:14px 22px;border-radius:10px;font-weight:600">Open the note</a></td></tr>
<tr><td style="font-size:13px;line-height:1.7;color:#6F6B66;padding-bottom:24px">
If you were not expecting this, ignore it and nothing further happens.</td></tr>"""

    text = (
        f"{sender} has asked that this reach you.\n\n"
        f"{row['title']}\n\n"
        f"Read it here, privately: {link}\n"
        f"The link expires in {RELEASE_DAYS} days and can be closed by the sender at any time.\n"
    )

    mail_pool.submit(
        send_mail,
        row["recipient_email"],
        "A private message from AfterKey",
        mail_shell("Something was left for you.", body_html),
        text,
    )
    log.info("entry released user_id=%s entry_id=%s", user["id"], entry_id)
    return JSONResponse(
        {
            "ok": True,
            "link": link,
            "expires_at": expires,
            "recipient": row["recipient_email"],
        }
    )


@app.post("/api/entries/{entry_id}/cancel")
async def cancel_release(entry_id: int, request: Request) -> JSONResponse:
    """Close a sent link. Anyone still holding it gets nothing."""
    if not same_origin(request):
        return JSONResponse({"ok": False, "error": "cross_origin"}, status_code=403)
    user = session_user(request)
    if not user:
        return JSONResponse({"ok": False, "error": "unauthenticated"}, status_code=401)

    with db() as conn:
        cur = conn.execute(
            "UPDATE entries SET status='sealed', released_at=NULL, release_token_hash=NULL,"
            " release_token_expires=NULL, release_views=0, updated_at=?"
            " WHERE id=? AND user_id=?",
            (int(time.time()), entry_id, user["id"]),
        )
    if cur.rowcount == 0:
        return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
    log.info("release cancelled user_id=%s entry_id=%s", user["id"], entry_id)
    return JSONResponse({"ok": True})


@app.get("/api/release/{token}")
async def read_release(token: str, request: Request) -> JSONResponse:
    """What the recipient's browser asks for. No account, no cookie, one token."""
    ip_hash = hash_ip(client_ip(request))
    now = int(time.time())
    if not token or len(token) > 200:
        return JSONResponse({"ok": False, "error": "expired"}, status_code=410)
    if bucket_hit(f"release-view:{ip_hash}", 60, 3600, now):
        return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)

    digest = token_digest(token)
    with db() as conn:
        row = conn.execute(
            "SELECT e.id, e.user_id, e.title, e.recipient, e.body, e.released_at,"
            " e.release_token_expires, e.release_views, u.email AS owner"
            " FROM entries e JOIN users u ON u.id = e.user_id"
            " WHERE e.release_token_hash=? AND e.status='sent'",
            (digest,),
        ).fetchone()
        if (
            not row
            or row["released_at"] is None
            or not row["release_token_expires"]
            or row["release_token_expires"] < now
            or row["release_views"] >= RELEASE_MAX_VIEWS
        ):
            return JSONResponse({"ok": False, "error": "expired"}, status_code=410)
        first_open = row["release_views"] == 0
        conn.execute(
            "UPDATE entries SET release_views = release_views + 1 WHERE id=?", (row["id"],)
        )

    if first_open:
        opened = f"{row['owner']} opened \u201c{row['title']}\u201d"
        html = mail_shell(
            "Your entry was opened.",
            f"""<tr><td style="font-size:15px;line-height:1.7;color:#B8B4AE;padding-bottom:20px">
The person you addressed has opened <strong style="color:#F2F0EC">{escape(row['title'])}</strong>.</td></tr>
<tr><td style="font-size:15px;line-height:1.7;color:#B8B4AE;padding-bottom:20px">
The link stays open for {RELEASE_DAYS} days unless you close it from the vault.</td></tr>""",
        )
        mail_pool.submit(
            send_mail,
            row["owner"],
            "Your AfterKey entry was opened",
            html,
            opened + f"\n\nClose it any time: {PUBLIC_URL}/app\n",
        )
        log.info("release first open entry_id=%s", row["id"])

    return JSONResponse(
        {
            "ok": True,
            "title": row["title"],
            "body": row["body"],
            "from": mask_email(row["owner"]),
            "recipient": row["recipient"],
            "released_at": row["released_at"],
            "expires_at": row["release_token_expires"],
        }
    )


# ── legacy access ─────────────────────────────────────────────────
#
# The entry link above hands over one note. Legacy access hands over the whole
# vault: the person the owner names opens a private link and reads every entry,
# recipient and note in one place, for as long as the owner allows it.
#
# It is deliberately read-only. It sets no password, cannot reset one, cannot
# send, edit or delete anything, and the owner can withdraw it at any moment.
# The token is stored only as a SHA-256 digest, and it also lives in an HttpOnly
# cookie scoped to /api/legacy so the heir can come back without keeping a URL.


def heir_rows(user_id: int) -> list[sqlite3.Row]:
    with db() as conn:
        return conn.execute(
            "SELECT id, name, email, status, invited_at, claimed_at, last_seen,"
            " token_expires FROM heirs WHERE user_id=? AND status != 'revoked'"
            " ORDER BY created_at",
            (user_id,),
        ).fetchall()


def user_email(user_id: int) -> str:
    with db() as conn:
        row = conn.execute("SELECT email FROM users WHERE id=?", (user_id,)).fetchone()
    return row["email"] if row else ""


def vault_snapshot(user_id: int, heir: sqlite3.Row) -> dict:
    """The whole account as the owner sees it, handed to the person they named.

    Every kind of record travels: notes and letters, account credentials,
    links and maps, documents, photographs and video. Nothing is filtered,
    because the point of naming someone is that they receive all of it.
    """
    with db() as conn:
        owner = conn.execute(
            "SELECT email, created_at FROM users WHERE id=?", (user_id,)
        ).fetchone()
        rows = conn.execute(
            "SELECT id, title, recipient, recipient_email, release_rule, kind, body,"
            " secret, link, file_name, file_type, file_size, file_path,"
            " status, released_at, created_at, updated_at FROM entries"
            " WHERE user_id=? ORDER BY created_at",
            (user_id,),
        ).fetchall()

    entries = []
    for row in rows:
        item = dict(row)
        has_file = bool(str(item.pop("file_path") or "").strip())
        item["media"] = f"/api/legacy/file/{item['id']}" if has_file else ""
        entries.append(item)

    return {
        "ok": True,
        "owner_email": owner["email"] if owner else "",
        "owner_since": owner["created_at"] if owner else None,
        "heir": {"id": heir["id"], "name": heir["name"], "email": heir["email"]},
        "entries": entries,
    }


def set_legacy_cookie(response: Response, token: str, seconds: int) -> None:
    response.set_cookie(
        LEGACY_COOKIE,
        token,
        max_age=max(60, min(int(seconds), LEGACY_DAYS * 86400)),
        httponly=True,
        secure=True,
        samesite="lax",
        path="/api/legacy",
    )


def heir_from_token(token: str) -> sqlite3.Row | None:
    if not token or len(token) > 200:
        return None
    now = int(time.time())
    with db() as conn:
        row = conn.execute(
            "SELECT id, user_id, name, email, status, token_expires, claimed_at"
            " FROM heirs WHERE token_hash=? AND status IN ('invited', 'active')",
            (token_digest(token),),
        ).fetchone()
    if not row or not row["token_expires"] or row["token_expires"] < now:
        return None
    return row


@app.get("/api/heirs")
async def list_heirs(request: Request) -> JSONResponse:
    user = session_user(request)
    if not user:
        return JSONResponse({"ok": False, "error": "unauthenticated"}, status_code=401)
    return JSONResponse({"ok": True, "heirs": [dict(r) for r in heir_rows(user["id"])]})


@app.post("/api/heirs")
async def create_heir(request: Request) -> JSONResponse:
    if not same_origin(request):
        return JSONResponse({"ok": False, "error": "cross_origin"}, status_code=403)
    user = session_user(request)
    if not user:
        return JSONResponse({"ok": False, "error": "unauthenticated"}, status_code=401)

    payload = await json_body(request)
    if payload is None:
        return JSONResponse({"ok": False, "error": "bad_request"}, status_code=400)

    name = clean(payload.get("name"), 80)
    email = normalise_email(payload.get("email"))
    if not email:
        return JSONResponse(
            {"ok": False, "error": "invalid_email", "message": "That address is not valid."},
            status_code=422,
        )
    if email == user["email"].lower():
        return JSONResponse(
            {"ok": False, "error": "self", "message": "Name someone other than yourself."},
            status_code=422,
        )

    now = int(time.time())
    with db() as conn:
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM heirs WHERE user_id=? AND status != 'revoked'",
            (user["id"],),
        ).fetchone()["c"]
        if count >= LEGACY_MAX_HEIRS:
            return JSONResponse(
                {"ok": False, "error": "limit", "message": "You can name up to five people."},
                status_code=422,
            )
        existing = conn.execute(
            "SELECT id FROM heirs WHERE user_id=? AND email=?", (user["id"], email)
        ).fetchone()
        if existing:
            return JSONResponse({"ok": True, "id": existing["id"], "status": "exists"})
        cur = conn.execute(
            "INSERT INTO heirs (user_id, name, email, status, created_at)"
            " VALUES (?, ?, ?, 'ready', ?)",
            (user["id"], name, email, now),
        )
        heir_id = cur.lastrowid
    log.info("heir added user_id=%s", user["id"])
    return JSONResponse({"ok": True, "id": heir_id, "status": "ready"}, status_code=201)


@app.post("/api/heirs/{heir_id}/invite")
async def invite_heir(heir_id: int, request: Request) -> JSONResponse:
    """Hand the whole vault to one named person. Explicit confirmation required."""
    if not same_origin(request):
        return JSONResponse({"ok": False, "error": "cross_origin"}, status_code=403)
    user = session_user(request)
    if not user:
        return JSONResponse({"ok": False, "error": "unauthenticated"}, status_code=401)

    payload = await json_body(request)
    if payload is None or payload.get("confirm") is not True:
        return JSONResponse(
            {
                "ok": False,
                "error": "confirm_required",
                "message": "Confirm that this person should be able to read the vault.",
            },
            status_code=428,
        )

    now = int(time.time())
    if bucket_hit(f"heir-invite:{hash_ip(client_ip(request))}", 10, 3600, now):
        return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)

    with db() as conn:
        row = conn.execute(
            "SELECT id, name, email FROM heirs WHERE id=? AND user_id=? AND status != 'revoked'",
            (heir_id, user["id"]),
        ).fetchone()
    if not row:
        return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)

    token = secrets.token_urlsafe(32)
    expires = now + LEGACY_DAYS * 86400
    with db() as conn:
        conn.execute(
            "UPDATE heirs SET status='invited', token_hash=?, token_expires=?,"
            " invited_at=?, claimed_at=NULL WHERE id=? AND user_id=?",
            (token_digest(token), expires, now, heir_id, user["id"]),
        )

    link = f"{PUBLIC_URL}/legacy?token={token}"
    who = escape(row["name"] or "Someone who trusted you")
    owner = mask_email(user["email"])
    body_html = f"""<tr><td style="font-size:15px;line-height:1.7;color:#B8B4AE;padding-bottom:18px">
{escape(owner)} has named you as the person who should receive their AfterKey account.</td></tr>
<tr><td style="font-size:15px;line-height:1.7;color:#F2F0EC;padding-bottom:22px">
Opening the link hands you the whole space: every letter, every account and password, every document,
every photograph and video, every place and every instruction they left behind.</td></tr>
<tr><td style="font-size:15px;line-height:1.7;color:#B8B4AE;padding-bottom:26px">
It opens the same vault they see, and you can keep it open as long as they allow. Treat the link as a key:
whoever holds it can open the account.</td></tr>
<tr><td style="padding-bottom:30px">
<a href="{link}" style="display:inline-block;background:#EDE9E1;color:#0A0A0A;text-decoration:none;
padding:14px 22px;border-radius:10px;font-weight:600">Open the vault</a></td></tr>
<tr><td style="font-size:13px;line-height:1.7;color:#6F6B66;padding-bottom:24px">
If this was not meant for you, ignore it and nothing further happens. {who}.</td></tr>"""

    text = (
        f"{owner} has named you as the person who should receive their AfterKey account.\n\n"
        f"Open it here: {link}\n\n"
        "The link hands you the whole space: letters, accounts and passwords, documents,\n"
        "photographs and video, places and instructions. It opens the same vault they see.\n"
        "Treat the link as a key: whoever holds it can open the account.\n"
    )

    mail_pool.submit(
        send_mail,
        row["email"],
        "You have been trusted with a legacy",
        mail_shell("Something was left in your keeping.", body_html),
        text,
    )
    log.info("heir invited user_id=%s heir_id=%s", user["id"], heir_id)
    return JSONResponse({"ok": True, "email": row["email"], "expires_at": expires})


@app.delete("/api/heirs/{heir_id}")
async def revoke_heir(heir_id: int, request: Request) -> JSONResponse:
    """Close the vault for this person, immediately and for good."""
    if not same_origin(request):
        return JSONResponse({"ok": False, "error": "cross_origin"}, status_code=403)
    user = session_user(request)
    if not user:
        return JSONResponse({"ok": False, "error": "unauthenticated"}, status_code=401)
    with db() as conn:
        cur = conn.execute(
            "UPDATE heirs SET status='revoked', token_hash=NULL, token_expires=NULL"
            " WHERE id=? AND user_id=?",
            (heir_id, user["id"]),
        )
    if cur.rowcount == 0:
        return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
    log.info("heir revoked user_id=%s heir_id=%s", user["id"], heir_id)
    return JSONResponse({"ok": True})


@app.get("/api/legacy/me")
async def legacy_me(request: Request) -> JSONResponse:
    token = request.cookies.get(LEGACY_COOKIE) or ""
    row = heir_from_token(token)
    if not row:
        return JSONResponse({"ok": False, "error": "expired"}, status_code=401)
    with db() as conn:
        conn.execute("UPDATE heirs SET last_seen=? WHERE id=?", (int(time.time()), row["id"]))
    snap = vault_snapshot(row["user_id"], row)
    snap["expires_at"] = row["token_expires"]
    return JSONResponse(snap)


@app.delete("/api/legacy/session")
async def legacy_sign_out(request: Request) -> JSONResponse:
    response = JSONResponse({"ok": True})
    response.delete_cookie(LEGACY_COOKIE, path="/api/legacy")
    return response


@app.get("/api/legacy/file/{entry_id}")
async def read_legacy_file(entry_id: int, request: Request) -> Response:
    """One attachment, for the heir's session only.

    The file never sits in the web root. The heir cookie is scoped to
    /api/legacy, so this route cannot be reached with the owner session and
    the owner route cannot be reached with the heir cookie.
    """
    token = request.cookies.get(LEGACY_COOKIE) or ""
    row = heir_from_token(token)
    if not row:
        return JSONResponse({"ok": False, "error": "expired"}, status_code=401)

    with db() as conn:
        entry = conn.execute(
            "SELECT file_path, file_name, file_type FROM entries WHERE id=? AND user_id=?",
            (entry_id, row["user_id"]),
        ).fetchone()
    path = stored_media(entry) if entry else None
    if not path:
        return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)

    headers = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}
    kind = (entry["file_type"] or "").lower()
    if kind.startswith(("image/", "video/", "audio/")) or kind == "application/pdf":
        return FileResponse(
            path,
            media_type=kind,
            content_disposition_type="inline",
            headers=headers,
        )
    return FileResponse(
        path,
        media_type=kind or "application/octet-stream",
        filename=entry["file_name"] or path.name,
        headers=headers,
    )


@app.get("/api/legacy/export")
async def legacy_export(request: Request) -> Response:
    """One plain-text copy of the whole record, for keeping offline."""
    token = request.cookies.get(LEGACY_COOKIE) or ""
    row = heir_from_token(token)
    if not row:
        return JSONResponse({"ok": False, "error": "expired"}, status_code=401)

    snap = vault_snapshot(row["user_id"], row)
    lines = [
        "AFTERKEY LEGACY RECORD",
        f"Owner: {snap['owner_email']}",
        f"Held by: {row['name'] or 'unnamed'} <{row['email']}>",
        f"Entries: {len(snap['entries'])}",
        "",
    ]
    for item in snap["entries"]:
        stamp = time.strftime("%Y-%m-%d", time.gmtime(item["created_at"]))
        lines += [
            "=" * 64,
            item["title"],
            f"Kind: {KIND_LABELS.get(item.get('kind') or 'note', 'Note')}",
            f"For: {item['recipient'] or 'unnamed'}"
            + (f" <{item['recipient_email']}>" if item["recipient_email"] else ""),
            f"Sealed: {stamp}  Status: {item['status']}",
        ]
        if item.get("secret"):
            lines += ["Credentials:", item["secret"]]
        if item.get("link"):
            lines += ["Link:", item["link"]]
        if item.get("file_name"):
            size = int(item.get("file_size") or 0)
            lines += [f"Attachment: {item['file_name']} ({size} bytes)"]
        lines += ["-" * 64, item.get("body") or "", ""]
    body = "\n".join(lines)
    return Response(
        content=body.encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="afterkey-legacy.txt"'},
    )


@app.get("/api/legacy/{token}")
async def open_legacy(token: str, request: Request) -> JSONResponse:
    """What the heir's browser asks for the first time. No account, one token."""
    now = int(time.time())
    ip_hash = hash_ip(client_ip(request))
    if not token or len(token) > 200:
        return JSONResponse({"ok": False, "error": "expired"}, status_code=410)
    if bucket_hit(f"legacy-view:{ip_hash}", 60, 3600, now):
        return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)

    row = heir_from_token(token)
    if not row:
        return JSONResponse({"ok": False, "error": "expired"}, status_code=410)

    first_open = row["claimed_at"] is None
    with db() as conn:
        conn.execute(
            "UPDATE heirs SET status='active', claimed_at=COALESCE(claimed_at, ?), last_seen=?"
            " WHERE id=?",
            (now, now, row["id"]),
        )

    snap = vault_snapshot(row["user_id"], row)
    snap["expires_at"] = row["token_expires"]
    response = JSONResponse(snap)
    set_legacy_cookie(response, token, row["token_expires"] - now)

    if first_open:
        html = mail_shell(
            "Your account was opened.",
            f"""<tr><td style="font-size:15px;line-height:1.7;color:#B8B4AE;padding-bottom:20px">
{escape(row['name'] or 'The person you named')} opened your vault and now has the whole account in front of them.</td></tr>
<tr><td style="font-size:15px;line-height:1.7;color:#B8B4AE;padding-bottom:20px">
That access stays open for a year unless you withdraw it here: {PUBLIC_URL}/app</td></tr>
<tr><td style="font-size:13px;line-height:1.7;color:#6F6B66">
If this should not have happened, withdraw the person's access now.</td></tr>""",
        )
        mail_pool.submit(
            send_mail,
            user_email(row["user_id"]),
            "Your AfterKey vault was opened",
            html,
            f"{row['name'] or 'The person you named'} opened your vault.\n"
            f"Withdraw access: {PUBLIC_URL}/app\n",
        )
        log.info("legacy first open heir_id=%s", row["id"])

    return response


import restoration
restoration.install(globals())


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("AFTERKEY_PORT", "8001")),
        log_level="warning",
        server_header=False,
        date_header=False,
        access_log=False,
    )
