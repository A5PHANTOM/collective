import React,{useState,useEffect,useRef,lazy,Suspense} from 'react';
import {Login,Sheet,Icon,Mark,Avatar,ErrorMessage,Loader,Empty,api,apiUpload,useData,datetime,localInput,iso} from './ui.jsx';
import './collective.css';
import './premium.css';
import VoiceInput from './VoiceInput.jsx';
import FormattedAnswer from './FormattedAnswer.jsx';
const Workspace=lazy(()=>import('./Workspace.jsx'));
const tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Kolkata';
const id=()=>crypto.randomUUID();
const tabs=[
 ['ai','Home','home'],
 ['task','Tasks','check'],
 ['workspaces','Workspaces','box'],
 ['profile','Profile','people']
];
export default function Collective(){
 const [boot,setBoot]=useState(null),[error,setError]=useState(''),[signedOut,setSignedOut]=useState(false),[tab,setTab]=useState(new URLSearchParams(location.search).has('workspace')?'workspaces':'ai'),[selected,setSelected]=useState(new URLSearchParams(location.search).get('task')),[revision,setRevision]=useState(0),[draft,setDraft]=useState(''),[online,setOnline]=useState(navigator.onLine),[account,setAccount]=useState(false),[drawerOpen,setDrawerOpen]=useState(false);
 async function load(){try{setBoot(await api('/bootstrap'));setSignedOut(false);const task=new URLSearchParams(location.search).get('task');if(task)setSelected(task)}catch(e){if(e.message==='Please sign in')setSignedOut(true);else setError(e.message)}}
 useEffect(()=>{const close=e=>{if(e.key==='Escape'){setAccount(false);setDrawerOpen(false)}};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[]);
 useEffect(()=>{load();const out=()=>{setBoot(null);setSignedOut(true);setDraft('');setSelected(null);setTab('ai');sessionStorage.clear()};const network=()=>setOnline(navigator.onLine);const viewport=()=>{document.documentElement.style.setProperty('--visual-height',`${window.visualViewport?.height||innerHeight}px`);document.documentElement.dataset.keyboard=innerHeight-(window.visualViewport?.height||innerHeight)>140?'open':'closed'};viewport();window.addEventListener('signed-out',out);window.addEventListener('online',network);window.addEventListener('offline',network);window.visualViewport?.addEventListener('resize',viewport);if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});return()=>{window.removeEventListener('signed-out',out);window.removeEventListener('online',network);window.removeEventListener('offline',network);window.visualViewport?.removeEventListener('resize',viewport)}},[]);
 async function logout(){try{if('serviceWorker' in navigator){const registration=await navigator.serviceWorker.getRegistration();const subscription=await registration?.pushManager?.getSubscription();if(subscription){await api('/me/push-subscriptions',{method:'DELETE',body:subscription.toJSON()});await subscription.unsubscribe()}}await api('/logout',{method:'POST'});sessionStorage.clear();setBoot(null);setSignedOut(true);setDraft('');setSelected(null);setTab('ai');history.replaceState(null,'',location.pathname)}catch(e){setError(e.message)}}
 if(signedOut)return <Login onLogin={load}/>;if(!boot)return <><Loader/><ErrorMessage>{error}</ErrorMessage>{error&&<button onClick={load}>Retry</button>}</>;
 const refresh=()=>setRevision(r=>r+1);
 return <><div id="shell" className={`collective-shell tab-${tab}`}>
  {drawerOpen&&<div className="mobile-drawer-backdrop" onClick={()=>setDrawerOpen(false)} aria-hidden="true"/>}
  <aside className={`mobile-drawer ${drawerOpen?'open':''}`} aria-label="Navigation drawer">
   <div className="drawer-top">
    <div className="drawer-brand" onClick={()=>{setTab('ai');setDrawerOpen(false);history.replaceState(null,'','/');}} style={{cursor:'pointer'}}><Mark/> <span>collective</span></div>
    <button className="icon-button drawer-close-btn" onClick={()=>setDrawerOpen(false)} aria-label="Close menu"><Icon name="close" size={18}/></button>
   </div>
   <nav className="drawer-nav">
    <span className="drawer-section-title">NAVIGATION</span>
    {tabs.map(([key,label,icon])=><button key={key} className={`drawer-nav-item ${tab===key?'active':''}`} onClick={()=>{setTab(key);history.replaceState(null,'','/');setDrawerOpen(false)}}><span className="drawer-icon-wrap"><Icon name={icon} size={18}/></span><span className="drawer-nav-label">{label}</span>{tab===key&&<span className="drawer-active-dot"/>}</button>)}
    {boot.user.role==='admin'&&<button className={`drawer-nav-item ${tab==='admin'?'active':''}`} onClick={()=>{setTab('admin');setDrawerOpen(false)}}><span className="drawer-icon-wrap"><Icon name="settings" size={18}/></span><span className="drawer-nav-label">People & spaces</span>{tab==='admin'&&<span className="drawer-active-dot"/>}</button>}
   </nav>
   <div className="drawer-footer">
    <div className="drawer-user-card">
     <Avatar name={boot.user.name} small/>
     <div className="drawer-user-info">
      <strong>{boot.user.name}</strong>
      <small>{boot.user.email}</small>
     </div>
    </div>
    <button className="text-button drawer-logout" onClick={()=>{setDrawerOpen(false);logout()}}>
     <Icon name="logout" size={15}/>
     <span>Sign out</span>
    </button>
   </div>
  </aside>
  <aside className="collective-sidebar"><a className="brand" href="/" onClick={(e)=>{e.preventDefault();setTab('ai');history.replaceState(null,'','/');}}><Mark/> collective</a><p className="eyebrow">A LITTLE MORE FOCUS</p><nav>{tabs.map(([key,label,icon])=><button key={key} className={tab===key?'active':''} onClick={()=>setTab(key)}><Icon name={icon}/>{label}</button>)}</nav><div className="sidebar-bottom">{boot.user.role==='admin'&&<button className="text-button" onClick={()=>setTab('admin')}>People & spaces</button>}<p>{boot.user.name}</p><button className="text-button" onClick={logout}>Sign out</button></div></aside><div className="collective-main"><header className="collective-header"><div className="header-left"><button className="icon-button mobile-menu-btn" onClick={()=>setDrawerOpen(true)} aria-label="Open menu"><Icon name="menu" size={20}/></button><button className="icon-button header-home-btn" onClick={()=>{setTab('ai');history.replaceState(null,'','/');}} aria-label="Home" title="Home"><Icon name="home" size={19}/></button><button className="brand-title brand-button" onClick={()=>{setTab('ai');history.replaceState(null,'','/');}} title="Home"><Mark/> <span>your collective</span></button></div><div className="header-right">{tab!=='ai'&&<button className="header-home-pill" onClick={()=>{setTab('ai');history.replaceState(null,'','/');}} aria-label="Home"><Icon name="home" size={14}/><span>Home</span></button>}{tab==='ai'?(<button className="icon-button header-newchat-btn" onClick={()=>window.dispatchEvent(new CustomEvent('ai-new-chat'))} aria-label="New chat"><Icon name="edit" size={18}/></button>):(<button className="icon-button header-profile-btn" onClick={()=>setAccount(!account)} aria-label="Account"><Icon name="people" size={19}/></button>)}{account&&<><button className="menu-dismiss" aria-label="Close account menu" onClick={()=>setAccount(false)}/><div className="account-menu"><strong>{boot.user.name}</strong><button onClick={()=>{setTab('ai');setAccount(false);history.replaceState(null,'','/');}}>Home</button>{boot.user.role==='admin'&&<button onClick={()=>{setTab('admin');setAccount(false)}}>People & spaces</button>}<button onClick={logout}>Sign out</button></div></>}</div></header>{!online&&<p className="offline" role="status">You’re offline. Your unfinished message is kept here. Reconnect to save changes.</p>}<ErrorMessage>{error}</ErrorMessage><div className={'collective-content '+(tab==='ai'?'ai-page':'tasks-page')}>
 {tab==='task'&&<Today key={revision} user={boot.user} open={setSelected} onWorkspace={()=>setTab('workspaces')} onHome={()=>{setTab('ai');history.replaceState(null,'','/');}}/>}
 <div className={tab==='ai'?'ai-chat-page':'hidden'} aria-label="AI conversation"><PersonalAI user={boot.user} visible={tab==='ai'} connected={boot.ai_connected} draft={draft} setDraft={setDraft} open={setSelected} refresh={refresh}/></div>
 {(tab==='workspaces'||tab==='admin')&&<Suspense fallback={<Loader/>}><Workspace admin={tab==='admin'} onAdmin={()=>setTab('admin')} onHome={()=>{setTab('ai');history.replaceState(null,'','/');}} onCloseAdmin={()=>setTab('workspaces')} user={boot.user} open={setSelected}/></Suspense>}
 {tab==='profile'&&<ProfileView user={boot.user} boot={boot} onAdmin={()=>setTab('admin')} onHome={()=>{setTab('ai');history.replaceState(null,'','/');}} onLogout={logout} open={setSelected}/>}
 </div></div><nav className="collective-tabs" aria-label="Main navigation">{tabs.map(([key,label,icon])=><button key={key} type="button" aria-current={tab===key?'page':undefined} className={`tab-btn ${tab===key?'active':''}`} onClick={()=>setTab(key)}><span className="tab-icon-wrap"><Icon name={icon} size={18}/></span><span className="tab-label">{label}</span></button>)}</nav></div>{selected&&<TaskSheet taskId={selected} onClose={()=>{setSelected(null);history.replaceState(null,'',location.pathname)}} onSave={refresh}/>}</>;
}
function Today({user,open,onWorkspace,onHome}){
 const [delegated,setDelegated]=useState(false),[completed,setCompleted]=useState(false),[offset,setOffset]=useState(0);
 const [creatingTask,setCreatingTask]=useState(false);
 const [toast,setToast]=useState('');
 const {data,error,loading,reload}=useData(`/me/tasks?assigned_by_me=${delegated}&completed=${completed}&offset=${offset}&timezone_name=${encodeURIComponent(tz)}`);
 useEffect(()=>{const t=setInterval(()=>{if(document.visibilityState==='visible')reload()},15000);return()=>clearInterval(t)},[reload]);
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),4000);return()=>clearTimeout(t)},[toast]);

 return <section className="today">
  <div className="workspace-sub-nav" style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'12px',flexWrap:'wrap'}}>
   {onHome&&<button type="button" className="text-button" onClick={onHome} style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="home" size={15}/> <span>Home</span></button>}
   <span style={{color:'var(--muted)',fontSize:'13px'}}>›</span>
   <span style={{fontSize:'13px',fontWeight:600,color:'var(--ink)'}}>Tasks</span>
  </div>
  <div className="workspace-page-heading">
   <div className="day-heading">
    <span className="eyebrow">{new Date().toLocaleDateString('en',{weekday:'long',month:'long',day:'numeric'})}</span>
    <h1>Tasks<span>.</span></h1>
    <p>All your work, together. Track assignments, deadlines, and notifications across workspaces.</p>
   </div>
   <div className="workspace-actions">
    <button className="button primary" onClick={()=>setCreatingTask(true)}>
     <Icon name="plus" size={16}/>
     <span>New task</span>
    </button>
   </div>
  </div>
  <div className="task-filters">
   <button className={!delegated?'active':''} onClick={()=>{setDelegated(false);setOffset(0)}}>Assigned to me</button>
   <button className={delegated?'active':''} onClick={()=>{setDelegated(true);setOffset(0)}}>Assigned by me</button>
   <label><input type="checkbox" checked={completed} onChange={e=>{setCompleted(e.target.checked);setOffset(0)}}/> Include completed</label>
  </div>
  <ErrorMessage>{error}</ErrorMessage>
  {error&&<button className="button" onClick={reload}>Retry</button>}
  {loading?<Loader/>:data&&<>
   {data.total===0&&<div className="day-empty">
    <Icon name="check" size={28}/>
    <h2>{delegated?'No delegated tasks yet':'You’re all clear'}</h2>
    <p>{delegated?'Tasks you assign will appear here.':'Your assigned tasks will appear here, across all your workspaces.'}</p>
    <div style={{display:'flex',gap:'10px',marginTop:'14px',flexWrap:'wrap',justifyContent:'center'}}>
     <button className="button primary" onClick={()=>setCreatingTask(true)}>
      <Icon name="plus" size={16}/>
      <span>Create a task</span>
     </button>
     <button className="button" onClick={onWorkspace}>Open workspaces</button>
    </div>
   </div>}
   {data.tasks.length>0&&<section className="task-group all-tasks"><h2>All tasks<span>{data.total}</span></h2>{data.tasks.map(t=><TaskCard key={t.id} task={t} open={open}/>)}</section>}
   <div className="pagination">
    {offset>0&&<button className="button" onClick={()=>setOffset(Math.max(0,offset-50))}>Previous</button>}
    {data.next_offset!==null&&<button className="button" onClick={()=>setOffset(data.next_offset)}>Next tasks</button>}
   </div>
  </>}
  <Inbox open={open} embedded/>
  {creatingTask&&<CreateTaskSheet user={user} onClose={()=>setCreatingTask(false)} onCreated={(task)=>{reload();setToast('Task created.');if(task?.id)open(task.id)}}/>}
  {toast&&<div className="toast" role="status" onClick={()=>setToast('')}>{toast}</div>}
 </section>;
}

