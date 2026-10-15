/** Opt-in authenticated HTTP management for function-first marketing campaigns.
 * Does not expose provider credentials, per-contact JSON, or unbounded recipient lists. */
import type {MarketingCampaignService,MarketingCampaignInput,MarketingRecipient} from './marketing.js';

export interface MarketingCampaignDashboardOptions {
  service:MarketingCampaignService;
  authorize:(request:Request)=>unknown|Promise<unknown>;
  authorizeCampaign:(principal:unknown,code:string,action:'read'|'recipients'|'preview'|'append'|'enqueue'|'pause'|'resume'|'cancel'|'redrive'|'schedule'|'archive'|'finalize'|'export')=>boolean|Promise<boolean>;
  /** Creation is a separate permission because a code does not yet exist. */
  authorizeCreate:(principal:unknown)=>boolean|Promise<boolean>;
  /** Listing is only available when the entire campaign namespace is authorized. */
  authorizeList?:(principal:unknown)=>boolean|Promise<boolean>;
  verifyCsrf:(request:Request,principal:unknown)=>boolean|Promise<boolean>;
  csrfToken:(request:Request,principal:unknown)=>string|Promise<string>;
  prefix?:string;publicOrigin?:string;
}
const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-frame-options':'DENY','x-content-type-options':'nosniff','vary':'Cookie',
  'content-security-policy':"default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...headers,'content-type':'application/json; charset=utf-8'}});
