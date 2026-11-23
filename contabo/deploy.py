"""Run on Contabo from an extracted release directory, after validation.

Keeps the database in place, takes an online backup, copies files atomically,
validates nginx before reload, and never restores an old bearer-access API.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tarfile
import time
import urllib.request

ROOT=Path(__file__).resolve().parent
LIVE=Path('/opt/afterkey')
SITE=Path('/var/www/afterkey')
assert ROOT.parent==LIVE/'releases', 'Run only from /opt/afterkey/releases/<release>'
assert (ROOT/'app/restoration.py').is_file()
os.umask(0o077)
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
backup=LIVE/'backups'/('deployment-'+stamp)
backup.mkdir(parents=True,exist_ok=False)
src=sqlite3.connect(LIVE/'data/afterkey.db')
dst=sqlite3.connect(backup/'afterkey.db')
src.backup(dst)
assert dst.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
tables=['users','entries','heirs','subscribers']
counts={t:src.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in tables}
src.close();dst.close()
with tarfile.open(backup/'files.tar.gz','w:gz') as archive:
    for p in [LIVE/'app',LIVE/'data/media',LIVE/'shared',SITE,Path('/etc/nginx/sites-available/afterkey'),Path('/etc/systemd/system/afterkey-api.service')]:
        archive.add(p,arcname=str(p).lstrip('/'))

def copy_file(source,target,mode):
    target.parent.mkdir(parents=True,exist_ok=True)
    temporary=target.with_name(target.name+'.restoration-new')
    shutil.copyfile(source,temporary)
    os.chmod(temporary,mode)
    os.replace(temporary,target)

# Existing code, records and files remain in backups; no table or media deletion.
for p in (ROOT/'app').glob('*.py'):copy_file(p,LIVE/'app'/p.name,0o644)
subprocess.run(['/opt/afterkey/venv/bin/python','-m','py_compile',str(LIVE/'app/app.py'),str(LIVE/'app/restoration.py')],check=True)
subprocess.run(['systemctl','restart','afterkey-api.service'],check=True)
healthy=False
for _ in range(20):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8001/api/health',timeout=2) as response:
            healthy=response.status==200
        if healthy:break
    except Exception:time.sleep(.5)
if not healthy:raise RuntimeError('New API did not become healthy; old insecure code has not been re-enabled. Inspect the service log.')
for p in (ROOT/'site').rglob('*'):
    if p.is_file():copy_file(p,SITE/p.relative_to(ROOT/'site'),0o644)
for p in SITE.rglob('*'):
    if p.is_dir():os.chmod(p,0o755)
copy_file(ROOT/'nginx.conf',Path('/etc/nginx/sites-available/afterkey'),0o644)
subprocess.run(['nginx','-t'],check=True)
subprocess.run(['systemctl','reload','nginx'],check=True)
for name in ['afterkey-reminders.service','afterkey-reminders.timer']:
    copy_file(ROOT/name,Path('/etc/systemd/system')/name,0o644)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','afterkey-reminders.timer'],check=True)
conn=sqlite3.connect(LIVE/'data/afterkey.db')
assert conn.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
assert all(conn.execute('SELECT COUNT(*) FROM '+t).fetchone()[0]>=count for t,count in counts.items())
conn.close()
manifest={'release':str(ROOT),'backup':str(backup),'integrity':'ok','original_record_counts_preserved':True,
          'files':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.rglob('*') if p.is_file() and '__pycache__' not in str(p)}}
(backup/'deployment.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({k:v for k,v in manifest.items() if k!='files'}))
