import {timingSafeEqual} from 'node:crypto';
import type {QueueOperations, QueueJobState} from './index.js';

export interface QueueDashboardOptions {
  /** Explicit trusted app-session authenticator. Return a server-issued principal, never request fields. */
  authorize:(request:Request)=>unknown|Promise<unknown>;
  /** Validate a per-session CSRF header using server-side state. No default bypass. */
  verifyCsrf:(request:Request,principal:unknown)=>boolean|Promise<boolean>;
  /** Return the matching session CSRF token for the rendered dashboard. */
  csrfToken:(request:Request,principal:unknown)=>string|Promise<string>;
  prefix?:string;
  /** Canonical public origin when proxied. POST Origin must match this exactly. */
  publicOrigin?:string;
}
const headers:Record<string,string>={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','vary':'Cookie'};
const security={...headers,'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...security,'content-type':'application/json; charset=utf-8'}});
const page=(content:string,type:string)=>new Response(content,{status:200,headers:{...security,'content-type':type}});
const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const validPrefix=(s:string)=>/^\/[A-Za-z0-9/_-]{1,100}$/.test(s)&&!s.includes('//')&&!s.endsWith('/')&&!s.includes('..');
async function smallJson(request:Request):Promise<Record<string,unknown>>{
  if(!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type')??''))throw new TypeError('Expected application/json');
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>4096))throw new RangeError('Request body too large');
  if(!request.body)throw new TypeError('Request body missing');
  const reader=request.body.getReader();let size=0;const parts:Uint8Array[]=[];let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;void reader.cancel().catch(()=>{});},5000);timer.unref?.();
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel().catch(()=>{});throw new RangeError('Request body too large');}parts.push(value);}}
  finally{clearTimeout(timer);reader.releaseLock();}
  if(timedOut)throw new Error('Request body timed out');
  const value=JSON.parse(Buffer.concat(parts.map(part=>Buffer.from(part))).toString('utf8')) as unknown;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Invalid request body');
  return value as Record<string,unknown>;
}
const script=String.raw`'use strict';
const base=document.currentScript?.getAttribute('data-base')||location.pathname.replace(/\/app\.js$/,'');
const token=document.querySelector('meta[name="csrf-token"]')?.content||'';
const $=id=>document.getElementById(id);
let selected='';
function item(tag,txt){const el=document.createElement(tag);el.textContent=String(txt);return el;}
async function api(url,method='GET',body){const res=await fetch(base+'/api'+url,{method,credentials:'same-origin',headers:body?{'content-type':'application/json','x-csrf-token':token}:{},body:body?JSON.stringify(body):undefined});const data=await res.json();if(!res.ok)throw Error(data.error||'Request failed');return data;}
function info(message){$('notice').textContent=message;}
async function show(){try{const result=await api('?kind=queues');const dropdown=$('queues');const before=dropdown.value;dropdown.replaceChildren();for(const row of result.queues){const opt=item('option',row.name);opt.value=row.name;dropdown.append(opt);}dropdown.value=result.queues.some(q=>q.name===before)?before:result.queues[0]?.name||'';selected=dropdown.value;const counts=$('counts');counts.replaceChildren();const current=result.queues.find(q=>q.name===selected);for(const [k,v] of Object.entries(current?.counts||{})){const div=document.createElement('div');div.className='stat';div.append(item('span',k),item('strong',v));counts.append(div);}await jobs();info('Last refreshed '+new Date().toLocaleTimeString());}catch(error){info(error.message);}}
async function jobs(){if(!selected){$('jobs').replaceChildren();return;}try{const state=$('state').value;const result=await api('?kind=jobs&queue='+encodeURIComponent(selected)+'&state='+encodeURIComponent(state));const tbody=$('jobs');tbody.replaceChildren();for(const job of result.jobs){const tr=document.createElement('tr');for(const text of [job.id,job.name,job.state,job.attemptsMade,job.finishedOn?new Date(job.finishedOn).toLocaleString():'—'])tr.append(item('td',text));const td=document.createElement('td');if(job.state==='failed'){const button=item('button','Retry');button.onclick=()=>act('retry',job.id);td.append(button);}tr.append(td);tbody.append(tr);} }catch(error){info(error.message);}}
async function act(action,id){if(!selected)return;const label=action==='retry'?'Retry this failed job?':action.replace('-',' ')+' on '+selected+'?';if(!confirm(label))return;try{await api('','POST',{action,queue:selected,...(id?{id}:{})});info('Operation completed');await show();}catch(error){info(error.message);}}
document.addEventListener('DOMContentLoaded',()=>{$('refresh').onclick=show;$('queues').onchange=show;$('state').onchange=jobs;for(const button of document.querySelectorAll('[data-action]'))button.onclick=()=>act(button.dataset.action);show();});`;
const css=String.raw`body{font:15px system-ui,sans-serif;max-width:1100px;margin:30px auto;padding:0 20px;color:#162334;background:#f6f8fb}h1{font-size:28px}main{display:grid;gap:20px}section{background:#fff;border:1px solid #dce2e9;border-radius:12px;padding:18px;overflow-x:auto}button,select{padding:8px 12px;margin:3px;border:1px solid #bbc6d3;border-radius:6px;background:white;cursor:pointer}button:hover{background:#e9f0fc}button:focus-visible,select:focus-visible{outline:3px solid #2365d1}.stats{display:flex;flex-wrap:wrap;gap:12px}.stat{display:grid;border:1px solid #e1e6ed;border-radius:8px;padding:10px;min-width:86px}.stat strong{font-size:22px}table{width:100%;border-collapse:collapse}td,th{padding:9px;text-align:left;border-bottom:1px solid #e1e6ed;overflow-wrap:anywhere}#notice{min-height:24px}`;
/** Not publicly enabled: host must provide both a session authenticator and CSRF integration. */
export function createQueueDashboard(service:{names():string[];operations:QueueOperations},config:QueueDashboardOptions){
  if(!config||typeof config.authorize!=='function'||typeof config.verifyCsrf!=='function'||typeof config.csrfToken!=='function')throw new TypeError('Dashboard requires session authentication and CSRF callbacks');
  const prefix=config.prefix??'/_queue/admin';if(!validPrefix(prefix))throw new TypeError('Invalid queue dashboard prefix');
  let publicOrigin:string|undefined;
  if(config.publicOrigin){const parsed=new URL(config.publicOrigin);if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw new TypeError('Invalid dashboard public origin');publicOrigin=parsed.origin;}
  async function handle(request:Request){
    if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed'},405);
    let principal:unknown;
    try{principal=await config.authorize(request);}catch{return json({error:'Forbidden'},403);}
    if(principal===undefined||principal===null||principal===false||principal===true)return json({error:'Forbidden'},403);
    const u=new URL(request.url),suffix=u.pathname.slice(prefix.length);
    if(suffix===''&&request.method==='GET'){
      let token:string;
      try{token=await config.csrfToken(request,principal);}catch{return json({error:'Forbidden'},403);}
      if(typeof token!=='string'||token.length<16||token.length>512)return json({error:'Forbidden'},403);
      return page(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="csrf-token" content="${escapeHtml(token)}"><link rel="stylesheet" href="${prefix}/app.css"><title>Zerux Queue Operations</title></head><body><main><h1>Queue operations</h1><p>Only redacted job metadata is displayed. Changes require session authorization and CSRF verification.</p><section><label>Queue <select id="queues"></select></label><button id="refresh">Refresh</button><p id="notice" role="status"></p><div id="counts" class="stats"></div></section><section><h2>Worker controls</h2><button data-action="pause-queue">Pause queue</button><button data-action="resume-queue">Resume queue</button><button data-action="pause-worker">Pause local worker</button><button data-action="resume-worker">Resume local worker</button></section><section><h2>Jobs</h2><label>State <select id="state"><option value="failed">Failed</option><option value="waiting">Waiting</option><option value="active">Active</option><option value="delayed">Delayed</option><option value="completed">Completed</option></select></label><table><thead><tr><th>ID</th><th>Job</th><th>State</th><th>Attempts</th><th>Finished</th><th>Action</th></tr></thead><tbody id="jobs"></tbody></table></section></main><script defer src="${prefix}/app.js" data-base="${prefix}"></script></body></html>`,'text/html; charset=utf-8');
    }
    if(suffix==='/app.js'&&request.method==='GET')return page(script,'text/javascript; charset=utf-8');
    if(suffix==='/app.css'&&request.method==='GET')return page(css,'text/css; charset=utf-8');
    if(suffix!=='/api')return json({error:'Not found'},404);
    if(request.method==='GET'){
      const kind=u.searchParams.get('kind');
      if(kind==='queues'){
        const rows=[];
        for(const name of service.names())try{rows.push({name,...await service.operations.status(name,principal)});}catch{/* Never expose unauthorized queue names */}
        return json({queues:rows});
      }
      if(kind==='jobs'){
        const queue=u.searchParams.get('queue')??'',state=u.searchParams.get('state')??'failed';
        try{return json(await service.operations.inspect(queue,{states:[state as QueueJobState],limit:25},principal));}
        catch{return json({error:'Not authorized or invalid query'},403);}
      }
      return json({error:'Invalid query'},400);
    }
    const origin=request.headers.get('origin');
    if(!origin||origin!==(publicOrigin??u.origin)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Invalid request origin'},403);
    try{
      const provided=request.headers.get('x-csrf-token');
      const expected=await config.csrfToken(request,principal);
      if(typeof provided!=='string'||typeof expected!=='string'||provided.length<16||provided.length>512||
        Buffer.byteLength(provided)!==Buffer.byteLength(expected)||
        !timingSafeEqual(Buffer.from(provided),Buffer.from(expected))||
        await config.verifyCsrf(request,principal)!==true)return json({error:'CSRF verification failed'},403);
    }catch{return json({error:'CSRF verification failed'},403);}
    let body:Record<string,unknown>;
    try{body=await smallJson(request);}catch{return json({error:'Invalid request body'},400);}
    const queue=body.queue,action=body.action,id=body.id;
    if(typeof queue!=='string'||typeof action!=='string')return json({error:'Invalid operation'},400);
    try{
      const operations:QueueOperations=service.operations;
      if(action==='retry'){if(typeof id!=='string')return json({error:'Missing job ID'},400);await operations.retryFailed(queue,id,principal);}
      else if(action==='pause-queue')await operations.pauseQueue(queue,principal);
      else if(action==='resume-queue')await operations.resumeQueue(queue,principal);
      else if(action==='pause-worker')await operations.pauseWorker(queue,principal);
      else if(action==='resume-worker')await operations.resumeWorker(queue,principal);
      else return json({error:'Invalid operation'},400);
      return json({ok:true});
    }catch{return json({error:'Operation rejected or unavailable'},403);}
  }
  return {routes:()=>[
    {pattern:prefix,handler:handle},
    {pattern:prefix+'/api',handler:handle},
    {pattern:prefix+'/app.js',handler:handle},
    {pattern:prefix+'/app.css',handler:handle}
  ]};
}
