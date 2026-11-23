"""Periodic notifications only. This worker NEVER changes activation or access."""
import json
import app as a
import restoration as r


def tick():
    for row in r.rows('''SELECT p.*,u.email,u.preferences FROM legacy_plans p JOIN users u ON u.id=p.user_id
      WHERE u.deleted_at IS NULL AND u.verified_at IS NOT NULL'''):
        due=row['last_checkin']+row['frequency']*86400
        if due>r.now() or not json.loads(row['preferences']).get('life_check_email',True): continue
        if r.one('SELECT 1 FROM reminders WHERE user_id=? AND due_at=?',(row['user_id'],due)): continue
        text=f'It is time for your AfterKey Life Check. Let us know you are here: {a.PUBLIC_URL}/app/legacy\n\nA missed check-in does not prove death and never releases private content.'
        if r.c.send_mail(row['email'],'A gentle Life Check reminder',a.mail_shell('A moment to check in.', '<tr><td>A Life Check is due. Sign in to your AfterKey account. Missing a check-in never releases private content.</td></tr>'),text):
            r.run('INSERT OR IGNORE INTO reminders(user_id,due_at,sent_at) VALUES(?,?,?)',(row['user_id'],due,r.now()))
    for row in r.rows('''SELECT m.*,u.email,u.preferences,u.verified_at,u.deleted_at FROM mail_outbox m
      JOIN users u ON u.id=m.user_id WHERE m.sent_at IS NULL AND m.attempts<5 ORDER BY m.id LIMIT 30'''):
        if row['deleted_at'] or not row['verified_at'] or not json.loads(row['preferences']).get('activity_email',True):
            r.run('UPDATE mail_outbox SET sent_at=? WHERE id=?',(r.now(),row['id']));continue
        r.run('UPDATE mail_outbox SET attempts=attempts+1 WHERE id=?',(row['id'],))
        if r.c.send_mail(row['email'],row['subject'],a.mail_shell(row['subject'],'<tr><td>'+r.escape(row['body']).replace('\n','<br>')+'</td></tr>'),row['body']):
            r.run('UPDATE mail_outbox SET sent_at=? WHERE id=?',(r.now(),row['id']))


if __name__=='__main__':
    a.init_db();r.migrate();a.IP_SALT=a.resolve_salt();tick()
