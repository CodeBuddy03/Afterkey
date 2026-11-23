"""Integration tests use disposable databases and a captured mail sender only."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
BOOT=tempfile.TemporaryDirectory()
os.environ['AFTERKEY_ENV']=str(Path(BOOT.name)/'absent.env')
os.environ['AFTERKEY_DATA']=str(Path(BOOT.name)/'data')
os.environ['AFTERKEY_LOGS']=str(Path(BOOT.name)/'logs')
sys.path.insert(0,str(ROOT/'app'))
import app as a
import restoration as r
a.setup_logging=lambda: None
from fastapi.testclient import TestClient


class NoMailPool:
    def submit(self,*args,**kwargs): pass
    def shutdown(self,**kwargs): pass


class RestorationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        a.DATA_DIR=Path(self.temp.name)
        a.DB_PATH=a.DATA_DIR/'afterkey.db'
        a.MEDIA_DIR=a.DATA_DIR/'media'
        a.mail_pool=NoMailPool()
        self.mail=[]
        r.c.send_mail=lambda to,subject,html,text: self.mail.append((to,subject,text)) or True
        r.c.ADMIN_EMAIL='reviewer@example.test'
        self.client=TestClient(a.app,base_url='https://spidercrawler.site')
        self.client.__enter__()
        self.owner=self.make_user('owner@example.test')
        self.heir=self.make_user('heir@example.test')
        self.reviewer=self.make_user('reviewer@example.test')
        self.other=self.make_user('other@example.test')
        self.login(self.owner)
        self.eid=r.run("INSERT INTO entries(user_id,title,body,created_at,updated_at) VALUES(?,?,?,?,?)",(self.owner,'Private memory','NEVER LEAK THIS',r.now(),r.now()))

    def tearDown(self):
        self.client.__exit__(None,None,None)
        self.temp.cleanup()

    def make_user(self,email,verified=True):
        return r.run('INSERT INTO users(email,pw_hash,created_at,verified_at) VALUES(?,?,?,?)',(email,a.hash_password('Independent-password-123'),r.now(),r.now() if verified else None))

    def login(self,uid):
        token=a.create_session(uid,'test','Integration tests')
        self.client.cookies.set('ak_session',token,domain='spidercrawler.site',path='/')

    def call(self,path,p=None,method='POST'):
        return self.client.request(method,path,json=p or {},headers={'Origin':'https://spidercrawler.site'})

    def nominate(self):
        return self.call('/api/heirs',{'name':'My loved one','email':'heir@example.test','role':'primary','steward':True}).json()['id']

    def activation(self):
        return self.call('/api/activations',{'reason':'Request supported by independently verified records','evidence':'Record reference held by an independent professional'}).json()['id']

    def approve(self,kind,rid):
        self.login(self.reviewer)
        return self.call(f'/api/reviews/{kind}/{rid}',{'status':'approved','decision':'Independently checked records and inheritance authority','password':'Independent-password-123','death_evidence_checked':True,'identity_checked':True,'authority_checked':True})

    def invitation(self):
        hid=self.nominate(); aid=self.activation()
        self.assertEqual(self.approve('activation',aid).status_code,200)
        self.assertEqual(self.call(f'/api/heirs/{hid}/invite').status_code,200)
        token=self.mail[-1][2].split('#token=')[1].split()[0]
        self.assertEqual(self.call('/api/claim/open',{'token':token}).status_code,200)
        return hid,aid,token

    def verify_claim(self):
        self.assertEqual(self.call('/api/claim/send').status_code,200)
        code=self.mail[-1][2].split('Your code is ')[1][:6]
        self.assertEqual(self.call('/api/claim/verify',{'code':code}).status_code,200)
        return code

    def approved_claim(self):
        hid,aid,token=self.invitation();self.verify_claim()
        self.assertEqual(self.call('/api/claim/identity',{'name':'Loved One','relationship':'Nominated child','evidence':'Independent inheritance and identity reference for review'}).status_code,200)
        cid=r.one('SELECT id FROM claims WHERE heir_id=?',(hid,))['id']
        self.assertEqual(self.approve('identity',cid).status_code,200)
        return hid,aid,token,cid

    def claimed(self):
        hid,aid,token,cid=self.approved_claim()
        self.login(self.heir)
        self.assertEqual(self.call('/api/claim/account').status_code,200)
        self.assertEqual(self.call('/api/account/recovery-codes',{'password':'Independent-password-123'}).status_code,200)
        self.assertEqual(self.call('/api/claim/complete',{'confirm':True,'recovery_confirm':True}).status_code,200)
        return hid,aid,cid

    def test_old_bearer_routes_fail_closed(self):
        for path in ('/api/legacy/me','/api/legacy/export','/api/legacy/file/1','/api/legacy/oldtoken','/api/release/oldtoken'):
            res=self.client.get(path);self.assertEqual(res.status_code,410);self.assertNotIn('NEVER LEAK',res.text)

    def test_invitation_cannot_precede_approval(self):
        hid=self.nominate();self.assertEqual(self.call(f'/api/heirs/{hid}/invite').status_code,403)
        self.activation();self.assertEqual(self.call(f'/api/heirs/{hid}/invite').status_code,403)
        self.assertFalse(self.mail)

    def test_invitation_and_otp_do_not_grant_access(self):
        hid,aid,token=self.invitation()
        self.assertNotIn('NEVER LEAK',self.client.get('/api/claim/status').text)
        self.assertEqual(self.call('/api/claim/identity',{'name':'x'}).status_code,403)
        self.assertEqual(self.call('/api/claim/complete',{'confirm':True}).status_code,403)
        self.verify_claim()
        self.assertEqual(self.call('/api/claim/account',{'password':'Independent-password-123'}).status_code,403)
        self.assertEqual(self.client.get('/api/family/1').status_code,403)

    def test_otp_wrong_expired_replay_and_attempt_limits(self):
        self.invitation();self.call('/api/claim/send')
        code=self.mail[-1][2].split('Your code is ')[1][:6]
        wrong='111111' if code!='111111' else '222222'
        for _ in range(5):self.assertEqual(self.call('/api/claim/verify',{'code':wrong}).status_code,422)
        self.assertEqual(self.call('/api/claim/verify',{'code':code}).status_code,422)
        self.call('/api/claim/send');code=self.mail[-1][2].split('Your code is ')[1][:6]
        r.run('UPDATE challenges SET expires_at=?',(r.now()-1,))
        self.assertEqual(self.call('/api/claim/verify',{'code':code}).status_code,422)
        code=self.verify_claim()
        self.assertEqual(self.call('/api/claim/verify',{'code':code}).status_code,422)

    def test_complete_claim_revocation_and_owner_checkin(self):
        hid,aid,cid=self.claimed()
        self.assertIn('NEVER LEAK',self.client.get(f'/api/family/{cid}').text)
        self.login(self.other)
        self.assertEqual(self.client.get(f'/api/family/{cid}').status_code,403)
        self.login(self.owner);self.call('/api/plan/checkin')
        self.login(self.heir)
        self.assertEqual(self.client.get(f'/api/family/{cid}').status_code,403)

    def test_account_and_recovery_required_before_claim(self):
        hid,aid,token,cid=self.approved_claim()
        self.login(self.other)
        self.assertEqual(self.call('/api/claim/account').status_code,409)
        self.login(self.heir);self.assertEqual(self.call('/api/claim/account').status_code,200)
        self.assertEqual(self.call('/api/claim/complete',{'confirm':True}).status_code,403)
        self.assertIsNone(r.one('SELECT claimed_at FROM claims WHERE id=?',(cid,))['claimed_at'])

    def test_invitation_reopen_rechecks_email_and_revokes_old_session(self):
        hid,aid,token=self.invitation();self.verify_claim()
        self.call('/api/claim/open',{'token':token})
        self.assertFalse(self.client.get('/api/claim/status').json()['verified'])
        self.assertEqual(self.call('/api/claim/identity',{'name':'No proof'}).status_code,403)

    def test_revoked_heir_cannot_reuse_claim(self):
        hid,aid,cid=self.claimed()
        self.login(self.owner);self.call(f'/api/heirs/{hid}',method='DELETE')
        self.login(self.heir);self.assertEqual(self.client.get(f'/api/family/{cid}').status_code,403)
        self.assertEqual(self.client.get(f'/api/family/{cid}/file/{self.eid}').status_code,403)

    def test_missed_lifecheck_never_activates(self):
        r.plan(self.owner);r.run('UPDATE legacy_plans SET last_checkin=? WHERE user_id=?',(r.now()-400*86400,self.owner))
        d=self.client.get('/api/overview').json()
        self.assertEqual(d['plan']['checkin_status'],'follow-up needed');self.assertIsNone(d['plan']['activation'])
        self.assertEqual(r.one('SELECT COUNT(*) n FROM claims')['n'],0)

    def test_vault_crud_authorization_upload_preview_download(self):
        new=self.call('/api/entries',{'title':'Photo','kind':'media'}).json()['id']
        self.assertEqual(self.call(f'/api/entries/{new}',{'title':'Edited photo','kind':'media','body':'Caption'},'PATCH').status_code,200)
        raw=b'\x89PNG\r\n\x1a\n'+b'0'*24
        headers={'Origin':'https://spidercrawler.site','Content-Type':'image/png','X-File-Name':'memory.png'}
        self.assertEqual(self.client.post(f'/api/entries/{new}/file',content=raw,headers=headers).status_code,201)
        self.assertEqual(self.client.get(f'/api/entries/{new}/file').content,raw)
        self.assertIn('attachment',self.client.get(f'/api/entries/{new}/file?download=1').headers['content-disposition'])
        stored=r.one('SELECT file_path FROM entries WHERE id=?',(new,))['file_path']
        self.login(self.other)
        self.assertEqual(self.client.get(f'/api/entries/{new}/file').status_code,404)
        self.assertEqual(self.call(f'/api/entries/{new}',{'title':'Hacked','kind':'note'},'PATCH').status_code,404)
        self.login(self.owner);self.assertEqual(self.call(f'/api/entries/{new}',method='DELETE').status_code,200)
        self.assertEqual(self.client.get(f'/api/entries/{new}/file').status_code,404)
        self.assertTrue((a.MEDIA_DIR/stored).exists())
        self.assertIsNotNone(r.one('SELECT * FROM entries WHERE id=?',(new,)))

    def test_upload_rejects_spoof_and_wrong_origin(self):
        self.assertEqual(self.client.post(f'/api/entries/{self.eid}/file',content=b'<script>',headers={'Origin':'https://spidercrawler.site','Content-Type':'image/png'}).status_code,415)
        self.assertEqual(self.client.post('/api/plan/checkin',json={},headers={'Origin':'https://attacker.test'}).status_code,403)
        self.assertEqual(self.call('/api/plan',{'frequency':0,'grace':14},'PATCH').status_code,422)

    def test_recovery_codes_single_use_and_sessions_revoked(self):
        d=self.call('/api/account/recovery-codes',{'password':'Independent-password-123'}).json()
        code=d['codes'][0]
        self.assertEqual(self.call('/api/auth/recover',{'email':'owner@example.test','code':code,'new_password':'New-independent-password'}).status_code,200)
        self.assertEqual(self.client.get('/api/account').status_code,401)
        self.assertEqual(self.call('/api/auth/recover',{'email':'owner@example.test','code':code,'new_password':'Another-independent-password'}).status_code,422)
        self.assertNotIn(code,str(r.rows('SELECT * FROM recovery_codes')))

    def test_sessions_password_and_soft_account_delete(self):
        self.assertEqual(self.call('/api/account/password',{'password':'Wrong','new_password':'New-independent-password'}).status_code,403)
        old=a.create_session(self.owner,'another','Another device')
        self.assertEqual(self.call('/api/account/password',{'password':'Independent-password-123','new_password':'New-independent-password'}).status_code,200)
        self.assertIsNone(r.one('SELECT * FROM sessions WHERE token_hash=?',(a.token_digest(old),)))
        self.assertEqual(self.call('/api/account',{'password':'New-independent-password','confirmation':'DELETE'},'DELETE').status_code,200)
        self.assertIsNotNone(r.one('SELECT * FROM entries WHERE id=?',(self.eid,)))
        self.assertEqual(self.client.get('/api/account').status_code,401)
        self.assertEqual(self.call('/api/auth/login',{'email':'owner@example.test','password':'New-independent-password'}).status_code,401)

    def test_reviews_require_verified_unrelated_reviewer(self):
        aid=self.activation()
        self.assertEqual(self.client.get('/api/reviews').status_code,403)
        r.c.ADMIN_EMAIL='owner@example.test'
        self.assertEqual(self.call(f'/api/reviews/activation/{aid}',{'status':'approved','decision':'A deliberately invalid self approval attempt','password':'Independent-password-123','death_evidence_checked':True,'authority_checked':True}).status_code,403)
        r.c.ADMIN_EMAIL='reviewer@example.test';self.login(self.reviewer)
        self.assertEqual(self.call(f'/api/reviews/activation/{aid}',{'status':'approved','decision':'Missed check-in is not enough to approve','password':'Independent-password-123'}).status_code,422)

    def test_backup_beneficiary_waits_for_primary_withdrawal(self):
        primary=self.nominate()
        backup=self.call('/api/heirs',{'name':'Backup','email':'backup@example.test','role':'backup'}).json()['id']
        aid=self.activation();self.approve('activation',aid)
        self.assertEqual(self.call(f'/api/heirs/{backup}/invite').status_code,409)
        self.login(self.owner);self.call(f'/api/heirs/{primary}',method='DELETE')
        self.assertEqual(self.call(f'/api/heirs/{backup}/invite').status_code,200)

    def test_steward_succession_requires_owner_setting(self):
        hid,aid,cid=self.claimed()
        p={'name':'Next generation','email':'next@example.test','role':'primary','steward':True}
        self.assertEqual(self.call(f'/api/family/{cid}/successors',p).status_code,403)
        self.login(self.owner);self.call('/api/plan',{'frequency':30,'grace':14,'generation_enabled':True},'PATCH')
        self.login(self.heir);self.assertEqual(self.call(f'/api/family/{cid}/successors',p).status_code,200)
        self.assertEqual(self.call(f'/api/family/{cid}/entries/{self.eid}',{'title':'Preserved memory','kind':'note','body':'NEVER LEAK THIS'},'PATCH').status_code,200)

    def test_mail_failure_does_not_report_success(self):
        r.c.send_mail=lambda *args:False
        self.assertEqual(self.call('/api/account/email/send').status_code,503)

    def test_migration_preserves_existing_data_and_is_repeatable(self):
        before=r.one('SELECT body FROM entries WHERE id=?',(self.eid,))['body']
        a.init_db();r.migrate();r.migrate()
        self.assertEqual(r.one('SELECT body FROM entries WHERE id=?',(self.eid,))['body'],before)
        with a.db() as db:self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')

    def test_password_reset_single_use_and_email_verified(self):
        uid=self.make_user('reset@example.test',False)
        token='test-reset-token-with-sufficient-entropy'
        r.run('INSERT INTO resets(token_hash,user_id,expires_at) VALUES(?,?,?)',(a.token_digest(token),uid,r.now()+600))
        body={'token':token,'password':'Reset-independent-password'}
        self.assertEqual(self.call('/api/auth/reset/confirm',body).status_code,200)
        self.assertIsNotNone(r.one('SELECT verified_at FROM users WHERE id=?',(uid,))['verified_at'])
        self.assertEqual(self.call('/api/auth/reset/confirm',body).status_code,410)

    def test_reminders_respect_preferences_and_never_release(self):
        import reminders
        r.plan(self.owner)
        r.run('UPDATE legacy_plans SET last_checkin=? WHERE user_id=?',(r.now()-400*86400,self.owner))
        reminders.tick();reminders.tick()
        self.assertEqual(len(self.mail),1)
        self.assertIn('never releases',self.mail[0][2])
        self.assertEqual(r.one('SELECT COUNT(*) n FROM activations')['n'],0)
        r.run('UPDATE legacy_plans SET last_checkin=last_checkin-1 WHERE user_id=?',(self.owner,))
        self.call('/api/account',{'name':'Private profile','preferences':{'life_check_email':False,'activity_email':False}},'PATCH')
        reminders.tick();self.assertEqual(len(self.mail),1)

    def test_nominated_person_can_request_review_by_owner_email(self):
        self.nominate();self.login(self.heir)
        p={'owner_email':'owner@example.test','reason':'Independent review requested by a nominated family member','evidence':'Verifiable external death record and inheritance authority'}
        self.assertEqual(self.call('/api/activations',p).status_code,200)
        self.login(self.other)
        self.assertEqual(self.call('/api/activations',p).status_code,403)

    def test_renomination_cannot_restore_revoked_claim(self):
        hid,aid,cid=self.claimed();self.login(self.owner)
        self.call(f'/api/heirs/{hid}',method='DELETE')
        self.assertEqual(self.nominate(),hid)
        self.login(self.heir)
        self.assertEqual(self.client.get(f'/api/family/{cid}').status_code,403)

    def test_other_beneficiary_cannot_approve_identity(self):
        hid,aid,token=self.invitation();self.verify_claim()
        self.call('/api/claim/identity',{'name':'Loved One','relationship':'Nominated child','evidence':'Independent inheritance and identity reference for review'})
        cid=r.one('SELECT id FROM claims WHERE heir_id=?',(hid,))['id']
        self.login(self.owner)
        self.call('/api/heirs',{'name':'Conflicted reviewer','email':'reviewer@example.test','role':'primary'})
        self.assertEqual(self.approve('identity',cid).status_code,403)


if __name__=='__main__': unittest.main(verbosity=2)
