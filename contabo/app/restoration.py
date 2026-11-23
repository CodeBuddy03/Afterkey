"""Additive restoration of the deployed AfterKey application.

Invitation possession is never an access grant. Every inherited read is checked
against the recipient account, approved activation, and approved identity review.
"""
import hashlib
import hmac
import json
import secrets
import sqlite3
import time
from types import SimpleNamespace
from html import escape
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse

c = None


def now():
    return int(time.time())


def fail(message, status=400):
    raise HTTPException(status, detail=message)


def one(sql, args=()):
    with c.db() as db:
        return db.execute(sql, args).fetchone()


def rows(sql, args=()):
    with c.db() as db:
        return [dict(r) for r in db.execute(sql, args).fetchall()]


def run(sql, args=()):
    with c.db() as db:
        return db.execute(sql, args).lastrowid


def audit(actor, action, target):
    run('INSERT INTO audit_events(actor,action,target,created_at) VALUES(?,?,?,?)', (actor, action, str(target), now()))
    if actor:
        notify_user(actor,'AfterKey account activity',f'An action was recorded on your account: {action.replace("_"," ")}.\nIf you did not expect this, sign in to review your account and active sessions.\n{c.PUBLIC_URL}/app/settings')


def notify_user(uid,subject,text):
    u=one('SELECT * FROM users WHERE id=? AND deleted_at IS NULL',(uid,))
    if u and u['verified_at'] and json.loads(u['preferences']).get('activity_email',True):
        run('INSERT INTO mail_outbox(user_id,subject,body,created_at) VALUES(?,?,?,?)',(uid,subject,text,now()))


def migrate():
    columns = {
        'users': [('name', "TEXT NOT NULL DEFAULT ''"), ('verified_at', 'INTEGER'), ('deleted_at', 'INTEGER'),
                  ('preferences', "TEXT NOT NULL DEFAULT '{}'"), ('recovery_ready', 'INTEGER NOT NULL DEFAULT 0')],
        'entries': [('deleted_at', 'INTEGER')],
        'heirs': [('role', "TEXT NOT NULL DEFAULT 'primary'"), ('steward', 'INTEGER NOT NULL DEFAULT 0')],
    }
    with c.db() as db:
        for table, additions in columns.items():
            existing = {r['name'] for r in db.execute(f'PRAGMA table_info({table})')}
            for name, ddl in additions:
                if name not in existing:
                    db.execute(f'ALTER TABLE {table} ADD COLUMN {name} {ddl}')
        db.executescript('''
        CREATE TABLE IF NOT EXISTS legacy_plans (
          user_id INTEGER PRIMARY KEY REFERENCES users(id), frequency INTEGER NOT NULL DEFAULT 30,
          grace INTEGER NOT NULL DEFAULT 14, last_checkin INTEGER NOT NULL,
          generation_enabled INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS checkins (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS activations (
          id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL, requested_by INTEGER NOT NULL,
          reason TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
          created_at INTEGER NOT NULL, reviewed_by INTEGER, reviewed_at INTEGER, decision TEXT);
        CREATE UNIQUE INDEX IF NOT EXISTS one_open_activation ON activations(owner_id) WHERE status IN ('pending','approved');
        CREATE TABLE IF NOT EXISTS claims (
          id INTEGER PRIMARY KEY, heir_id INTEGER NOT NULL, activation_id INTEGER NOT NULL,
          invitation_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL,
          session_hash TEXT UNIQUE, session_expires INTEGER, email_verified_at INTEGER,
          identity_name TEXT, relationship TEXT, evidence TEXT, identity_status TEXT NOT NULL DEFAULT 'unsubmitted',
          reviewed_by INTEGER, reviewed_at INTEGER, decision TEXT,
          recipient_id INTEGER, claimed_at INTEGER, revoked_at INTEGER, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS challenges (
          scope TEXT PRIMARY KEY, digest TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS recovery_codes (
          digest TEXT PRIMARY KEY, user_id INTEGER NOT NULL, used_at INTEGER);
        CREATE TABLE IF NOT EXISTS audit_events (
          id INTEGER PRIMARY KEY, actor INTEGER, action TEXT NOT NULL, target TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS reminders (
          user_id INTEGER NOT NULL, due_at INTEGER NOT NULL, sent_at INTEGER NOT NULL, PRIMARY KEY(user_id,due_at));
        CREATE TABLE IF NOT EXISTS mail_outbox (
          id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
          created_at INTEGER NOT NULL, sent_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0);
        ''')


def user(request):
    u = c.session_user(request)
    if not u:
        fail('Please sign in to continue.', 401)
    return one('SELECT * FROM users WHERE id=? AND deleted_at IS NULL', (u['id'],))


def is_admin(u):
    return bool(u and u['verified_at'] and c.ADMIN_EMAIL and u['email'].lower() == c.ADMIN_EMAIL.lower())


