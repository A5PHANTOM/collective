import os
os.environ['COLLECTIVE_TEST']='true'
os.environ['ADMIN_PASSWORD']='1234'
os.environ['GROQ_API_KEY']=''
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta,timezone
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.app import create_app,password_hash,connection

class CollectiveTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=Path(self.temp.name)/'test.sqlite3'
        self.app=create_app(self.path,legacy_path=None)
        self.client=TestClient(self.app)
        self.login(self.client)

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def login(self,client,email='admin@gmail.com',password='1234'):
        result=client.post('/api/login',json={'email':email,'password':password})
        self.assertEqual(result.status_code,200,result.text)
        return result

    def order(self,space='packaging',**changes):
        body={'name':'Botanical box','client':'Evergreen','quantity':500,'details':'Recycled board',**changes}
        response=self.client.post(f'/api/spaces/{space}/orders',json=body)
        self.assertEqual(response.status_code,201,response.text)
        return response.json()

    def member(self):
        self.assertEqual(self.client.post('/api/admin/members',json={'name':'Member','email':'member@example.com','password':'member-password','spaces':['packaging']}).status_code,201)
        client=TestClient(self.app)
        self.addCleanup(client.close)
        self.login(client,'member@example.com','member-password')
        return client

    def test_authentication_and_sessions(self):
        guest=TestClient(self.app)
        self.addCleanup(guest.close)
        self.assertEqual(guest.get('/api/bootstrap').status_code,401)
        self.assertEqual(guest.post('/api/login',json={'email':'admin@gmail.com','password':'wrong'}).status_code,401)
        login=self.login(guest)
        self.assertIn('HttpOnly',login.headers['set-cookie'])
        self.assertIn('SameSite=strict',login.headers['set-cookie'])
        boot=guest.get('/api/bootstrap').json()
        self.assertNotIn('password',boot['user'])
        self.assertNotIn('salt',boot['user'])
        guest.post('/api/logout')
        self.assertEqual(guest.get('/api/bootstrap').status_code,401)
        self.assertEqual(self.client.post('/api/admin/spaces',headers={'Origin':'https://attacker.example'},json={'name':'Bad'}).status_code,403)

    def test_unique_order_ids_and_restart(self):
        a=self.order()
        b=self.order('digital')
        self.assertEqual(a['order_id'],'ORD-000001')
        self.assertEqual(b['order_id'],'ORD-000002')
        self.assertNotEqual(a['id'],b['id'])
        self.client.put('/api/orders/'+a['id'],json={'name':'Renamed','quantity':600,'order_id':'HACKED'})
        self.assertEqual(self.client.get('/api/orders/'+a['id']).json()['order_id'],a['order_id'])
        second=TestClient(create_app(self.path,legacy_path=None))
        self.addCleanup(second.close)
        second.cookies.update(self.client.cookies)
        self.assertEqual(second.get('/api/orders/'+a['id']).json()['name'],'Renamed')
        c=second.post('/api/spaces/packaging/orders',json={'name':'Third','quantity':1}).json()
        self.assertEqual(c['order_id'],'ORD-000003')

    def test_concurrent_creation_has_unique_ids(self):
        def create(i):
            c=TestClient(self.app)
            try:
                c.cookies.update(self.client.cookies)
                r=c.post('/api/spaces/packaging/orders',json={'name':f'Order {i}','quantity':2})
                self.assertEqual(r.status_code,201,r.text)
                return r.json()['order_id']
            finally:
                c.close()
        with ThreadPoolExecutor(max_workers=4) as executor:
            ids=list(executor.map(create,range(12)))
        self.assertEqual(len(set(ids)),12)

    def test_feedback_production_estimate_dispatch_history(self):
        order=self.order()
        eta=(datetime.now(timezone.utc)+timedelta(days=3)).isoformat()
        self.assertEqual(self.client.post(f"/api/orders/{order['id']}/updates",json={'stage':'Production','feedback':'Approved proof. Printing has started.','estimated_finish':eta}).status_code,201)
        self.assertEqual(self.client.post(f"/api/orders/{order['id']}/updates",json={'stage':'Dispatched','feedback':'Handed to carrier.','tracking_id':'AWB-123456','carrier':'Blue Dart'}).status_code,201)
        detail=self.client.get('/api/orders/'+order['id']).json()
        self.assertEqual(detail['stage'],'Dispatched')
        self.assertEqual(len(detail['updates']),3)
        self.assertEqual(detail['updates'][0]['tracking_id'],'AWB-123456')
        self.assertEqual(detail['updates'][0]['carrier'],'Blue Dart')
        self.assertEqual(detail['updates'][1]['estimated_finish'],eta)
        self.assertEqual(detail['updates'][1]['feedback'],'Approved proof. Printing has started.')
        listing=self.client.get('/api/spaces/packaging/orders').json()['orders'][0]
        self.assertEqual(listing['latest_update']['tracking_id'],'AWB-123456')
        self.assertNotIn('image',listing)

    def test_reminders_reschedule_complete_and_validation(self):
        order=self.order()
        future=datetime.now(timezone.utc)+timedelta(hours=5)
        response=self.client.post(f"/api/orders/{order['id']}/updates",json={'stage':'Production','feedback':'Check the print run','reminder_at':future.isoformat()})
        self.assertEqual(response.status_code,201)
        reminders=self.client.get('/api/spaces/packaging/orders').json()['reminders']
        self.assertEqual(len(reminders),1)
        rid=reminders[0]['id']
        new_time=(future+timedelta(days=1)).isoformat()
        self.assertEqual(self.client.post('/api/reminders/'+rid,json={'action':'reschedule','remind_at':new_time}).status_code,200)
        self.assertEqual(self.client.get('/api/spaces/packaging/orders').json()['reminders'][0]['remind_at'],new_time)
        self.assertEqual(self.client.post('/api/reminders/'+rid,json={'action':'complete'}).status_code,200)
        self.assertEqual(self.client.get('/api/spaces/packaging/orders').json()['reminders'],[])
        self.assertEqual(self.client.post('/api/reminders/'+rid,json={'action':'reschedule','remind_at':'2001-01-01T12:00:00Z'}).status_code,400)
        self.assertEqual(self.client.post(f"/api/orders/{order['id']}/updates",json={'stage':'Production','reminder_at':'2001-01-01T12:00:00Z'}).status_code,400)
        self.assertEqual(self.client.post(f"/api/orders/{order['id']}/updates",json={'stage':'Production','estimated_finish':'2028-01-01T12:00:00'}).status_code,422)

    def test_workspace_isolation_and_immediate_revocation(self):
        packaging=self.order()
        digital=self.order('digital')
        member=self.member()
        self.assertEqual([s['id'] for s in member.get('/api/bootstrap').json()['spaces']],['packaging'])
        for path in ['/api/admin','/api/spaces/digital/orders','/api/spaces/digital/messages','/api/spaces/digital/ai','/api/orders/'+digital['id'],'/api/orders/'+digital['id']+'/image']:
            self.assertEqual(member.get(path).status_code,403,path)
        self.assertEqual(member.post('/api/spaces/digital/ai',json={'question':'Read everything'}).status_code,403)
        self.assertEqual(member.post(f"/api/orders/{digital['id']}/updates",json={'stage':'Production'}).status_code,403)
        user_id=member.get('/api/bootstrap').json()['user']['id']
        self.assertEqual(self.client.put(f'/api/admin/members/{user_id}/access',json={'spaces':[]}).status_code,200)
        self.assertEqual(member.get('/api/orders/'+packaging['id']).status_code,403)
        self.assertEqual(member.get('/api/bootstrap').json()['spaces'],[])

    def test_validation_and_admin_creation(self):
        for payload in [{'name':'','quantity':1},{'name':'X','quantity':0},{'name':'X','quantity':1.5},{'name':'X','quantity':True},{'name':'X','quantity':1,'due':'2026-02-31'},{'name':'X','quantity':1,'image':'data:image/png;base64,YQ=='}]:
            self.assertEqual(self.client.post('/api/spaces/packaging/orders',json=payload).status_code,422,payload)
        self.assertEqual(self.client.post('/api/spaces/packaging/orders',json={'name':'X','quantity':1,'assignee':'unknown'}).status_code,400)
        self.assertEqual(self.client.post('/api/admin/spaces',json={'name':'Packaging projects','description':'Design and delivery'}).status_code,201)
        self.assertEqual(len(self.client.get('/api/bootstrap').json()['spaces']),3)
        self.assertEqual(self.client.post('/api/spaces/packaging/messages',json={'text':'   '}).status_code,422)
        self.assertEqual(self.client.post('/api/spaces/packaging/messages',json={'text':'Proof approved.'}).status_code,201)
        self.assertEqual(self.client.get('/api/spaces/packaging/messages').json()[0]['text'],'Proof approved.')
        self.assertEqual(self.client.get('/data/store.json').status_code,404)

    def test_admin_workspace_list_is_not_limited_to_memberships(self):
        admin_id=self.client.get('/api/bootstrap').json()['user']['id']
        space_id=self.client.post('/api/admin/spaces',json={'name':'Admin visible'}).json()['id']
        with connection(self.app) as conn:
            conn.execute('DELETE FROM memberships WHERE user_id=? AND space_id=?',(admin_id,space_id))
        self.assertIn(space_id,[s['id'] for s in self.client.get('/api/me/workspaces').json()])
        member=self.member()
        self.assertNotIn(space_id,[s['id'] for s in member.get('/api/me/workspaces').json()])

    def test_delete_workspace_removes_data_and_access(self):
        admin_id=self.client.get('/api/bootstrap').json()['user']['id']
        space_id=self.client.post('/api/admin/spaces',json={'name':'Temporary','description':'Temporary space'}).json()['id']
        order=self.order(space_id)
        self.assertEqual(self.client.post(f'/api/spaces/{space_id}/messages',json={'text':'Temporary note'}).status_code,201)
        self.assertEqual(self.client.post(f'/api/spaces/{space_id}/tasks',json={'title':'Temporary task','assignee_id':admin_id}).status_code,201)
        member=self.member()
        member_id=member.get('/api/bootstrap').json()['user']['id']
        self.assertEqual(self.client.put(f'/api/admin/members/{member_id}/access',json={'spaces':[space_id]}).status_code,200)
        self.assertEqual(member.delete(f'/api/admin/spaces/{space_id}').status_code,403)
        self.assertEqual(self.client.delete(f'/api/admin/spaces/{space_id}').status_code,200)
        self.assertEqual(self.client.delete(f'/api/admin/spaces/{space_id}').status_code,404)
        self.assertNotIn(space_id,[s['id'] for s in self.client.get('/api/bootstrap').json()['spaces']])
        self.assertEqual(member.get('/api/bootstrap').json()['spaces'],[])
        self.assertEqual(self.client.get(f'/api/spaces/{space_id}/orders').status_code,404)
        self.assertEqual(self.client.get(f'/api/spaces/{space_id}/messages').status_code,404)
        self.assertEqual(self.client.get('/api/orders/'+order['id']).status_code,404)
        with connection(self.app) as conn:
            for table,column in [('memberships','space_id'),('orders','space'),('messages','space'),('tasks','space'),('projects','space'),('notifications','space'),('ai_runs','space'),('ai_receipts','space'),('personal_runs','space')]:
                self.assertEqual(conn.execute(f'SELECT COUNT(*) FROM {table} WHERE {column}=?',(space_id,)).fetchone()[0],0,table)

    def test_legacy_migration_is_idempotent_and_preserves_passwords(self):
        legacy=Path(self.temp.name)/'old.json'
        salt='00112233445566778899aabbccddeeff'
        legacy.write_text(json.dumps({'users':[{'id':'legacy-admin','name':'Owner','email':'admin@gmail.com','role':'admin','salt':salt,'password':password_hash('1234',salt),'spaces':['packaging']}],'spaces':[{'id':'packaging','name':'Original studio','description':'Preserved'}],'items':[{'id':'original-order','space':'packaging','name':'Existing order','number':'PKG-22','client':'Client','quantity':200,'stage':'Design','priority':'High','due':'2026-12-01','details':'Keep this detail','assignee':'legacy-admin','art':'sage','image':'','created':'2026-11-01T12:00:00Z'}],'messages':[{'id':'msg','space':'packaging','author':'Owner','text':'Existing chat','created':'2026-11-01T12:00:00Z'}],'activities':[]}))
        path=Path(self.temp.name)/'migrated.sqlite3'
        before=legacy.read_bytes()
        first=create_app(path,legacy)
        second=create_app(path,legacy)
        c=TestClient(second)
        self.addCleanup(c.close)
        self.login(c)
        listing=c.get('/api/spaces/packaging/orders').json()['orders']
        self.assertEqual(len(listing),1)
        self.assertEqual(listing[0]['id'],'original-order')
        self.assertEqual(listing[0]['number'],'PKG-22')
        self.assertEqual(listing[0]['details'],'Keep this detail')
        self.assertEqual(c.get('/api/spaces/packaging/messages').json()[0]['text'],'Existing chat')
        self.assertEqual(legacy.read_bytes(),before)

    def test_groq_payload_context_and_failure(self):
        order=self.order()
        self.order('digital',name='SECRET OTHER WORKSPACE')
        self.client.post('/api/spaces/packaging/messages',json={'text':'Delivery after Friday.'})
        self.client.post(f"/api/orders/{order['id']}/updates",json={'stage':'Production','feedback':'Use the new proof.'})
        self.assertEqual(self.client.post('/api/spaces/packaging/ai',json={'question':'What next?'}).status_code,503)
        calls=[]
        class FakeResponse:
            status_code=200
            def json(self):
                return {'choices':[{'message':{'content':'ORD-000001 is in production.'}}]}
        class FakeClient:
            def __init__(self,**kwargs):pass
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def post(self,url,**kwargs):
                calls.append((url,kwargs))
                return FakeResponse()
        with patch.dict(os.environ,{'GROQ_API_KEY':'test-only-key'}),patch('backend.app.httpx.AsyncClient',FakeClient):
            answer=self.client.post('/api/spaces/packaging/ai',json={'question':'What next?'})
        self.assertEqual(answer.status_code,200,answer.text)
        self.assertEqual(answer.json()['answer'],'ORD-000001 is in production.')
        url,kwargs=calls[0]
        self.assertEqual(url,'https://api.groq.com/openai/v1/chat/completions')
        self.assertEqual(kwargs['headers']['Authorization'],'Bearer test-only-key')
        self.assertEqual(kwargs['json']['messages'][0]['role'],'system')
        context=kwargs['json']['messages'][1]['content']
        self.assertIn('Delivery after Friday',context)
        self.assertIn('Use the new proof',context)
        self.assertIn('ORD-000001',context)
        self.assertNotIn('SECRET OTHER WORKSPACE',context)
        self.assertNotIn('password',context)
        self.assertEqual(len(self.client.get('/api/spaces/packaging/ai').json()),2)
        self.assertEqual(self.client.get('/api/spaces/digital/ai').json(),[])
        with patch.dict(os.environ,{'GROQ_API_KEY':'test-only-key'}),patch('backend.app.httpx.AsyncClient',FakeClient),patch.object(FakeResponse,'status_code',429):
            self.assertEqual(self.client.post('/api/spaces/packaging/ai',json={'question':'Again?'}).status_code,502)
        self.assertEqual(len(self.client.get('/api/spaces/packaging/ai').json()),2)

if __name__=='__main__':
    unittest.main()
