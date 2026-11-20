import React,{useState,useEffect,useRef} from 'react';
import {Orders,Admin,DeleteWorkspace} from './WorkspaceTools.jsx';
import {api,useData,Loader,ErrorMessage,Sheet,Icon,Avatar,iso,datetime} from './ui.jsx';
import {TaskCard} from './Collective.jsx';
import FormattedAnswer from './FormattedAnswer.jsx';
export default function Workspace({admin,user,open,onAdmin,onHome,onCloseAdmin}){
 const {data:spaces,error,reload}=useData('/me/workspaces');
 const {data:adminData,reload:reloadAdmin}=useData(user.role==='admin'?'/admin':null);
 const [space,setSpace]=useState(new URLSearchParams(location.search).get('workspace')||''),[tab,setTab]=useState('tasks'),[notice,setNotice]=useState(''),[creating,setCreating]=useState(false),[busy,setBusy]=useState(false);
 const [filterProject,setFilterProject]=useState('');
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(t)},[notice]);
 async function create(e){e.preventDefault();if(busy)return;setBusy(true);setNotice('');const fd=new FormData(e.currentTarget);const body={name:fd.get('name'),description:fd.get('description')||'',member_ids:fd.getAll('members')};try{const result=await api('/admin/spaces',{method:'POST',body});await reload();if(reloadAdmin)await reloadAdmin();setCreating(false);setSpace(result.id);setTab('members');setNotice('Workspace created.')}catch(e){setNotice(e.message)}finally{setBusy(false)}}
 if(admin)return <Admin notify={setNotice} onChange={async()=>{await reload();if(reloadAdmin)await reloadAdmin()}} user={user} onHome={onHome} onCloseAdmin={onCloseAdmin||(()=>setTab('workspaces'))}/>;
 const current=spaces?.find(s=>s.id===space);
 return <section><ErrorMessage>{error}</ErrorMessage>{!current?<><div className="workspace-sub-nav" style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'12px',flexWrap:'wrap'}}>{onHome&&<button type="button" className="text-button" onClick={onHome} style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="home" size={15}/> <span>Home</span></button>}<span style={{color:'var(--muted)',fontSize:'13px'}}>›</span><span style={{fontSize:'13px',fontWeight:600,color:'var(--ink)'}}>Workspaces</span></div><div className="workspace-page-heading"><div className="day-heading"><span className="eyebrow">GOOD WORK, TOGETHER</span><h1>Workspaces<span>.</span></h1><p>Your people and projects, with room to grow.</p></div>{user.role==='admin'&&<div className="workspace-actions"><button className="button primary" onClick={()=>setCreating(true)}>+ New workspace</button><button className="button" onClick={onAdmin}>People & spaces</button></div>}</div>{user.role!=='admin'&&<p className="workspace-help">An administrator can create workspaces and manage access. Open a workspace’s Members tab to see your team.</p>}<div className="workspace-list">{spaces?.map(s=><article className="workspace-card" key={s.id}><button onClick={()=>{setSpace(s.id);setTab('tasks')}}><span>↗</span><h2>{s.name}</h2><p>{s.description}</p></button>{user.role==='admin'&&<DeleteWorkspace space={s} notify={setNotice} onDeleted={async()=>{if(space===s.id)setSpace('');await reload();if(reloadAdmin)await reloadAdmin()}} className="icon-button workspace-delete" ariaLabel={'Delete '+s.name}><Icon name="trash" size={16}/></DeleteWorkspace>}</article>)}</div>{spaces?.length===0&&<p>Ask your administrator to add you to a workspace.</p>}</>:<><div className="workspace-sub-nav" style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'12px',flexWrap:'wrap'}}>{onHome&&<button type="button" className="text-button" onClick={onHome} style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="home" size={15}/> <span>Home</span></button>}<span style={{color:'var(--muted)',fontSize:'13px'}}>›</span><button className="text-button" onClick={()=>{setFilterProject('');setSpace('');}}>All workspaces</button><span style={{color:'var(--muted)',fontSize:'13px'}}>›</span><span style={{fontSize:'13px',fontWeight:600,color:'var(--ink)'}}>{current.name}</span></div><div className="workspace-detail-heading"><h1>{current.name}</h1>{user.role==='admin'&&<DeleteWorkspace space={current} notify={setNotice} onDeleted={async()=>{setSpace('');await reload();if(reloadAdmin)await reloadAdmin()}} className="button danger-outline">Delete workspace</DeleteWorkspace>}</div><nav className="workspace-tabs">{[['tasks','Tasks'],['projects','Projects'],['history','Task history'],['orders','Orders'],['team','Team'],['members','Members']].map(([k,label])=><button key={k} className={k===tab?'active':''} onClick={()=>setTab(k)}>{label}</button>)}</nav>{tab==='history'?<TaskHistory space={current} user={user} open={open}/>:tab==='members'?<Members space={space} user={user} onAdmin={onAdmin} onChange={reload}/>:tab==='orders'?<Orders workspace={current} user={user} notify={setNotice} onAI={()=>setTab('team')}/>:tab==='team'?<Channel space={current||{id:space,name:'team'}} user={user} open={open}/>:<Work key={space} space={current} tab={tab} user={user} open={open} onSelectTab={setTab} filterProject={filterProject} setFilterProject={setFilterProject}/>}</>}{notice&&<div className="toast" role="status" onClick={()=>setNotice('')}>{notice}</div>}{creating&&<Sheet title="New workspace" kicker="MAKE ROOM FOR YOUR TEAM" onClose={()=>setCreating(false)}><form className="sheet-body form-fields" onSubmit={create}><label>Workspace name<input name="name" required maxLength={80} placeholder="e.g. Events"/></label><label>Description<textarea name="description" maxLength={200} placeholder="What will your team work on here?"/></label>{adminData?.users?.length>1&&<fieldset><legend>Add team members</legend><p className="helper">Select members to include in this workspace. You will be added automatically.</p><div style={{maxHeight:'160px',overflowY:'auto',display:'grid',gap:'8px'}}>{adminData.users.filter(u=>u.id!==user.id).map(u=><label className="check-label" key={u.id}><input type="checkbox" name="members" value={u.id}/><span><strong>{u.name}</strong> <small>({u.email})</small></span></label>)}</div></fieldset>}<ErrorMessage>{notice}</ErrorMessage><button className="button primary" disabled={busy}>{busy?'Creating…':'Create workspace'}</button></form></Sheet>}</section>;
}
function Members({space,user,onAdmin,onChange}){
 const admin=user.role==='admin';const {data,error,reload}=useData(admin?'/admin':'/spaces/'+space+'/work');const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function save(e){e.preventDefault();setBusy(true);setMessage('');try{const members=new FormData(e.currentTarget).getAll('members');if(user?.id&&!members.includes(user.id))members.push(user.id);await api('/admin/spaces/'+encodeURIComponent(space)+'/members',{method:'PUT',body:{member_ids:members}});await reload();await onChange();setMessage('Workspace members updated.')}catch(e){setMessage(e.message)}finally{setBusy(false)}}
 return <section className="workspace-members"><div className="section-heading"><h2>Members</h2>{admin&&<button className="button" onClick={onAdmin}>Add a new person</button>}</div><p>{admin?'Select the people who can access this workspace. Other workspace memberships stay unchanged.':'These people have access to this workspace. Ask an administrator to add or remove members.'}</p><ErrorMessage>{error}</ErrorMessage>{!data?<Loader/>:admin?<form onSubmit={save} key={space+'-'+JSON.stringify((data.users||[]).map(u=>u.id+':'+u.spaces.includes(space)))}>{data.users.map(u=><label className="member-choice" key={u.id}><input type="checkbox" name="members" value={u.id} defaultChecked={u.spaces.includes(space)}/><span><strong>{u.name}</strong><small>{u.email}</small></span><span>{u.role}</span></label>)}<button className="button primary" disabled={busy}>{busy?'Saving…':'Save members'}</button></form>:data.members.map(m=><div className="member-choice" key={m.id}><strong>{m.name}</strong><span>{m.role}</span></div>)}<p role="status">{message}</p></section>
}
function Work({space,tab,user,open,onSelectTab,filterProject,setFilterProject}){
 const {data,error,reload}=useData('/spaces/'+space.id+'/work');
 const [creating,setCreating]=useState(false),[failure,setFailure]=useState(''),[busy,setBusy]=useState(false);
 const [defaultProject,setDefaultProject]=useState('');
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
   setDefaultProject('');
   reload();
  }catch(e){
   setFailure(e.message);
  }finally{
   setBusy(false);
  }
 }
 const members = [...(data?.members || [])];
 if (!members.some(m => m.id === user.id)) {
  members.unshift({ id: user.id, name: user.name + ' (You)' });
 }
 const visibleTasks = tab==='tasks' && data?.tasks ? (filterProject ? data.tasks.filter(t=>t.project_id===filterProject) : data.tasks) : [];
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
   <>
    {data.projects.length>0&&(
     <div className="filter-chips" style={{display:'flex',gap:'8px',flexWrap:'wrap',marginBottom:'16px',alignItems:'center'}}>
      <button type="button" className={`pill-filter ${!filterProject?'active':''}`} onClick={()=>setFilterProject('')}>
       All tasks ({data.tasks.length})
      </button>
      {data.projects.map(p=>{
       const pCount = data.tasks.filter(t=>t.project_id===p.id).length;
       return (
        <button key={p.id} type="button" className={`pill-filter ${filterProject===p.id?'active':''}`} onClick={()=>setFilterProject(filterProject===p.id?'':p.id)}>
         📁 {p.name} ({pCount})
        </button>
       );
      })}
     </div>
    )}
    {visibleTasks.length===0?(
     <div className="day-empty" style={{margin:'20px 0'}}>
      <Icon name="check" size={28}/>
      <h2>{filterProject?'No tasks in this project yet':'No tasks here yet'}</h2>
      <p>{filterProject?'Add deliverables and milestones to this project.':'Create a task to track deliverables, assign to teammates, and set deadlines.'}</p>
      <button className="button primary" onClick={()=>{if(filterProject)setDefaultProject(filterProject);setCreating(true);}}>
       <Icon name="plus" size={16}/>
       <span>{filterProject?'Add task to this project':'Create your first task'}</span>
      </button>
     </div>
    ):(
     visibleTasks.map(t=><TaskCard key={t.id} task={{...t,workspace_name:space.name}} open={open}/>)
    )}
   </>
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
    data.projects.map(p=>(
     <article className="project-card" key={p.id} style={{display:'flex',flexDirection:'column',gap:'10px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'12px'}}>
       <div>
        <h2 style={{margin:'0 0 4px'}}>{p.name}</h2>
        <p style={{margin:0}}>{p.description||'No description provided.'}</p>
       </div>
       <div style={{display:'flex',gap:'8px',flexShrink:0}}>
        <button type="button" className="button small" onClick={()=>{setFilterProject(p.id);onSelectTab?.('tasks');}}>
         View tasks ({p.task_count})
        </button>
        <button type="button" className="button small primary" onClick={()=>{setFilterProject(p.id);setDefaultProject(p.id);onSelectTab?.('tasks');setCreating(true);}}>
         + Task
        </button>
       </div>
      </div>
      <small>{p.done_count} of {p.task_count} tasks complete · {p.status}</small>
     </article>
    ))
   )
  )}
  {creating&&<Sheet title={'New '+(tab==='tasks'?'task':'project')} kicker={space.name} onClose={()=>{setCreating(false);setDefaultProject('');}}>
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
      <select name="project_id" defaultValue={defaultProject||filterProject||''}>
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
     <button type="button" className="button" onClick={()=>{setCreating(false);setDefaultProject('');}}>Cancel</button>
     <button className="button primary" disabled={busy}>
      {busy?'Creating…':'Create '+(tab==='tasks'?'task':'project')}
      <Icon name="arrow" size={16}/>
     </button>
    </div>
   </form>
  </Sheet>}
 </>;
}
function Channel({space,user,open}){
 const spaceId = space?.id || space;
 const spaceName = space?.name || 'Workspace';
 const {data,error,reload} = useData('/spaces/'+spaceId+'/thread');
 const [text,setText] = useState(()=>sessionStorage.getItem('channel-'+spaceId)||'');
 const [mention,setMention] = useState(false);
 const [parent,setParent] = useState(null);
 const [busy,setBusy] = useState(false);
 const [failure,setFailure] = useState('');
 const [aiThinking,setAiThinking] = useState(false);
 const messagesEndRef = useRef(null);
 const textareaRef = useRef(null);

 useEffect(()=>{
  const interval = setInterval(async ()=>{
   if(document.visibilityState==='visible'){
    await reload();
   }
  }, aiThinking ? 1200 : 3000);
  return ()=>clearInterval(interval);
 }, [reload, aiThinking]);

 useEffect(()=>{
  if(!data || !data.length) return;
  const lastMsg = data[data.length - 1];
  if(lastMsg.author === 'Collective AI'){
   setAiThinking(false);
  }
 }, [data]);

 useEffect(()=>{
  messagesEndRef.current?.scrollIntoView({behavior:'smooth'});
 }, [data?.length, aiThinking]);

 useEffect(()=>{
  sessionStorage.setItem('channel-'+spaceId, text);
 }, [spaceId, text]);

 function insertMention(){
  if(!text.includes('@AI')){
   setText(prev => (prev.trim() ? prev + ' @AI ' : '@AI '));
  }
  setMention(true);
  textareaRef.current?.focus();
 }

 function useChip(prompt){
  setText(prompt + ' ');
  setMention(true);
  textareaRef.current?.focus();
 }

 async function send(e){
  if(e) e.preventDefault();
  const trimmed = text.trim();
  if(busy || !trimmed) return;
  setBusy(true);
  setFailure('');

  const isMention = mention || /(^|\s)@ai\b/i.test(trimmed);
  if(isMention) setAiThinking(true);

  const payload = {
   request_id: crypto.randomUUID(),
   text: trimmed,
   mentions: isMention ? ['AI'] : [],
   parent_id: parent,
   timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'
  };

  try{
   await api('/spaces/'+spaceId+'/thread', {method:'POST', body:payload});
   setText('');
   setParent(null);
   setMention(false);
   await reload();
  }catch(err){
   setFailure(err.message);
   setAiThinking(false);
  }finally{
   setBusy(false);
  }
 }

 const parentMsg = parent ? data?.find(m=>m.id===parent) : null;

 return (
  <div className="slack-team-channel">
   <div className="slack-channel-header">
    <div className="slack-channel-title-row">
     <div className="slack-channel-hash">#</div>
     <div>
      <div className="slack-channel-name">
       <strong>{spaceName}</strong>
       <span className="slack-channel-badge">Team chat</span>
      </div>
      <p className="slack-channel-topic">
       Workspace discussion & updates. Mention <strong>@AI</strong> to ask the AI bot about tasks, deadlines, or chat summary.
      </p>
     </div>
    </div>
    <div className="slack-channel-tools">
     <button
      type="button"
      className="slack-ask-ai-pill"
      onClick={insertMention}
      title="Mention AI bot"
     >
      <Icon name="spark" size={14}/>
      <span>Ask @AI bot</span>
     </button>
    </div>
   </div>

   <ErrorMessage>{error||failure}</ErrorMessage>

   <div className="slack-messages-stream" role="log" aria-label="Team chat messages">
    <div className="slack-channel-welcome">
     <div className="slack-welcome-icon">
      <Icon name="spark" size={24}/>
     </div>
     <h3>Welcome to #{spaceName}!</h3>
     <p>This is the start of the <strong>{spaceName}</strong> team channel. Everyone in this workspace can share updates here, and the <strong>Collective AI Bot</strong> has full context of the chat to answer questions, summarize discussions, or create tasks.</p>
    </div>

    {data && data.length > 0 && (
     <div className="slack-date-divider">
      <span>Conversation</span>
     </div>
    )}

    {data?.map(m => {
     const isBot = m.author === 'Collective AI' || !m.author_id;
     const isMe = user?.id && m.author_id === user.id;
     const formattedTime = m.created ? datetime(m.created) : '';
     const replyTarget = m.parent_id ? data.find(p=>p.id===m.parent_id) : null;

     return (
      <article
       key={m.id}
       className={`slack-msg ${isBot ? 'slack-bot-msg' : ''} ${isMe ? 'is-me' : ''}`}
      >
       <div className="slack-msg-gutter">
        {isBot ? (
         <div className="slack-bot-avatar" title="Collective AI Bot">
          <Icon name="spark" size={18}/>
         </div>
        ) : (
         <Avatar name={m.author} small/>
        )}
       </div>

       <div className="slack-msg-content">
        <div className="slack-msg-header">
         <span className="slack-msg-author">{m.author}</span>
         {isBot && <span className="slack-bot-tag">BOT</span>}
         {isMe && <span className="slack-me-tag">you</span>}
         <span className="slack-msg-time">{formattedTime}</span>
         {!isBot && (
          <button
           type="button"
           className="slack-reply-btn"
           onClick={() => { setParent(m.id); textareaRef.current?.focus(); }}
           title="Reply in thread"
          >
           Reply
          </button>
         )}
        </div>

        {replyTarget && (
         <div className="slack-quoted-reply">
          <span className="slack-quote-bar"/>
          <small>
           Replying to <strong>{replyTarget.author}</strong>: {replyTarget.text.slice(0, 80)}{replyTarget.text.length > 80 ? '…' : ''}
          </small>
         </div>
        )}

        <div className="slack-msg-body">
         {isBot ? (
          <FormattedAnswer text={m.text} onOpenTask={open}/>
         ) : (
          <p>{renderWithMentions(m.text)}</p>
         )}
        </div>
       </div>
      </article>
     );
    })}

    {aiThinking && (
     <div className="slack-msg slack-bot-msg slack-thinking-msg">
      <div className="slack-msg-gutter">
       <div className="slack-bot-avatar pulsing">
        <Icon name="spark" size={18}/>
       </div>
      </div>
      <div className="slack-msg-content">
       <div className="slack-msg-header">
        <span className="slack-msg-author">Collective AI</span>
        <span className="slack-bot-tag">BOT</span>
        <span className="slack-msg-time">just now</span>
       </div>
       <div className="slack-thinking-indicator">
        <span className="thinking-text">Reading team chat & thinking</span>
        <span className="thinking-dots">
         <span className="dot dot-1"/>
         <span className="dot dot-2"/>
         <span className="dot dot-3"/>
        </span>
       </div>
      </div>
     </div>
    )}

    <div ref={messagesEndRef} style={{height: 1}}/>
   </div>

   <div className="slack-composer-wrap">
    {parentMsg && (
     <div className="slack-reply-banner">
      <div className="slack-reply-info">
       <Icon name="arrow" size={13}/>
       <span>Replying to <strong>{parentMsg.author}</strong>: &ldquo;{parentMsg.text.slice(0, 60)}{parentMsg.text.length > 60 ? '…' : ''}&rdquo;</span>
      </div>
      <button
       type="button"
       className="slack-cancel-reply"
       onClick={()=>setParent(null)}
       title="Cancel reply"
      >
       <Icon name="close" size={14}/>
      </button>
     </div>
    )}

    <div className="slack-quick-chips">
     <button
      type="button"
      className="slack-chip"
      onClick={()=>useChip('@AI summarize our team updates')}
     >
      <Icon name="spark" size={12}/>
      <span>@AI summarize updates</span>
     </button>
     <button
      type="button"
      className="slack-chip"
      onClick={()=>useChip('@AI what tasks are due or overdue?')}
     >
      <Icon name="spark" size={12}/>
      <span>@AI what is due?</span>
     </button>
     <button
      type="button"
      className="slack-chip"
      onClick={()=>useChip('@AI what did the team discuss today?')}
     >
      <Icon name="spark" size={12}/>
      <span>@AI what was discussed?</span>
     </button>
    </div>

    <form className="slack-composer-card" onSubmit={send}>
     <textarea
      ref={textareaRef}
      aria-label="Message team channel"
      value={text}
      rows={2}
      required
      onChange={e => {
       setText(e.target.value);
       if(/(^|\s)@ai\b/i.test(e.target.value)) setMention(true);
      }}
      onKeyDown={e => {
       if(e.key === 'Enter' && !e.shiftKey){
        e.preventDefault();
        send();
       }
      }}
      placeholder={`Message #${spaceName} · Type @AI to ask the workspace bot…`}
     />

     <div className="slack-composer-toolbar">
      <div className="slack-toolbar-left">
       <button
        type="button"
        className={`slack-ai-mention-toggle ${mention || /(^|\s)@ai\b/i.test(text) ? 'active' : ''}`}
        onClick={() => {
         if(!mention && !text.includes('@AI')){
          setText(prev => (prev.trim() ? prev + ' @AI ' : '@AI '));
         }
         setMention(prev => !prev);
         textareaRef.current?.focus();
        }}
        title="Toggle AI Bot mention"
       >
        <Icon name="spark" size={13}/>
        <span>@AI</span>
       </button>
       <span className="slack-send-hint">Press <strong>Enter ↵</strong> to send, Shift+Enter for new line</span>
      </div>

      <button
       type="submit"
       className="slack-send-button"
       disabled={busy || !text.trim()}
       aria-label="Send message"
      >
       <Icon name="send" size={15}/>
      </button>
     </div>
    </form>
   </div>
  </div>
 );
}

function renderWithMentions(text){
 if(!text) return null;
 const parts = text.split(/(@AI|@ai)/g);
 return parts.map((part, i) => {
  if(/^@ai$/i.test(part)){
   return <span key={i} className="slack-mention-pill">@AI</span>;
  }
  return part;
 });
}

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
