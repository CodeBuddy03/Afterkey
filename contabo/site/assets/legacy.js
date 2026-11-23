// AfterKey — the account a named person opens. Read only: this file never calls
// a route that can change, send or delete anything.

const params = new URLSearchParams(location.search);
const token = (params.get("token") || "").trim();

const record = document.querySelector("[data-record]");
const state = document.querySelector("[data-state]");
const stateText = document.querySelector("[data-state-text]");
const intro = document.querySelector("[data-intro]");
const lede = document.querySelector("[data-lede]");
const badge = document.querySelector("[data-badge]");
const jump = document.querySelector("[data-jump]");
const counts = document.querySelector("[data-counts]");
const countEntries = document.querySelector("[data-count-entries]");
const countFiles = document.querySelector("[data-count-files]");
const countSecrets = document.querySelector("[data-count-secrets]");
const signOut = document.querySelector("[data-signout]");

const GROUPS = [
  { kind: "message", label: "Messages", blurb: "What they wanted you to hear." },
  { kind: "note", label: "Notes and instructions", blurb: "How things work, and what to do." },
  { kind: "account", label: "Accounts and passwords", blurb: "The logins they kept for you." },
  { kind: "document", label: "Documents", blurb: "Papers, records and files." },
  { kind: "media", label: "Photographs and video", blurb: "Kept for you to see." },
  { kind: "place", label: "Places", blurb: "Property, addresses and maps." },
];

const showState = (text, kind = "") => {
  if (!state) return;
  state.hidden = false;
  state.dataset.kind = kind;
  if (stateText) stateText.textContent = text;
};

const hideState = () => {
  if (state) state.hidden = true;
};

const day = (seconds) => {
  if (!seconds) return "";
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};

/* Credentials: shown masked until asked for, with copy and no autofill. */
const credentialBlock = (secret, title) => {
  const box = el("div", "secret");
  const head = el("div", "secret__head");
  head.append(el("span", "secret__label", "Credentials"));
  const value = el("code", "secret__value");
  value.textContent = "•".repeat(Math.min(28, Math.max(12, secret.length)));
  value.dataset.hidden = "true";

  const reveal = el("button", "secret__btn", "Show");
  reveal.type = "button";
  reveal.setAttribute("aria-label", "Show the credentials");
  reveal.addEventListener("click", () => {
    const hidden = value.dataset.hidden === "true";
    value.textContent = hidden ? secret : "•".repeat(Math.min(28, Math.max(12, secret.length)));
    value.dataset.hidden = hidden ? "false" : "true";
    reveal.textContent = hidden ? "Hide" : "Show";
  });

  const copy = el("button", "secret__btn", "Copy");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(secret);
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Select and copy";
      value.textContent = secret;
      value.dataset.hidden = "false";
    }
    setTimeout(() => {
      copy.textContent = "Copy";
    }, 2200);
  });

  head.append(reveal, copy);
  box.append(head, value);
  box.setAttribute("aria-label", `Credentials for ${title}`);
  return box;
};

const mediaBlock = (entry) => {
  if (!entry.media) return null;
  const type = (entry.file_type || "").toLowerCase();
  const wrap = el("figure", "media");
  const src = entry.media;

  if (type.startsWith("image/")) {
    const img = el("img");
    img.src = src;
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = entry.file_name || entry.title || "Photograph";
    wrap.append(img);
  } else if (type.startsWith("video/")) {
    const video = el("video");
    video.src = src;
    video.controls = true;
    video.preload = "metadata";
    video.playsInline = true;
    wrap.append(video);
  } else if (type.startsWith("audio/")) {
    const audio = el("audio");
    audio.src = src;
    audio.controls = true;
    audio.preload = "metadata";
    wrap.append(audio);
  } else if (type === "application/pdf") {
    const frame = el("iframe", "media__pdf");
    frame.src = src;
    frame.title = entry.file_name || "Document";
    frame.loading = "lazy";
    wrap.append(frame);
  }

  const bar = el("figcaption", "media__bar");
  const name = el("span", "media__name", entry.file_name || "Attachment");
  if (entry.file_size) {
    name.textContent = `${entry.file_name || "Attachment"} · ${Math.round(entry.file_size / 1024)} KB`;
  }
  const open = el("a", "media__open", "Open");
  open.href = src;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  const save = el("a", "media__open", "Save");
  save.href = src;
  save.download = entry.file_name || "";
  bar.append(name, open, save);
  wrap.append(bar);
  return wrap;
};

