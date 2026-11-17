"""Run with python -m backend.worker; durable queues survive process restarts."""
import asyncio
import json
import os
import time
from datetime import datetime, timezone
from .app import connection, now, uid
import logging
import httpx
from .personal import process_one


def reminders(app):
    with connection(app) as conn:
        conn.execute('BEGIN IMMEDIATE')
        for task in conn.execute("SELECT * FROM tasks WHERE due_at IS NOT NULL AND status!='Done'").fetchall():
            if not conn.execute('SELECT 1 FROM memberships WHERE user_id=? AND space_id=?',(task['assignee_id'],task['space'])).fetchone(): continue
            pref=conn.execute('SELECT reminders FROM notification_preferences WHERE user_id=?',(task['assignee_id'],)).fetchone()
            if pref and not pref[0]: continue
            deadline=datetime.fromisoformat(task['due_at']).timestamp()
            for offset in (3600,0):
                if time.time()<deadline-offset: continue
                # On a long outage, avoid delivering both reminders together.
                if offset and time.time()>=deadline: continue
                inserted=conn.execute('INSERT OR IGNORE INTO deadline_deliveries VALUES (?,?,?,?)',(task['id'],task['due_at'],task['assignee_id'],offset)).rowcount
                if inserted:
                    app.state.work_service.notify(conn,task['assignee_id'],task['space'],task['id'],'Task deadline reminder',task['due_at'])


def deliver_one(app):
    with connection(app) as conn:
        conn.execute('BEGIN IMMEDIATE')
        row=conn.execute("SELECT j.*,n.recipient_id,n.space,n.task_id,n.title,n.body FROM notification_jobs j JOIN notifications n ON n.id=j.notification_id WHERE j.status IN ('queued','sending') AND j.available<=? AND j.attempts<5 ORDER BY j.available LIMIT 1",(time.time(),)).fetchone()
        if not row: return False
        row=dict(row)
        sub=conn.execute('SELECT subscription FROM push_subscriptions WHERE endpoint=? AND user_id=?',(row['endpoint'],row['recipient_id'])).fetchone()
        member=conn.execute('SELECT 1 FROM memberships WHERE user_id=? AND space_id=?',(row['recipient_id'],row['space'])).fetchone()
        pref=conn.execute('SELECT * FROM notification_preferences WHERE user_id=?',(row['recipient_id'],)).fetchone()
        reminder=row['title']=='Task deadline reminder'
        task=conn.execute('SELECT * FROM tasks WHERE id=?',(row['task_id'],)).fetchone()
        valid=bool(sub and member and (not pref or pref['reminders' if reminder else 'assignments']))
        if reminder and (not task or task['status']=='Done' or task['due_at']!=row['body'] or task['assignee_id']!=row['recipient_id']): valid=False
        if not valid:
            conn.execute("UPDATE notification_jobs SET status='suppressed' WHERE id=?",(row['id'],)); return True
        conn.execute("UPDATE notification_jobs SET status='sending',attempts=attempts+1,available=? WHERE id=?",(time.time()+120,row['id']))
    try:
        from pywebpush import webpush, WebPushException
        webpush(subscription_info=json.loads(sub[0]),data=json.dumps({'title':'Collective','body':'You have a task update','url':'/?task='+row['task_id'],'tag':row['notification_id']}),vapid_private_key=os.environ['VAPID_PRIVATE_KEY'],vapid_claims={'sub':os.environ['VAPID_SUBJECT']},timeout=15)
        status='sent'
    except Exception as exc:
        response=getattr(exc,'response',None)
        if response is not None and response.status_code in (404,410):
            with connection(app) as conn: conn.execute('DELETE FROM push_subscriptions WHERE endpoint=?',(row['endpoint'],))
            status='expired'
        else: status='failed' if row['attempts']>=4 else 'queued'
    with connection(app) as conn:
        conn.execute('UPDATE notification_jobs SET status=?,available=? WHERE id=?',(status,time.time()+min(3600,30*2**row['attempts']),row['id']))
    return True


async def maintain_notifications(app):
    while True:
        try:
            await asyncio.to_thread(reminders,app)
            await asyncio.to_thread(deliver_one,app)
        except asyncio.CancelledError:
            raise
        except Exception:
            logging.getLogger(__name__).exception('Notification iteration failed; retrying')
        await asyncio.sleep(2)


async def run_worker(app):
    # Reuse TLS connections; notification delivery must not delay chat requests.
    async with httpx.AsyncClient(timeout=45,limits=httpx.Limits(max_connections=10,max_keepalive_connections=5)) as client:
        app.state.groq_client=client
        notifications=asyncio.create_task(maintain_notifications(app))
        try:
            while True:
                processed=False
                try:
                    processed=await process_one(app,app.state.work_service)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logging.getLogger(__name__).exception('Background queue iteration failed; retrying')
                await asyncio.sleep(0 if processed else .25)
        finally:
            app.state.groq_client=None
            notifications.cancel()
            try:
                await notifications
            except asyncio.CancelledError:
                pass

async def main():
    from .app import app
    await run_worker(app)

if __name__=='__main__': asyncio.run(main())
