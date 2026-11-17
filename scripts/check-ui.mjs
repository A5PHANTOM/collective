import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(process.cwd()+'/package.json');
const {JSDOM}=require(process.env.JSDOM_PATH||'jsdom');
const esbuild=require('esbuild');
await esbuild.build({entryPoints:['src/main.jsx'],bundle:true,outfile:'/tmp/collective-ui-bundle.js',format:'iife',define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
const bridge=spawn('.venv/bin/python',['scripts/ui_bridge.py'],{cwd:process.cwd(),stdio:['pipe','pipe','pipe']});
const pending=new Map();let next=0;
createInterface({input:bridge.stdout}).on('line',line=>{const r=JSON.parse(line);pending.get(r.id)?.(r);pending.delete(r.id)});
let bridgeError='';bridge.stderr.on('data',d=>bridgeError+=d);
bridge.on('error',e=>{throw e});
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost:3000/',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.crypto.randomUUID=randomUUID;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
w.fetch=async(path,options={})=>{const id=++next;const promise=new Promise(resolve=>pending.set(id,resolve));bridge.stdin.write(JSON.stringify({id,path,method:options.method||'GET',body:options.body?JSON.parse(options.body):undefined})+'\n');const response=await promise;return {ok:response.status<400,status:response.status,json:async()=>response.data}};
Object.defineProperty(w,'isSecureContext',{value:true});
let microphone;
w.SpeechRecognition=class {
 constructor(){microphone=this}
 start(){}
 stop(){this.onend?.()}
 abort(){this.onend?.()}
};
const doc=w.document;
async function until(fn,label){for(let i=0;i<150;i++){const v=fn();if(v)return v;await new Promise(r=>setTimeout(r,20))}throw Error('Timed out: '+label+'\n'+doc.body.textContent.slice(-3500)+'\n'+bridgeError)}
const button=text=>[...doc.querySelectorAll('button')].find(e=>e.textContent.trim()===text);
function input(name,value,root=doc){const e=root.querySelector(`[name="${name}"]`);assert.ok(e,'Input '+name);const proto=e.tagName==='TEXTAREA'?w.HTMLTextAreaElement.prototype:e.tagName==='SELECT'?w.HTMLSelectElement.prototype:w.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new w.Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));return e}
function submit(form){form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}))}
function click(e){assert.ok(e,'Clickable element exists');e.click()}
try{
 w.eval(fs.readFileSync('/tmp/collective-ui-bundle.js','utf8'));
 await until(()=>doc.querySelector('input[name=email]'),'login form');
 input('email','admin@gmail.com');input('password','1234');submit(doc.querySelector('form'));
 await until(()=>doc.querySelector('.ai-chat-page'),'AI page after login');
 assert.equal(doc.querySelector('.today'),null);
 click(button('Tasks'));
 await until(()=>doc.querySelector('.today'),'Tasks section');
 assert.ok(doc.body.textContent.includes('Assigned by me'));
 for(const width of [375,390,430,1440]){w.innerWidth=width;w.dispatchEvent(new w.Event('resize'));assert.equal(doc.querySelectorAll('.collective-tabs button').length,4)}
 click(button('Workspaces'));await until(()=>doc.querySelector('.workspace-list button'),'workspace list');
 click(button('+ New workspace'));await until(()=>doc.querySelector('[role=dialog] [name=name]'),'workspace creation sheet');input('name','Events smoke test');input('description','Event team');submit(doc.querySelector('[role=dialog] form'));await until(()=>button('Save members'),'new workspace member management');submit(button('Save members').closest('form'));await until(()=>doc.body.textContent.includes('Workspace members updated'),'members saved');click(button('← All workspaces'));await until(()=>doc.querySelector('.workspace-list button'),'workspace list refreshed');assert.ok(doc.body.textContent.includes('Events smoke test'));click(doc.querySelector('.workspace-list button'));
 await until(()=>button('+ New task'),'tasks workspace');click(button('+ New task'));
 await until(()=>doc.querySelector('[role=dialog]'),'new task');input('title','Instagram event post');input('description','Evening campaign');input('due_at','2030-12-02T18:00');submit(doc.querySelector('[role=dialog] form'));
 await until(()=>!doc.querySelector('[role=dialog]')&&doc.body.textContent.includes('Instagram event post'),'task created');
 click(button('Tasks'));await until(()=>doc.querySelector('.today .task-card'),'task visible on home');click(doc.querySelector('.task-card'));
 await until(()=>doc.querySelector('[name=status]'),'task sheet');input('status','In progress');input('feedback','Draft in review');submit(doc.querySelector('[role=dialog] form'));
 await until(()=>doc.querySelector('.task-activity')?.textContent.includes('Draft in review'),'feedback saved');click(doc.querySelector('[aria-label="Close dialog"]'));
 click(button('AI'));await until(()=>doc.querySelector('.personal-composer textarea'),'personal AI');const textarea=doc.querySelector('.personal-composer textarea');Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value').set.call(textarea,'An unfinished private brief');textarea.dispatchEvent(new w.Event('input',{bubbles:true}));
 await until(()=>textarea.value.includes('unfinished'),'draft state');
 click(doc.querySelector('[aria-label="Start microphone"]'));
 await until(()=>doc.querySelector('[aria-label="Stop microphone"]'),'microphone started');
 microphone.onresult({results:[[{transcript:'with voice input'}]]});
 await until(()=>textarea.value.includes('with voice input'),'transcription appended');
 assert.equal(textarea.readOnly,true);
 click(doc.querySelector('[aria-label="Stop microphone"]'));
 await until(()=>!textarea.readOnly,'microphone stopped');
 Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value').set.call(textarea,'An unfinished private brief');textarea.dispatchEvent(new w.Event('input',{bubbles:true}));
 await until(()=>textarea.value==='An unfinished private brief','draft restored');click(button('Tasks'));
 await until(()=>doc.querySelector('.today'),'Tasks page');
 assert.equal(doc.querySelector('.ai-chat-page'),null);
 assert.equal(doc.querySelector('.collective-tabs [aria-current="page"]').textContent,'Tasks');
 assert.equal(doc.querySelectorAll('.all-tasks').length,1);
 click(button('AI'));await until(()=>doc.querySelector('.ai-page'),'AI reopened');assert.equal(doc.querySelector('.personal-composer textarea').value,'An unfinished private brief');
 click(button('Inbox'));await until(()=>doc.querySelector('.inbox-item'),'inbox notification');assert.ok(doc.body.textContent.includes('New task assigned'));
 click(button('Workspaces'));await until(()=>doc.querySelector('.workspace-list button'),'workspace again');click(doc.querySelector('.workspace-list button'));await until(()=>button('Team'),'workspace tabs');click(button('Team'));await until(()=>doc.querySelector('.channel-composer textarea'),'team composer');const channel=doc.querySelector('.channel-composer textarea');Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value').set.call(channel,'Team launch update');channel.dispatchEvent(new w.Event('input',{bubbles:true}));submit(doc.querySelector('.channel-composer'));await until(()=>doc.querySelector('.channel-message')?.textContent.includes('Team launch update'),'team message saved');
 const savedTasks=await (await w.fetch('/api/me/tasks')).json();const taskId=savedTasks.tasks[0].id;
 click(button('Sign out'));await until(()=>doc.querySelector('input[name=email]'),'signed out');assert.equal(w.sessionStorage.length,0);
 w.history.replaceState(null,'','/?task='+taskId);input('email','admin@gmail.com');input('password','1234');submit(doc.querySelector('form'));await until(()=>doc.querySelector('[role=dialog] [name=status]'),'authorized notification deep link restored after login');
 console.log('PASS: React/FastAPI DOM integration: login → My Day, workspace task creation, task home, status/feedback, inbox, team message, draft preservation, logout. Navigation structure checked at 375/390/430/1440; no layout engine.');
}finally{dom.window.close();bridge.kill()}