const renderEntry = (entry) => {
  const article = el("article", "entry");

  const head = el("div", "entry__head");
  head.append(el("h3", "entry__title", entry.title || "Untitled"));
  const group = GROUPS.find((g) => g.kind === (entry.kind || "note"));
  head.append(el("span", "entry__kind", group ? group.label.replace(/s$/, "") : "Note"));
  article.append(head);

  const meta = el("p", "entry__meta");
  const parts = [];
  if (entry.recipient) parts.push(`For ${entry.recipient}`);
  if (entry.created_at) parts.push(`Sealed ${day(entry.created_at)}`);
  if (entry.status === "released" && entry.released_at) parts.push(`Released ${day(entry.released_at)}`);
  meta.textContent = parts.join("  ·  ");
  if (parts.length) article.append(meta);

  if (entry.body) {
    article.append(el("p", "entry__body", entry.body));
  }

  if (entry.secret) article.append(credentialBlock(entry.secret, entry.title || "this record"));

  if (entry.link) {
    const row = el("p", "entry__link");
    row.append(el("span", "entry__link-label", "Link"));
    const a = el("a", "", entry.link);
    a.href = entry.link;
    a.target = "_blank";
    a.rel = "noopener noreferrer nofollow";
    row.append(a);
    article.append(row);
  }

  const media = mediaBlock(entry);
  if (media) article.append(media);

  return article;
};

const buildJump = (present) => {
  if (!jump) return;
  jump.replaceChildren();
  if (present.length < 2) {
    jump.hidden = true;
    return;
  }
  for (const group of present) {
    const a = el("a", "jump__item", group.label);
    a.href = `#g-${group.kind}`;
    jump.append(a);
  }
  jump.hidden = false;
};

const render = (data) => {
  if (!record) return;
  record.replaceChildren();

  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (intro) intro.hidden = false;

  const files = entries.filter((e) => e.media).length;
  const secrets = entries.filter((e) => e.secret).length;
  if (counts) counts.hidden = !entries.length;
  if (countEntries) countEntries.textContent = String(entries.length);
  if (countFiles) countFiles.textContent = String(files);
  if (countSecrets) countSecrets.textContent = String(secrets);

  if (lede) {
    const owner = data.owner_email || "the person who left this";
    const heldBy = data.heir && data.heir.name ? data.heir.name : "";
    const since = data.owner_since ? ` Their account has been kept since ${day(data.owner_since)}.` : "";
    lede.textContent = heldBy
      ? `${owner} named you, ${heldBy}, to receive this account. Everything they kept is open below.${since}`
      : `${owner} left this account in your keeping. Everything they kept is open below.${since}`;
  }
  if (badge && data.expires_at) {
    badge.textContent = `Open until ${day(data.expires_at)}`;
  }

  if (!entries.length) {
    record.append(el("p", "empty-entry", "The account is open but nothing has been written in it yet."));
    return;
  }

  const present = [];
  for (const group of GROUPS) {
    const items = entries.filter((e) => (e.kind || "note") === group.kind);
    if (items.length) present.push({ ...group, items });
  }
  const known = new Set(GROUPS.map((g) => g.kind));
  const other = entries.filter((e) => !known.has(e.kind || "note"));
  if (other.length) present.push({ kind: "other", label: "Other records", blurb: "Also left for you.", items: other });

  buildJump(present);

  for (const group of present) {
    const section = el("section", "group");
    section.id = `g-${group.kind}`;
    const head = el("header", "group__head");
    head.append(el("h2", "group__title", group.label));
    head.append(el("p", "group__blurb", group.blurb));
    head.append(el("span", "group__count", `${group.items.length}`));
    section.append(head);
    for (const entry of group.items) section.append(renderEntry(entry));
    record.append(section);
  }
};

const ask = async (url, options) => {
  const res = await fetch(url, { credentials: "same-origin", ...options });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { res, body };
};

const open = async () => {
  if (token) {
    try {
      history.replaceState(null, "", location.pathname);
    } catch {
      /* nothing to do */
    }
    const { res, body } = await ask(`/api/legacy/${encodeURIComponent(token)}`);
    if (res.ok && body && body.ok) {
      hideState();
      render(body);
      return;
    }
    if (res.status === 429) {
      showState("Too many attempts from this connection. Wait a few minutes and open the link again.", "error");
      return;
    }
    showState(
      "This link is no longer open. It may have expired, or the person who left it has withdrawn access. If you expected to open it, ask them for a fresh invitation.",
      "error"
    );
    return;
  }

  const { res, body } = await ask("/api/legacy/me");
  if (res.ok && body && body.ok) {
    hideState();
    render(body);
    return;
  }
  showState(
    "Open the private link you were sent. It is the only way in, and it stays open for as long as the person who left it allows.",
    "error"
  );
};

if (signOut) {
  signOut.addEventListener("click", async () => {
    signOut.disabled = true;
    try {
      await ask("/api/legacy/session", { method: "DELETE" });
    } catch {
      /* the cookie is scoped to this path either way */
    }
    location.replace("/");
  });
}

open().catch(() => {
  showState("Could not reach the server. Check the connection and open the link again.", "error");
});
