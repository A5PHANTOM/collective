import json
import unittest
from backend.retrieval import bounded_context

class ContextTests(unittest.TestCase):
    def test_budget_and_history_order(self):
        context={'workspaces':[],'records':[{'text':'x'*1600} for _ in range(30)],'attention':[{'id':str(i),'description':'x'*2000} for i in range(50)],'pending_tasks':[{'id':str(i),'description':'x'*2000} for i in range(100)],'pending_task_count':100}
        history=[{'question':str(i),'result':{'answer':'x'*2000}} for i in range(12)]
        before=len(json.dumps({'data':context,'private_history':history}))
        data,turns=bounded_context(context,history)
        after=len(json.dumps({'data':data,'private_history':turns},ensure_ascii=False,separators=(',',':')))
        self.assertLessEqual(after,24000)
        self.assertLess(after,before/4)
        self.assertEqual(data['pending_task_count'],100)
        self.assertEqual([t['question'] for t in turns],['3','2','1','0'])
        self.assertTrue(data['retrieval_limits']['truncated'])
