"""Permission-scoped SQL answers and bounded context for generative requests."""
import json
import re
from datetime import datetime, timezone


def direct_answer(conn, user, run):
    # Full matches deliberately leave compound requests and mutations to the planner.
    question=re.sub(r'[?!.,]+$', '', run['question'].strip().casefold())
    if re.fullmatch(r'(hi+|hello|hey)( there)?',question):
        return {'answer':'Hello! I can help with your tasks, team, or workspace.','actions':[]}
    pending=question in {'what all work is pending','what all works are pending','what work is pending','what tasks are pending','show pending tasks','list pending tasks','what is pending'}
    members=question in {'who are my members','who all are my members','can you tell me who all are my members','can u tell em who all are my members','list members','show members'}
    if not (pending or members): return None
    scope=' AND s.id=?' if run['space'] else ''
    params=[user['id']]+([run['space']] if run['space'] else [])
    workspaces=conn.execute('SELECT s.id,s.name FROM spaces s JOIN memberships m ON m.space_id=s.id WHERE m.user_id=?'+scope+' ORDER BY s.name',params).fetchall()
    lines=[]; refs=[]
    for workspace in workspaces:
        if members:
            rows=conn.execute('SELECT u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.space_id=? ORDER BY u.name',(workspace['id'],)).fetchall()
            lines.append(workspace['name']+': '+', '.join(r['name'] for r in rows))
        else:
            count=conn.execute("SELECT COUNT(*) FROM tasks WHERE space=? AND status!='Done'",(workspace['id'],)).fetchone()[0]
            now_utc = datetime.now(timezone.utc)
            rows=conn.execute("SELECT t.id,t.title,t.due_at,u.name FROM tasks t JOIN users u ON u.id=t.assignee_id WHERE t.space=? AND t.status!='Done' ORDER BY t.due_at IS NULL,t.due_at LIMIT 20",(workspace['id'],)).fetchall()
            lines.append(f"{workspace['name']}: {count} pending task(s).")
            for r in rows:
                is_overdue = False
                if r['due_at']:
                    try:
                        dt = datetime.fromisoformat(r['due_at'].replace('Z', '+00:00'))
                        if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
                        is_overdue = dt < now_utc
                    except Exception:
                        pass
                due_label = f" · Due {r['due_at']}" if r['due_at'] else ' · No deadline'
                if is_overdue:
                    due_label += ' **[OVERDUE]**'
                lines.append(f"- {r['title']} — {r['name']}{due_label} – [View](/?task={r['id']})")
            if count>len(rows): lines.append(f'Showing the first {len(rows)} tasks; open the workspace for the rest.')
            refs.extend({'url':'/?task='+r['id'],'label':r['title']} for r in rows)
    return {'answer':'\n'.join(lines) or 'You have no workspace memberships.','actions':[],'_references':refs[:20]}


def bounded_context(context, history, max_chars=24000):
    """Cap serialized retrieval size; preserve explicit truncation metadata."""
    context=dict(context)
    context['retrieval_limits']={'truncated':False,'note':'Counts are exact; lists and text may be partial.'}
    context['records']=[{**r,'text':r.get('text','')[:700]} for r in context['records'][:8]]
    context['attention']=[{k:r.get(k) for k in ('id','title','space','assignee_id','due_at','status','url','is_overdue')} for r in context['attention'][:15]]
    context['pending_tasks']=[{k:r.get(k) for k in ('id','title','space','assignee_id','due_at','status','url','is_overdue')} for r in context['pending_tasks'][:20]]
    history=[{'question':h['question'][:600],'answer':h['result'].get('answer','')[:1000]} for h in history[:4]][::-1]
    context['retrieval_limits']['truncated']=True
    def size(): return len(json.dumps({'data':context,'private_history':history},ensure_ascii=False,separators=(',',':')))
    while size()>max_chars:
        if history: history.pop(0); continue
        for name in ('records','pending_tasks','attention'):
            if context[name]: context[name].pop(); break
        else:
            # Do not silently lose member IDs used to authorize assignments.
            raise ValueError('Too many workspace details for one request. Select a workspace to narrow the request.')
    return context,history
