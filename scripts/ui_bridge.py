import os,sys,json,tempfile
os.environ['COLLECTIVE_TEST']='true'
os.environ['ADMIN_PASSWORD']='1234'
os.environ.pop('OPENAI_API_KEY',None)
sys.path.insert(0,os.getcwd())
from backend.app import create_app
from fastapi.testclient import TestClient
with tempfile.TemporaryDirectory() as folder:
 app=create_app(folder+'/ui.sqlite3',legacy_path=None)
 with TestClient(app) as client:
  for line in sys.stdin:
   try:
    msg=json.loads(line)
    response=client.request(msg.get('method','GET'),msg['path'],json=msg.get('body'))
    print(json.dumps({'id':msg['id'],'status':response.status_code,'data':response.json()}),flush=True)
   except Exception as e:
    print(json.dumps({'id':msg.get('id'),'status':500,'data':{'detail':str(e)}}),flush=True)
