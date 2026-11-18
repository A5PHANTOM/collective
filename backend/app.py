"""Collective: FastAPI, SQLite, and workspace-scoped Groq AI."""
from __future__ import annotations
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import tempfile
import time
import uuid
from contextlib import contextmanager, asynccontextmanager
import asyncio
import logging
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field, field_validator

ROOT = Path(__file__).resolve().parent.parent
for line in (ROOT / '.env').read_text().splitlines() if (ROOT / '.env').exists() else []:
    if '=' in line and not line.lstrip().startswith('#'):
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"\''))
STAGES = ['Brief', 'Design', 'Approval', 'Production', 'Quality check', 'Dispatched']
Stage = Literal['Brief', 'Design', 'Approval', 'Production', 'Quality check', 'Dispatched']

def now():
    return datetime.now(timezone.utc).isoformat()

def uid():
    return str(uuid.uuid4())

def session_secret():
    secret=os.environ.get('SESSION_SECRET')
    if not secret:
        if os.environ.get('VERCEL')=='1':
            raise RuntimeError('SESSION_SECRET must be configured on Vercel')
        secret='local-development-session-secret'
    return secret.encode()

def signed_session(user_id, expires):
    identity=base64.urlsafe_b64encode(user_id.encode()).decode().rstrip('=')
    payload=f'{identity}.{int(expires)}'
    signature=hmac.new(session_secret(),payload.encode(),hashlib.sha256).hexdigest()
    return f'{payload}.{signature}'

def session_claims(token):
    try:
        payload,signature=token.rsplit('.',1)
        identity,expires=payload.split('.',1)
        if not hmac.compare_digest(signature,hmac.new(session_secret(),payload.encode(),hashlib.sha256).hexdigest()):
            return None
        if int(expires)<=time.time():
            return None
        return base64.urlsafe_b64decode(identity+'='*((4-len(identity)%4)%4)).decode()
    except (ValueError,TypeError):
        return None

def password_hash(password, salt):
    # Matches the original Node.js scrypt encoding so existing logins survive migration.
    return hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64).hex()

_transaction = ContextVar("collective_transaction", default=None)

@contextmanager
def connection(app):
    active = _transaction.get()
    if active and active[0] == app.state.db_path:
        yield active[1]
        return
    conn = sqlite3.connect(app.state.db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    try:
        with conn:
            token = _transaction.set((app.state.db_path, conn))
            try:
                yield conn
            finally:
                _transaction.reset(token)
    finally:
        conn.close()

def rowdict(row):
    return dict(row) if row else None

def check_space(conn, user, space):
    if not conn.execute('SELECT 1 FROM spaces WHERE id=?', (space,)).fetchone():
        raise HTTPException(404, 'Workspace not found')
    if user['role'] != 'admin' and not conn.execute('SELECT 1 FROM memberships WHERE user_id=? AND space_id=?', (user['id'], space)).fetchone():
        raise HTTPException(403, 'You do not have access to this workspace')

def get_order(conn, user, order_id):
    order = conn.execute('SELECT * FROM orders WHERE id=?', (order_id,)).fetchone()
    if not order:
        raise HTTPException(404, 'Order not found')
    check_space(conn, user, order['space'])
    return order

def order_dict(row):
    result = dict(row)
    result['order_id'] = f"ORD-{row['seq']:06d}"
    return result

class Login(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=1024)

class WorkspaceMembers(BaseModel):
    member_ids: list[str] = Field(max_length=1000)

class OrderInput(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    number: str = Field(default='', max_length=60)
    client: str = Field(default='', max_length=160)
    quantity: int = Field(gt=0, le=1_000_000_000, strict=True)
    details: str = Field(default='', max_length=6000)
    priority: Literal['Low', 'Medium', 'High'] = 'Medium'
    due: str = ''
    assignee: str = ''
    image: str = Field(default='', max_length=2_900_000)

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError('Enter an order name')
        return value.strip()

    @field_validator('due')
    @classmethod
    def valid_date(cls, value):
        if value:
            datetime.strptime(value, '%Y-%m-%d')
        return value

    @field_validator('image')
    @classmethod
    def valid_image(cls, value):
        if not value:
            return value
        match = re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)', value)
        if not match:
            raise ValueError('Use a PNG, JPEG, or WebP image')
        try:
            raw = base64.b64decode(match[2], validate=True)
        except ValueError:
            raise ValueError('Invalid image data')
        if len(raw) > 2 * 1024 * 1024:
            raise ValueError('Image must be smaller than 2 MB')
        if not ((match[1] == 'png' and raw.startswith(b'\x89PNG\r\n\x1a\n')) or (match[1] == 'jpeg' and raw.startswith(b'\xff\xd8\xff')) or (match[1] == 'webp' and raw.startswith(b'RIFF') and raw[8:12] == b'WEBP')):
            raise ValueError('Image format does not match its contents')
        return value

class StatusInput(BaseModel):
    stage: Stage
    feedback: str = Field(default='', max_length=4000)
    estimated_finish: datetime | None = None
    reminder_at: datetime | None = None
    tracking_id: str = Field(default='', max_length=160)
    carrier: str = Field(default='', max_length=100)

    @field_validator('estimated_finish', 'reminder_at')
    @classmethod
    def valid_time(cls, value):
        if value and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError('Include a timezone')
        return value

class ReminderInput(BaseModel):
    action: Literal['complete', 'reschedule']
    remind_at: datetime | None = None

class MessageInput(BaseModel):
    text: str = Field(min_length=1, max_length=6000)
    @field_validator('text')
    @classmethod
    def nonempty(cls, value):
        if not value.strip():
            raise ValueError('Enter a message')
        return value.strip()

class SpaceInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default='', max_length=200)

class MemberInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(max_length=254)
    password: str = Field(min_length=10, max_length=1024)
    spaces: list[str] = Field(default_factory=list)

class AccessInput(BaseModel):
    spaces: list[str]

class AIInput(BaseModel):
    question: str = Field(min_length=1, max_length=6000)

SCHEMA = '''
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,role TEXT NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS memberships(user_id TEXT REFERENCES users(id),space_id TEXT REFERENCES spaces(id),PRIMARY KEY(user_id,space_id));
CREATE TABLE IF NOT EXISTS orders(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,space TEXT NOT NULL REFERENCES spaces(id),name TEXT NOT NULL,number TEXT DEFAULT '',client TEXT DEFAULT '',quantity INTEGER NOT NULL CHECK(quantity>0),stage TEXT NOT NULL,priority TEXT NOT NULL,due TEXT DEFAULT '',details TEXT DEFAULT '',assignee TEXT REFERENCES users(id),image TEXT DEFAULT '',art TEXT DEFAULT 'sage',created TEXT NOT NULL,updated TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS orders_space ON orders(space);
CREATE TABLE IF NOT EXISTS updates(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),author_id TEXT REFERENCES users(id),stage TEXT NOT NULL,feedback TEXT DEFAULT '',estimated_finish TEXT,tracking_id TEXT DEFAULT '',carrier TEXT DEFAULT '',created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS updates_order ON updates(order_id,created);
CREATE TABLE IF NOT EXISTS reminders(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),created_by TEXT REFERENCES users(id),remind_at TEXT NOT NULL,note TEXT DEFAULT '',completed INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS reminders_order ON reminders(order_id,completed,remind_at);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,space TEXT NOT NULL REFERENCES spaces(id),author_id TEXT REFERENCES users(id),author TEXT NOT NULL,text TEXT NOT NULL,created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS messages_space ON messages(space,created);
CREATE TABLE IF NOT EXISTS ai_messages(id TEXT PRIMARY KEY,space TEXT NOT NULL REFERENCES spaces(id),author_id TEXT REFERENCES users(id),role TEXT NOT NULL,text TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires REAL NOT NULL);
'''

