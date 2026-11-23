"""Loopback-only, disposable browser fixture. Never deploy this as production."""
import os
import sys
import tempfile
from pathlib import Path
from fastapi.responses import FileResponse

ROOT=Path(__file__).resolve().parents[1]
TEMP=tempfile.TemporaryDirectory(prefix='afterkey-browser-')
os.environ['AFTERKEY_ENV']=str(Path(TEMP.name)/'absent.env')
os.environ['AFTERKEY_DATA']=str(Path(TEMP.name)/'data')
os.environ['AFTERKEY_LOGS']=str(Path(TEMP.name)/'logs')
sys.path.insert(0,str(ROOT/'app'))
import app as a
import restoration as r
import uvicorn

mail=[]
def capture(to,subject,html,text): mail.append({'to':to,'subject':subject,'text':text});return True
a.send_mail=capture;r.c.send_mail=capture
r.c.ADMIN_EMAIL='reviewer@example.test'
a.ALLOWED_ORIGINS.add('https://127.0.0.1:18443')
a.init_db();r.migrate()
for email in ('owner@example.test','reviewer@example.test'):
    r.run('INSERT INTO users(email,pw_hash,created_at,verified_at) VALUES(?,?,?,?)',(email,a.hash_password('Independent-password-123'),r.now(),r.now()))

@a.app.get('/__test/mail')
async def test_mail(): return mail

@a.app.middleware('http')
async def policy(request,call_next):
    response=await call_next(request)
    response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    return response

@a.app.get('/{path:path}')
async def static(path: str):
    if path=='app' or path.startswith('app/'): path='dashboard.html'
    elif path in ('login','register','reset','recover','legacy','release','contact'): path+='.html'
    elif not path: path='index.html'
    root=(ROOT/'site').resolve();target=(root/path).resolve()
    if not target.is_relative_to(root) or not target.is_file(): r.fail('Not found',404)
    return FileResponse(target)

if __name__=='__main__':
    uvicorn.run(a.app,host='127.0.0.1',port=8012,ssl_keyfile='/etc/letsencrypt/live/spidercrawler.site/privkey.pem',ssl_certfile='/etc/letsencrypt/live/spidercrawler.site/fullchain.pem',access_log=False)