def admin(request):
    u = user(request)
    if not is_admin(u):
        fail('A verified review administrator is required.', 403)
    return u


async def payload(request):
    if not c.same_origin(request):
        fail('This request must come from AfterKey.', 403)
    p = await c.json_body(request)
    if p is None:
        fail('The submitted information could not be read.')
    return p


def limit(request, scope, count=10, window=3600):
    if c.bucket_hit(f'restore:{scope}:{c.hash_ip(c.client_ip(request))}', count, window, now()):
        fail('Too many attempts. Please try again later.', 429)


def password(value):
    value = str(value or '')
    if not 10 <= len(value) <= 200:
        fail('Use a password with 10–200 characters.', 422)
    return value


def reauth(request, u, p):
    limit(request, f'password:{u["id"]}', 10, 900)
    if not c.verify_password(str(p.get('password', ''))[:200], u['pw_hash']):
        fail('Your current password did not match.', 403)


def send(to, subject, text):
    # Delivery failure must not be represented as a successful OTP or invitation.
    if not c.send_mail(to, subject, c.mail_shell(subject, '<tr><td>' + escape(text).replace('\n', '<br>') + '</td></tr>'), text):
        fail('Email could not be delivered. Please try again shortly.', 503)


def otp_send(request, scope, email):
    limit(request, f'otp-send:{scope}', 4, 3600)
    code = f'{secrets.randbelow(1000000):06d}'
    nonce = secrets.token_hex(16)
    digest = nonce + ':' + hashlib.sha256((nonce + code).encode()).hexdigest()
    run('INSERT OR REPLACE INTO challenges(scope,digest,expires_at,attempts) VALUES(?,?,?,0)', (scope, digest, now()+600))
    send(email, 'Your AfterKey verification code', f'Your code is {code}. It expires in 10 minutes.\nThis verifies your email only. It does not authorize inheritance.\nNever share this code.')


def otp_check(scope, value):
    code = str(value or '')
    with c.db() as db:
        db.execute('BEGIN IMMEDIATE')
        r = db.execute('SELECT * FROM challenges WHERE scope=?', (scope,)).fetchone()
        if not r or r['expires_at'] < now() or r['attempts'] >= 5:
            db.commit()
            fail('Code expired or too many attempts. Request a new code.', 422)
        db.execute('UPDATE challenges SET attempts=attempts+1 WHERE scope=?', (scope,))
        nonce, digest = r['digest'].split(':')
        valid = len(code) == 6 and code.isdigit() and hmac.compare_digest(digest, hashlib.sha256((nonce+code).encode()).hexdigest())
        if valid:
            db.execute('DELETE FROM challenges WHERE scope=?', (scope,))
        db.commit()
    if not valid:
        fail('That code did not match.', 422)


def plan(uid):
    run('INSERT OR IGNORE INTO legacy_plans(user_id,last_checkin) VALUES(?,?)', (uid, now()))
    p = dict(one('SELECT * FROM legacy_plans WHERE user_id=?', (uid,)))
    p['due_at'] = p['last_checkin'] + p['frequency']*86400
    p['grace_ends_at'] = p['due_at'] + p['grace']*86400
    p['checkin_status'] = 'current' if now() <= p['due_at'] else ('grace period' if now() <= p['grace_ends_at'] else 'follow-up needed')
    a = one("SELECT * FROM activations WHERE owner_id=? AND status IN ('pending','approved') ORDER BY id DESC LIMIT 1", (uid,))
    p['activation'] = dict(a) if a else None
    return p


def grant(request, claim_id, steward=False):
    u = user(request)
    g = one('''SELECT cl.*,h.user_id AS owner_id,h.steward FROM claims cl
      JOIN heirs h ON h.id=cl.heir_id JOIN activations a ON a.id=cl.activation_id
      JOIN users owner ON owner.id=h.user_id
      WHERE cl.id=? AND cl.recipient_id=? AND cl.claimed_at IS NOT NULL
      AND cl.revoked_at IS NULL AND cl.identity_status='approved' AND cl.email_verified_at IS NOT NULL
      AND a.status='approved' AND h.status!='revoked' AND owner.deleted_at IS NULL''', (claim_id,u['id']))
    if not g or (steward and not g['steward']):
        fail('You do not have approved access to this family space.', 403)
    return u,g


def claim_session(request):
    token = request.cookies.get('ak_claim','')
    r = one('''SELECT cl.*,h.email,h.name,h.user_id AS owner_id,h.status AS heir_status,a.status AS activation_status
      FROM claims cl JOIN heirs h ON h.id=cl.heir_id JOIN activations a ON a.id=cl.activation_id
      JOIN users owner ON owner.id=h.user_id
      WHERE cl.session_hash=? AND cl.session_expires>? AND cl.expires_at>? AND cl.revoked_at IS NULL
      AND h.status!='revoked' AND a.status='approved' AND owner.deleted_at IS NULL''', (c.token_digest(token),now(),now())) if token else None
    if not r:
        fail('Your invitation session expired. Open the invitation again.', 401)
    return r


