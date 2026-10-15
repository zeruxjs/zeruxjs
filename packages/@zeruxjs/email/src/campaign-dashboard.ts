import type {CampaignPlanner,CampaignDefinition} from './campaigns.js';
export interface CampaignDashboardOptions {
  planner:CampaignPlanner;
  authorize:(request:Request)=>unknown|Promise<unknown>;
  verifyCsrf:(request:Request,principal:unknown)=>boolean|Promise<boolean>;
  csrfToken:(request:Request,principal:unknown)=>string|Promise<string>;
  /** Mandatory per-campaign access check (tenant and role separation). */
  authorizeCampaign:(principal:unknown,id:string,action:string)=>boolean|Promise<boolean>;
  /** Optional bounded, PII-free campaign delivery summary provider. Must be tenant scoped by authorizeCampaign. */
  deliveryReport?:(campaignId:string)=>Promise<unknown>;
  /** Exact database-native counts with optional verified provider events; requires campaign authorization. */
  performanceReport?:(campaignId:string)=>Promise<unknown>;
  /** Bounded UTC-day counts; callback must use trusted database tables. */
  trendsReport?:(campaignId:string,from:string,to:string)=>Promise<unknown>;
  prefix?:string;publicOrigin?:string;
}
const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-frame-options':'DENY','x-content-type-options':'nosniff','vary':'Cookie',
  'content-security-policy':"default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...headers,'content-type':'application/json; charset=utf-8'}});
