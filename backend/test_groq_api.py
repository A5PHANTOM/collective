import unittest
import httpx
from backend.groq_api import response_text

class GroqResponseTests(unittest.TestCase):
    def test_errors_do_not_expose_failed_generation(self):
        for status,code,expected in [(400,'json_validate_failed','valid action plan'),(404,'model_not_found','model is unavailable'),(403,'access_denied','denied access'),(413,'','too large'),(429,'','rate limit')]:
            with self.subTest(code=code):
                response=httpx.Response(status,json={'error':{'code':code,'message':'PRIVATE PROMPT','failed_generation':'PRIVATE PROMPT'}})
                with self.assertRaises(ValueError) as error: response_text(response)
                self.assertIn(expected,str(error.exception))
                self.assertNotIn('PRIVATE PROMPT',str(error.exception))

    def test_empty_and_truncated_responses(self):
        for body in [{'choices':[]},{'choices':[{'message':{'content':None}}]},{'choices':[{'finish_reason':'length','message':{'content':'partial'}}]}]:
            with self.assertRaises(ValueError): response_text(httpx.Response(200,json=body))

class ModelRecoveryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        from backend.groq_api import _model_cache
        _model_cache.clear()
    async def test_retired_model_uses_catalogue_and_preserves_request(self):
        from backend.groq_api import complete
        calls=[]
        class Client:
            async def post(self,url,**kwargs):
                calls.append(kwargs['json'])
                if len(calls)==1:
                    return httpx.Response(404,json={'error':{'code':'model_not_found'}})
                return httpx.Response(200,json={'choices':[{'message':{'content':'{"answer":"OK"}'}}]})
            async def get(self,url,**kwargs):
                self_url=url
                assert self_url=='https://api.groq.com/openai/v1/models'
                return httpx.Response(200,json={'data':[{'id':'whisper-large-v3'},{'id':'openai/gpt-oss-20b','active':True}]})
        payload={'model':'retired','messages':[{'role':'user','content':'Hello'}],'response_format':{'type':'json_object'}}
        response=await complete(Client(),'test',payload)
        self.assertEqual(response.status_code,200)
        self.assertEqual(calls[1]['model'],'openai/gpt-oss-20b')
        self.assertEqual(calls[1]['messages'],payload['messages'])
        self.assertEqual(calls[1]['response_format'],payload['response_format'])
        self.assertEqual(payload['model'],'retired')
        await complete(Client(),'test',payload)
        self.assertEqual(calls[2]['model'],'openai/gpt-oss-20b')

    async def test_no_text_model_does_not_retry_with_speech(self):
        from backend.groq_api import complete
        class Client:
            async def post(self,*args,**kwargs):
                return httpx.Response(400,json={'error':{'code':'model_decommissioned'}})
            async def get(self,*args,**kwargs):
                return httpx.Response(200,json={'data':[{'id':'whisper-large-v3'}]})
        with self.assertRaisesRegex(ValueError,'No supported chat model'):
            await complete(Client(),'test',{'model':'retired'})