const html=(value:string)=>new Response(value,{headers:{...headers,'content-type':'text/html; charset=utf-8'}});
const validCode=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(v);
const safe=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
async function readBody(request:Request){
  if(!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type')??''))throw new TypeError('JSON body required');
  const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>131_072))throw new RangeError('Body too large');
  const reader=request.body?.getReader();if(!reader)throw new TypeError('Body required');
  const chunks:Uint8Array[]=[];let size=0,expired=false;
  const timeout=setTimeout(()=>{expired=true;void reader.cancel().catch(()=>{});},5000);timeout.unref?.();
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>131_072){await reader.cancel().catch(()=>{});throw new RangeError('Body too large');}chunks.push(value);
  }}finally{clearTimeout(timeout);reader.releaseLock();}
  if(expired)throw new Error('Body timed out');
  const raw=JSON.parse(Buffer.concat(chunks.map(v=>Buffer.from(v))).toString('utf8')) as unknown;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('JSON object required');
  return raw as Record<string,unknown>;
}
const css='body{font:16px system-ui,sans-serif;max-width:900px;margin:24px auto;padding:16px;color:#17212d;background:#f8fafc}main{display:grid;gap:14px}section{padding:16px;background:white;border:1px solid #cbd5e1;border-radius:8px}label{display:block;margin:8px}input,textarea{max-width:90%;padding:8px;margin:8px}textarea{width:85%}button{padding:9px;margin:4px;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere}#status{min-height:24px}';
const js=String.raw`'use strict';
const root=document.currentScript.dataset.root,csrf=document.querySelector('meta[name="csrf"]').content;
const $=id=>document.getElementById(id),message=s=>{$('status').textContent=s},show=v=>{$('result').textContent=JSON.stringify(v,null,2)};
let lastView='',nextCursor=null;
async function call(action,method='GET',body,paginate=false){
 const params=new URLSearchParams({code:$('code').value,view:action});
 if(method==='GET'){params.set('limit','10');if(paginate&&nextCursor)params.set('cursor',nextCursor);}
 const response=await fetch(root+'/api?'+params,{method,credentials:'same-origin',headers:body?{'content-type':'application/json','x-csrf-token':csrf}:{},body:body?JSON.stringify({action,...body}):undefined});
 const value=await response.json();if(!response.ok)throw Error(value.error||'Request failed');
 if(method==='GET'){lastView=action;nextCursor=value.nextCursor??null;}return value;
}
$('load').onclick=async()=>{try{show(await call('overview'));message('Campaign loaded')}catch(e){message(e.message)}};
$('recipients').onclick=async()=>{try{show(await call('recipients'));message('Bounded recipient list loaded')}catch(e){message(e.message)}};
$('previews').onclick=async()=>{try{show(await call('previews'));message('Recipient previews loaded')}catch(e){message(e.message)}};
$('nextPage').onclick=async()=>{if(!lastView||!nextCursor){message('No more pages');return;}try{show(await call(lastView,'GET',undefined,true));message('Next page loaded')}catch(e){message(e.message)}};
$('report').onclick=async()=>{try{show(await call('report'));message('Delivery state report page loaded')}catch(e){message(e.message)}};
$('export').onclick=async()=>{try{show(await call('export'));message('Redacted campaign export page loaded')}catch(e){message(e.message)}};
$('list').onclick=async()=>{try{show(await call('list'));message('Campaign list loaded')}catch(e){message(e.message)}};
$('create').onclick=async()=>{try{
 const content=$('content').value;const emails=$('emails').value.split(/[\s,]+/).filter(Boolean);
 const input={name:$('name').value,subject:$('subject').value,content,providers:[$('account').value],emails,isTracking:$('tracking').checked,autoEnqueue:false};
 const response=await call('create','POST',{input});$('code').value=response.code;show(response);message('Campaign stored; use Enqueue to schedule delivery');
 }catch(e){message(e.message)}};
$('schedule').onclick=async()=>{try{const sendAt=Date.parse($('sendAt').value);if(!Number.isSafeInteger(sendAt))throw Error('Select a valid schedule');show(await call('schedule','POST',{code:$('code').value,sendAt}));message('Schedule updated')}catch(e){message(e.message)}};
for(const action of ['enqueue','pause','resume','cancel','redrive','finalize','archive'])$(action).onclick=async()=>{try{show(await call(action,'POST',{code:$('code').value}));message(action+' completed')}catch(e){message(e.message)}};
`;
export function createMarketingCampaignDashboard(options:MarketingCampaignDashboardOptions){
  if(!options||!options.service||!['get','list','recipients','previewPage','appendRecipients','enqueue','pause','resume','cancel','redrivePending','create','overview','schedule','archive','finalize','exportPage','report'].every(k=>typeof (options.service as any)[k]==='function')||
    !['authorize','authorizeCampaign','authorizeCreate','verifyCsrf','csrfToken'].every(k=>typeof (options as any)[k]==='function'))throw new TypeError('Marketing dashboard requires a campaign service and host authorization');
  const prefix=options.prefix??'/_email/marketing';
  if(!/^\/[A-Za-z0-9/_-]{2,100}$/.test(prefix)||prefix.includes('//')||prefix.endsWith('/')||prefix.includes('..'))throw new TypeError('Invalid dashboard route');
  let origin:string|undefined;
  if(options.publicOrigin){const url=new URL(options.publicOrigin);
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new TypeError('Invalid dashboard origin');origin=url.origin;
  }
  async function handle(request:Request):Promise<Response>{
    if(request.method!=='GET'&&request.method!=='POST')return json({error:'Method not allowed'},405);
    let principal:unknown;try{principal=await options.authorize(request);}catch{return json({error:'Forbidden'},403);}
    if(principal===true||principal===false||principal===null||principal===undefined)return json({error:'Forbidden'},403);
    const url=new URL(request.url);const suffix=url.pathname.slice(prefix.length);
    if(suffix===''&&request.method==='GET'){
      let token:string;try{token=await options.csrfToken(request,principal);}catch{return json({error:'Forbidden'},403);}
      if(typeof token!=='string'||token.length<16||token.length>512)return json({error:'Forbidden'},403);
      return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="csrf" content="${safe(token)}"><link rel="stylesheet" href="${prefix}/app.css"><title>Zerux Marketing Campaigns</title></head><body><main><h1>Marketing campaigns</h1><p>Create one reusable template and queue recipient-specific renders without duplicating content. All actions require host authorization.</p><section><label>Campaign code <input id="code" maxlength="96"></label><button id="load">Overview</button><button id="list">List</button><button id="recipients">Recipients</button><button id="previews">Previews</button><button id="export">Redacted export</button><button id="report">Delivery report</button><button id="nextPage">Next page</button></section><section><h2>New campaign</h2><label>Name <input id="name" maxlength="120"></label><label>Subject <input id="subject" maxlength="998"></label><label>Account <input id="account"></label><label>Recipient emails, comma or newline separated <textarea id="emails" rows="4"></textarea></label><label>HTML content <textarea id="content" rows="7"></textarea></label><label><input id="tracking" type="checkbox"> Enable email tracking</label><button id="create">Create draft</button></section><section><label>Schedule (local time) <input id="sendAt" type="datetime-local"></label><button id="schedule">Schedule</button><button id="enqueue">Enqueue</button><button id="redrive">Redrive pending</button><button id="pause">Pause</button><button id="resume">Resume</button><button id="cancel">Cancel</button><button id="finalize">Finalize completed</button><button id="archive">Archive</button></section><p id="status" role="status"></p><section><h2>Results</h2><pre id="result"></pre></section></main><script defer src="${prefix}/app.js" data-root="${prefix}"></script></body></html>`);
    }
    if(suffix==='/app.js'&&request.method==='GET')return new Response(js,{headers:{...headers,'content-type':'text/javascript; charset=utf-8'}});
    if(suffix==='/app.css'&&request.method==='GET')return new Response(css,{headers:{...headers,'content-type':'text/css; charset=utf-8'}});
    if(suffix!=='/api')return json({error:'Not found'},404);
    let action:string,code:unknown,input:Record<string,unknown>|undefined;
    if(request.method==='GET'){
      action=url.searchParams.get('view')??'overview';code=url.searchParams.get('code');
    }else{
      if(request.headers.get('origin')!==(origin??url.origin)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Invalid origin'},403);
      try{if(await options.verifyCsrf(request,principal)!==true)return json({error:'Forbidden'},403);}catch{return json({error:'Forbidden'},403);}
      try{input=await readBody(request);}catch{return json({error:'Invalid request body'},400);}
      action=String(input.action??'');code=input.code;
    }
    const service=options.service;
    if(action==='list'&&request.method==='GET'){
      if(!options.authorizeList)return json({error:'Forbidden'},403);
      try{if(await options.authorizeList(principal)!==true)return json({error:'Forbidden'},403);}catch{return json({error:'Forbidden'},403);}
      const limit=Math.min(50,Math.max(1,Number(url.searchParams.get('limit')??25)));
      if(!Number.isSafeInteger(limit))return json({error:'Invalid page size'},400);
      try{const list=await service.list({cursor:url.searchParams.get('cursor'),limit});
        return json({campaigns:list.campaigns.map(c=>({code:c.code,name:c.name,status:c.status,createdAt:c.createdAt,recipientCount:c.recipientCount})),nextCursor:list.nextCursor,done:list.done});
      }catch{return json({error:'Campaign listing unavailable'},503);}
    }
    if(action==='create'&&request.method==='POST'){
      try{if(await options.authorizeCreate(principal)!==true)return json({error:'Forbidden'},403);}catch{return json({error:'Forbidden'},403);}
      const candidate=input?.input;
      if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))return json({error:'Campaign definition required'},400);
      const value=candidate as MarketingCampaignInput;
      if((value.recipients??value.emails??[]).length>100)return json({error:'Use server-side streaming import for larger audiences'},400);
      try{return json({code:await service.create(value)},201);}catch{return json({error:'Campaign creation failed'},409);}
    }
    if(!validCode(code))return json({error:'Invalid campaign code'},400);
    const permission:MarketingCampaignDashboardOptions['authorizeCampaign'] extends (p:any,id:any,a:infer A)=>any?A:never=
      action==='recipients'?'recipients':action==='previews'?'preview':action==='append'?'append':action==='enqueue'?'enqueue':
      action==='redrive'?'redrive':action==='schedule'?'schedule':action==='archive'?'archive':action==='finalize'?'finalize':action==='export'?'export':action==='pause'?'pause':action==='resume'?'resume':action==='cancel'?'cancel':'read';
    try{if(await options.authorizeCampaign(principal,code,permission)!==true)return json({error:'Forbidden'},403);}catch{return json({error:'Forbidden'},403);}
    try{
      if(request.method==='GET'){
        if(action==='overview')return json(await service.overview(code));
        if(action==='template'){
          const c=await service.get(code);return c?json({code:c.code,name:c.name,subject:c.subject,html:c.html,text:c.text,status:c.status,trackingEnabled:c.tracking.enabled===true}):json({error:'Not found'},404);
        }
        const limit=Math.min(action==='previews'?20:100,Number(url.searchParams.get('limit')??10));
        if(!Number.isSafeInteger(limit)||limit<1)return json({error:'Invalid page size'},400);
        const cursor=url.searchParams.get('cursor');
        if(action==='report')return json(await service.report(code,{cursor,limit}));
        if(action==='export'){
          const result=await service.exportPage(code,{cursor,limit});
          return json(result);
        }
        if(action==='previews'){
          const r=await service.previewPage(code,{cursor,limit});
          return json({items:r.items.map(v=>({subject:v.subject,html:v.html,text:v.text,recipient:v.recipient,trackingEnabled:v.trackingEnabled})),nextCursor:r.nextCursor,done:r.done});
        }
        if(action==='recipients'){
          const r=await service.recipients(code,{cursor,limit});
          return json({recipients:r.recipients.map(v=>({email:v.email,name:v.name,deliveryState:v.deliveryState})),nextCursor:r.nextCursor,done:r.done});
        }
        return json({error:'Unknown view'},400);
      }
      if(action==='schedule'){if(typeof input?.sendAt!=='number')return json({error:'Absolute sendAt milliseconds required'},400);
        return json(await service.schedule(code,input.sendAt));}
      if(action==='finalize')return json(await service.finalize(code));
      if(action==='archive')return json({status:(await service.archive(code)).status});
      if(action==='enqueue')return json(await service.enqueue(code));
      if(action==='redrive')return json(await service.redrivePending(code));
      if(action==='pause')return json({status:(await service.pause(code)).status});
      if(action==='resume')return json({status:(await service.resume(code)).status});
      if(action==='cancel')return json({status:(await service.cancel(code)).status});
      if(action==='append'){
        const entries=input?.recipients;
        if(!Array.isArray(entries)||entries.length<1||entries.length>100)return json({error:'Append 1..100 recipients per HTTP request'},400);
        return json(await service.appendRecipients(code,entries as MarketingRecipient[],false));
      }
      return json({error:'Unknown action'},400);
    }catch{return json({error:'Campaign action failed or store unavailable'},409);}
  }
  return {prefix,handle,routes:()=>[{pattern:prefix,handler:handle},{pattern:`${prefix}/api`,handler:handle},{pattern:`${prefix}/app.js`,handler:handle},{pattern:`${prefix}/app.css`,handler:handle}]};
}