const html=(body:string,type='text/html; charset=utf-8')=>new Response(body,{headers:{...headers,'content-type':type}});
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
async function body(request:Request):Promise<Record<string,unknown>>{
  if(!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type')??''))throw new TypeError('JSON body required');
  const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>12_288))throw new RangeError('Body too large');
  const reader=request.body?.getReader();if(!reader)throw new TypeError('Body required');
  const chunks:Buffer[]=[];let size=0,timeout=false;
  const timer=setTimeout(()=>{timeout=true;void reader.cancel().catch(()=>{});},5000);timer.unref?.();
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>12_288){await reader.cancel().catch(()=>{});throw new RangeError('Body too large');}chunks.push(Buffer.from(value));}}
  finally{clearTimeout(timer);reader.releaseLock();}
  if(timeout)throw new Error('Body timed out');
  const decoded=JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))throw new TypeError('Invalid JSON');
  return decoded as Record<string,unknown>;
}
const js=String.raw`'use strict';
const root=document.currentScript.dataset.root;const csrf=document.querySelector('meta[name="csrf"]')?.content;
const $=id=>document.getElementById(id);const note=(s)=>{$('status').textContent=s};
const show=(rec)=>{$('record').textContent=JSON.stringify(rec,null,2)};
function drawReport(r){
  const container=$('reportChart');container.replaceChildren();
  const title=document.createElement('h3');title.textContent=r.complete?'Complete delivery snapshot':'Partial delivery snapshot — scan limit reached';container.append(title);
  const max=Math.max(1,...Object.values(r.counts));
  for(const [state,count] of Object.entries(r.counts)){
    const line=document.createElement('div');line.className='metric';
    const name=document.createElement('span');name.textContent=state+' ('+count+')';
    const track=document.createElement('div');track.className='track';
    const bar=document.createElement('div');bar.className='bar';bar.style.width=(count/max*100)+'%';
    track.append(bar);line.append(name,track);container.append(line);
  }
  const foot=document.createElement('p');foot.textContent=r.mode==='database'?
    'Exact grouped database state counts at query time; no transaction-wide snapshot. Daily and activity summaries not computed. SMTP accepted is not inbox delivery.':
    'SMTP state, not inbox delivery. Activity counts cover available summaries only.';container.append(foot);
  if(r.provider){
    const h=document.createElement('h3');h.textContent='Provider-reported events (not unique recipients)';container.append(h);
    for(const [kind,count] of Object.entries(r.provider.counts)){
      const line=document.createElement('p');line.textContent=kind+': '+count;container.append(line);
    }
  }
}

async function call(op,method='GET',payload){const url=root+'/api'+(method==='GET'?'?id='+encodeURIComponent($('id').value)+(['delivery','performance'].includes(op)?'&view='+op:''):'');const r=await fetch(url,{method,credentials:'same-origin',headers:payload?{'content-type':'application/json','x-csrf-token':csrf}:{},body:payload?JSON.stringify({action:op,...payload}):undefined});const v=await r.json();if(!r.ok)throw Error(v.error||'Request failed');return v;}
$('load').onclick=async()=>{try{show(await call('', 'GET'));note('Loaded')}catch(e){note(e.message)}};
$('delivery').onclick=async()=>{try{const r=await call('delivery','GET');show(r);drawReport(r);note('Delivery report loaded; incomplete scans are explicitly marked')}catch(e){note(e.message)}};
$('performance').onclick=async()=>{try{const r=await call('performance','GET');show(r);drawReport(r);note('Database-native delivery state totals; provider feedback includes only received verified events. Daily/activity metrics are not computed.')}catch(e){note(e.message)}};
$('trends').onclick=async()=>{try{const id=$('id').value,from=$('fromDay').value,to=$('toDay').value;const url=root+'/api?id='+encodeURIComponent(id)+'&view=trends&from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to);const r=await fetch(url,{credentials:'same-origin'});const value=await r.json();if(!r.ok)throw Error(value.error||'Request failed');show(value);const container=$('reportChart');container.replaceChildren();const title=document.createElement('h3');title.textContent='UTC-day update-state trend (not status transitions)';container.append(title);for(const day of value.days){const row=document.createElement('p');row.textContent=day.day+': '+day.total+' current-state updates; SMTP sent='+day.counts.sent+(day.providerEvents===null?'':'; provider notifications='+day.providerEvents);container.append(row)}note('Trends: last durable state update day; provider notifications are event counts, not unique recipients.')}catch(e){note(e.message)}};
$('create').onclick=async()=>{try{const id=$('id').value;show(await call('create','POST',{id,name:$('name').value,sendAt:Date.parse($('time').value),segment:$('segment').value?JSON.parse($('segment').value):undefined,tracking:$('track').checked?{enabled:true,opens:$('opens').checked,clicks:$('clicks').checked}:undefined}));note('Draft created')}catch(e){note(e.message)}};
for(const op of ['schedule','pause','resume','cancel'])$(op).onclick=async()=>{try{show(await call(op,'POST',{id:$('id').value}));note(op+' completed')}catch(e){note(e.message)}};
`;
const css=' .metric{display:grid;grid-template-columns:130px 1fr;align-items:center;gap:12px;margin:8px 0}.track{height:12px;border-radius:7px;background:#e5e7eb;overflow:hidden}.bar{height:100%;background:#2563eb;min-width:0}body{font:16px system-ui,sans-serif;max-width:850px;margin:auto;padding:25px;color:#17202b;background:#f8fafc}main{display:grid;gap:15px}section{background:white;border:1px solid #d7dfe6;border-radius:10px;padding:18px}label{display:block;margin:8px 0}input{min-width:210px;padding:8px;margin-left:12px}button{padding:9px;margin:4px;cursor:pointer}pre{max-height:400px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}#status{min-height:20px}';
/** Optional session-authenticated campaign console. No default auth or public route. */
export function createCampaignDashboard(options:CampaignDashboardOptions){
  if(!options||!options.planner||typeof options.authorize!=='function'||typeof options.verifyCsrf!=='function'||typeof options.csrfToken!=='function'||typeof options.authorizeCampaign!=='function')throw new TypeError('Campaign dashboard requires session auth, scoped permissions and CSRF');
  const prefix=options.prefix??'/_email/campaigns';
  if(!/^\/[A-Za-z0-9/_-]{2,100}$/.test(prefix)||prefix.includes('//')||prefix.endsWith('/')||prefix.includes('..'))throw new TypeError('Invalid campaign dashboard prefix');
  let origin:string|undefined;
  if(options.publicOrigin){const u=new URL(options.publicOrigin);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new TypeError('Invalid public origin');origin=u.origin;}
  async function handle(request:Request):Promise<Response>{
    if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed'},405);
    let principal:unknown;
    try{principal=await options.authorize(request);}catch{return json({error:'Forbidden'},403);}
    if(principal===true||principal===false||principal===null||principal===undefined)return json({error:'Forbidden'},403);
    const u=new URL(request.url);const suffix=u.pathname.slice(prefix.length);
    if(suffix===''&&request.method==='GET'){
      let token;try{token=await options.csrfToken(request,principal);}catch{return json({error:'Forbidden'},403);}
      if(typeof token!=='string'||token.length<16||token.length>512)return json({error:'Forbidden'},403);
      return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="csrf" content="${escape(token)}"><link rel="stylesheet" href="${prefix}/app.css"><title>Zerux Email Campaigns</title></head><body><main><h1>Campaign administration</h1><p>Recipient data and email bodies are stored outside the queue. Planning requires explicitly scheduled campaigns.</p><section><label>Campaign ID <input id="id" maxlength="96" required></label><button id="load">Load</button><button id="delivery">Delivery report</button><button id="performance">All-time performance</button><label>From UTC <input id="fromDay" type="date"></label><label>To UTC <input id="toDay" type="date"></label><button id="trends">Daily trends</button><label>Name <input id="name" maxlength="120"></label><label>Send at (local time) <input id="time" type="datetime-local"></label><label>Audience segment (JSON, optional) <textarea id="segment" rows="3" cols="55" placeholder='{"all":[{"field":"region","operator":"eq","value":"AU"}]}'></textarea></label><label><input type="checkbox" id="track"> Track activity (independently opt-in)</label><label><input type="checkbox" id="opens"> Opens</label><label><input type="checkbox" id="clicks"> Clicks</label><button id="create">Create draft</button></section><section><h2>Control</h2><button id="schedule">Schedule</button><button id="pause">Pause</button><button id="resume">Resume</button><button id="cancel">Cancel</button></section><p role="status" id="status"></p><section><h2>Delivery overview</h2><div id="reportChart" aria-live="polite"></div></section><section><h2>Checkpoint / detailed results</h2><pre id="record"></pre></section></main><script defer data-root="${prefix}" src="${prefix}/app.js"></script></body></html>`);
    }
    if(suffix==='/app.js'&&request.method==='GET')return html(js,'text/javascript; charset=utf-8');
    if(suffix==='/app.css'&&request.method==='GET')return html(css,'text/css; charset=utf-8');
    if(suffix!=='/api')return json({error:'Not found'},404);
    if(request.method==='GET'){
      const id=u.searchParams.get('id')??'';
      if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(id))return json({error:'Invalid campaign'},400);
      try{if(await options.authorizeCampaign(principal,id,'read')!==true)return json({error:'Forbidden'},403);}catch{return json({error:'Forbidden'},403);}
      try{
        const value=await options.planner.get(id);
        if(!value)return json({error:'Not found'},404);
        if(u.searchParams.get('view')==='trends'){
          if(!options.trendsReport)return json({error:'Trend reporting not configured'},404);
          const from=u.searchParams.get('from')??'',to=u.searchParams.get('to')??'';
          if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return json({error:'Invalid UTC-day range'},400);
          return json(publicTrendsReport(await options.trendsReport(id,from,to),id,from,to));
        }
        if(u.searchParams.get('view')==='performance'){
          if(!options.performanceReport)return json({error:'Performance reporting not configured'},404);
          return json(publicPerformanceReport(await options.performanceReport(id),id));
        }
        if(u.searchParams.get('view')==='delivery'){
          if(!options.deliveryReport)return json({error:'Delivery reporting not configured'},404);
          return json(publicDeliveryReport(await options.deliveryReport(id),id));
        }
        return json(publicState(value));
      }catch{return json({error:'Campaign report or store unavailable'},503);}
    }
    if(request.headers.get('origin')!==(origin??u.origin)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Invalid origin'},403);
    try{if(await options.verifyCsrf(request,principal)!==true)return json({error:'Forbidden'},403);}catch{return json({error:'Forbidden'},403);}
    let input;try{input=await body(request);}catch{return json({error:'Invalid request'},400);}
    const id=input.id;
    if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(id))return json({error:'Invalid campaign ID'},400);
    try{if(await options.authorizeCampaign(principal,id,String(input.action))!==true)return json({error:'Forbidden'},403);}catch{return json({error:'Forbidden'},403);}
    try{
      if(input.action==='create'){
        const def:CampaignDefinition={id,name:input.name as string,sendAt:input.sendAt as number,segment:input.segment as CampaignDefinition['segment'],tracking:input.tracking as CampaignDefinition['tracking']};
        return json(publicState(await options.planner.create(def)),201);
      }
      if(['schedule','pause','resume','cancel'].includes(String(input.action)))return json(publicState(await options.planner.command(id,input.action as 'schedule'|'pause'|'resume'|'cancel')));
      return json({error:'Unknown action'},400);
    }catch{return json({error:'Campaign transition failed'},409);}
  }
  return {prefix,handle,routes:()=>[{pattern:prefix,handler:handle},{pattern:`${prefix}/api`,handler:handle},{pattern:`${prefix}/app.js`,handler:handle},{pattern:`${prefix}/app.css`,handler:handle}]};
}
function publicState(s:Awaited<ReturnType<CampaignPlanner['get']>>){
  if(!s)return null;
  // Never return recipient identities, live lease tokens or message IDs to the web client.
  const {lease,pending,tracking,segment,cursor,...safe}=s;
  return {...safe,pendingCount:pending.length,leased:!!lease,cursorPresent:cursor!==null,segmentConditions:(segment?.all?.length??0)+(segment?.any?.length??0),trackingEnabled:tracking?.enabled===true};
}

/** Defense in depth: the dashboard returns a whitelist, never a provider object. */
function publicDeliveryReport(input:unknown,campaignId:string){
  if(!input||typeof input!=='object')throw new TypeError('Invalid delivery report');
  const item=input as Record<string,unknown>;
  const states=['pending','claimed','sending','sent','suppressed','uncertain','rejected'];
  const counts=item.counts as Record<string,unknown>|undefined;
  if(item.campaignId!==campaignId||typeof item.complete!=='boolean'||!Number.isSafeInteger(item.scanned)||Number(item.scanned)<0||!counts||
    states.some(k=>!Number.isSafeInteger(counts[k])||Number(counts[k])<0))throw new TypeError('Invalid delivery report summary');
  const safeCounts=Object.fromEntries(states.map(k=>[k,counts[k]]));
  if(states.reduce((sum,k)=>sum+Number(counts[k]),0)!==item.scanned)throw new TypeError('Inconsistent delivery report');
  if(!Array.isArray(item.days)||item.days.length>5000)throw new TypeError('Invalid delivery timeline');
  const days=item.days.map((day:unknown)=>{
    const d=day as Record<string,unknown>;
    if(!d||typeof d.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.day)||
      ['sent','suppressed','uncertain','other'].some(k=>!Number.isSafeInteger(d[k])||Number(d[k])<0))throw new TypeError('Invalid delivery date group');
    return {day:d.day,sent:d.sent,suppressed:d.suppressed,uncertain:d.uncertain,other:d.other};
  });
  if(days.reduce((sum,d)=>sum+Number(d.sent)+Number(d.suppressed)+Number(d.uncertain)+Number(d.other),0)!==item.scanned)throw new TypeError('Inconsistent delivery report timeline');
  if(item.sentPercent!==null&&(typeof item.sentPercent!=='number'||!Number.isFinite(item.sentPercent)||item.sentPercent<0||item.sentPercent>100)||
    item.complete===false&&item.sentPercent!==null)throw new TypeError('Invalid report rate');
  let activity=null;
  if(item.activity!==null){
    const a=item.activity as Record<string,unknown>|undefined;
    const keys=['summariesAvailable','opens','uniqueOpens','clicks','uniqueClicks','downloadClicks','downloads','downloadedBytes'];
    if(!a||a.coverage!=='available-summaries-only'||keys.some(k=>!Number.isSafeInteger(a[k])||Number(a[k])<0)||Number(a.summariesAvailable)>Number(item.scanned))throw new TypeError('Invalid activity counters');
    activity={...Object.fromEntries(keys.map(k=>[k,a[k]])),coverage:'available-summaries-only'};
  }
  return {campaignId,complete:item.complete,scanned:item.scanned,counts:safeCounts,days,sentPercent:item.sentPercent,activity};
}

/** Strict public projection. Never allow an arbitrary callback to leak recipient IDs or secrets. */
function publicPerformanceReport(input:unknown,campaignId:string){
  if(!input||typeof input!=='object')throw new TypeError('Invalid campaign performance report');
  const r=input as Record<string,unknown>;
  const states=['pending','claimed','sending','sent','suppressed','uncertain','rejected'];
  const counts=r.counts as Record<string,unknown>|undefined;
  if(r.campaignId!==campaignId||r.mode!=='database'||r.complete!==true||!Number.isSafeInteger(r.total)||Number(r.total)<0||!counts||
    states.some(s=>!Number.isSafeInteger(counts[s])||Number(counts[s])<0)||
    states.reduce((sum,s)=>sum+Number(counts[s]),0)!==r.total||
    r.dailyCoverage!=='not-computed'||r.activityCoverage!=='not-computed'||
    (r.smtpAcceptedPercent!==null&&(!Number.isFinite(r.smtpAcceptedPercent)||typeof r.smtpAcceptedPercent!=='number'||r.smtpAcceptedPercent<0||r.smtpAcceptedPercent>100))||
    (Number(r.total)===0&&r.smtpAcceptedPercent!==null))throw new TypeError('Invalid campaign performance report');
  const expectedPercent=Number(r.total)>0?100*Number(counts.sent)/Number(r.total):null;
  if((expectedPercent===null)!==(r.smtpAcceptedPercent===null)||
    (expectedPercent!==null&&Math.abs(expectedPercent-Number(r.smtpAcceptedPercent))>1e-8))throw new TypeError('Invalid SMTP acceptance percentage');
  let provider:null|Record<string,unknown>=null;
  if(r.provider!==null){
    const p=r.provider as Record<string,unknown>|undefined;
    const kinds=['delivered','deferred','hard-bounce','soft-bounce','complaint'];
    const pc=p?.counts as Record<string,unknown>|undefined;
    if(!p||p.coverage!=='reported-events-only'||!Number.isSafeInteger(p.events)||Number(p.events)<0||!pc||
      kinds.some(k=>!Number.isSafeInteger(pc[k])||Number(pc[k])<0)||kinds.reduce((n,k)=>n+Number(pc[k]),0)!==p.events)throw new TypeError('Invalid provider outcome counts');
    provider={events:p.events,counts:Object.fromEntries(kinds.map(k=>[k,pc[k]])),coverage:'reported-events-only'};
  }
  return {campaignId,mode:'database',complete:true,total:r.total,counts:Object.fromEntries(states.map(s=>[s,counts[s]])),
    smtpAcceptedPercent:expectedPercent,dailyCoverage:'not-computed',activityCoverage:'not-computed',provider};
}

/** Explicit whitelist; no recipients, message IDs, email bodies or provider credentials. */
function publicTrendsReport(input:unknown,campaignId:string,from:string,to:string){
  if(!input||typeof input!=='object')throw new TypeError('Invalid campaign trends');
  const r=input as Record<string,unknown>;
  if(r.campaignId!==campaignId||r.from!==from||r.to!==to||r.mode!=='database'||r.complete!==true||
    r.deliveryCoverage!=='last-state-update-day'||r.snapshotConsistent!==false||
    !['reported-events-only','not-configured'].includes(String(r.providerCoverage))||
    !Number.isSafeInteger(r.total)||Number(r.total)<0||!Array.isArray(r.days)||r.days.length>366)throw new TypeError('Invalid campaign trend summary');
  const stateLabels=['pending','claimed','sending','sent','suppressed','uncertain','rejected'];
  const providerLabels=['delivered','deferred','hard-bounce','soft-bounce','complaint'];
  const verify=(value:unknown,labels:string[])=>{
    if(!value||typeof value!=='object')throw new TypeError('Invalid campaign trend counts');
    const source=value as Record<string,unknown>;
    if(labels.some(key=>!Number.isSafeInteger(source[key])||Number(source[key])<0))throw new TypeError('Invalid campaign trend count');
    const total=labels.reduce((n,key)=>n+Number(source[key]),0);
    if(!Number.isSafeInteger(total))throw new TypeError('Campaign trend total overflow');
    return {counts:Object.fromEntries(labels.map(key=>[key,source[key]])),total};
  };
  const days=r.days.map((raw:unknown)=>{
    const d=raw as Record<string,unknown>;
    if(!d||typeof d.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.day)||
      d.day<from||d.day>to)throw new TypeError('Invalid campaign trend date');
    const states=verify(d.counts,stateLabels);
    if(states.total!==d.total)throw new TypeError('Inconsistent campaign trend totals');
    let provider=null,providerEvents:null|number=null;
    if(r.providerCoverage==='reported-events-only'){
      const counts=verify(d.provider,providerLabels);
      if(d.providerEvents!==counts.total)throw new TypeError('Inconsistent provider trend totals');
      provider=counts.counts;providerEvents=counts.total;
    }else if(d.provider!==null||d.providerEvents!==null)throw new TypeError('Unexpected provider events');
    return {day:d.day,counts:states.counts,total:states.total,provider,providerEvents};
  });
  if(days.some((d,i)=>i>0&&d.day<=days[i-1]!.day)||days.reduce((n,d)=>n+d.total,0)!==r.total||
    (r.providerCoverage==='reported-events-only'?days.reduce((n,d)=>n+(d.providerEvents??0),0)!==r.providerEvents:r.providerEvents!==null))
    throw new TypeError('Inconsistent campaign trend series');
  return {campaignId,from,to,mode:'database',complete:true,deliveryCoverage:'last-state-update-day',providerCoverage:r.providerCoverage,
    snapshotConsistent:false,days,total:r.total,providerEvents:r.providerEvents};
}