def public_entry(e):
    return {k:v for k,v in dict(e).items() if k not in ('file_path','release_token_hash','user_id','deleted_at')}


def entry_owned(uid, eid):
    e = one('SELECT * FROM entries WHERE id=? AND user_id=? AND deleted_at IS NULL', (eid,uid))
    if not e:
        fail('This vault item was not found.',404)
    return e


def install(core):
    global c
    c = SimpleNamespace(**core)
    app = c.app
    # Remove bearer-access handlers and superseded routes, including their file/export routes.
    replaced = {'/api/heirs','/api/heirs/{heir_id}/invite','/api/heirs/{heir_id}',
                '/api/entries','/api/entries/{entry_id}','/api/entries/{entry_id}/file',
                '/api/entries/{entry_id}/release','/api/entries/{entry_id}/cancel'}
    app.router.routes[:] = [r for r in app.router.routes if not (r.path in replaced or r.path.startswith(('/api/legacy','/api/release')))]

    @app.api_route('/api/legacy/{path:path}', methods=['GET','POST','DELETE'])
    @app.api_route('/api/release/{path:path}', methods=['GET','POST'])
    async def retired(path: str):
        fail('This old link no longer grants access. A new verified invitation is required.',410)

    @app.get('/api/account')
    async def account(request: Request):
        u = user(request)
        return {'email':u['email'],'name':u['name'],'verified':bool(u['verified_at']),
                'recovery_ready':bool(u['recovery_ready']),'preferences':json.loads(u['preferences']), 'admin':is_admin(u)}

    @app.patch('/api/account')
    async def update_account(request: Request):
        u,p = user(request),await payload(request)
        prefs = p.get('preferences',{})
        if not isinstance(prefs,dict): fail('Invalid preferences.',422)
        allowed = {k:bool(prefs.get(k,True)) for k in ('life_check_email','activity_email')}
        allowed['profile_visible'] = bool(prefs.get('profile_visible',False))
        run('UPDATE users SET name=?,preferences=? WHERE id=?', (c.clean(p.get('name'),100),json.dumps(allowed),u['id']))
        return {'ok':True}

    @app.post('/api/account/email/send')
    async def email_send(request: Request):
        u = user(request); await payload(request)
        otp_send(request,f'user:{u["id"]}',u['email'])
        return {'ok':True}

    @app.post('/api/account/email/verify')
    async def email_verify(request: Request):
        u,p = user(request),await payload(request)
        otp_check(f'user:{u["id"]}',p.get('code'))
        run('UPDATE users SET verified_at=? WHERE id=?',(now(),u['id']))
        return {'ok':True}

    @app.post('/api/account/password')
    async def change_password(request: Request):
        u,p = user(request),await payload(request)
        reauth(request,u,p)
        pw = c.hash_password(password(p.get('new_password')))
        with c.db() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('UPDATE users SET pw_hash=? WHERE id=?',(pw,u['id']))
            db.execute('DELETE FROM sessions WHERE user_id=? AND token_hash!=?',(u['id'],c.token_digest(request.cookies.get(c.SESSION_COOKIE,''))))
            db.execute('UPDATE resets SET used_at=? WHERE user_id=? AND used_at IS NULL',(now(),u['id']))
            db.commit()
        audit(u['id'],'password_changed',u['id'])
        return {'ok':True}

    @app.get('/api/account/sessions')
    async def sessions(request: Request):
        u = user(request)
        current = c.token_digest(request.cookies.get(c.SESSION_COOKIE,''))
        rs = rows('SELECT token_hash,created_at,expires_at,user_agent FROM sessions WHERE user_id=? AND expires_at>?',(u['id'],now()))
        return {'sessions':[{'id':r['token_hash'],'current':r['token_hash']==current,**{k:v for k,v in r.items() if k!='token_hash'}} for r in rs]}

    @app.delete('/api/account/sessions/{sid}')
    async def revoke_session(sid: str, request: Request):
        u = user(request); await payload(request)
        run('DELETE FROM sessions WHERE user_id=? AND token_hash=?',(u['id'],sid))
        return {'ok':True}

    @app.post('/api/account/recovery-codes')
    async def recovery_codes(request: Request):
        u,p = user(request),await payload(request)
        reauth(request,u,p)
        if not u['verified_at']: fail('Verify your email before creating recovery codes.',403)
        codes = [secrets.token_hex(10) for _ in range(8)]
        with c.db() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('UPDATE recovery_codes SET used_at=? WHERE user_id=? AND used_at IS NULL',(now(),u['id']))
            db.executemany('INSERT INTO recovery_codes(digest,user_id) VALUES(?,?)', [(c.token_digest(s),u['id']) for s in codes])
            db.execute('UPDATE users SET recovery_ready=1 WHERE id=?',(u['id'],))
            db.commit()
        return {'ok':True,'codes':codes}

    @app.post('/api/auth/recover')
    async def recover(request: Request):
        p = await payload(request); limit(request,'recover',5,900)
        pw = c.hash_password(password(p.get('new_password')))
        email = c.normalise_email(p.get('email'))
        digest = c.token_digest(str(p.get('code','')).strip().lower())
        with c.db() as db:
            db.execute('BEGIN IMMEDIATE')
            r = db.execute('SELECT r.user_id FROM recovery_codes r JOIN users u ON u.id=r.user_id WHERE r.digest=? AND r.used_at IS NULL AND u.email=? AND u.deleted_at IS NULL AND u.verified_at IS NOT NULL',(digest,email)).fetchone()
            if not r: db.rollback(); fail('The recovery details did not match.',422)
            db.execute('UPDATE recovery_codes SET used_at=? WHERE digest=?',(now(),digest))
            db.execute('UPDATE users SET pw_hash=? WHERE id=?',(pw,r['user_id']))
            db.execute('DELETE FROM sessions WHERE user_id=?',(r['user_id'],))
            db.execute('UPDATE resets SET used_at=? WHERE user_id=?',(now(),r['user_id']))
            db.commit()
        audit(r['user_id'],'account_recovered',r['user_id'])
        return {'ok':True}

    @app.delete('/api/account')
    async def delete_account(request: Request):
        u,p = user(request),await payload(request); reauth(request,u,p)
        if p.get('confirmation') != 'DELETE': fail('Type DELETE to confirm.',422)
        with c.db() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('UPDATE users SET deleted_at=? WHERE id=?',(now(),u['id']))
            db.execute('DELETE FROM sessions WHERE user_id=?',(u['id'],))
            db.execute("UPDATE activations SET status='cancelled' WHERE owner_id=?",(u['id'],))
            db.execute('UPDATE claims SET revoked_at=? WHERE recipient_id=?',(now(),u['id']))
            db.commit()
        audit(u['id'],'account_closed',u['id'])
        r=JSONResponse({'ok':True}); c.clear_session_cookie(r); return r

    @app.get('/api/entries')
    async def entries(request: Request):
        u=user(request)
        return {'entries':[public_entry(e) for e in rows('SELECT * FROM entries WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC',(u['id'],))]}

    def entry_fields(p):
        title=c.clean(p.get('title'),120)
        if not title: fail('Give this memory a title.',422)
        kind=p.get('kind','note')
        if kind not in c.ENTRY_KINDS: fail('Choose a valid vault category.',422)
        email=c.normalise_email(p.get('recipient_email')) if p.get('recipient_email') else ''
        if p.get('recipient_email') and not email: fail('Enter a valid recipient email.',422)
        return (title,kind,c.clean(p.get('recipient'),120),email,str(p.get('body',''))[:20000],str(p.get('secret',''))[:4000],c.safe_link(p.get('link')),now())

    @app.post('/api/entries')
    async def add_entry(request: Request):
        u,p=user(request),await payload(request); limit(request,'entry',120)
        fields=entry_fields(p)
        eid=run('INSERT INTO entries(title,kind,recipient,recipient_email,body,secret,link,updated_at,user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',fields+(u['id'],now()))
        return {'ok':True,'id':eid}

    @app.patch('/api/entries/{eid}')
    async def edit_entry(eid: int, request: Request):
        u,p=user(request),await payload(request); entry_owned(u['id'],eid)
        run('UPDATE entries SET title=?,kind=?,recipient=?,recipient_email=?,body=?,secret=?,link=?,updated_at=? WHERE id=? AND user_id=?',entry_fields(p)+(eid,u['id']))
        return {'ok':True}

    @app.delete('/api/entries/{eid}')
    async def remove_entry(eid: int, request: Request):
        u=user(request); await payload(request); entry_owned(u['id'],eid)
        run('UPDATE entries SET deleted_at=? WHERE id=? AND user_id=?',(now(),eid,u['id']))
        return {'ok':True}

    @app.post('/api/entries/{eid}/file')
    async def upload(eid: int, request: Request):
        u=user(request); entry_owned(u['id'],eid)
        # Existing validated, private storage. Replaced attachments remain in backup storage.
        return await c.upload_file(eid,request)

    @app.get('/api/entries/{eid}/file')
    async def file(eid: int, request: Request):
        u=user(request); e=entry_owned(u['id'],eid)
        return file_response(e,request)

    @app.get('/api/overview')
    async def overview(request: Request):
        u=user(request)
        totals=dict(one('SELECT COUNT(*) AS items,COALESCE(SUM(file_size),0) AS bytes FROM entries WHERE user_id=? AND deleted_at IS NULL',(u['id'],)))
        return {**totals,'plan':plan(u['id']),'recent':[public_entry(e) for e in rows('SELECT * FROM entries WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5',(u['id'],))]}

    @app.get('/api/plan')
    async def get_plan(request: Request):
        u=user(request)
        return {'plan':plan(u['id']),'history':rows('SELECT created_at FROM checkins WHERE user_id=? ORDER BY id DESC LIMIT 50',(u['id'],))}

    @app.patch('/api/plan')
    async def save_plan(request: Request):
        u,p=user(request),await payload(request); plan(u['id'])
        try: frequency,grace=int(p.get('frequency',30)),int(p.get('grace',14))
        except (TypeError,ValueError): fail('Enter valid numbers of days.',422)
        if not 1<=frequency<=365 or not 1<=grace<=90: fail('Life Check must be 1–365 days; grace period 1–90 days.',422)
        run('UPDATE legacy_plans SET frequency=?,grace=?,generation_enabled=? WHERE user_id=?',(frequency,grace,int(bool(p.get('generation_enabled'))),u['id']))
        return {'ok':True}

    @app.post('/api/plan/checkin')
    async def checkin(request: Request):
        u=user(request); await payload(request); plan(u['id'])
        with c.db() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('UPDATE legacy_plans SET last_checkin=? WHERE user_id=?',(now(),u['id']))
            db.execute('INSERT INTO checkins(user_id,created_at) VALUES(?,?)',(u['id'],now()))
            db.execute("UPDATE activations SET status='cancelled',decision='Owner checked in' WHERE owner_id=? AND status IN ('pending','approved')",(u['id'],))
            db.commit()
        audit(u['id'],'life_check',u['id'])
        return {'ok':True}

    @app.get('/api/heirs')
    async def heirs(request: Request):
        u=user(request)
        return {'heirs':rows("SELECT id,name,email,status,role,steward,invited_at,claimed_at FROM heirs WHERE user_id=? AND status!='revoked'",(u['id'],))}

    @app.post('/api/heirs')
    async def add_heir(request: Request):
        u,p=user(request),await payload(request)
        return create_heir(u['id'],p,u['email'])

    @app.patch('/api/heirs/{hid}')
    async def edit_heir(hid: int, request: Request):
        u,p=user(request),await payload(request)
        if p.get('role') not in ('primary','backup'): fail('Choose primary or backup.',422)
        r=one("SELECT * FROM heirs WHERE id=? AND user_id=? AND status!='revoked'",(hid,u['id']))
        if not r: fail('Loved one not found.',404)
        run('UPDATE heirs SET name=?,role=?,steward=? WHERE id=?',(c.clean(p.get('name'),80),p['role'],int(bool(p.get('steward'))),hid))
        return {'ok':True}

    @app.delete('/api/heirs/{hid}')
    async def remove_heir(hid: int, request: Request):
        u=user(request); await payload(request)
        run("UPDATE heirs SET status='revoked',token_hash=NULL WHERE id=? AND user_id=?",(hid,u['id']))
        audit(u['id'],'beneficiary_revoked',hid)
        return {'ok':True}

    @app.post('/api/activations')
    async def activation_request(request: Request):
        u,p=user(request),await payload(request)
        if not u['verified_at']: fail('Verify your email first.',403)
        # Owner or a nominated, independently verified account may request review.
        try: owner=int(p.get('owner_id') or u['id'])
        except (TypeError,ValueError): fail('Invalid family space.',422)
        if p.get('owner_email'):
            owner_row=one('SELECT id FROM users WHERE email=? AND deleted_at IS NULL',(c.normalise_email(p['owner_email']),))
            if not owner_row: fail('A matching nomination could not be verified.',403)
            owner=owner_row['id']
        if owner != u['id'] and not one("SELECT id FROM heirs WHERE user_id=? AND email=? AND status!='revoked'",(owner,u['email'])): fail('You are not nominated for this family space.',403)
        reason=c.clean(p.get('reason'),1000); evidence=c.clean(p.get('evidence'),4000)
        if len(reason)<20 or len(evidence)<20: fail('Describe the circumstances and provide an independently verifiable supporting record or reference (at least 20 characters each).',422)
        try:
            aid=run('INSERT INTO activations(owner_id,requested_by,reason,evidence,created_at) VALUES(?,?,?,?,?)',(owner,u['id'],reason,evidence,now()))
        except sqlite3.IntegrityError: fail('A review is already pending or approved.',409)
        audit(u['id'],'activation_requested',aid)
        return {'ok':True,'id':aid}

    @app.post('/api/heirs/{hid}/invite')
    async def invite(hid: int, request: Request):
        u=user(request); await payload(request)
        h=one("SELECT * FROM heirs WHERE id=? AND status!='revoked'",(hid,))
        if not h or (h['user_id']!=u['id'] and not is_admin(u)): fail('This nomination was not found.',404)
        return invitation(request,u,h)

    @app.post('/api/claim/open')
    async def open_claim(request: Request):
        p=await payload(request); limit(request,'claim-open',30)
        token=str(p.get('token',''))[:200]
        r=one("SELECT cl.id FROM claims cl JOIN heirs h ON h.id=cl.heir_id JOIN activations a ON a.id=cl.activation_id JOIN users u ON u.id=h.user_id WHERE cl.invitation_hash=? AND cl.expires_at>? AND cl.revoked_at IS NULL AND cl.claimed_at IS NULL AND h.status!='revoked' AND a.status='approved' AND u.deleted_at IS NULL",(c.token_digest(token),now()))
        if not r: fail('This invitation is expired, withdrawn, or already claimed. Sign in if you already claimed it.',410)
        session=secrets.token_urlsafe(32)
        # Opening/reopening invalidates previous proof and session, not identity review.
        run('UPDATE claims SET session_hash=?,session_expires=?,email_verified_at=NULL WHERE id=?',(c.token_digest(session),now()+3600,r['id']))
        response=JSONResponse({'ok':True})
        response.set_cookie('ak_claim',session,max_age=3600,path='/api/claim',secure=True,httponly=True,samesite='strict')
        return response

    @app.get('/api/claim/status')
    async def claim_status(request: Request):
        r=claim_session(request)
        return {'email_hint':c.mask_email(r['email']),'verified':bool(r['email_verified_at']),
                'identity_status':r['identity_status'] if r['email_verified_at'] else 'unsubmitted',
                'decision':r['decision'] if r['email_verified_at'] else None, 'claimed':bool(r['claimed_at'])}

    @app.post('/api/claim/send')
    async def claim_send(request: Request):
        await payload(request); r=claim_session(request)
        otp_send(request,f'claim:{r["id"]}:{r["session_hash"]}',r['email'])
        return {'ok':True}

    @app.post('/api/claim/verify')
    async def claim_verify(request: Request):
        p=await payload(request); r=claim_session(request)
        otp_check(f'claim:{r["id"]}:{r["session_hash"]}',p.get('code'))
        run('UPDATE claims SET email_verified_at=? WHERE id=? AND session_hash=?',(now(),r['id'],r['session_hash']))
        return {'ok':True}

    @app.post('/api/claim/identity')
    async def claim_identity(request: Request):
        p=await payload(request); r=claim_session(request)
        if not r['email_verified_at']: fail('Verify the nominated email first.',403)
        if r['identity_status'] in ('pending','approved'): fail('Your identity review is already submitted.',409)
        name=c.clean(p.get('name'),120); relation=c.clean(p.get('relationship'),200); evidence=c.clean(p.get('evidence'),4000)
        if len(name)<2 or len(relation)<2 or len(evidence)<20: fail('Include your name, relationship, and a verifiable identity and inheritance reference.',422)
        run("UPDATE claims SET identity_name=?,relationship=?,evidence=?,identity_status='pending',decision=NULL WHERE id=?",(name,relation,evidence,r['id']))
        audit(None,'identity_submitted',r['id'])
        return {'ok':True}

    @app.post('/api/claim/account')
    async def claim_account(request: Request):
        p=await payload(request); r=claim_session(request); limit(request,'claim-account',10)
        if not r['email_verified_at'] or r['identity_status']!='approved': fail('Email and identity approval are required first.',403)
        existing=one('SELECT * FROM users WHERE email=?',(r['email'],))
        u=c.session_user(request)
        if existing:
            if not u or u['id']!=existing['id']: fail('An account already exists for the nominated email. Sign in with your own password, then return here.',409)
            if existing['deleted_at']: fail('This recipient account is closed.',403)
            uid=existing['id']
        else:
            uid=run('INSERT INTO users(email,pw_hash,name,verified_at,created_at) VALUES(?,?,?,?,?)',(r['email'],c.hash_password(password(p.get('password'))),r['identity_name'],now(),now()))
        run('UPDATE users SET verified_at=COALESCE(verified_at,?) WHERE id=?',(now(),uid))
        run('UPDATE claims SET recipient_id=? WHERE id=?',(uid,r['id']))
        token=c.create_session(uid,c.hash_ip(c.client_ip(request)),request.headers.get('user-agent',''))
        response=JSONResponse({'ok':True}); c.set_session_cookie(response,token); return response

    @app.post('/api/claim/complete')
    async def complete_claim(request: Request):
        p=await payload(request); r=claim_session(request); u=user(request)
        if p.get('confirm') is not True: fail('Confirm that you accept stewardship of this legacy.',422)
        if not r['email_verified_at'] or r['identity_status']!='approved' or r['recipient_id']!=u['id'] or u['email']!=r['email'] or not u['verified_at'] or not u['recovery_ready']:
            fail('Complete verification, your independent account, and recovery setup before claiming.',403)
        with c.db() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('UPDATE claims SET claimed_at=COALESCE(claimed_at,?) WHERE id=?',(now(),r['id']))
            db.execute("UPDATE heirs SET status='claimed',claimed_at=? WHERE id=?",(now(),r['heir_id']))
            db.commit()
        audit(u['id'],'legacy_claimed',r['id'])
        return {'ok':True,'claim_id':r['id']}

    @app.get('/api/family')
    async def families(request: Request):
        u=user(request)
        rs=rows("SELECT cl.id,cl.claimed_at,h.steward FROM claims cl JOIN heirs h ON h.id=cl.heir_id JOIN activations a ON a.id=cl.activation_id JOIN users owner ON owner.id=h.user_id WHERE cl.recipient_id=? AND cl.claimed_at IS NOT NULL AND cl.revoked_at IS NULL AND cl.identity_status='approved' AND h.status!='revoked' AND a.status='approved' AND owner.deleted_at IS NULL",(u['id'],))
        return {'spaces':rs}

    @app.get('/api/family/{cid}')
    async def family(cid: int, request: Request):
        u,g=grant(request,cid)
        owner=one('SELECT name,preferences FROM users WHERE id=?',(g['owner_id'],))
        return {'steward':bool(g['steward']),'generation_enabled':bool(plan(g['owner_id'])['generation_enabled']),
                'owner_name':owner['name'] if json.loads(owner['preferences']).get('profile_visible',False) else '',
                'entries':[public_entry(e) for e in rows('SELECT * FROM entries WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC',(g['owner_id'],))]}

    @app.get('/api/family/{cid}/file/{eid}')
    async def family_file(cid: int,eid: int,request: Request):
        u,g=grant(request,cid); return file_response(entry_owned(g['owner_id'],eid),request)

    @app.patch('/api/family/{cid}/entries/{eid}')
    async def family_edit(cid: int,eid: int,request: Request):
        u,g=grant(request,cid,True); p=await payload(request); entry_owned(g['owner_id'],eid)
        run('UPDATE entries SET title=?,kind=?,recipient=?,recipient_email=?,body=?,secret=?,link=?,updated_at=? WHERE id=? AND user_id=?',entry_fields(p)+(eid,g['owner_id']))
        audit(u['id'],'family_entry_updated',eid)
        return {'ok':True}

    @app.post('/api/family/{cid}/successors')
    async def successor(cid: int,request: Request):
        u,g=grant(request,cid,True); p=await payload(request)
        if not plan(g['owner_id'])['generation_enabled']: fail('The owner has not enabled generational succession.',403)
        result=create_heir(g['owner_id'],p,u['email']); audit(u['id'],'successor_nominated',result['id'])
        # Invitation is issued by the administrator after reviewing this new nomination.
        return result

    @app.get('/api/reviews')
    async def reviews(request: Request):
        admin(request)
        return {'activations':rows("SELECT * FROM activations WHERE status='pending' ORDER BY id"),
                'claims':rows("SELECT id,identity_name,relationship,evidence,activation_id FROM claims WHERE identity_status='pending' AND revoked_at IS NULL ORDER BY id"),
                'invitations':rows("SELECT h.id,h.name,h.role,h.user_id FROM heirs h JOIN activations a ON a.owner_id=h.user_id WHERE a.status='approved' AND h.status='ready'"),
                'audit':rows('SELECT actor,action,target,created_at FROM audit_events ORDER BY id DESC LIMIT 50')}

    @app.post('/api/reviews/{kind}/{rid}')
    async def review(kind: str,rid: int,request: Request):
        u,p=admin(request),await payload(request); reauth(request,u,p)
        decision=c.clean(p.get('decision'),2000)
        if len(decision)<20 or p.get('status') not in ('approved','rejected'): fail('Record a review decision and its independently checked evidence (at least 20 characters).',422)
        if kind=='activation':
            r=one("SELECT * FROM activations WHERE id=? AND status='pending'",(rid,))
            if not r: fail('Review is no longer pending.',409)
            if u['id'] in (r['owner_id'],r['requested_by']) or one("SELECT id FROM heirs WHERE user_id=? AND email=? AND status!='revoked'",(r['owner_id'],u['email'])): fail('You cannot review your own or a related inheritance request.',403)
            if p.get('death_evidence_checked') is not True or p.get('authority_checked') is not True: fail('Independently verify the death record and legal authority. A missed Life Check is never sufficient.',422)
            run("UPDATE activations SET status=?,reviewed_by=?,reviewed_at=?,decision=? WHERE id=? AND status='pending'",(p['status'],u['id'],now(),decision,rid))
        elif kind=='identity':
            r=one("SELECT cl.*,h.email,h.user_id AS owner_id,a.requested_by FROM claims cl JOIN heirs h ON h.id=cl.heir_id JOIN activations a ON a.id=cl.activation_id WHERE cl.id=? AND cl.identity_status='pending' AND cl.revoked_at IS NULL AND a.status='approved'",(rid,))
            if not r: fail('Review is no longer pending.',409)
            if u['email']==r['email'] or u['id'] in (r['owner_id'],r['requested_by']) or one("SELECT id FROM heirs WHERE user_id=? AND email=? AND status!='revoked'",(r['owner_id'],u['email'])): fail('A separate administrator must review this claim.',403)
            if p.get('identity_checked') is not True or p.get('authority_checked') is not True: fail('Verify identity and inheritance authority before recording approval.',422)
            run("UPDATE claims SET identity_status=?,reviewed_by=?,reviewed_at=?,decision=? WHERE id=? AND identity_status='pending'",(p['status'],u['id'],now(),decision,rid))
        else: fail('Unknown review type.',404)
        audit(u['id'],kind+'_'+p['status'],rid)
        if kind=='activation':
            notify_user(r['requested_by'],'Your AfterKey activation review was updated',f'Your activation review is {p["status"]}. Sign in for details: {c.PUBLIC_URL}/app/legacy')
        elif r['recipient_id']:
            notify_user(r['recipient_id'],'Your AfterKey identity review was updated',f'Your identity review is {p["status"]}. Return to your invitation to continue.')
        return {'ok':True}