def initialize(app, legacy_path):
    Path(app.state.db_path).parent.mkdir(parents=True, exist_ok=True)
    with connection(app) as conn:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.executescript(SCHEMA)
        if conn.execute("SELECT 1 FROM meta WHERE key='initialized'").fetchone():
            return
        legacy = json.loads(Path(legacy_path).read_text()) if legacy_path and Path(legacy_path).exists() else None
        if legacy:
            for user in legacy['users']:
                conn.execute('INSERT INTO users VALUES (?,?,?,?,?,?)', tuple(user[k] for k in ['id','name','email','role','salt','password']))
            for space in legacy['spaces']:
                conn.execute('INSERT INTO spaces VALUES (?,?,?)', (space['id'],space['name'],space.get('description','')))
            for user in legacy['users']:
                for space in user.get('spaces',[]):
                    if conn.execute('SELECT 1 FROM spaces WHERE id=?',(space,)).fetchone():
                        conn.execute('INSERT OR IGNORE INTO memberships VALUES (?,?)',(user['id'],space))
            admin_id = next(u['id'] for u in legacy['users'] if u['role']=='admin')
            for item in legacy['items']:
                fields = ['id','space','name','number','client','quantity','stage','priority','due','details','assignee','image','art','created']
                values = [item.get(k,'') for k in fields]
                values[10] = item.get('assignee') or admin_id
                conn.execute(f"INSERT INTO orders({','.join(fields)},updated) VALUES ({','.join('?' for _ in range(15))})", (*values, item.get('created') or now()))
                conn.execute('INSERT INTO updates(id,order_id,author_id,stage,feedback,created) VALUES (?,?,?,?,?,?)',(uid(),item['id'],values[10],item['stage'],'Existing order imported into Collective.',item.get('created') or now()))
            for message in legacy.get('messages',[]):
                conn.execute('INSERT INTO messages VALUES (?,?,?,?,?,?)',(message['id'],message['space'],None,message['author'],message['text'],message['created']))
            for activity in legacy.get('activities',[]):
                conn.execute('INSERT INTO messages VALUES (?,?,?,?,?,?)',(uid(),activity['space'],None,'Previous activity',activity['text'],activity['created']))
        else:
            salt=secrets.token_hex(16)
            admin_id=uid()
            password=os.environ.get('ADMIN_PASSWORD','1234')
            conn.execute('INSERT INTO users VALUES (?,?,?,?,?,?)',(admin_id,'Alex Morgan',os.environ.get('ADMIN_EMAIL','admin@gmail.com'),'admin',salt,password_hash(password,salt)))
            conn.executemany('INSERT INTO spaces VALUES (?,?,?)',[('packaging','Packaging studio','From the first idea to the final detail.'),('digital','Digital & IT','A little space for your next big idea.')])
        if not legacy:
            conn.executemany('INSERT INTO memberships VALUES (?,?)', [(admin_id, 'packaging'), (admin_id, 'digital')])
        conn.execute("INSERT INTO meta VALUES ('initialized',?)", (now(),))
    try:
        os.chmod(app.state.db_path, 0o600)
    except OSError:
        pass