function CreateTaskSheet({user,onClose,onCreated}){
 const {data:spaces,loading:loadingSpaces,error:spacesError}=useData('/me/workspaces');
 const [spaceId,setSpaceId]=useState('');
 const [busy,setBusy]=useState(false);
 const [failure,setFailure]=useState('');
 const [members,setMembers]=useState([]);
 const [projects,setProjects]=useState([]);
 const [loadingSpaceData,setLoadingSpaceData]=useState(false);

 useEffect(()=>{
  if(spaces?.length&&!spaceId){
   setSpaceId(spaces[0].id);
  }
 },[spaces,spaceId]);

 useEffect(()=>{
  if(!spaceId)return;
  setLoadingSpaceData(true);
  api('/spaces/'+spaceId+'/work')
   .then(data=>{
    const m = data?.members?.length ? [...data.members] : [];
    if(!m.some(x=>x.id===user.id)){
     m.unshift({id:user.id,name:user.name});
    }
    setMembers(m);
    setProjects(data?.projects||[]);
   })
   .catch(err=>setFailure(err.message))
   .finally(()=>setLoadingSpaceData(false));
 },[spaceId,user.id,user.name]);

 async function submit(e){
  e.preventDefault();
  if(busy||!spaceId)return;
  setBusy(true);
  setFailure('');
  const f=Object.fromEntries(new FormData(e.currentTarget));
  try{
   const result=await api('/spaces/'+spaceId+'/tasks',{
    method:'POST',
    body:{
     title:f.title,
     description:f.description||'',
     assignee_id:f.assignee_id||user.id,
     project_id:f.project_id||null,
     priority:f.priority||'Medium',
     due_at:iso(f.due_at)
    }
   });
   onCreated?.(result);
   onClose();
  }catch(err){
   setFailure(err.message);
  }finally{
   setBusy(false);
  }
 }

 return (
  <Sheet title="New task" kicker="YOUR WORK, TOGETHER" onClose={onClose}>
   <div className="sheet-body">
    <ErrorMessage>{spacesError||failure}</ErrorMessage>
    {loadingSpaces?<Loader/>:!spaces?.length?(
     <div className="day-empty" style={{margin:'20px 0'}}>
      <Icon name="box" size={28}/>
      <h2>No workspace found</h2>
      <p>You need to be in a workspace to create tasks.</p>
     </div>
    ):(
     <form className="form-fields" onSubmit={submit}>
      <label>Workspace
       <select value={spaceId} onChange={e=>setSpaceId(e.target.value)} required>
        {spaces.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
       </select>
      </label>
      <label>Task title
       <input name="title" required maxLength={240} placeholder="What needs to be done?" autoFocus/>
      </label>
      <label>Details
       <textarea name="description" rows={3} placeholder="Add brief, instructions, or deliverables…"/>
      </label>
      <div className="form-row">
       <label>Assign to
        <select name="assignee_id" defaultValue={user.id} disabled={loadingSpaceData}>
         {members.map(m=><option key={m.id} value={m.id}>{m.name}{m.id===user.id?' (You)':''}</option>)}
        </select>
       </label>
       <label>Priority
        <select name="priority" defaultValue="Medium">
         {['Low','Medium','High'].map(p=><option key={p} value={p}>{p}</option>)}
        </select>
       </label>
      </div>
      <div className="form-row">
       <label>Project
        <select name="project_id" defaultValue="" disabled={loadingSpaceData}>
         <option value="">No project</option>
         {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
       </label>
       <label>Deadline
        <input type="datetime-local" name="due_at"/>
       </label>
      </div>
      <div className="sheet-actions">
       <button type="button" className="button" onClick={onClose}>Cancel</button>
       <button className="button primary" disabled={busy||loadingSpaceData}>
        {busy?'Creating…':'Create task'}
        <Icon name="arrow" size={16}/>
       </button>
      </div>
     </form>
    )}
   </div>
  </Sheet>
 );
}
export function TaskCard({task:t,open}){
 const isDone = t.status === 'Done';
 const isOverdue = !isDone && t.due_at && new Date(t.due_at).getTime() < Date.now();
 return (
  <button className={`task-card ${isOverdue ? 'is-overdue' : ''}`} onClick={()=>open(t.id)}>
   <span className={`task-check ${isDone ? 'done' : ''} ${isOverdue ? 'overdue' : ''}`}>
    {isDone && <Icon name="check" size={14}/>}
   </span>
   <span className="task-copy">
    <strong>{t.title}</strong>
    <span className="task-meta">
     {t.workspace_name && <span>{t.workspace_name}</span>}
     {t.project_name && <span className="task-project-tag">📁 {t.project_name}</span>}
     {t.assignee_name && <span>{t.assignee_name}</span>}
     <span className={`task-due-item ${isOverdue ? 'due-overdue' : ''}`}>
      {isOverdue && <Icon name="clock" size={12}/>}
      {isOverdue ? `Overdue · ${datetime(t.due_at)}` : (t.due_at ? datetime(t.due_at) : 'No deadline')}
     </span>
    </span>
    <span className="task-tags">
     {isOverdue && <span className="tag-overdue"><Icon name="clock" size={11}/> Overdue</span>}
     <span>{t.status}</span>
     <span className={t.priority==='High'?'priority-high':''}>{t.priority} priority</span>
    </span>
   </span>
   <Icon name="chevron" size={16}/>
  </button>
 );
}
function TaskSheet({taskId,onClose,onSave}){
 const {data,error,loading,reload}=useData('/tasks/'+taskId);const [busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[workspaceInfo,setWorkspaceInfo]=useState({members:[],projects:[]});
 useEffect(()=>{if(data?.space)api('/spaces/'+data.space+'/work').then(w=>setWorkspaceInfo({members:w.members||[],projects:w.projects||[]})).catch(e=>setFailure(e.message))},[data?.space]);
 async function save(e){e.preventDefault();if(busy)return;setBusy(true);const f=Object.fromEntries(new FormData(e.currentTarget));try{await api('/tasks/'+taskId,{method:'PATCH',body:{...f,assignee_id:f.assignee_id||undefined,due_at:iso(f.due_at),clear_deadline:!f.due_at,project_id:f.project_id||null,clear_project:!f.project_id}});await reload();onSave()}catch(e){setFailure(e.message)}finally{setBusy(false)}}
 const isDone = data?.status === 'Done';
 const isOverdue = !isDone && data?.due_at && new Date(data.due_at).getTime() < Date.now();
 return <Sheet title={data?.title||'Task'} kicker={data?.task_id||'YOUR WORK'} onClose={onClose}><div className="sheet-body"><ErrorMessage>{error||failure}</ErrorMessage>{loading?<Loader/>:data&&<><form className="form-fields" key={data.updated} onSubmit={save}><label>Title<input name="title" defaultValue={data.title} required maxLength={240}/></label><label>Details<textarea name="description" defaultValue={data.description}/></label><label>Status<select name="status" defaultValue={data.status}>{['To do','In progress','Blocked','Done'].map(s=><option key={s}>{s}</option>)}</select></label><label>Assign to<select name="assignee_id" defaultValue={data.assignee_id}>{workspaceInfo.members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label>Project<select name="project_id" defaultValue={data.project_id||''}><option value="">No project</option>{workspaceInfo.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Priority<select name="priority" defaultValue={data.priority}>{['Low','Medium','High'].map(s=><option key={p}>{p}</option>)}</select></label><label className={isOverdue ? 'deadline-label-overdue' : ''}>Deadline {isOverdue && <span className="overdue-text">⚠️ Overdue</span>}<input type="datetime-local" name="due_at" defaultValue={localInput(data.due_at)}/></label><label>Feedback<textarea name="feedback" placeholder="Add an update for your team"/></label><button className="button primary" disabled={busy}>{busy?'Saving…':'Save changes'}</button></form><h3 className="activity-title">Activity</h3>{data.activity.map(a=><article className="task-activity" key={a.id}><strong>{a.actor}</strong><p>{a.description}</p><small>{datetime(a.created)}</small></article>)}</>}</div></Sheet>;
}
function ActionCard({action:a,index:i,onOpen,onSave}){
 const [done,setDone]=useState(a.status==='Done');
 const [busy,setBusy]=useState(false);
 async function toggleCheck(e){
  e.stopPropagation();
  if(a.kind!=='task'||busy)return;
  const nextStatus=done?'To do':'Done';
  setDone(!done);
  setBusy(true);
  try{
   await api('/tasks/'+a.id,{method:'PATCH',body:{status:nextStatus}});
   onSave?.();
  }catch(_){
   setDone(done);
  }finally{
   setBusy(false);
  }
 }
 return (
  <div className={`action-receipt ${done?'is-done':''}`} style={{'--i':i}} onClick={()=>a.kind==='task'&&onOpen?.(a.id)}>
   {a.kind==='task'?(
    <button type="button" className={`receipt-checkbox ${done?'checked':''}`} aria-label={done?'Mark incomplete':'Mark done'} onClick={toggleCheck}>
     <Icon name="check" size={13}/>
    </button>
   ):(
    <span className="receipt-kind-icon">
     <Icon name={a.kind==='space'?'box':'spark'} size={15}/>
    </span>
   )}
   <div className="receipt-content">
    <div className="receipt-header">
     <strong className="receipt-title">{a.title}</strong>
     {a.label&&<span className={`receipt-badge ${done?'badge-done':''}`}>{done?'Completed':a.label}</span>}
    </div>
    <p className="receipt-meta">
     {[a.assignee,a.due_at?datetime(a.due_at):null,a.workspace_name].filter(Boolean).join(' · ')}
    </p>
   </div>
   {a.kind==='task'&&<span className="receipt-arrow" aria-hidden="true"><Icon name="chevron" size={15}/></span>}
  </div>
 );
}

function mergeTurns(existing=[],fresh=[]){
 const map=new Map();
 for(const t of (existing||[])){if(t&&(t.run_id||t.id))map.set(t.run_id||t.id,t)}
 for(const t of (fresh||[])){if(t&&(t.run_id||t.id))map.set(t.run_id||t.id,t)}
 return Array.from(map.values());
}

function PersonalAI({user,visible,connected,draft,setDraft,open,refresh,embedded=false}){
 const [listening,setListening]=useState(false);
 const messageInput=useRef(null),chatHistory=useRef(null),followLatest=useRef(true);
 useEffect(()=>{if(visible&&!embedded)messageInput.current?.focus()},[visible,embedded]);
 const [cid,setCid]=useState(''),[conversations,setConversations]=useState([]),[turns,setTurns]=useState(()=>{try{const cached=sessionStorage.getItem('collective-turns');return cached?JSON.parse(cached):[]}catch{return []}}),[spaces,setSpaces]=useState([]),[space,setSpace]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[run,setRun]=useState(()=>{try{return JSON.parse(sessionStorage.getItem('collective-run')||'null')}catch{sessionStorage.removeItem('collective-run');return null}}),[draftTarget,setDraftTarget]=useState('');const lock=useRef(false);
 useEffect(()=>{try{if(turns.length>0)sessionStorage.setItem('collective-turns',JSON.stringify(turns))}catch{}},[turns]);
 useEffect(()=>{const el=chatHistory.current;if(el&&followLatest.current)el.scrollTop=el.scrollHeight},[turns,run,busy,visible]);
 async function historyLoad(c){
  if(!c)return;
  try{
   const loaded=await api('/me/conversations/'+c);
   if(Array.isArray(loaded)){
    setTurns(prev=>(loaded.length>0?mergeTurns(prev,loaded):prev));
    setError('');
   }
  }catch(err){
   if(err.message==='Conversation not found'){
    try{
     const fresh=await api('/me/conversations',{method:'POST'});
     setCid(fresh.id);
     setConversations(cs=>[{id:fresh.id,created:new Date().toISOString()},...cs.filter(x=>x.id!==c)]);
     setError('');
    }catch(e2){
     setError(e2.message);
    }
   }else{
    console.warn('historyLoad warning:',err.message);
   }
  }
 }
 useEffect(()=>{let active=true;(async()=>{try{const [cs,ss]=await Promise.all([api('/me/conversations'),api('/me/workspaces')]);const c=cs[0]?.id||(await api('/me/conversations',{method:'POST'})).id;if(active){setCid(c);setConversations(cs.length?cs:[{id:c,created:new Date().toISOString()}]);setSpaces(ss);await historyLoad(c)}}catch(e){setError(e.message)}})();return()=>{active=false}},[user.id]);
 useEffect(()=>{if(!visible||!cid)return;const reload=()=>Promise.all([historyLoad(cid),api('/me/workspaces').then(setSpaces)]).catch(e=>{setError(e.message)});reload();const timer=setInterval(reload,10000);window.addEventListener('focus',reload);return()=>{clearInterval(timer);window.removeEventListener('focus',reload)}},[visible,cid]);
 useEffect(()=>{if(!run)return;let stop=false;let timer;async function poll(){try{const r=await api('/me/ai/runs/'+run.id);if(stop)return;if(r.status==='completed'){if(r.result){const completedTurn={id:id(),conversation_id:run.cid,run_id:run.id,question:run.question,result:r.result,sources:run.space?[run.space]:[],created:new Date().toISOString()};setTurns(prev=>mergeTurns(prev,[completedTurn]))}await historyLoad(run.cid);setRun(null);sessionStorage.removeItem('collective-run');setBusy(false);lock.current=false;refresh()}else if(r.status==='failed'){setError(r.result?.answer||'Could not complete this request.');setRun(null);sessionStorage.removeItem('collective-run');setBusy(false);lock.current=false}else{setBusy(true);timer=setTimeout(poll,1000)}}catch(e){if(!stop){if(e.message==='Run not found or access changed'||e.message==='Run unavailable'){setRun(null);sessionStorage.removeItem('collective-run');setBusy(false);lock.current=false}else{setError(e.message);setBusy(false);timer=setTimeout(poll,3000)}}}}poll();return()=>{stop=true;clearTimeout(timer)}},[run]);
 async function enqueue(question){followLatest.current=true;let activeCid=cid;if(!activeCid){try{const fresh=await api('/me/conversations',{method:'POST'});activeCid=fresh.id;setCid(fresh.id);setConversations(cs=>[{id:fresh.id,created:new Date().toISOString()},...cs])}catch(e){setError(e.message);setBusy(false);lock.current=false;return}}const pending={id:id(),cid:activeCid,question,space};sessionStorage.setItem('collective-run',JSON.stringify(pending));setRun(pending);setDraft('');setBusy(true);try{const res=await api('/me/ai/runs',{method:'POST',body:{request_id:pending.id,conversation_id:pending.cid,question:pending.question,space:pending.space||null,timezone:tz}});if(res?.status==='completed'&&res.result){const completedTurn={id:id(),conversation_id:pending.cid,run_id:pending.id,question:pending.question,result:res.result,sources:pending.space?[pending.space]:[],created:new Date().toISOString()};setTurns(prev=>mergeTurns(prev,[completedTurn]));await historyLoad(pending.cid);setRun(null);sessionStorage.removeItem('collective-run');setBusy(false);lock.current=false;refresh();return}else if(res?.status==='failed'){setError(res.result?.answer||'Could not complete this request.');setRun(null);sessionStorage.removeItem('collective-run');setBusy(false);lock.current=false;return}}catch(e){setError(e.message);setRun(null);sessionStorage.removeItem('collective-run');setBusy(false);lock.current=false}}
 async function send(e){e.preventDefault();if(listening||lock.current||!draft.trim()||!connected)return;lock.current=true;setBusy(true);setError('');await enqueue(draft)}
 async function sendVoiceNote(blob){if(lock.current||!connected)return;lock.current=true;setBusy(true);setError('');try{const form=new FormData();const t=(blob.type||'').toLowerCase();const ext=t.includes('wav')?'wav':(t.includes('mp4')||t.includes('m4a')||t.includes('aac'))?'m4a':t.includes('ogg')?'ogg':t.includes('mp3')?'mp3':'webm';form.append('audio',blob,`voice-note.${ext}`);const {text}=await apiUpload('/me/ai/transcribe',form);await enqueue(text)}catch(e){setError(e.message);setBusy(false);lock.current=false}}
 async function retry(){if(!run)return;setBusy(true);try{await api('/me/ai/runs',{method:'POST',body:{request_id:run.id,conversation_id:run.cid,question:run.question,space:run.space||null,timezone:tz}});const res=await api('/me/ai/runs/'+run.id+'/retry',{method:'POST'});if(res?.status==='completed'&&res.result){const completedTurn={id:id(),conversation_id:run.cid,run_id:run.id,question:run.question,result:res.result,sources:run.space?[run.space]:[],created:new Date().toISOString()};setTurns(prev=>mergeTurns(prev,[completedTurn]));await historyLoad(run.cid);setRun(null);sessionStorage.removeItem('collective-run');setBusy(false);lock.current=false;refresh();return}setError('');setBusy(true);setRun({...run})}catch(e){setError(e.message);setBusy(false)}}
 function clarify(turn,choice){
  const lower=choice.toLowerCase();
  const matches=spaces.filter(w=>lower.includes(w.name.toLowerCase()));
  if(matches.length===1)setSpace(matches[0].id);
  const lines=turn.question.split('\n').filter(line=>!(matches.length===1&&line.startsWith('Clarification:')&&spaces.some(w=>line.toLowerCase().includes(w.name.toLowerCase()))));
  setDraft(lines.join('\n')+'\nClarification: '+choice);
  messageInput.current?.focus();
 }
 async function newChat(){try{const c=await api('/me/conversations',{method:'POST'});setCid(c.id);setConversations(cs=>[{id:c.id,created:new Date().toISOString()},...cs]);setTurns([]);sessionStorage.removeItem('collective-turns');setRun(null);sessionStorage.removeItem('collective-run');setError('')}catch(e){setError(e.message)}}
 useEffect(()=>{const h=()=>newChat();window.addEventListener('ai-new-chat',h);return()=>window.removeEventListener('ai-new-chat',h)},[]);
 return <section className="personal-ai">{!connected&&<div className="ai-setup-notice"><strong>Connect your AI</strong><p>{user.role==='admin'?'Add GROQ_API_KEY to the project’s .env file, then restart npm start. The key stays on the server.':'Ask your administrator to add the Groq API key to the server’s .env file and restart the app.'}</p></div>}<header><div><span className="eyebrow">ONLY YOU & YOUR AI</span><h1>{embedded?<>A little clarity. <em>A better day.</em></>:<>A clearer <em>next step.</em></>}</h1></div><button className="button" disabled={busy} onClick={newChat}><Icon name="plus" size={14}/> New chat</button></header><label className="conversation-picker"><Icon name="clock" size={13}/><span>History</span><select aria-label="Private conversation" disabled={busy} value={cid} onChange={e=>{setCid(e.target.value);historyLoad(e.target.value).catch(e=>setError(e.message))}}>{conversations.map((c,i)=><option key={c.id} value={c.id}>{i===0?"Latest · ":""}{datetime(c.created)}</option>)}</select></label><div ref={chatHistory} role="log" aria-label="AI conversation messages" onScroll={e=>{const el=e.currentTarget;followLatest.current=el.scrollHeight-el.scrollTop-el.clientHeight<60}} className={'private-history'+(!turns.length&&!run?' empty-history':'')}>{!embedded&&!turns.length&&!run&&<div className="ai-welcome"><div className="welcome-spark-ring"><Icon name="spark" size={38}/></div><h2 className="welcome-title">Less keeping track.<br/><em>More moving forward.</em></h2><p className="welcome-desc">Assign a task, find a detail, or make a start on that brief.</p><button className="suggestion premium-suggestion" onClick={()=>setDraft('What needs my attention today?')}><span>What needs my attention today?</span> <Icon name="arrow" size={16}/></button></div>}{turns.map(t=><article className="private-turn" key={t.id||t.run_id}><p className="user-question">{t.question}</p><div className="assistant-answer"><span className="assistant-mark"><Icon name="spark" size={16}/></span><div className="assistant-body"><FormattedAnswer text={t.result?.answer||''} onOpenTask={open}/></div></div>{t.result?.clarification&&<button className="text-button" onClick={()=>setDraft(t.question+'\nAdditional details: ')}>Add details to this request</button>}{t.result?.clarification?.choices?.map(c=><button className="button" key={c} onClick={()=>clarify(t,c)}>{c}</button>)}{t.result?.actions?.map((a,i)=><ActionCard key={i} action={a} index={i} onOpen={open} onSave={refresh}/>)}{t.result?.failed_actions?.map((f,i)=><ErrorMessage key={i}>{f.tool}: {f.error}</ErrorMessage>)}{t.result?.draft&&<div className="private-draft"><small>PRIVATE DRAFT</small><p>{t.result.draft.text}</p><input aria-label="Destination task ID" placeholder="Task UUID to save this draft" value={draftTarget} onChange={e=>setDraftTarget(e.target.value)}/><button className="button" onClick={async()=>{try{await api('/me/drafts/'+t.result.draft.id+'/save',{method:'POST',body:{task_id:draftTarget}});open(draftTarget)}catch(e){setError(e.message)}}}>Save to task</button></div>}</article>)}{run&&<p className="user-question pending-question">{run.question}</p>}{busy&&<div className="run-pending-card" role="status" aria-live="polite"><div className="thinking-avatar"><Icon name="spark" size={16}/></div><div className="thinking-content"><div className="thinking-header"><span className="thinking-title">Collective is working</span><span className="thinking-dots"><span className="dot dot-1"/><span className="dot dot-2"/><span className="dot dot-3"/></span></div><p className="thinking-subtitle">Reviewing records & preparing answer…</p></div></div>}</div><ErrorMessage>{error}</ErrorMessage>{run&&!busy&&<button className="button" onClick={retry}>Retry request</button>}<div className="ai-starters" aria-label="Suggested requests">{[['Summarize my day','What needs my attention today?'],["Due this week","What tasks are due this week?"],['Create a task','Help me create a task.']].map(([label,prompt])=><button key={label} type="button" disabled={busy||!!run||listening} onClick={()=>{setDraft(prompt);messageInput.current?.focus()}}>{label}<Icon name="arrow" size={12}/></button>)}</div><form className="personal-composer" onSubmit={send}><textarea ref={messageInput} aria-label="Ask your personal AI" readOnly={listening} rows={2} value={draft} maxLength={6000} onChange={e=>setDraft(e.target.value)} placeholder="Ask, assign, or make a start…"/><label className="composer-scope"><Icon name="lock" size={13}/><select aria-label="Knowledge and action workspace" value={space} disabled={busy||!!run} onChange={e=>setSpace(e.target.value)}><option value="">My workspaces</option>{spaces.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label> <VoiceInput disabled={busy||!!run} visible={visible} onListening={setListening} onVoiceNote={sendVoiceNote}/>{!listening&&<button className="button primary" aria-label="Send to AI" disabled={!connected||busy||!draft.trim()||!!run}><Icon name="arrow"/></button>}</form><p className="privacy-note"><Icon name="lock" size={12}/> Only you & your AI · Your workspace access applies</p></section>;
}
function Inbox({open,embedded=false}){const {data,error,reload}=useData('/notifications');const [failure,setFailure]=useState('');useEffect(()=>{const t=setInterval(reload,15000);return()=>clearInterval(t)},[reload]);return <section className={embedded?'notification-section':''}>{!embedded&&<div className="day-heading"><span className="eyebrow">KEEP IN THE LOOP</span><h1>Notifications<span>.</span></h1><p>Updates that bring the next step into view.</p></div>}{embedded&&<div className="section-heading"><h2>Notifications</h2><span className="eyebrow">KEEP IN THE LOOP</span></div>}<ErrorMessage>{error||failure}</ErrorMessage>{data?.notifications.map(n=><button className={'inbox-item '+(!n.read_at?'unread':'')} key={n.id} onClick={async()=>{try{await api('/notifications/'+n.id+'/read',{method:'POST'});if(n.task_id)open(n.task_id);reload()}catch(e){setFailure(e.message)}}}><Icon name="bell"/><span><strong>{n.title}</strong><p>{n.body}</p><small>{n.workspace_name} · {datetime(n.created)}</small></span></button>)}{data&&!data.notifications.length&&<Empty icon="bell" title="All quiet for now.">Task assignments and updates will appear here.</Empty>}<NotificationSetup/></section>}
function NotificationSetup(){const {data,reload}=useData('/me/notification-preferences');const [message,setMessage]=useState('');async function enable(){try{if(!window.isSecureContext||!('PushManager' in window))throw Error('On iPhone, use Share → Add to Home Screen, then open Collective from its icon over HTTPS.');if(!data?.public_key)throw Error('Push keys are not configured on the server. Your inbox still works.');const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notifications are off. You can change this in device settings; your inbox still works.');const ready=await navigator.serviceWorker.ready;const encoded=data.public_key.replace(/-/g,'+').replace(/_/g,'/');const key=Uint8Array.from(atob(encoded+'='.repeat((4-encoded.length%4)%4)),c=>c.charCodeAt(0));const subscription=await ready.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});await api('/me/push-subscriptions',{method:'POST',body:subscription.toJSON()});setMessage('Notifications enabled on this device.')}catch(e){setMessage(e.message)}}return <div className="notification-setup"><h3>A gentle heads-up.</h3><p>Get private task alerts on this device. On iPhone, add Collective to your Home Screen first.</p><button className="button" onClick={enable}>Enable notifications</button>{data&&['assignments','reminders'].map(k=><label className="check-label" key={k}><input type="checkbox" checked={!!data[k]} onChange={async e=>{try{await api('/me/notification-preferences',{method:'PUT',body:{...data,[k]:e.target.checked}});reload()}catch(e){setMessage(e.message)}}}/>{k==='assignments'?'Assignment alerts':'Deadline reminders'}</label>)}<p role="status">{message}</p></div>}
function ProfileView({user,boot,onAdmin,onHome,onLogout,open}){
 const initials=(user.name||'User').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
 return <section className="profile-view-page"><div className="workspace-sub-nav" style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'12px',flexWrap:'wrap'}}>{onHome&&<button type="button" className="text-button" onClick={onHome} style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="home" size={15}/> <span>Home</span></button>}<span style={{color:'var(--muted)',fontSize:'13px'}}>›</span><span style={{fontSize:'13px',fontWeight:600,color:'var(--ink)'}}>Profile</span></div><div className="day-heading"><span className="eyebrow">YOUR ACCOUNT & PREFERENCES</span><h1>Profile<span>.</span></h1><p>Personal access, workspace roles, and notification controls.</p></div><div className="profile-hero-card"><div className="profile-avatar-circle"><span>{initials}</span></div><div className="profile-hero-details"><h2>{user.name}</h2><p className="profile-hero-email">{user.email}</p><div className="profile-role-row"><span className={`role-badge ${user.role==='admin'?'role-admin':'role-member'}`}><Icon name="people" size={12}/> {user.role==='admin'?'Administrator':'Team Member'}</span><span className="role-badge role-ai"><Icon name="spark" size={12}/> {boot.ai_connected?'Groq AI Connected':'AI Offline'}</span></div></div></div>{user.role==='admin'&&<div className="profile-admin-card"><div className="admin-card-copy"><h3>Workspace Administration</h3><p>Manage members, workspace access, permissions, and company spaces.</p></div><button className="button primary" onClick={onAdmin}>Open People & spaces →</button></div>}<div className="profile-inbox-section"><Inbox open={open} embedded/></div><div className="profile-logout-card"><div><h3>Sign Out</h3><p>End your active session on this device.</p></div><button className="button danger-outline" onClick={onLogout}>Sign out</button></div></section>;
}