def create_heir(uid,p,self_email):
    email=c.normalise_email(p.get('email')); name=c.clean(p.get('name'),80)
    if not email or not name or email==self_email: fail('Enter a loved one’s name and their own email.',422)
    role=p.get('role','primary')
    if role not in ('primary','backup'): fail('Choose primary or backup.',422)
    if one("SELECT COUNT(*) AS n FROM heirs WHERE user_id=? AND status!='revoked'",(uid,))['n']>=5: fail('Up to five loved ones may be nominated.',422)
    old=one('SELECT * FROM heirs WHERE user_id=? AND email=?',(uid,email))
    if old and old['status']!='revoked': fail('This person is already nominated.',409)
    with c.db() as db:
        db.execute('BEGIN IMMEDIATE')
        if old:
            hid=old['id']
            db.execute('UPDATE claims SET revoked_at=? WHERE heir_id=?',(now(),hid))
            db.execute("UPDATE heirs SET name=?,role=?,steward=?,status='ready',token_hash=NULL,claimed_at=NULL WHERE id=?",(name,role,int(bool(p.get('steward'))),hid))
        else:
            hid=db.execute('INSERT INTO heirs(user_id,name,email,role,steward,created_at) VALUES(?,?,?,?,?,?)',(uid,name,email,role,int(bool(p.get('steward'))),now())).lastrowid
        db.commit()
    return {'ok':True,'id':hid}


