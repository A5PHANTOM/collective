import React,{useState,useEffect} from 'react';
import {Orders,Admin,DeleteWorkspace} from './WorkspaceTools.jsx';
import {api,useData,Loader,ErrorMessage,Sheet,Icon,iso,datetime} from './ui.jsx';
import {TaskCard} from './Collective.jsx';
export default function Workspace({admin,user,open,onAdmin}){
 const {data:spaces,error,reload}=useData('/me/workspaces');
 const {data:adminData,reload:reloadAdmin}=useData(user.role==='admin'?'/admin':null);
 const [space,setSpace]=useState(new URLSearchParams(location.search).get('workspace')||''),[tab,setTab]=useState('tasks'),[notice,setNotice]=useState(''),[creating,setCreating]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(t)},[notice]);
 async function create(e){e.preventDefault();if(busy)return;setBusy(true);setNotice('');const fd=new FormData(e.currentTarget);const body={name:fd.get('name'),description:fd.get('description')||'',member_ids:fd.getAll('members')};try{const result=await api('/admin/spaces',{method:'POST',body});await reload();if(reloadAdmin)await reloadAdmin();setCreating(false);setSpace(result.id);setTab('members');setNotice('Workspace created.')}catch(e){setNotice(e.message)}finally{setBusy(false)}}
 if(admin)return <Admin notify={setNotice} onChange={reload} user={user}/>;
 const current=spaces?.find(s=>s.id===space);
 return <section><ErrorMessage>{error}</ErrorMessage>{!current?<><div className="workspace-page-heading"><div className="day-heading"><span className="eyebrow">GOOD WORK, TOGETHER</span><h1>Workspaces<span>.</span></h1><p>Your people and projects, with room to grow.</p></div>{user.role==='admin'&&<div className="workspace-actions"><button className="button primary" onClick={()=>setCreating(true)}>+ New workspace</button><button className="button" onClick={onAdmin}>People & spaces</button></div>}</div>{user.role!=='admin'&&<p className="workspace-help">An administrator can create workspaces and manage access. Open a workspace’s Members tab to see your team.</p>}<div className="workspace-list">{spaces?.map(s=><article className="workspace-card" key={s.id}><button onClick={()=>{setSpace(s.id);setTab('tasks')}}><span>↗</span><h2>{s.name}</h2><p>{s.description}</p></button>{user.role==='admin'&&<DeleteWorkspace space={s} notify={setNotice} onDeleted={async()=>{if(space===s.id)setSpace('');await reload()}} className="icon-button workspace-delete" ariaLabel={'Delete '+s.name}><Icon name="trash" size={16}/></DeleteWorkspace>}</article>)}</div>{spaces?.length===0&&<p>Ask your administrator to add you to a workspace.</p>}</>:<><button className="text-button" onClick={()=>setSpace('')}>← All workspaces</button><div className="workspace-detail-heading"><h1>{current.name}</h1>{user.role==='admin'&&<DeleteWorkspace space={current} notify={setNotice} onDeleted={async()=>{setSpace('');await reload()}} className="button danger-outline">Delete workspace</DeleteWorkspace>}</div><nav className="workspace-tabs">{[['tasks','Tasks'],['projects','Projects'],['history','Task history'],['orders','Orders'],['team','Team'],['members','Members']].map(([k,label])=><button key={k} className={k===tab?'active':''} onClick={()=>setTab(k)}>{label}</button>)}</nav>{tab==='history'?<TaskHistory space={current} user={user} open={open}/>:tab==='members'?<Members space={space} user={user} onAdmin={onAdmin} onChange={reload}/>:tab==='orders'?<Orders workspace={current} user={user} notify={setNotice} onAI={()=>setTab('team')}/>:tab==='team'?<Channel space={space}/>:<Work key={space+tab} space={current} tab={tab} user={user} open={open}/>}</>}{notice&&<div className="toast" role="status" onClick={()=>setNotice('')}>{notice}</div>}{creating&&<Sheet title="New workspace" kicker="MAKE ROOM FOR YOUR TEAM" onClose={()=>setCreating(false)}><form className="sheet-body form-fields" onSubmit={create}><label>Workspace name<input name="name" required maxLength={80} placeholder="e.g. Events"/></label><label>Description<textarea name="description" maxLength={200} placeholder="What will your team work on here?"/></label>{adminData?.users?.length>1&&<fieldset><legend>Add team members</legend><p className="helper">Select members to include in this workspace. You will be added automatically.</p><div style={{maxHeight:'160px',overflowY:'auto',display:'grid',gap:'8px'}}>{adminData.users.filter(u=>u.id!==user.id).map(u=><label className="check-label" key={u.id}><input type="checkbox" name="members" value={u.id}/><span><strong>{u.name}</strong> <small>({u.email})</small></span></label>)}</div></fieldset>}<ErrorMessage>{notice}</ErrorMessage><button className="button primary" disabled={busy}>{busy?'Creating…':'Create workspace'}</button></form></Sheet>}</section>;
}
function Members({space,user,onAdmin,onChange}){
 const admin=user.role==='admin';const {data,error,reload}=useData(admin?'/admin':'/spaces/'+space+'/work');const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function save(e){e.preventDefault();setBusy(true);setMessage('');try{const members=new FormData(e.currentTarget).getAll('members');if(user?.id&&!members.includes(user.id))members.push(user.id);await api('/admin/spaces/'+encodeURIComponent(space)+'/members',{method:'PUT',body:{member_ids:members}});await reload();await onChange();setMessage('Workspace members updated.')}catch(e){setMessage(e.message)}finally{setBusy(false)}}
 return <section className="workspace-members"><div className="section-heading"><h2>Members</h2>{admin&&<button className="button" onClick={onAdmin}>Add a new person</button>}</div><p>{admin?'Select the people who can access this workspace. Other workspace memberships stay unchanged.':'These people have access to this workspace. Ask an administrator to add or remove members.'}</p><ErrorMessage>{error}</ErrorMessage>{!data?<Loader/>:admin?<form onSubmit={save} key={space+'-'+JSON.stringify((data.users||[]).map(u=>u.id+':'+u.spaces.includes(space)))}>{data.users.map(u=><label className="member-choice" key={u.id}><input type="checkbox" name="members" value={u.id} defaultChecked={u.spaces.includes(space)}/><span><strong>{u.name}</strong><small>{u.email}</small></span><span>{u.role}</span></label>)}<button className="button primary" disabled={busy}>{busy?'Saving…':'Save members'}</button></form>:data.members.map(m=><div className="member-choice" key={m.id}><strong>{m.name}</strong><span>{m.role}</span></div>)}<p role="status">{message}</p></section>
}
function Work({space,tab,user,open}){
 const {data,error,reload}=useData('/spaces/'+space.id+'/work');
 const [creating,setCreating]=useState(false),[failure,setFailure]=useState(''),[busy,setBusy]=useState(false);
 async function save(e){
  e.preventDefault();
  if(busy)return;
  setBusy(true);
  const f=Object.fromEntries(new FormData(e.currentTarget));
  try{
   await api('/spaces/'+space.id+'/'+tab,{
    method:'POST',
    body:{...f,due_at:iso(f.due_at),...(tab==='tasks'?{project_id:f.project_id||null}:{})}
   });
   setCreating(false);
   reload();
  }catch(e){
   setFailure(e.message);
  }finally{
   setBusy(false);
  }
 }
 const members = data?.members?.length ? data.members : [{id:user.id, name:user.name}];
 return <>
  <div className="section-heading" style={{margin:'20px 0 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
   <div>
    <h2>{tab==='tasks'?'Tasks':'Projects'}</h2>
    <span>{tab==='tasks'?`${data?.tasks?.length||0} tasks in this workspace`:`${data?.projects?.length||0} projects in this workspace`}</span>
   </div>
   <button className="button primary" onClick={()=>setCreating(true)}>
    <Icon name="plus" size={16}/>
    <span>New {tab==='tasks'?'task':'project'}</span>
   </button>
  </div>
  <ErrorMessage>{error}</ErrorMessage>
  {!data?<Loader/>:tab==='tasks'?(
   data.tasks.length===0?(
    <div className="day-empty" style={{margin:'20px 0'}}>
     <Icon name="check" size={28}/>
     <h2>No tasks here yet</h2>
     <p>Create a task to track deliverables, assign to teammates, and set deadlines.</p>
     <button className="button primary" onClick={()=>setCreating(true)}>
      <Icon name="plus" size={16}/>
      <span>Create your first task</span>
     </button>
    </div>
   ):(
    data.tasks.map(t=><TaskCard key={t.id} task={{...t,workspace_name:space.name}} open={open}/>)
   )
  ):(
   data.projects.length===0?(
    <div className="day-empty" style={{margin:'20px 0'}}>
     <Icon name="box" size={28}/>
     <h2>No projects here yet</h2>
     <p>Group related tasks and milestones together under a project.</p>
     <button className="button primary" onClick={()=>setCreating(true)}>
      <Icon name="plus" size={16}/>
      <span>Create your first project</span>
     </button>
    </div>
   ):(
    data.projects.map(p=><article className="project-card" key={p.id}><h2>{p.name}</h2><p>{p.description}</p><small>{p.done_count} of {p.task_count} tasks complete · {p.status}</small></article>)
   )
  )}
  {creating&&<Sheet title={'New '+(tab==='tasks'?'task':'project')} kicker={space.name} onClose={()=>setCreating(false)}>
   <form onSubmit={save} className="sheet-body form-fields">
    <label>{tab==='tasks'?'Task title':'Project name'}<input name={tab==='tasks'?'title':'name'} required maxLength={160} placeholder={tab==='tasks'?'e.g. Update product catalog':'e.g. Winter Launch'} autoFocus/></label>
    <label>Description<textarea name="description" placeholder="Add any details, briefs, or instructions…" rows={3}/></label>
    {tab==='tasks'&&<>
     <label>Assign to
      <select name="assignee_id" defaultValue={user.id}>
       {members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
     </label>
     <label>Project
      <select name="project_id">
       <option value="">No project</option>
       {(data?.projects||[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
     </label>
     <label>Priority
      <select name="priority" defaultValue="Medium">
       {['Low','Medium','High'].map(p=><option key={p}>{p}</option>)}
      </select>
     </label>
    </>}
    <label>Deadline<input type="datetime-local" name="due_at"/></label>
    <ErrorMessage>{failure}</ErrorMessage>
    <div className="sheet-actions">
     <button type="button" className="button" onClick={()=>setCreating(false)}>Cancel</button>
     <button className="button primary" disabled={busy}>
      {busy?'Creating…':'Create '+(tab==='tasks'?'task':'project')}
      <Icon name="arrow" size={16}/>
     </button>
    </div>
   </form>
  </Sheet>}
 </>;
}
function Channel({space}){const {data,error,reload}=useData('/spaces/'+space+'/thread');const [text,setText]=useState(()=>sessionStorage.getItem('channel-'+space)||''),[mention,setMention]=useState(false),[parent,setParent]=useState(null),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[request,setRequest]=useState(null);useEffect(()=>{const t=setInterval(reload,4000);return()=>clearInterval(t)},[reload]);useEffect(()=>{sessionStorage.setItem('channel-'+space,text)},[space,text]);async function send(e){e.preventDefault();if(busy)return;setBusy(true);const r=request||{request_id:crypto.randomUUID(),text,mentions:mention?['AI']:[],parent_id:parent,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Kolkata'};setRequest(r);try{await api('/spaces/'+space+'/thread',{method:'POST',body:r});setText('');setRequest(null);setParent(null);setMention(false);reload()}catch(e){setFailure(e.message)}finally{setBusy(false)}}return <div className="channel"><ErrorMessage>{error||failure}</ErrorMessage><p className="privacy-note">Team conversation · use @AI to ask the workspace assistant</p>{data?.map(m=><article key={m.id} className={'channel-message '+(m.parent_id?'reply':'')}><strong>{m.author}</strong>{m.parent_id&&<small> Reply to {data.find(p=>p.id===m.parent_id)?.author||'message'}</small>}<p>{m.text}</p><button className="text-button" onClick={()=>setParent(m.id)}>Reply</button></article>)}<form className="channel-composer" onSubmit={send}>{parent&&<button type="button" className="text-button" onClick={()=>setParent(null)}>Cancel reply</button>}<textarea aria-label="Team message" value={text} required onChange={e=>{setText(e.target.value);setRequest(null)}} placeholder="Share an update…"/><label className="check-label"><input type="checkbox" checked={mention} onChange={e=>{setMention(e.target.checked);setRequest(null)}}/>@AI · ask using this workspace only</label><button className="button primary" disabled={busy}>{busy?'Sending…':'Send'}</button></form></div>}

function formatDuration(ms){
 const mins=Math.max(1,Math.round(ms/60000));
 if(mins<60)return `${mins}m`;
 const hours=Math.round(mins/60);
 if(hours<24)return `${hours}h`;
 const days=Math.round(hours/24);
 return `${days}d`;
}

function TaskHistory({space,user,open}){
 const {data,error,loading,reload}=useData('/spaces/'+space.id+'/work');
 const [filter,setFilter]=useState('all');
 const [search,setSearch]=useState('');

 const now=Date.now();
 const tasks=(data?.tasks||[]).map(t=>{
  const postedTime=t.created;
  const deadlineTime=t.due_at;
  const isDone=t.status==='Done';
  const finishedTime=isDone?t.updated:null;
  let missed=false;
  let statusLabel='';
  let badgeClass='';
  let diffDescription='';

  if(isDone){
   if(deadlineTime){
    const closedAfter=new Date(t.updated).getTime() - new Date(deadlineTime).getTime();
    if(closedAfter>60000){
     missed=true;
     statusLabel='Deadline missed · Closed late';
     badgeClass='badge-missed-closed';
     diffDescription=`Closed ${formatDuration(closedAfter)} after deadline`;
    }else{
     statusLabel='Completed on time';
     badgeClass='badge-completed-ontime';
     diffDescription='Closed on schedule';
    }
   }else{
    statusLabel='Completed';
    badgeClass='badge-completed';
    diffDescription='No deadline set';
   }
  }else{
   if(deadlineTime){
    const overdue=now - new Date(deadlineTime).getTime();
    if(overdue>0){
     missed=true;
     statusLabel='Deadline missed · Still incomplete';
     badgeClass='badge-missed-open';
     diffDescription=`Overdue by ${formatDuration(overdue)}`;
    }else{
     statusLabel='In progress';
     badgeClass='badge-in-progress';
     diffDescription=`Due in ${formatDuration(-overdue)}`;
    }
   }else{
    statusLabel='In progress';
    badgeClass='badge-in-progress';
    diffDescription='No deadline set';
   }
  }

  return {
   ...t,
   isDone,
   missed,
   postedTime,
   finishedTime,
   deadlineTime,
   statusLabel,
   badgeClass,
   diffDescription
  };
 });

 const totalCount=tasks.length;
 const missedCount=tasks.filter(t=>t.missed).length;
 const completedCount=tasks.filter(t=>t.isDone).length;
 const onTimeDoneCount=tasks.filter(t=>t.isDone&&!t.missed).length;
 const openCount=tasks.filter(t=>!t.isDone).length;
 const onTimeRate=totalCount>0?Math.round((tasks.filter(t=>!t.missed).length/totalCount)*100):100;

 const filtered=tasks.filter(t=>{
  if(filter==='missed'&&!t.missed)return false;
  if(filter==='completed'&&!t.isDone)return false;
  if(filter==='open'&&t.isDone)return false;
  if(search.trim()){
   const q=search.toLowerCase();
   const matchTitle=t.title.toLowerCase().includes(q);
   const matchAssignee=t.assignee_name?.toLowerCase().includes(q);
   const matchProject=t.project_name?.toLowerCase().includes(q);
   if(!matchTitle&&!matchAssignee&&!matchProject)return false;
  }
  return true;
 });

 return (
  <div className="task-history-section">
   <div className="history-header">
    <div className="history-title-wrap">
     <h2>Task History & Audit Log</h2>
     <p>Chronological record of all assigned tasks, posted times, finished times, and deadline tracking.</p>
    </div>
    <button className="button" onClick={reload}><Icon name="clock" size={13}/> Refresh</button>
   </div>

   <div className="history-metrics-row">
    <div className="history-metric-card">
     <span className="metric-num">{totalCount}</span>
     <span className="metric-label">Total tasks</span>
    </div>
    <div className="history-metric-card metric-ontime">
     <span className="metric-num">{onTimeDoneCount}</span>
     <span className="metric-label">Completed on time</span>
    </div>
    <div className="history-metric-card metric-missed">
     <span className="metric-num">{missedCount}</span>
     <span className="metric-label">Deadlines missed</span>
    </div>
    <div className="history-metric-card">
     <span className="metric-num">{onTimeRate}%</span>
     <span className="metric-label">On-time rate</span>
    </div>
   </div>

   <div className="history-controls">
    <div className="history-filter-chips">
     <button className={`chip ${filter==='all'?'active':''}`} onClick={()=>setFilter('all')}>All ({totalCount})</button>
     <button className={`chip chip-missed ${filter==='missed'?'active':''}`} onClick={()=>setFilter('missed')}>Deadlines missed ({missedCount})</button>
     <button className={`chip ${filter==='completed'?'active':''}`} onClick={()=>setFilter('completed')}>Completed ({completedCount})</button>
     <button className={`chip ${filter==='open'?'active':''}`} onClick={()=>setFilter('open')}>In progress ({openCount})</button>
    </div>
    <div className="history-search">
     <input
      type="search"
      aria-label="Search task history"
      placeholder="Search by title, assignee, or project…"
      value={search}
      onChange={e=>setSearch(e.target.value)}
     />
    </div>
   </div>

   <ErrorMessage>{error}</ErrorMessage>
   {loading&&<Loader/>}

   {!loading&&filtered.length===0&&(
    <div className="history-empty">
     <Icon name="clock" size={24}/>
     <p>{tasks.length===0?'No tasks recorded in this workspace yet.':'No tasks match your selected filter.'}</p>
    </div>
   )}

   <div className="history-task-list">
    {filtered.map(t=>(
     <article key={t.id} className={`history-task-card ${t.missed?'card-missed':''} ${t.isDone?'card-done':''}`}>
      <div className="history-card-top">
       <div className="history-card-meta-left">
        <span className="history-task-id">{t.task_id}</span>
        {t.project_name&&<span className="history-project-pill">{t.project_name}</span>}
        <span className={`history-priority-pill priority-${t.priority.toLowerCase()}`}>{t.priority} priority</span>
       </div>
       <span className={`history-status-badge ${t.badgeClass}`}>
        {t.statusLabel}
       </span>
      </div>

      <h3 className="history-task-title">{t.title}</h3>
      {t.description&&<p className="history-task-desc">{t.description}</p>}

      <div className="history-assignment-row">
       <span className="assignment-item">
        <strong>Assigned to:</strong> {t.assignee_name||'Unassigned'}
       </span>
       {t.creator_name&&<span className="assignment-item">
        <strong>Posted by:</strong> {t.creator_name}
       </span>}
      </div>

      <div className="history-timeline-grid">
       <div className="timeline-node">
        <span className="node-icon node-posted"><Icon name="plus" size={12}/></span>
        <div className="node-info">
         <span className="node-label">Posted time</span>
         <span className="node-value">{datetime(t.postedTime)}</span>
        </div>
       </div>

       <div className="timeline-node">
        <span className={`node-icon ${t.deadlineTime?'node-deadline':'node-none'}`}><Icon name="clock" size={12}/></span>
        <div className="node-info">
         <span className="node-label">Deadline</span>
         <span className={`node-value ${t.missed?'val-overdue':''}`}>
          {t.deadlineTime?datetime(t.deadlineTime):'No deadline'}
         </span>
        </div>
       </div>

       <div className="timeline-node">
        <span className={`node-icon ${t.isDone?'node-finished':'node-pending'}`}>
         <Icon name={t.isDone?'check':'arrow'} size={12}/>
        </span>
        <div className="node-info">
         <span className="node-label">Finished time</span>
         <span className={`node-value ${t.isDone?'val-finished':''}`}>
          {t.finishedTime?datetime(t.finishedTime):'Not finished yet'}
         </span>
        </div>
       </div>
      </div>

      {t.diffDescription&&(
       <div className={`history-callout-bar ${t.missed?'callout-missed':'callout-normal'}`}>
        <span className="callout-indicator">
         <Icon name={t.missed?'spark':'check'} size={13}/>
        </span>
        <span className="callout-text">
         {t.missed&&t.isDone&&<strong>Deadline missed: </strong>}
         {t.missed&&!t.isDone&&<strong>Attention required: </strong>}
         {t.diffDescription}
         {t.isDone?` · Final status: Done`:` · Current status: ${t.status}`}
        </span>
        <button type="button" className="history-view-btn" onClick={()=>open(t.id)}>
         View task details →
        </button>
       </div>
      )}
     </article>
    ))}
   </div>
  </div>
 );
}
