import {createHash,createHmac} from 'node:crypto';
import {addressString,validateEmailAddress} from './validation.js';
import type {EmailAddress} from './types.js';
import type {CampaignDatabaseConnection} from './campaign-storage.js';
export type SenderFeedbackKind='accepted'|'delivered'|'deferred'|'hard-bounce'|'soft-bounce'|'complaint';
export interface SenderFeedbackInput {eventId:string;messageId:string;email:EmailAddress;kind:SenderFeedbackKind;at:number}
export interface SenderFeedbackRecord {id:string;scope:string;recipientHash:string;messageHash:string;kind:SenderFeedbackKind;at:number;recordedAt:number;fingerprint:string}
export interface SenderFeedbackStore {
 capability:'sender-feedback-v1';durability:'durable'|'process';
 /** Unique insert; exact duplicate returns false, conflicting content MUST throw. */
 append(record:SenderFeedbackRecord):Promise<boolean>;
 /** Strict ascending immutable ID keyset page, filtered to this scope/optional recipient. */
 page(scope:string,after:string|null,limit:number,recipientHash?:string):Promise<SenderFeedbackRecord[]>;
}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const hex=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const kinds:SenderFeedbackKind[]=['accepted','delivered','deferred','hard-bounce','soft-bounce','complaint'];
function record(input:SenderFeedbackRecord){if(!input||Object.keys(input).some(k=>!['id','scope','recipientHash','messageHash','kind','at','recordedAt','fingerprint'].includes(k))||!['id','scope','recipientHash','messageHash','fingerprint'].every(k=>hex(input[k as keyof SenderFeedbackRecord]))||!kinds.includes(input.kind)||!Number.isSafeInteger(input.at)||input.at<0||!Number.isSafeInteger(input.recordedAt)||input.recordedAt<0)throw new TypeError('Invalid sender feedback record');if(input.fingerprint!==hash(JSON.stringify([input.id,input.scope,input.recipientHash,input.messageHash,input.kind,input.kind==='accepted'?null:input.at])))throw new Error('Corrupt feedback fingerprint');return {...input};}
/** Bounded reference fixture only; shared objects do not provide cross-process durability. */
export function createMemorySenderFeedbackStore(maxRecords=10000):SenderFeedbackStore {
 if(!Number.isSafeInteger(maxRecords)||maxRecords<1||maxRecords>100000)throw new RangeError('Invalid feedback capacity');const rows=new Map<string,SenderFeedbackRecord>();
 return {capability:'sender-feedback-v1',durability:'process',async append(input){const value=record(input),prior=rows.get(value.id);if(prior){if(prior.fingerprint!==value.fingerprint)throw new Error('Conflicting sender feedback identity');return false;}if(rows.size>=maxRecords)throw new Error('Sender feedback capacity reached');rows.set(value.id,value);return true;},async page(scope,after,limit,recipientHash){if(!hex(scope)||after!==null&&!hex(after)||recipientHash!==undefined&&!hex(recipientHash)||!Number.isSafeInteger(limit)||limit<1||limit>500)throw new TypeError('Invalid feedback page');return [...rows.values()].filter(r=>r.scope===scope&&(!after||r.id>after)&&(!recipientHash||r.recipientHash===recipientHash)).sort((a,b)=>a.id<b.id?-1:1).slice(0,limit).map(r=>({...r}));}};
}
/** Durable deduplication uses the database primary key, not an in-process receipt cache. */
export function createDatabaseSenderFeedbackStore(db:CampaignDatabaseConnection,table='zerux_sender_feedback'):SenderFeedbackStore {
 if(!/^[a-z][a-z0-9_]{0,47}$/.test(table)||!db||!['createTable','insert','select'].every(k=>typeof db[k as keyof CampaignDatabaseConnection]==='function'))throw new TypeError('Feedback database required');let ready:Promise<void>|undefined;
 const ensure=()=>ready??=(async()=>{const r=await db.createTable({table,ifNotExists:true,columns:[{name:'id',type:'varchar',length:64,primary:true,notNull:true},{name:'scope',type:'varchar',length:64,notNull:true},{name:'recipient_hash',type:'varchar',length:64,notNull:true},{name:'payload_json',type:'text',notNull:true}]});if(!r.ok)throw new Error('Feedback table unavailable');if(db.createIndex){for(const [suffix,columns] of [['scope_idx',['scope','id']],['recipient_idx',['scope','recipient_hash','id']]] as const){const index=await db.createIndex({table,name:table+'_'+suffix,columns:[...columns],ifNotExists:true});if(!index.ok)throw new Error('Feedback index unavailable');}}})().catch(error=>{ready=undefined;throw error;});
 const decode=(row:any)=>{if(!row||typeof row.payload_json!=='string'||row.payload_json.length>4096)throw new Error('Corrupt feedback row');const r=record(JSON.parse(row.payload_json));if(r.id!==row.id||r.scope!==row.scope||r.recipientHash!==row.recipient_hash)throw new Error('Feedback row scope mismatch');return r;};
 return {capability:'sender-feedback-v1',durability:'durable',async append(input){const r=record(input);await ensure();let cause:unknown;try{const added=await db.insert({table,values:{id:r.id,scope:r.scope,recipient_hash:r.recipientHash,payload_json:JSON.stringify(r)}});if(added.ok)return true;}catch(error){cause=error;}
 const result=await db.select({table,columns:['id','scope','recipient_hash','payload_json'],where:{field:'id',operator:'eq',value:r.id},limit:1});if(!result.ok||!result.rows?.length)throw new Error('Feedback persistence unavailable',{cause});const prior=decode(result.rows[0]);if(prior.fingerprint!==r.fingerprint)throw new Error('Conflicting sender feedback identity');return false;},
 async page(scope,after,limit,recipientHash){if(!hex(scope)||after!==null&&!hex(after)||recipientHash!==undefined&&!hex(recipientHash)||!Number.isSafeInteger(limit)||limit<1||limit>500)throw new TypeError('Invalid feedback page');await ensure();const result=await db.select({table,columns:['id','scope','recipient_hash','payload_json'],where:{and:[{field:'scope',operator:'eq',value:scope},...(after?[{field:'id',operator:'gt',value:after}]:[]),...(recipientHash?[{field:'recipient_hash',operator:'eq',value:recipientHash}]:[])]},orderBy:[{by:'id',direction:'asc'}],limit});if(!result.ok||!Array.isArray(result.rows))throw new Error('Feedback read unavailable');return result.rows.map(decode);}};
}
export interface SenderReputationReport {
 version:1;from:number;until:number;asOf:number;denominator:number;
 counts:Record<'accepted'|'delivered'|'hardBounces'|'softBounces'|'complaints',number>;
 rates:{deliveryPercent:number|null;bouncePercent:number|null;softBouncePercent:number|null;complaintPercent:number|null};
 days:Array<{day:string;accepted:number;delivered:number;hardBounces:number;softBounces:number;complaints:number}>;
 coverage:{basis:'accepted-message-recipient-cohort';feedback:'authenticated-reported-only';snapshotConsistent:false;scanned:number;unmatchedFeedback:number;lateFeedback:number;durability:'durable'|'process';heuristic:true;providerReputation:'not-measured';dnsAuthentication:'not-measured'};
}
export function createSenderFeedbackService(options:{store:SenderFeedbackStore;tenant:string;site:string;account:string;provider:string;lookupKey:Uint8Array;requireDurable?:boolean;scanLimit?:number;softBounceThreshold?:number;now?:()=>number}) {
 if(!options||options.now!==undefined&&typeof options.now!=='function'||options.requireDurable!==undefined&&typeof options.requireDurable!=='boolean'||options.store?.capability!=='sender-feedback-v1'||!['durable','process'].includes(options.store.durability)||typeof options.store.append!=='function'||typeof options.store.page!=='function'||options.requireDurable!==false&&options.store.durability!=='durable'||!['tenant','site','account','provider'].every(k=>typeof options[k as 'tenant']==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(options[k as 'tenant']))||!(options.lookupKey instanceof Uint8Array)||options.lookupKey.length!==32)throw new TypeError('Tenant-bound durable feedback configuration required');
 const store=options.store,scope=hash(JSON.stringify([options.tenant,options.site,options.account,options.provider])),key=Buffer.from(options.lookupKey),now=options.now??Date.now,limit=options.scanLimit??10000,threshold=options.softBounceThreshold??3,account=options.account;
 if(!Number.isSafeInteger(limit)||limit<1||limit>100000||!Number.isSafeInteger(threshold)||threshold<1||threshold>20)throw new RangeError('Invalid sender feedback limits');
 const digest=(s:string)=>createHmac('sha256',key).update(s).digest('hex'),recipient=(email:EmailAddress)=>digest(addressString(validateEmailAddress(email)).toLowerCase());
 const prepare=(input:SenderFeedbackInput):SenderFeedbackRecord=>{const at=now();if(!Number.isSafeInteger(at)||at<0||!input||Object.keys(input).some(k=>!['eventId','messageId','email','kind','at'].includes(k))||typeof input.eventId!=='string'||! /^[A-Za-z0-9:_./-]{1,160}$/.test(input.eventId)||typeof input.messageId!=='string'||!input.messageId||input.messageId.length>512||/[\r\n\0]/.test(input.messageId)||!kinds.includes(input.kind)||!Number.isSafeInteger(input.at)||input.at<0||input.at>at+300000)throw new TypeError('Invalid correlated feedback');const recipientHash=recipient(input.email),messageHash=digest(input.messageId),id=digest(JSON.stringify([scope,input.kind==='accepted'?'smtp':'provider',input.eventId,recipientHash])),fingerprint=hash(JSON.stringify([id,scope,recipientHash,messageHash,input.kind,input.kind==='accepted'?null:input.at]));return {id,scope,recipientHash,messageHash,kind:input.kind,at:input.at,recordedAt:at,fingerprint};};
 async function scan(recipientHash?:string,asOf=now(),signal?:AbortSignal){
  const check=()=>{if(signal?.aborted)throw Object.assign(new Error('Sender report cancelled'),{code:'EMAIL_REPORT_CANCELLED'});};check();
  const rows:SenderFeedbackRecord[]=[];let after:string|null=null;
  while(rows.length<limit){check();const take=Math.min(500,limit-rows.length),batch=await store.page(scope,after,take,recipientHash);check();if(!Array.isArray(batch)||batch.length>take)throw new Error('Invalid feedback page');for(const raw of batch){const r=record(raw);if(r.scope!==scope||recipientHash&&r.recipientHash!==recipientHash||after&&r.id<=after)throw new Error('Feedback isolation/order violation');after=r.id;rows.push(r);}if(batch.length<take)return rows.filter(r=>r.recordedAt<=asOf);}
  if((await store.page(scope,after,1,recipientHash)).length)throw new Error('Feedback scan limit reached; coverage unavailable');return rows.filter(r=>r.recordedAt<=asOf);
 }
 return {
  /** Pure validation allows an authenticated endpoint to validate the entire batch before writes. */
  validateFeedback(input:SenderFeedbackInput){prepare(input);},
  recordFeedback(input:SenderFeedbackInput){const r=prepare(input);return store.append(r);},
  recordAccepted(name:string,email:EmailAddress,messageId:string,at=now()){if(name!==account)throw new TypeError('Sender account mismatch');return store.append(prepare({eventId:hash(messageId),messageId,email,kind:'accepted',at}));},
  /** Durable ledger is the suppression source of truth; wire this into planner AND SMTP manager. */
  async isSuppressed(email:EmailAddress){const rows=await scan(recipient(email));if(rows.some(r=>r.kind==='hard-bounce'||r.kind==='complaint'))return true;return new Set(rows.filter(r=>r.kind==='soft-bounce').map(r=>r.messageHash)).size>=threshold;},
  rolling(windowMs=7*86400000){const until=now();return this.report(Math.max(0,until-windowMs),until);},
  async report(from:number,until:number,signal?:AbortSignal):Promise<SenderReputationReport>{
   if(signal!==undefined&&!(signal instanceof AbortSignal))throw new TypeError('Invalid report cancellation');
   const asOf=now();if(!Number.isSafeInteger(asOf)||asOf<0||asOf>8640000000000000||!Number.isSafeInteger(from)||!Number.isSafeInteger(until)||from<0||until<=from||until>asOf||until-from>90*86400000)throw new RangeError('Bounded completed UTC window required');
   const rows=await scan(undefined,asOf,signal),cohort=new Map<string,SenderFeedbackRecord>(),identity=(r:SenderFeedbackRecord)=>r.messageHash+':'+r.recipientHash;
   const firstAccepted=new Map<string,SenderFeedbackRecord>();for(const r of rows)if(r.kind==='accepted'&&r.at<=asOf){const old=firstAccepted.get(identity(r));if(!old||r.at<old.at)firstAccepted.set(identity(r),r);}for(const [id,r] of firstAccepted)if(r.at>=from&&r.at<until)cohort.set(id,r);
   const counts={accepted:cohort.size,delivered:0,hardBounces:0,softBounces:0,complaints:0},days=new Map<string,SenderReputationReport['days'][number]>();
   for(let at=Date.UTC(new Date(from).getUTCFullYear(),new Date(from).getUTCMonth(),new Date(from).getUTCDate());at<until;at+=86400000){const day=new Date(at).toISOString().slice(0,10);days.set(day,{day,accepted:0,delivered:0,hardBounces:0,softBounces:0,complaints:0});}
   for(const r of cohort.values())days.get(new Date(r.at).toISOString().slice(0,10))!.accepted++;
   const outcomes=new Map<string,SenderFeedbackRecord>();for(const r of rows){if(r.at>asOf||r.kind==='accepted'||r.kind==='deferred')continue;const id=identity(r)+':'+r.kind,old=outcomes.get(id);if(!old||r.recordedAt<old.recordedAt)outcomes.set(id,r);}let unmatchedFeedback=0,lateFeedback=0;
   for(const r of outcomes.values()){if(r.kind==='accepted'||r.kind==='deferred')continue;const accepted=cohort.get(identity(r));if(!accepted){unmatchedFeedback++;continue;}if(r.recordedAt>=until)lateFeedback++;const metric=({'delivered':'delivered','hard-bounce':'hardBounces','soft-bounce':'softBounces','complaint':'complaints'} as const)[r.kind];counts[metric]++;days.get(new Date(accepted.at).toISOString().slice(0,10))![metric]++;}
   const rate=(n:number)=>counts.accepted?100*n/counts.accepted:null;
   return {version:1,from,until,asOf,denominator:counts.accepted,counts,rates:{deliveryPercent:rate(counts.delivered),bouncePercent:rate(counts.hardBounces),softBouncePercent:rate(counts.softBounces),complaintPercent:rate(counts.complaints)},days:[...days.values()],coverage:{basis:'accepted-message-recipient-cohort',feedback:'authenticated-reported-only',snapshotConsistent:false,scanned:rows.length,unmatchedFeedback,lateFeedback,durability:store.durability,heuristic:true,providerReputation:'not-measured',dnsAuthentication:'not-measured'}};
  },
 };
}
/** Shape-compatible with Reports ChartData; avoids a runtime dependency/cycle. */
export function senderReputationCharts(report:SenderReputationReport){
 if(report?.version!==1||report.coverage?.basis!=='accepted-message-recipient-cohort'||report.coverage.feedback!=='authenticated-reported-only'||!Array.isArray(report.days)||report.days.length>91||report.denominator!==report.counts.accepted||Object.values(report.counts).some(v=>!Number.isSafeInteger(v)||v<0))throw new TypeError('Invalid sender report');
 const fields=['accepted','delivered','hardBounces','softBounces','complaints'] as const;
 if(!Number.isSafeInteger(report.coverage.scanned)||report.coverage.scanned<report.denominator||report.days.some((d,i)=>!d||typeof d.day!=='string'||!/^\d{4}-\d\d-\d\d$/.test(d.day)||!Number.isFinite(Date.parse(d.day+'T00:00:00Z'))||new Date(d.day+'T00:00:00Z').toISOString().slice(0,10)!==d.day||i>0&&d.day<=report.days[i-1].day||fields.some(k=>!Number.isSafeInteger(d[k])||d[k]<0))||fields.some(k=>report.days.reduce((n,d)=>n+d[k],0)!==report.counts[k]||report.counts[k]>report.denominator))throw new TypeError('Invalid sender trend counts');
 const make=(field:'accepted'|'delivered'|'hardBounces'|'softBounces'|'complaints',title:string)=>({id:'sender_'+field,title,type:'line' as const,labels:report.days.map(d=>d.day),values:report.days.map(d=>d[field]),total:report.counts[field],sampledRows:report.coverage.scanned,truncated:false,coverage:'accepted-message-recipient-cohort; authenticated reported feedback only; local heuristic; no DNS/provider score'});
 return {accepted:make('accepted','SMTP-accepted cohort denominator by UTC day'),delivered:make('delivered','Provider-reported delivery for the accepted cohort'),bounces:make('hardBounces','Reported hard bounces for the accepted cohort'),softBounces:make('softBounces','Reported soft bounces for the accepted cohort'),complaints:make('complaints','Reported complaints for the accepted cohort')};
}
/** Optional Reports-compatible read endpoint; host resolves a dedicated tenant-bound service. */
export function createSenderReputationReportEndpoint(options:{authorize:(request:Request)=>boolean|Promise<boolean>;resolveService:(request:Request)=>ReturnType<typeof createSenderFeedbackService>|Promise<ReturnType<typeof createSenderFeedbackService>>;path?:string}) {
 if(typeof options?.authorize!=='function'||typeof options.resolveService!=='function')throw new TypeError('Sender report authorization required');const path=options.path??'/_email/sender-report';if(!/^\/[A-Za-z0-9/_-]+$/.test(path)||path.includes('//')||path.endsWith('/'))throw new TypeError('Invalid sender report path');
 const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'private, no-store','vary':'Cookie, Authorization','x-content-type-options':'nosniff'}});
 const handle=async(request:Request)=>{try{if(await options.authorize(request)!==true)return response({error:'FORBIDDEN'},403);}catch{return response({error:'FORBIDDEN'},403);}if(request.method!=='GET')return response({error:'METHOD_NOT_ALLOWED'},405);
 const params=new URL(request.url).searchParams;if([...params.keys()].some(k=>!['from','until'].includes(k))||params.getAll('from').length!==1||params.getAll('until').length!==1||!/^\d{1,16}$/.test(params.get('from')??'')||!/^\d{1,16}$/.test(params.get('until')??''))return response({error:'INVALID_WINDOW'},422);
 try{const service=await options.resolveService(request),report=await service.report(Number(params.get('from')),Number(params.get('until')),request.signal);return response({report,charts:senderReputationCharts(report)});}catch(error){if((error as {code?:string})?.code==='EMAIL_REPORT_CANCELLED')return response({error:'CANCELLED'},408);return response({error:error instanceof RangeError?'INVALID_WINDOW':'REPORT_UNAVAILABLE'},error instanceof RangeError?422:503);}};
 return {path,handle,routes:()=>[{pattern:path,handler:handle}]};
}