def invitation(request,u,h):
    limit(request,'invite',10)
    a=one("SELECT * FROM activations WHERE owner_id=? AND status='approved' ORDER BY id DESC LIMIT 1",(h['user_id'],))
    if not a: fail('Legacy activation must be independently approved before an invitation can be sent.',403)
    if h['role']=='backup' and one("SELECT id FROM heirs WHERE user_id=? AND role='primary' AND status!='revoked'",(h['user_id'],)):
        fail('A backup can be invited after the primary nomination is withdrawn.',409)
    token=secrets.token_urlsafe(32)
    # A new invitation supersedes unclaimed sessions. Claimed access requires explicit revocation.
    if one('SELECT id FROM claims WHERE heir_id=? AND claimed_at IS NOT NULL AND revoked_at IS NULL',(h['id'],)): fail('This legacy has already been claimed.',409)
    cid=run('INSERT INTO claims(heir_id,activation_id,invitation_hash,expires_at,created_at) VALUES(?,?,?,?,?)',(h['id'],a['id'],c.token_digest(token),now()+30*86400,now()))
    try:
        send(h['email'],'Someone has left a legacy in your keeping',f'Something meaningful has been entrusted to you.\n\nOpen your AfterKey invitation: {c.PUBLIC_URL}/legacy#token={token}\n\nThis invitation begins a careful verification process. It does not unlock private content. You will verify your own email and identity, then use your own account. You will never need the original owner’s password or OTP.\nThe invitation expires in 30 days.')
    except HTTPException:
        run('UPDATE claims SET revoked_at=? WHERE id=?',(now(),cid)); raise
    with c.db() as db:
        db.execute('BEGIN IMMEDIATE')
        db.execute('UPDATE claims SET revoked_at=? WHERE heir_id=? AND id!=? AND claimed_at IS NULL',(now(),h['id'],cid))
        db.execute("UPDATE heirs SET status='invited',invited_at=? WHERE id=?",(now(),h['id']))
        db.commit()
    audit(u['id'],'invitation_sent',cid)
    return {'ok':True}


def file_response(e,request):
    path=c.stored_media(e)
    if not path: fail('Attachment not found.',404)
    return FileResponse(path,media_type=e['file_type'] or 'application/octet-stream',filename=e['file_name'],
                        content_disposition_type='attachment' if request.query_params.get('download')=='1' else 'inline',
                        headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})