def create_app(db_path=None, legacy_path=ROOT/'data/store.json'):
    @asynccontextmanager
    async def lifespan(instance):
        task=None
        if os.environ.get('COLLECTIVE_TEST')!='true' and os.environ.get('EMBEDDED_WORKER','true').lower()=='true':
            from .worker import run_worker
            task=asyncio.create_task(run_worker(instance))
        try:
            yield
        finally:
            if task:
                task.cancel()
                try: await task
                except asyncio.CancelledError: pass

    app=FastAPI(lifespan=lifespan,title='Collective',docs_url='/api/docs',openapi_url='/api/openapi.json',redoc_url=None)
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    if db_path is None:
        db_path = os.environ.get('DATABASE_PATH')
        if not db_path:
            bundled = ROOT/'data/collective.sqlite3'
            tmp_db = Path(tempfile.gettempdir())/'collective.sqlite3'
            try:
                # Test if project directory is writable
                candidate = ROOT/'data/collective.sqlite3'
                candidate.parent.mkdir(parents=True, exist_ok=True)
                marker = candidate.parent/'.collective-write-test'
                marker.write_text('writable', encoding='utf-8')
                marker.unlink()
                db_path = str(candidate)
            except OSError:
                # Serverless (read-only filesystem): copy bundled db to /tmp if not already there
                if bundled.exists() and not tmp_db.exists():
                    import shutil
                    shutil.copy2(bundled, tmp_db)
                db_path = str(tmp_db)
    app.state.db_path=str(db_path)
    app.state.login_attempts={}
    initialize(app,legacy_path)

    @app.middleware('http')
    async def security(request,call_next):
        origin=request.headers.get('origin')
        if request.method not in ('GET','HEAD','OPTIONS') and origin:
            # Build normalized effective origin considering reverse proxies (Vercel, etc.)
            proto = request.headers.get('x-forwarded-proto') or request.url.scheme
            host = request.headers.get('x-forwarded-host') or request.headers.get('host') or request.url.netloc
            effective_base = f"{proto}://{host}".rstrip('/')
            base_url = str(request.base_url).rstrip('/')

            allowed_origins = {
                effective_base,
                base_url,
                os.environ.get('DEV_ORIGIN'),
                'http://127.0.0.1:5173',
                'http://localhost:5173',
            }
            if origin != base_url and origin != effective_base and origin not in allowed_origins:
                # Also accept matching vercel.app domains and subdomains
                if not (origin.endswith('.vercel.app') and (host.endswith('.vercel.app') or host in origin)):
                    return JSONResponse({'detail':'Invalid request origin'},403)
        length=request.headers.get('content-length')
        if length and (not length.isdigit() or int(length)>3_200_000):
            return JSONResponse({'detail':'Request too large'},413)
        response=await call_next(request)
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='same-origin'
        response.headers['X-Frame-Options']='DENY'
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control']='no-store'
        else:
            response.headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
        return response

    def current_user(request:Request):
        token=request.cookies.get('session','')
        email=session_claims(token)
        with connection(app) as conn:
            user=conn.execute('SELECT * FROM users WHERE email=?',(email,)).fetchone() if email else None
        if not user:
            raise HTTPException(401,'Please sign in')
        return dict(user)

    def admin_user(user=Depends(current_user)):
        if user['role']!='admin':
            raise HTTPException(403,'Administrator access required')
        return user

    @app.get('/api/health')
    def health():
        return {'status':'ok','backend':'fastapi'}

    @app.post('/api/login')
    def login(payload:Login,request:Request,response:Response):
        key=request.client.host if request.client else 'local'
        cutoff,count=app.state.login_attempts.get(key,(time.time(),0))
        if time.time()-cutoff>600:
            cutoff,count=time.time(),0
        if count>=12:
            raise HTTPException(429,'Too many attempts. Try again in ten minutes.')
        app.state.login_attempts[key]=(cutoff,count+1)
        with connection(app) as conn:
            user=conn.execute('SELECT * FROM users WHERE email=?',(payload.email.strip().lower(),)).fetchone()
            if not user or not hmac.compare_digest(password_hash(payload.password,user['salt']),user['password']):
                raise HTTPException(401,'Incorrect email or password')
            expires=time.time()+86400*7
            token=signed_session(user['email'],expires)
        app.state.login_attempts.pop(key,None)
        response.set_cookie('session',token,httponly=True,samesite='strict',secure=os.environ.get('COOKIE_SECURE')=='true',max_age=86400*7)
        return {'ok':True}

    @app.post('/api/logout')
    def logout(request:Request,response:Response):
        response.delete_cookie('session')
        return {'ok':True}

    @app.get('/api/bootstrap')
    def bootstrap(user=Depends(current_user)):
        with connection(app) as conn:
            spaces=conn.execute('SELECT * FROM spaces ORDER BY rowid').fetchall() if user['role']=='admin' else conn.execute('SELECT spaces.* FROM spaces JOIN memberships ON memberships.space_id=spaces.id WHERE user_id=? ORDER BY spaces.rowid',(user['id'],)).fetchall()
        return {'user':{k:user[k] for k in ('id','name','email','role')},'spaces':[dict(s) for s in spaces],'ai_connected':bool(os.environ.get('GROQ_API_KEY'))}

    @app.get('/api/spaces/{space}/orders')
    def orders(space:str,user=Depends(current_user)):
        with connection(app) as conn:
            check_space(conn,user,space)
            result=[order_dict(r) for r in conn.execute('SELECT seq,id,space,name,number,client,quantity,stage,priority,due,details,assignee,art,created,updated,length(image)>0 AS has_image FROM orders WHERE space=? ORDER BY seq DESC',(space,))]
            latest={r['order_id']:dict(r) for r in conn.execute('SELECT * FROM updates WHERE rowid IN (SELECT MAX(updates.rowid) FROM updates JOIN orders ON updates.order_id=orders.id WHERE orders.space=? GROUP BY order_id)',(space,))}
            for order in result:
                order['has_image']=bool(order['has_image'])
                order['latest_update']=latest.get(order['id'])
            members=[dict(r) for r in conn.execute("SELECT DISTINCT users.id,users.name,users.email,users.role FROM users LEFT JOIN memberships ON memberships.user_id=users.id WHERE users.role='admin' OR memberships.space_id=?",(space,))]
            reminders=[dict(r) for r in conn.execute('SELECT reminders.*,orders.name,orders.seq FROM reminders JOIN orders ON reminders.order_id=orders.id WHERE orders.space=? AND completed=0 ORDER BY remind_at',(space,))]
        return {'orders':result,'members':members,'reminders':reminders}

    @app.get('/api/orders/{order_id}')
    def detail(order_id:str,user=Depends(current_user)):
        with connection(app) as conn:
            order=order_dict(get_order(conn,user,order_id))
            order['updates']=[dict(r) for r in conn.execute('SELECT updates.*,users.name AS author FROM updates LEFT JOIN users ON users.id=updates.author_id WHERE order_id=? ORDER BY created DESC,updates.rowid DESC',(order_id,))]
            order['reminders']=[dict(r) for r in conn.execute('SELECT * FROM reminders WHERE order_id=? ORDER BY remind_at',(order_id,))]
        return order

    @app.get('/api/orders/{order_id}/image')
    def order_image(order_id:str,user=Depends(current_user)):
        with connection(app) as conn:
            order=get_order(conn,user,order_id)
            if not order['image']:
                raise HTTPException(404,'No image')
            header,content=order['image'].split(',',1)
        return Response(base64.b64decode(content),media_type=header[5:].split(';')[0],headers={'Cache-Control':'private, no-store'})

    def validate_assignee(conn,user,space,assignee):
        assignee=assignee or user['id']
        member=conn.execute('SELECT * FROM users WHERE id=?',(assignee,)).fetchone()
        if not member:
            raise HTTPException(400,'Member not found')
        check_space(conn,dict(member),space)
        return assignee

    @app.post('/api/spaces/{space}/orders',status_code=201)
    def new_order(space:str,payload:OrderInput,user=Depends(current_user)):
        with connection(app) as conn:
            check_space(conn,user,space)
            values=payload.model_dump()
            values['assignee']=validate_assignee(conn,user,space,payload.assignee)
            order_id=uid()
            values.update(id=order_id,space=space,stage='Brief',art='sage',created=now(),updated=now())
            conn.execute(f"INSERT INTO orders({','.join(values)}) VALUES ({','.join('?' for _ in values)})",tuple(values.values()))
            conn.execute('INSERT INTO updates(id,order_id,author_id,stage,feedback,created) VALUES (?,?,?,?,?,?)',(uid(),order_id,user['id'],'Brief','Order created.',now()))
            result=order_dict(conn.execute('SELECT * FROM orders WHERE id=?',(order_id,)).fetchone())
        return result

    @app.put('/api/orders/{order_id}')
    def edit_order(order_id:str,payload:OrderInput,user=Depends(current_user)):
        with connection(app) as conn:
            order=get_order(conn,user,order_id)
            values=payload.model_dump()
            values['assignee']=validate_assignee(conn,user,order['space'],payload.assignee)
            values['updated']=now()
            conn.execute(f"UPDATE orders SET {','.join(k+'=?' for k in values)} WHERE id=?",(*values.values(),order_id))
        return {'ok':True}

    @app.post('/api/orders/{order_id}/updates',status_code=201)
    def add_update(order_id:str,payload:StatusInput,user=Depends(current_user)):
        if payload.reminder_at and payload.reminder_at<=datetime.now(timezone.utc):
            raise HTTPException(400,'Choose a reminder time in the future')
        with connection(app) as conn:
            get_order(conn,user,order_id)
            created=now()
            conn.execute('INSERT INTO updates VALUES (?,?,?,?,?,?,?,?,?)',(uid(),order_id,user['id'],payload.stage,payload.feedback,payload.estimated_finish.astimezone(timezone.utc).isoformat() if payload.estimated_finish else None,payload.tracking_id.strip(),payload.carrier.strip(),created))
            conn.execute('UPDATE orders SET stage=?,updated=? WHERE id=?',(payload.stage,created,order_id))
            if payload.reminder_at:
                conn.execute('INSERT INTO reminders VALUES (?,?,?,?,?,?,?)',(uid(),order_id,user['id'],payload.reminder_at.astimezone(timezone.utc).isoformat(),payload.feedback or f'Follow up on {payload.stage.lower()}',0,created))
        return {'ok':True}

    @app.post('/api/reminders/{reminder_id}')
    def reminder(reminder_id:str,payload:ReminderInput,user=Depends(current_user)):
        with connection(app) as conn:
            reminder=conn.execute('SELECT * FROM reminders WHERE id=?',(reminder_id,)).fetchone()
            if not reminder:
                raise HTTPException(404,'Reminder not found')
            get_order(conn,user,reminder['order_id'])
            if payload.action=='complete':
                conn.execute('UPDATE reminders SET completed=1 WHERE id=?',(reminder_id,))
            else:
                if not payload.remind_at or payload.remind_at.tzinfo is None or payload.remind_at<=datetime.now(timezone.utc):
                    raise HTTPException(400,'Choose a reminder time in the future, with a timezone')
                conn.execute('UPDATE reminders SET completed=0,remind_at=? WHERE id=?',(payload.remind_at.astimezone(timezone.utc).isoformat(),reminder_id))
        return {'ok':True}

    @app.get('/api/spaces/{space}/messages')
    def messages(space:str,user=Depends(current_user)):
        with connection(app) as conn:
            check_space(conn,user,space)
            return [dict(r) for r in conn.execute('SELECT * FROM messages WHERE space=? ORDER BY created,rowid',(space,))]

    @app.post('/api/spaces/{space}/messages',status_code=201)
    def send_message(space:str,payload:MessageInput,user=Depends(current_user)):
        with connection(app) as conn:
            check_space(conn,user,space)
            conn.execute('INSERT INTO messages VALUES (?,?,?,?,?,?)',(uid(),space,user['id'],user['name'],payload.text,now()))
        return {'ok':True}

    @app.get('/api/admin')
    def admin_state(user=Depends(admin_user)):
        with connection(app) as conn:
            users=[dict(r) for r in conn.execute('SELECT id,name,email,role FROM users')]
            for member in users:
                member['spaces']=[r[0] for r in conn.execute('SELECT space_id FROM memberships WHERE user_id=?',(member['id'],))]
            return {'users':users,'spaces':[dict(r) for r in conn.execute('SELECT * FROM spaces')]}

    @app.post('/api/admin/spaces',status_code=201)
    def create_space(payload:SpaceInput,user=Depends(admin_user)):
        if not payload.name.strip():
            raise HTTPException(400,'Enter a workspace name')
        with connection(app) as conn:
            space_id=uid()
            conn.execute('INSERT INTO spaces VALUES (?,?,?)',(space_id,payload.name.strip(),payload.description))
            conn.execute('INSERT INTO memberships VALUES (?,?)',(user['id'],space_id))
        return {'ok':True,'id':space_id}

    @app.delete('/api/admin/spaces/{space}')
    def delete_space(space:str,user=Depends(admin_user)):
        with connection(app) as conn:
            if not conn.execute('SELECT 1 FROM spaces WHERE id=?',(space,)).fetchone():
                raise HTTPException(404,'Workspace not found')
            conn.execute('DELETE FROM notification_jobs WHERE notification_id IN (SELECT id FROM notifications WHERE space=?)',(space,))
            conn.execute('DELETE FROM notifications WHERE space=?',(space,))
            conn.execute('DELETE FROM deadline_deliveries WHERE task_id IN (SELECT id FROM tasks WHERE space=?)',(space,))
            conn.execute('DELETE FROM task_activity WHERE task_id IN (SELECT id FROM tasks WHERE space=?)',(space,))
            conn.execute('DELETE FROM tasks WHERE space=?',(space,))
            conn.execute('DELETE FROM projects WHERE space=?',(space,))
            conn.execute('UPDATE message_meta SET run_id=NULL WHERE run_id IN (SELECT id FROM personal_runs WHERE space=?)',(space,))
            conn.execute('UPDATE message_meta SET parent_id=NULL WHERE parent_id IN (SELECT id FROM messages WHERE space=?)',(space,))
            conn.execute('UPDATE personal_runs SET parent_id=NULL WHERE parent_id IN (SELECT id FROM messages WHERE space=?)',(space,))
            conn.execute('DELETE FROM action_receipts WHERE run_id IN (SELECT id FROM personal_runs WHERE space=?)',(space,))
            conn.execute('DELETE FROM task_drafts WHERE run_id IN (SELECT id FROM personal_runs WHERE space=?)',(space,))
            conn.execute('DELETE FROM private_turns WHERE run_id IN (SELECT id FROM personal_runs WHERE space=?)',(space,))
            conn.execute('DELETE FROM personal_runs WHERE space=?',(space,))
            conn.execute('DELETE FROM message_meta WHERE message_id IN (SELECT id FROM messages WHERE space=?)',(space,))
            conn.execute('DELETE FROM messages WHERE space=?',(space,))
            conn.execute('DELETE FROM ai_message_actions WHERE message_id IN (SELECT id FROM ai_messages WHERE space=?)',(space,))
            conn.execute('DELETE FROM ai_receipts WHERE space=? OR run_id IN (SELECT id FROM ai_runs WHERE space=?)',(space,space))
            conn.execute('DELETE FROM ai_runs WHERE space=?',(space,))
            conn.execute('DELETE FROM ai_messages WHERE space=?',(space,))
            conn.execute('DELETE FROM updates WHERE order_id IN (SELECT id FROM orders WHERE space=?)',(space,))
            conn.execute('DELETE FROM reminders WHERE order_id IN (SELECT id FROM orders WHERE space=?)',(space,))
            conn.execute('DELETE FROM orders WHERE space=?',(space,))
            conn.execute('DELETE FROM memberships WHERE space_id=?',(space,))
            conn.execute('DELETE FROM spaces WHERE id=?',(space,))
        return {'ok':True}

    @app.put('/api/admin/spaces/{space}/members')
    def workspace_members(space:str,payload:WorkspaceMembers,user=Depends(admin_user)):
        with connection(app) as conn:
            check_space(conn,user,space)
            members=set(payload.member_ids)
            for member_id in members:
                if not conn.execute('SELECT 1 FROM users WHERE id=?',(member_id,)).fetchone():
                    raise HTTPException(400,'Account not found')
            conn.execute('DELETE FROM memberships WHERE space_id=?',(space,))
            conn.executemany('INSERT INTO memberships VALUES (?,?)',[(member_id,space) for member_id in members])
        return {'ok':True}

    @app.post('/api/admin/members',status_code=201)
    def create_member(payload:MemberInput,user=Depends(admin_user)):
        email=payload.email.strip().lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email) or not payload.name.strip():
            raise HTTPException(400,'Enter a name and valid email address')
        with connection(app) as conn:
            if conn.execute('SELECT 1 FROM users WHERE email=?',(email,)).fetchone():
                raise HTTPException(409,'This email already has an account')
            for space in payload.spaces:
                check_space(conn,user,space)
            salt=secrets.token_hex(16)
            member_id=uid()
            conn.execute('INSERT INTO users VALUES (?,?,?,?,?,?)',(member_id,payload.name.strip(),email,'member',salt,password_hash(payload.password,salt)))
            conn.executemany('INSERT INTO memberships VALUES (?,?)',[(member_id,s) for s in set(payload.spaces)])
        return {'ok':True}

    @app.put('/api/admin/members/{member_id}/access')
    def update_access(member_id:str,payload:AccessInput,user=Depends(admin_user)):
        with connection(app) as conn:
            member=conn.execute('SELECT * FROM users WHERE id=?',(member_id,)).fetchone()
            if not member:
                raise HTTPException(400,'Select an account')
            for space in payload.spaces:
                check_space(conn,user,space)
            conn.execute('DELETE FROM memberships WHERE user_id=?',(member_id,))
            conn.executemany('INSERT INTO memberships VALUES (?,?)',[(member_id,s) for s in set(payload.spaces)])
        return {'ok':True}

    from .work import register_work
    service = register_work(app,current_user,{'update_order_status':add_update,'send_team_message':send_message,'update_reminder':reminder})
    from .personal import register_personal
    register_personal(app, current_user, service)

    dist=ROOT/'dist'
    if (dist/'assets').exists():
        app.mount('/assets',StaticFiles(directory=dist/'assets'),name='assets')

    @app.get('/{asset}')
    def pwa_asset(asset:str):
        if asset not in {'manifest.webmanifest','sw.js','icon-192.png','icon-512.png'}:
            raise HTTPException(404,'Not found')
        return FileResponse(ROOT/'public'/asset, headers={'Cache-Control':'no-cache'})

    @app.get('/')
    def frontend():
        if not (dist/'index.html').exists():
            return JSONResponse({'detail':'Build the React frontend with npm run build, or use npm run dev.'},503)
        return FileResponse(dist/'index.html')
    return app

app=create_app() if os.environ.get('COLLECTIVE_TEST')!='true' else None
