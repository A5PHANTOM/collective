import os
os.environ['COLLECTIVE_TEST']='true'
import asyncio
import json
import tempfile
import unittest
from datetime import datetime,timedelta,timezone
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.app import create_app,connection
from backend.personal import process_one,finish,propose
from backend.worker import reminders,deliver_one

class PersonalTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.path=Path(self.temp.name)/'db.sqlite'
        self.app=create_app(self.path,None);self.client=TestClient(self.app)
        self.client.post('/api/login',json={'email':'admin@gmail.com','password':'1234'})
        self.user=self.client.get('/api/bootstrap').json()['user'];self.cid=self.client.post('/api/me/conversations').json()['id']
        self.client.post('/api/admin/members',json={'name':'Arjun','email':'arjun@example.com','password':'abcdefghijk','spaces':['packaging']})
        self.arjun=TestClient(self.app);self.arjun.post('/api/login',json={'email':'arjun@example.com','password':'abcdefghijk'})
        self.arjun_id=self.arjun.get('/api/bootstrap').json()['user']['id']
    def tearDown(self):self.client.close();self.arjun.close();self.temp.cleanup()
    def queue(self,rid='request-1234',question='Hi Arjun, make an Instagram post for the event',space='packaging'):
        r=self.client.post('/api/me/ai/runs',json={'request_id':rid,'conversation_id':self.cid,'question':question,'space':space});self.assertEqual(r.status_code,202,r.text);return rid
    def plan(self,**kwargs):
        return {'answer':'Here is the plan','actions':[{'tool':'create_task','space':'packaging','args':{'title':'Create Instagram post','assignee_id':self.arjun_id,'priority':'Medium','due_at':(datetime.now(timezone.utc)+timedelta(hours=4)).isoformat(),**kwargs}}]}
    def process(self,plan,sources=['packaging']):
        async def fake(*args,**kwargs):return plan,sources
        with patch('backend.personal.propose',fake):asyncio.run(process_one(self.app,self.app.state.work_service))
    def test_exactly_once_task_in_assignee_home_and_inbox(self):
        rid=self.queue();self.queue();self.process(self.plan());self.queue()
        tasks=self.arjun.get('/api/me/tasks').json()['tasks'];self.assertEqual(len(tasks),1);self.assertEqual(tasks[0]['title'],'Create Instagram post');self.assertEqual(tasks[0]['priority'],'Medium')
        self.assertEqual(len(self.arjun.get('/api/notifications').json()['notifications']),1)
        second=create_app(self.path,None);asyncio.run(process_one(second,second.state.work_service));finish(second,second.state.work_service,rid)
        with connection(second) as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM action_receipts').fetchone()[0],1)
        self.assertEqual(self.client.get('/api/me/ai/runs/'+rid).json()['status'],'completed')
    def test_transaction_rollback_does_not_leave_unreceipted_task(self):
        self.queue()
        with connection(self.app) as c:c.execute("CREATE TRIGGER fail_receipt BEFORE INSERT ON action_receipts BEGIN SELECT RAISE(FAIL,'receipt unavailable'); END")
        self.process(self.plan());self.assertEqual(self.arjun.get('/api/me/tasks').json()['tasks'],[])
        self.assertEqual(self.arjun.get('/api/notifications').json()['notifications'],[])
        self.assertEqual(len(self.client.get('/api/me/ai/runs/request-1234').json()['result']['failed_actions']),1)
    def test_clarification_and_past_deadline_do_not_mutate(self):
        self.queue();self.process({**self.plan(),'clarification':{'question':'Which event?','choices':['A','B']}})
        self.assertEqual(self.arjun.get('/api/me/tasks').json()['tasks'],[])
        self.queue('request-past');self.process(self.plan(due_at='2001-01-01T18:00:00+05:30'))
        self.assertIsNotNone(self.client.get('/api/me/ai/runs/request-past').json()['result']['clarification'])
        self.assertEqual(self.arjun.get('/api/me/tasks').json()['tasks'],[])
    def test_ambiguous_person_and_workspace(self):
        self.client.post('/api/admin/members',json={'name':'Arjun Kumar','email':'arjun2@example.com','password':'abcdefghijk','spaces':['packaging']})
        self.queue();self.process(self.plan());self.assertEqual(self.arjun.get('/api/me/tasks').json()['tasks'],[])
        self.assertEqual(len(self.client.get('/api/me/ai/runs/request-1234').json()['result']['clarification']['choices']),2)
        self.queue('request-space',question='Create a task',space=None);self.process(self.plan(assignee_id=self.user['id']),['packaging','digital'])
        self.assertIn('workspace',self.client.get('/api/me/ai/runs/request-space').json()['result']['clarification']['question'])
    def test_latest_workspace_clarification_breaks_loop(self):
        question='Create a task for Arjun to fix chat\nClarification: Digital & IT\nClarification: Assign to Arjun in Packaging studio\nClarification: Packaging studio'
        self.queue(question=question,space=None)
        self.process(self.plan(title='Fix chat'),['packaging','digital'])
        result=self.client.get('/api/me/ai/runs/request-1234').json()['result']
        self.assertIsNone(result['clarification'])
        self.assertEqual(len(result['actions']),1)
        self.assertEqual(result['actions'][0]['space'],'packaging')
        self.assertEqual(self.arjun.get('/api/me/tasks').json()['tasks'][0]['title'],'Fix chat')

    def test_clarification_does_not_override_explicit_workspace(self):
        self.queue(question='Create a task for Arjun\nClarification: Packaging studio',space='digital')
        self.process(self.plan(),['digital'])
        self.assertEqual(self.arjun.get('/api/me/tasks').json()['tasks'],[])

    def test_pending_query_uses_sql_without_provider(self):
        self.client.post('/api/spaces/packaging/tasks',json={'title':'Fix chat','assignee_id':self.arjun_id})
        self.queue(question='what all works are pending',space='packaging')
        with patch('backend.personal.httpx.AsyncClient',side_effect=AssertionError('Provider must not be called')):
            asyncio.run(process_one(self.app,self.app.state.work_service))
        result=self.client.get('/api/me/ai/runs/request-1234').json()['result']
        self.assertIn('1 pending task',result['answer'])
        self.assertIn('Fix chat',result['answer'])
        self.assertEqual(result['actions'],[])

    def test_search_history_and_links_after_revocation(self):
        self.queue();self.process(self.plan());task=self.arjun.get('/api/me/tasks').json()['tasks'][0]
        self.assertEqual(len(self.arjun.get('/api/search?q=Instagram').json()),1)
        self.assertEqual(self.arjun.get('/api/me/conversations/'+self.cid).status_code,404)
        with connection(self.app) as c:c.execute('DELETE FROM memberships WHERE user_id=? AND space_id=?',(self.user['id'],'packaging'))
        self.assertEqual(self.client.get('/api/me/conversations/'+self.cid).json(),[])
        self.assertEqual(self.client.get('/api/me/ai/runs/request-1234').status_code,404)
        self.assertEqual(self.client.get('/api/tasks/'+task['id']).status_code,403)
        self.assertEqual(self.client.get('/api/search?q=Instagram').json(),[])
        self.assertEqual(self.client.get('/api/spaces/packaging/ai').status_code,403)
    def test_revocation_between_plan_and_commit(self):
        rid=self.queue()
        with connection(self.app) as c:
            c.execute("UPDATE personal_runs SET status='planned',plan=?,sources=? WHERE id=?",(json.dumps(self.plan()),'["packaging"]',rid));c.execute('DELETE FROM memberships WHERE user_id=? AND space_id=?',(self.user['id'],'packaging'))
        finish(self.app,self.app.state.work_service,rid)
        self.assertEqual(self.arjun.get('/api/me/tasks').json()['tasks'],[])
    def test_private_draft_requires_explicit_scoped_save(self):
        self.queue();self.process({'answer':'Draft ready','draft':'A private caption','actions':[]})
        result=self.client.get('/api/me/ai/runs/request-1234').json()['result'];draft=result['draft']['id']
        self.assertEqual(self.arjun.get('/api/me/tasks').json()['tasks'],[])
        task=self.client.post('/api/spaces/packaging/tasks',json={'title':'Post','assignee_id':self.arjun_id}).json()
        self.assertEqual(self.arjun.post('/api/me/drafts/'+draft+'/save',json={'task_id':task['id']}).status_code,404)
        self.assertEqual(self.client.post('/api/me/drafts/'+draft+'/save',json={'task_id':task['id']}).status_code,200)
        self.assertEqual(self.arjun.get('/api/tasks/'+task['id']).json()['description'],'A private caption')
    def test_channel_mentions_and_scope(self):
        plain=self.client.post('/api/spaces/packaging/thread',json={'request_id':'plain-message','text':'@AI in plain text does not authorize an action'});self.assertEqual(plain.status_code,201)
        with connection(self.app) as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM personal_runs').fetchone()[0],0)
        r=self.client.post('/api/spaces/packaging/thread',json={'request_id':'mention-message','text':'Create a task','mentions':['AI']});self.assertEqual(r.status_code,201)
        malicious=self.plan();malicious['actions'][0]['space']='digital';self.process(malicious)
        with connection(self.app) as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM tasks').fetchone()[0],0)
        thread=self.client.get('/api/spaces/packaging/thread').json();self.assertEqual(thread[-1]['parent_id'],'mention-message')
    def test_deadline_changes_done_and_preferences(self):
        task=self.client.post('/api/spaces/packaging/tasks',json={'title':'Deadline','assignee_id':self.arjun_id,'due_at':(datetime.now(timezone.utc)+timedelta(minutes=30)).isoformat()}).json()
        reminders(self.app);reminders(self.app)
        with connection(self.app) as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM deadline_deliveries').fetchone()[0],1)
        self.client.patch('/api/tasks/'+task['id'],json={'status':'Done'});reminders(self.app)
        with connection(self.app) as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM deadline_deliveries').fetchone()[0],1)
        self.arjun.put('/api/me/notification-preferences',json={'assignments':False,'reminders':False})
        self.assertFalse(self.arjun.get('/api/me/notification-preferences').json()['reminders'])
        bad=self.arjun.post('/api/me/push-subscriptions',json={'endpoint':'https://127.0.0.1/internal','keys':{'auth':'x','p256dh':'y'}});self.assertEqual(bad.status_code,422)
    def test_provider_failure_retry_and_planned_restart(self):
        rid=self.queue()
        async def fail(*a):raise ValueError('provider failed')
        with patch('backend.personal.propose',fail):asyncio.run(process_one(self.app,self.app.state.work_service))
        self.assertEqual(self.client.get('/api/me/ai/runs/'+rid).json()['status'],'failed')
        self.client.post('/api/me/ai/runs/'+rid+'/retry');self.process(self.plan());self.assertEqual(len(self.arjun.get('/api/me/tasks').json()['tasks']),1)
        rid=self.queue('planned-restart')
        with connection(self.app) as c:c.execute("UPDATE personal_runs SET status='planned',plan=?,sources=? WHERE id=?",(json.dumps(self.plan()),'["packaging"]',rid))
        restart=create_app(self.path,None);asyncio.run(process_one(restart,restart.state.work_service))
        self.assertEqual(len(self.arjun.get('/api/me/tasks').json()['tasks']),2)
    def test_provider_context_isolation(self):
        self.client.post('/api/spaces/digital/orders',json={'name':'SECRET DIGITAL','quantity':1})
        self.client.post('/api/spaces/packaging/orders',json={'name':'PUBLIC PACKAGING','quantity':1})
        captured=[]
        class Response:
            status_code=200
            def json(self):return {'choices':[{'message':{'content':json.dumps({'answer':'Scoped answer','actions':[]})}}]}
        class Client:
            def __init__(self,**k):pass
            async def __aenter__(self):return self
            async def __aexit__(self,*a):pass
            async def post(self,*a,**k):captured.append(k['json']);return Response()
        self.queue(question='Find SECRET PUBLIC',space='packaging')
        with patch.dict(os.environ,{'GROQ_API_KEY':'test'}),patch('backend.personal.httpx.AsyncClient',Client):asyncio.run(process_one(self.app,self.app.state.work_service))
        content=captured[0]['messages'][1]['content'];self.assertNotIn('SECRET DIGITAL',content);self.assertIn('PUBLIC PACKAGING',content);self.assertEqual(captured[0]['response_format'],{'type':'json_object'})
        self.assertNotIn('password',content)

    def test_evening_example_uses_six_pm_and_notifies_once(self):
        class Clock(datetime):
            @classmethod
            def now(cls,tz=None):
                value=cls(2030,1,2,9,0,tzinfo=timezone.utc)
                return value.astimezone(tz) if tz else value.replace(tzinfo=None)
        self.queue(question='Hi Arjun, can you make an Instagram post for this evening for the event?')
        with patch('backend.personal.datetime',Clock):self.process(self.plan())
        task=self.arjun.get('/api/me/tasks').json()['tasks'][0]
        self.assertEqual(datetime.fromisoformat(task['due_at']).hour,12)
        self.assertEqual(datetime.fromisoformat(task['due_at']).minute,30)
        result=self.client.get('/api/me/ai/runs/request-1234').json()['result']
        self.assertIn('6 PM',result['answer'])
        self.assertEqual(result['actions'][0]['assignee'],'Arjun')

    def test_push_expired_subscription_and_stale_reminder(self):
        import sys,types
        endpoint='https://web.push.apple.com/device-test'
        subscription={'endpoint':endpoint,'keys':{'auth':'test-auth','p256dh':'test-key'}}
        self.assertEqual(self.arjun.post('/api/me/push-subscriptions',json=subscription).status_code,201)
        self.client.post('/api/spaces/packaging/tasks',json={'title':'Push task','assignee_id':self.arjun_id})
        class Expired(Exception):
            response=types.SimpleNamespace(status_code=410)
        transport=types.ModuleType('pywebpush');transport.WebPushException=Expired
        def send(**kwargs):raise Expired()
        transport.webpush=send
        with patch.dict(sys.modules,{'pywebpush':transport}),patch.dict(os.environ,{'VAPID_PRIVATE_KEY':'test-key','VAPID_SUBJECT':'mailto:test@example.com'}):deliver_one(self.app)
        with connection(self.app) as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM push_subscriptions').fetchone()[0],0)
            self.assertEqual(c.execute('SELECT status FROM notification_jobs').fetchone()[0],'expired')
        self.arjun.post('/api/me/push-subscriptions',json=subscription)
        task=self.client.post('/api/spaces/packaging/tasks',json={'title':'Reminder','assignee_id':self.arjun_id,'due_at':(datetime.now(timezone.utc)+timedelta(minutes=20)).isoformat()}).json()
        reminders(self.app)
        self.client.patch('/api/tasks/'+task['id'],json={'due_at':(datetime.now(timezone.utc)+timedelta(days=2)).isoformat()})
        # Suppress the assignment so the next eligible delivery is the old reminder.
        with connection(self.app) as c:c.execute("UPDATE notification_jobs SET status='sent' WHERE notification_id IN (SELECT id FROM notifications WHERE title!='Task deadline reminder')")
        calls=[];transport.webpush=lambda **kwargs:calls.append(kwargs)
        with patch.dict(sys.modules,{'pywebpush':transport}):deliver_one(self.app)
        self.assertEqual(calls,[])
        with connection(self.app) as c:self.assertEqual(c.execute("SELECT status FROM notification_jobs WHERE notification_id IN (SELECT id FROM notifications WHERE title='Task deadline reminder')").fetchone()[0],'suppressed')

    def test_groq_invalid_json_retries_once(self):
        calls=[]
        class Response:
            def __init__(self, status): self.status_code=status
            def json(self):
                if self.status_code==400:
                    return {'error':{'code':'json_validate_failed','failed_generation':'PRIVATE TEXT'}}
                return {'choices':[{'message':{'content':json.dumps({'answer':'Recovered','actions':[]})}}]}
        class Client:
            def __init__(self,**kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self,*args): pass
            async def post(self,*args,**kwargs):
                calls.append(dict(kwargs['json']))
                return Response(400 if len(calls)==1 else 200)
        self.queue(question='What needs attention?')
        with patch.dict(os.environ,{'GROQ_API_KEY':'test'}),patch('backend.personal.httpx.AsyncClient',Client):
            asyncio.run(process_one(self.app,self.app.state.work_service))
        self.assertEqual(len(calls),2)
        self.assertEqual(calls[1]['temperature'],0)

    def test_personal_combines_sources_but_shared_generation_is_scoped(self):
        self.client.post('/api/spaces/digital/orders',json={'name':'PRIVATE DIGITAL CONTENT','quantity':1})
        self.client.post('/api/spaces/packaging/orders',json={'name':'PACKAGING CONTENT','quantity':1})
        captured=[];plan=self.plan()
        class Response:
            status_code=200
            def json(self):return {'choices':[{'message':{'content':json.dumps(plan)}}]}
        class Client:
            def __init__(self,**kwargs):pass
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def post(self,*args,**kwargs):captured.append(kwargs['json']);return Response()
        self.queue(question='Search CONTENT then create task in Packaging studio for Arjun',space=None)
        with patch.dict(os.environ,{'GROQ_API_KEY':'test'}),patch('backend.personal.httpx.AsyncClient',Client):asyncio.run(process_one(self.app,self.app.state.work_service))
        self.assertEqual(len(captured),2)
        self.assertIn('PRIVATE DIGITAL CONTENT',captured[0]['messages'][1]['content'])
        self.assertNotIn('PRIVATE DIGITAL CONTENT',captured[1]['messages'][1]['content'])
        self.assertIn('PACKAGING CONTENT',captured[1]['messages'][1]['content'])
        self.assertEqual(json.loads(captured[1]['messages'][1]['content'])['private_history'],[])

    def test_workspace_membership_management_preserves_other_spaces(self):
        created=self.client.post('/api/admin/spaces',json={'name':'Events','description':'Event team'})
        self.assertEqual(created.status_code,201)
        space=created.json()['id']
        self.assertIn(space,[w['id'] for w in self.client.get('/api/me/workspaces').json()])
        members={'member_ids':[self.user['id'],self.arjun_id]}
        self.assertEqual(self.arjun.put('/api/admin/spaces/'+space+'/members',json=members).status_code,403)
        self.assertEqual(self.client.put('/api/admin/spaces/'+space+'/members',json=members).status_code,200)
        self.assertEqual(set(w['id'] for w in self.arjun.get('/api/me/workspaces').json()),{'packaging',space})
        invalid=self.client.put('/api/admin/spaces/'+space+'/members',json={'member_ids':['missing-account']})
        self.assertEqual(invalid.status_code,400)
        self.assertEqual(self.arjun.get('/api/spaces/'+space+'/work').status_code,200)
        self.client.put('/api/admin/spaces/'+space+'/members',json={'member_ids':[self.user['id']]})
        self.assertEqual(self.arjun.get('/api/spaces/'+space+'/work').status_code,403)
        self.assertEqual(self.arjun.get('/api/spaces/packaging/work').status_code,200)

    def test_server_starts_and_stops_embedded_worker(self):
        import threading
        started=threading.Event();stopped=threading.Event()
        async def worker(app):
            started.set()
            try:await asyncio.sleep(60)
            finally:stopped.set()
        with patch.dict(os.environ,{'COLLECTIVE_TEST':'false','EMBEDDED_WORKER':'true'}),patch('backend.worker.run_worker',worker):
            with TestClient(self.app) as client:
                self.assertTrue(started.wait(2))
                self.assertEqual(client.get('/api/health').status_code,200)
            self.assertTrue(stopped.wait(2))

    def test_serverless_inline_processing_when_embedded_worker_disabled(self):
        plan = {'answer': 'Hello! How can I help you today?', 'actions': []}
        async def fake_propose(*args, **kwargs):
            return plan, ['packaging']
        with patch.dict(os.environ, {'COLLECTIVE_TEST': 'false', 'EMBEDDED_WORKER': 'false'}), patch('backend.personal.propose', fake_propose):
            r = self.client.post('/api/me/ai/runs', json={
                'request_id': 'inline-run-1',
                'conversation_id': self.cid,
                'question': 'hi',
                'space': 'packaging'
            })
            self.assertEqual(r.status_code, 202)
            data = r.json()
            self.assertEqual(data['status'], 'completed')
            self.assertIsNotNone(data['result'])
            self.assertEqual(data['result']['answer'], 'Hello! How can I help you today?')

            # Check run_status
            status_res = self.client.get('/api/me/ai/runs/inline-run-1').json()
            self.assertEqual(status_res['status'], 'completed')
            self.assertEqual(status_res['result']['answer'], 'Hello! How can I help you today?')

            # Check conversation history
            history = self.client.get('/api/me/conversations/' + self.cid).json()
            self.assertEqual(len(history), 1)
            self.assertEqual(history[0]['question'], 'hi')
            self.assertEqual(history[0]['result']['answer'], 'Hello! How can I help you today?')

    def test_serverless_inline_retry_when_embedded_worker_disabled(self):
        with connection(self.app) as conn:
            conn.execute("INSERT INTO personal_runs(id,user_id,conversation_id,space,question,timezone,status,result,created) VALUES (?,?,?,?,?,?,?,?,?)",
                         ('failed-run-1', self.user['id'], self.cid, 'packaging', 'try again', 'Asia/Kolkata', 'failed', json.dumps({'answer': 'failed', 'actions': []}), '2026-01-01T00:00:00Z'))
        plan = {'answer': 'Recovered after retry!', 'actions': []}
        async def fake_propose(*args, **kwargs):
            return plan, ['packaging']
        with patch.dict(os.environ, {'COLLECTIVE_TEST': 'false', 'EMBEDDED_WORKER': 'false'}), patch('backend.personal.propose', fake_propose):
            r = self.client.post('/api/me/ai/runs/failed-run-1/retry')
            self.assertEqual(r.status_code, 200)
            data = r.json()
            self.assertEqual(data['status'], 'completed')
            self.assertEqual(data['result']['answer'], 'Recovered after retry!')

    def test_transcribe_voice_note_supported_types(self):
        class FakeClient:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def post(self, *args, **kwargs):
                class FakeResp:
                    status_code = 200
                    def json(self): return {'text': 'Transcribed voice note text'}
                return FakeResp()

        with patch.dict(os.environ, {'GROQ_API_KEY': 'test-key'}), patch('backend.personal.httpx.AsyncClient', FakeClient):
            # Test webm
            r1 = self.client.post('/api/me/ai/transcribe', files={'audio': ('voice.webm', b'dummy-audio-bytes', 'audio/webm')})
            self.assertEqual(r1.status_code, 200)
            self.assertEqual(r1.json()['text'], 'Transcribed voice note text')

            # Test m4a / audio/mp4 (Safari/iOS)
            r2 = self.client.post('/api/me/ai/transcribe', files={'audio': ('voice.m4a', b'dummy-audio-bytes', 'audio/mp4')})
            self.assertEqual(r2.status_code, 200)
            self.assertEqual(r2.json()['text'], 'Transcribed voice note text')

            # Test audio/x-m4a
            r3 = self.client.post('/api/me/ai/transcribe', files={'audio': ('voice.m4a', b'dummy-audio-bytes', 'audio/x-m4a')})
            self.assertEqual(r3.status_code, 200)

            # Test wav
            r_wav = self.client.post('/api/me/ai/transcribe', files={'audio': ('voice.wav', b'RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00', 'audio/wav')})
            self.assertEqual(r_wav.status_code, 200)
            self.assertEqual(r_wav.json()['text'], 'Transcribed voice note text')

            # Test invalid format
            r4 = self.client.post('/api/me/ai/transcribe', files={'audio': ('file.exe', b'bad-bytes', 'application/x-msdownload')})
            self.assertEqual(r4.status_code, 415)

    def test_admin_can_create_workspace_via_ai(self):
        plan = {
            'answer': 'I have created the new workspace called termjobs for you.',
            'actions': [{'tool': 'create_workspace', 'space': None, 'args': {'name': 'termjobs', 'description': 'Workspace for TermJobs'}}]
        }
        self.queue('req-create-space', question='Can you create a new workspace called termjobs?')
        self.process(plan)
        res = self.client.get('/api/me/ai/runs/req-create-space').json()
        self.assertEqual(res['status'], 'completed')
        self.assertEqual(len(res['result']['actions']), 1)
        self.assertEqual(res['result']['actions'][0]['label'], 'Workspace created')
        self.assertEqual(res['result']['actions'][0]['title'], 'termjobs')

        # Verify workspace appears in user's workspaces
        spaces = [w['name'] for w in self.client.get('/api/me/workspaces').json()]
        self.assertIn('termjobs', spaces)

    def test_admin_can_create_workspace_with_members_via_ai(self):
        plan = {
            'answer': 'I have created the Marketing workspace and added Arjun to it.',
            'actions': [{
                'tool': 'create_workspace',
                'space': None,
                'args': {'name': 'Marketing', 'description': 'Marketing dept', 'members': ['Arjun']}
            }]
        }
        self.queue('req-create-space-members', question='Create workspace Marketing and add Arjun to it')
        self.process(plan)
        res = self.client.get('/api/me/ai/runs/req-create-space-members').json()
        self.assertEqual(res['status'], 'completed')
        self.assertEqual(len(res['result']['actions']), 1)
        self.assertIn('Workspace created with Arjun', res['result']['actions'][0]['label'])

        # Verify Arjun can see Marketing in workspaces
        arjun_spaces = [w['name'] for w in self.arjun.get('/api/me/workspaces').json()]
        self.assertIn('Marketing', arjun_spaces)

    def test_admin_can_add_workspace_member_via_ai(self):
        plan = {
            'answer': 'I have added Arjun to Digital & IT workspace.',
            'actions': [{
                'tool': 'add_workspace_member',
                'space': None,
                'args': {'workspace': 'Digital & IT', 'member': 'Arjun'}
            }]
        }
        self.queue('req-add-member-space', question='Add Arjun to Digital & IT workspace')
        self.process(plan)
        res = self.client.get('/api/me/ai/runs/req-add-member-space').json()
        self.assertEqual(res['status'], 'completed')
        self.assertEqual(res['result']['actions'][0]['label'], 'Added to Digital & IT')

        arjun_spaces = [w['name'] for w in self.arjun.get('/api/me/workspaces').json()]
        self.assertIn('Digital & IT', arjun_spaces)

    def test_propose_allows_create_workspace_without_destination_space(self):
        plan = {
            'answer': 'Created termjobs workspace',
            'actions': [{'tool': 'create_workspace', 'space': None, 'args': {'name': 'termjobs'}}]
        }
        class FakeResp:
            status_code = 200
            def json(self): return {'choices': [{'message': {'content': json.dumps(plan)}}]}
        class FakeClient:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def post(self, *args, **kwargs): return FakeResp()

        # Admin has multiple spaces (packaging, digital); multi-workspace checks must not raise Unknown destination workspace
        with patch.dict(os.environ, {'GROQ_API_KEY': 'test-key'}), patch('backend.personal.httpx.AsyncClient', FakeClient):
            self.queue('req-propose-space', question='Create workspace termjobs', space=None)
            asyncio.run(process_one(self.app, self.app.state.work_service))
            res = self.client.get('/api/me/ai/runs/req-propose-space').json()
            self.assertEqual(res['status'], 'completed')
            self.assertEqual(res['result']['actions'][0]['label'], 'Workspace created')
            self.assertEqual(res['result']['actions'][0]['title'], 'termjobs')

    def test_member_cannot_create_workspace_via_ai(self):
        # Arjun is a member, not an admin
        arjun_cid = self.arjun.post('/api/me/conversations').json()['id']
        self.arjun.post('/api/me/ai/runs', json={
            'request_id': 'arjun-space-req',
            'conversation_id': arjun_cid,
            'question': 'Create workspace test',
            'space': 'packaging'
        })
        plan = {
            'answer': 'Creating workspace...',
            'actions': [{'tool': 'create_workspace', 'space': None, 'args': {'name': 'forbidden', 'description': ''}}]
        }
        async def fake_propose(*args, **kwargs): return plan, ['packaging']
        with patch('backend.personal.propose', fake_propose):
            asyncio.run(process_one(self.app, self.app.state.work_service))

        res = self.arjun.get('/api/me/ai/runs/arjun-space-req').json()
        self.assertEqual(len(res['result']['failed_actions']), 1)
        self.assertIn('Only administrators', res['result']['failed_actions'][0]['error'])

    def test_admin_receives_all_platform_users_in_context(self):
        # Register a member with 0 spaces
        self.client.post('/api/admin/members', json={'name': 'Unassigned Member', 'email': 'unassigned@example.com', 'password': 'pass', 'spaces': []})
        captured = []
        class FakeClient:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def post(self, *args, **kwargs):
                captured.append(kwargs.get('json'))
                class FakeResp:
                    status_code = 200
                    def json(self): return {'choices': [{'message': {'content': json.dumps({'answer': 'Here are all users.', 'actions': []})}}]}
                return FakeResp()

        with patch.dict(os.environ, {'GROQ_API_KEY': 'test-key'}), patch('backend.personal.httpx.AsyncClient', FakeClient):
            self.queue('req-platform-users', question='Show all candidates on the platform', space=None)
            asyncio.run(process_one(self.app, self.app.state.work_service))

        self.assertEqual(len(captured), 1)
        user_content = json.loads(captured[0]['messages'][1]['content'])
        platform_users = user_content['data']['platform_users']
        user_names = [u['name'] for u in platform_users]
        self.assertIn('Alex Morgan', user_names)
        self.assertIn('Arjun', user_names)
        self.assertIn('Unassigned Member', user_names)

    def test_overdue_tasks_annotated_in_ai_context(self):
        past_due = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        self.client.post('/api/spaces/packaging/tasks', json={'title': 'Urgent Overdue Task', 'assignee_id': self.user['id'], 'due_at': past_due})
        captured = []
        class FakeClient:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def post(self, *args, **kwargs):
                captured.append(kwargs.get('json'))
                class FakeResp:
                    status_code = 200
                    def json(self): return {'choices': [{'message': {'content': json.dumps({'answer': 'Overdue tasks alert.', 'actions': []})}}]}
                return FakeResp()

        with patch.dict(os.environ, {'GROQ_API_KEY': 'test-key'}), patch('backend.personal.httpx.AsyncClient', FakeClient):
            self.queue('req-overdue-test', question='Are there any overdue tasks?', space=None)
            asyncio.run(process_one(self.app, self.app.state.work_service))

        self.assertEqual(len(captured), 1)
        user_content = json.loads(captured[0]['messages'][1]['content'])
        overdue_tasks = user_content['data']['overdue_tasks']
        self.assertTrue(any(t['title'] == 'Urgent Overdue Task' and t['is_overdue'] for t in overdue_tasks))
        self.assertGreaterEqual(user_content['data']['overdue_task_count'], 1)

    def test_empty_conversation_id_persists_turn_and_history(self):
        res = self.client.post('/api/me/ai/runs', json={'request_id': 'req-auto-cid', 'conversation_id': '', 'question': 'Hello', 'timezone': 'UTC'})
        self.assertEqual(res.status_code, 202)
        asyncio.run(process_one(self.app, self.app.state.work_service))
        run_data = self.client.get('/api/me/ai/runs/req-auto-cid').json()
        self.assertEqual(run_data['status'], 'completed')
        # Check that conversation was created and turn exists in history
        convs = self.client.get('/api/me/conversations').json()
        self.assertGreater(len(convs), 0)
        history = self.client.get('/api/me/conversations/' + convs[0]['id']).json()
        self.assertGreaterEqual(len(history), 1)
        self.assertEqual(history[0]['question'], 'Hello')

    def test_task_project_assignment_and_resolution(self):
        # 1. Create a project
        p_res = self.client.post('/api/spaces/packaging/projects', json={'name': 'Packaging Rebrand', 'description': 'New look'})
        self.assertEqual(p_res.status_code, 201)
        project_id = p_res.json()['id']

        # 2. Create task using project name instead of UUID
        t_res = self.client.post('/api/spaces/packaging/tasks', json={
            'title': 'Design new box',
            'project_id': 'Packaging Rebrand',
            'assignee_id': self.user['id']
        })
        self.assertEqual(t_res.status_code, 201)
        task_data = t_res.json()
        self.assertEqual(task_data['project_id'], project_id)

        # 3. Snapshot includes project_name and task_count
        snap = self.client.get('/api/spaces/packaging/work').json()
        task_in_snap = next(t for t in snap['tasks'] if t['id'] == task_data['id'])
        self.assertEqual(task_in_snap['project_name'], 'Packaging Rebrand')
        proj_in_snap = next(p for p in snap['projects'] if p['id'] == project_id)
        self.assertEqual(proj_in_snap['task_count'], 1)

        # 4. Update task to clear project
        u_res = self.client.patch('/api/tasks/' + task_data['id'], json={'clear_project': True})
        self.assertEqual(u_res.status_code, 200)
        self.assertIsNone(u_res.json()['project_id'])

        # 5. Update task to assign back by partial project name
        u_res2 = self.client.patch('/api/tasks/' + task_data['id'], json={'project_id': 'Rebrand'})
        self.assertEqual(u_res2.status_code, 200)
        self.assertEqual(u_res2.json()['project_id'], project_id)

    def test_create_project_and_task_in_same_turn(self):
        plan = {
            'answer': 'Created project and task.',
            'actions': [
                {'tool': 'create_project', 'space': 'packaging', 'args': {'name': 'Termjobs Website', 'description': 'Platform site'}},
                {'tool': 'create_task', 'space': 'packaging', 'args': {'title': 'Build landing page', 'project_id': 'Termjobs Website', 'assignee_id': self.user['id']}}
            ]
        }
        async def fake_propose(*args, **kwargs):
            return plan, ['packaging']
        with patch('backend.personal.propose', fake_propose):
            self.queue('req-chained-proj', question='create project Termjobs Website and add task Build landing page', space='packaging')
            asyncio.run(process_one(self.app, self.app.state.work_service))

        res = self.client.get('/api/me/ai/runs/req-chained-proj').json()
        self.assertEqual(res['status'], 'completed')
        actions = res['result']['actions']
        self.assertEqual(len(actions), 2)
        self.assertEqual(actions[0]['kind'], 'project')
        self.assertEqual(actions[1]['kind'], 'task')
        new_proj_id = actions[0]['id']
        new_task_id = actions[1]['id']

        # Verify task is linked to project
        task_detail = self.client.get('/api/tasks/' + new_task_id).json()
        self.assertEqual(task_detail['project_id'], new_proj_id)

if __name__=='__main__':unittest.main()
