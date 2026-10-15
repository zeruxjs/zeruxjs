/** Durable, fenced, multi-worker audience import. Source cursors and durable checkpoints
 * contain no recipient PII. Application supplies a repeatable, immutable source revision.
 * A lost lease can replay a page; appendRecipients MUST be idempotent. */
import {createHash,randomUUID} from 'node:crypto';
import type {CampaignDatabaseConnection} from './campaign-storage.js';
import type {MarketingRecipient} from './marketing.js';

const jobIdPattern=/^[A-Za-z0-9_.:-]{1,80}$/;
const campaignPattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const cursorPattern=/^[A-Za-z0-9_.-]{1,160}$/;
export interface MarketingImportPage {
  recipients:readonly (string|MarketingRecipient)[];
  nextCursor:string|null;
  done:boolean;
}
export interface MarketingImportSource {
  /** Stable, keyset-paginated snapshot. Never use offset pagination over mutable audiences. */
  page(query:{cursor:string|null;limit:number}):Promise<MarketingImportPage>;
}
export interface MarketingImportJobState {
  id:string;campaignCode:string;sourceRevision:string;batchSize:number;
  version:number;epoch:number;status:'pending'|'running'|'failed'|'completed'|'cancelled';
  cursor:string|null;pages:number;processed:number;created:number;existing:number;
  lease:null|{owner:string;token:string;expiresAt:number};
  updatedAt:number;lastError:string|null;
}
export interface MarketingImportJobOptions {
  db:CampaignDatabaseConnection;
  id:string;campaignCode:string;
  /** Stable fingerprint of an immutable source snapshot; must change when input changes. */
  sourceRevision:string;
  source:MarketingImportSource;
  append:(campaignCode:string,entries:readonly (string|MarketingRecipient)[])=>Promise<{added:number;existing:number;recipientCount:number}>;
  batchSize?:number;leaseMs?:number;now?:()=>number;table?:string;
}
const safeCursor=(v:unknown):v is string=>typeof v==='string'&&cursorPattern.test(v);
const sanitized=(s:MarketingImportJobState)=>{const {lease,...other}=s;return structuredClone({...other,lease:lease?{owner:lease.owner,expiresAt:lease.expiresAt}:null});};
/** Uses atomic UPDATE ... WHERE version=old, never process-local locks. */
export function createMarketingImportJob(options:MarketingImportJobOptions){
  const {db,id,campaignCode,source,append}=options;
  const sourceRevision=options.sourceRevision;
  const table=options.table??'zerux_marketing_import_jobs';
  const batchSize=options.batchSize??200,leaseMs=options.leaseMs??60_000;
  if(!db||!['createTable','insert','select','update'].every(k=>typeof (db as any)[k]==='function')||
    !jobIdPattern.test(id)||!campaignPattern.test(campaignCode)||typeof sourceRevision!=='string'||
    !/^[A-Za-z0-9_.:-]{8,160}$/.test(sourceRevision)||!source||typeof source.page!=='function'||typeof append!=='function'||
    !Number.isSafeInteger(batchSize)||batchSize<1||batchSize>500||
    !Number.isSafeInteger(leaseMs)||leaseMs<3000||leaseMs>3600000||
    !/^[a-z][a-z0-9_]{0,62}$/.test(table))throw new TypeError('Invalid durable marketing import configuration');
  const clock=options.now??Date.now;
  const now=()=>{const t=clock();if(!Number.isSafeInteger(t)||t<0)throw new Error('Invalid import clock');return t;};
  const key='mi_'+createHash('sha256').update(campaignCode+'\0'+id).digest('hex');
  const initial:MarketingImportJobState={id,campaignCode,sourceRevision,batchSize,version:1,epoch:0,
    status:'pending',cursor:null,pages:0,processed:0,created:0,existing:0,lease:null,updatedAt:now(),lastError:null};
  let ready:Promise<void>|undefined;
  const ensure=()=>ready??=(async()=>{const r=await db.createTable({table,ifNotExists:true,columns:[
    {name:'id',type:'varchar',length:67,primary:true,notNull:true},
    {name:'version',type:'bigint',notNull:true},
    {name:'payload_json',type:'text',notNull:true}
  ]});if(!r?.ok)throw new Error('Import checkpoint table unavailable');})().catch(e=>{ready=undefined;throw e;});
  const lookup=async():Promise<MarketingImportJobState|null>=>{
    const r=await db.select({table,columns:['id','version','payload_json'],where:{field:'id',operator:'eq',value:key},limit:1});
    if(!r?.ok||!Array.isArray(r.rows))throw new Error('Import checkpoint unavailable');
    if(!r.rows.length)return null;
    const row=r.rows[0] as Record<string,unknown>;
    if(typeof row.payload_json!=='string')throw new Error('Invalid checkpoint JSON');
    const state=JSON.parse(row.payload_json) as MarketingImportJobState;
    if(state.id!==id||state.campaignCode!==campaignCode||state.sourceRevision!==sourceRevision||state.batchSize!==batchSize||
      !Number.isSafeInteger(state.version)||state.version!==Number(row.version)||state.version<1||
      !Number.isSafeInteger(state.epoch)||state.epoch<0||!['pending','running','failed','completed','cancelled'].includes(state.status)||
      state.cursor!==null&&!safeCursor(state.cursor)||
      ![state.pages,state.processed,state.created,state.existing].every(x=>Number.isSafeInteger(x)&&x>=0)||
      state.created+state.existing!==state.processed||
      state.lease!==null&&(!state.lease||typeof state.lease.owner!=='string'||typeof state.lease.token!=='string'||!Number.isSafeInteger(state.lease.expiresAt)))
      throw new Error('Import checkpoint identity or version conflict');
    return state;
  };
  const read=async()=>{await ensure();const existing=await lookup();if(existing)return existing;
    try{const r=await db.insert({table,values:{id:key,version:1,payload_json:JSON.stringify(initial)}});
      if(r?.ok)return structuredClone(initial);}catch(error){const concurrent=await lookup();if(concurrent)return concurrent;throw error;}
    const concurrent=await lookup();if(concurrent)return concurrent;throw new Error('Import checkpoint initialization failed');
  };
  const cas=async(current:MarketingImportJobState,update:Omit<MarketingImportJobState,'version'>)=>{
    const next={...update,version:current.version+1};
    const r=await db.update({table,values:{version:next.version,payload_json:JSON.stringify(next)},
      where:{and:[{field:'id',operator:'eq',value:key},{field:'version',operator:'eq',value:current.version}]}});
    if(!r?.ok)throw new Error('Import checkpoint write failed');
    const affected=r.affectedCount??r.rowCount;
    if(typeof affected!=='number'||!Number.isSafeInteger(affected)||affected<0||affected>1)
      throw new Error('Import requires connector atomic affectedCount');
    return affected===1;
  };
  type Lease={owner:string;token:string;epoch:number};
  const belongs=(s:MarketingImportJobState,l:Lease,t:number)=>s.status==='running'&&s.epoch===l.epoch&&
    s.lease?.owner===l.owner&&s.lease.token===l.token&&s.lease.expiresAt>t;
  async function acquire(owner:string):Promise<Lease|null>{
    if(!jobIdPattern.test(owner))throw new TypeError('Invalid import worker');
    for(let i=0;i<20;i++){
      const s=await read(),t=now();
      if(s.status==='completed'||s.status==='cancelled'||s.lease&&s.lease.expiresAt>t)return null;
      const lease={owner,token:randomUUID(),expiresAt:t+leaseMs},epoch=s.epoch+1;
      if(await cas(s,{...s,epoch,status:'running',lease,updatedAt:t,lastError:null}))return {owner,token:lease.token,epoch};
    }
    throw new Error('Import lease acquisition contention');
  }
  async function renew(lease:Lease){for(let i=0;i<15;i++){
    const s=await read(),t=now();if(!belongs(s,lease,t))throw new Error('Import lease lost');
    if(await cas(s,{...s,lease:{...s.lease!,expiresAt:t+leaseMs},updatedAt:t}))return;
  }throw new Error('Import lease renewal contention');}
  async function commit(lease:Lease,page:MarketingImportPage,counts:{added:number;existing:number;recipientCount:number}){
    const s=await read(),t=now();if(!belongs(s,lease,t))throw new Error('Import lease lost');
    if(!Number.isSafeInteger(counts.added)||counts.added<0||!Number.isSafeInteger(counts.existing)||counts.existing<0||
      counts.added+counts.existing!==page.recipients.length||page.done!==(page.nextCursor===null)||
      !page.done&&(!safeCursor(page.nextCursor)||s.cursor!==null&&page.nextCursor<=s.cursor||page.recipients.length===0))
      throw new Error('Invalid import batch checkpoint');
    const next={...s,status:page.done?'completed' as const:'pending' as const,lease:null,cursor:page.done?s.cursor:page.nextCursor,
      pages:s.pages+1,processed:s.processed+page.recipients.length,created:s.created+counts.added,existing:s.existing+counts.existing,updatedAt:t};
    if(![next.pages,next.processed,next.created,next.existing].every(Number.isSafeInteger))throw new Error('Import counters exceeded safe integer limit');
    if(!await cas(s,next))throw new Error('Import checkpoint lost to another worker');
    return sanitized({...next,version:s.version+1});
  }
  async function fail(lease:Lease,error:unknown){for(let i=0;i<15;i++){
    const s=await read(),t=now();if(!belongs(s,lease,t))return false;
    // Exceptions from parsers/DB callbacks may contain email addresses or JSON.
    // Persist a non-PII classification instead of untrusted exception messages.
    const lastError=error instanceof TypeError?'IMPORT_INVALID_INPUT':error instanceof RangeError?'IMPORT_BOUNDS':
      'IMPORT_PAGE_FAILED';
    if(await cas(s,{...s,status:'failed',lease:null,lastError,updatedAt:t}))return true;
  }throw new Error('Import failure checkpoint contention');}
  async function runOnce(owner:string){
    const lease=await acquire(owner);if(!lease)return {busy:true,state:sanitized(await read())};
    let active=true,lost:unknown;let heartbeat=Promise.resolve();
    const timer=setInterval(()=>{if(!active||lost)return;heartbeat=heartbeat.then(()=>renew(lease)).catch(e=>{lost=e;});},Math.max(1000,Math.floor(leaseMs/3)));
    timer.unref?.();
    try{
      const s=await read();
      const page=await source.page({cursor:s.cursor,limit:batchSize});
      if(!page||!Array.isArray(page.recipients)||page.recipients.length>batchSize||!page.recipients.length&&!page.done||
        typeof page.done!=='boolean'||page.nextCursor!==null&&!safeCursor(page.nextCursor))throw new Error('Invalid import source page');
      if(page.done!==(page.nextCursor===null)||!page.done&&(!safeCursor(page.nextCursor)||s.cursor!==null&&page.nextCursor<=s.cursor))
        throw new Error('Invalid import source cursor');
      // A cancellation or lease takeover during source paging must not start a new append.
      const current=await read();if(!belongs(current,lease,now()))throw new Error('Import lease lost before append');
      const counts=page.recipients.length?await append(campaignCode,page.recipients):{added:0,existing:0,recipientCount:0};
      active=false;clearInterval(timer);await heartbeat;if(lost)throw lost;
      return {busy:false,state:await commit(lease,page,counts)};
    }catch(error){active=false;clearInterval(timer);await heartbeat;
      try{await fail(lease,error);}catch{/* original failure retained */}throw error;
    }finally{active=false;clearInterval(timer);}
  }
  async function cancel(){for(let i=0;i<15;i++){
    const s=await read(),t=now();if(s.status==='completed'||s.status==='cancelled')return sanitized(s);
    if(await cas(s,{...s,status:'cancelled',lease:null,epoch:s.epoch+1,updatedAt:t}))return sanitized({...s,status:'cancelled',lease:null,epoch:s.epoch+1,updatedAt:t,version:s.version+1});
  }throw new Error('Import cancellation contention');}
  /** Rescans the immutable source to include late changes only if a NEW source revision/job ID is used. */
  return {get:async()=>sanitized(await read()),acquire,renew,commit,runOnce,cancel};
}

/** Minimal BullMQ bridge: queue only job/campaign identifiers and keep the source,
 * recipient data and database credentials in the trusted worker. Repeated jobs are safe. */
export function createMarketingImportProcessor(resolve:(id:string,campaignCode:string)=>ReturnType<typeof createMarketingImportJob>|Promise<ReturnType<typeof createMarketingImportJob>>){
  if(typeof resolve!=='function')throw new TypeError('Import job resolver required');
  return async function process(job:{data?:unknown;id?:string},workerId:string){
    if(!job||!job.data||typeof job.data!=='object'||Array.isArray(job.data)||
      !jobIdPattern.test((job.data as any).id)||!campaignPattern.test((job.data as any).campaignCode)||
      !jobIdPattern.test(workerId)||Object.keys(job.data).some(k=>!['id','campaignCode'].includes(k)))
      throw new TypeError('Import queue message must contain only safe job identifiers');
    const {id,campaignCode}=job.data as {id:string;campaignCode:string};
    const task=await resolve(id,campaignCode);
    if(!task||typeof task.runOnce!=='function')throw new Error('Registered import job unavailable');
    return task.runOnce(workerId);
  };
}
export async function enqueueMarketingImportJob(
  queue:{add(name:string,data:{id:string;campaignCode:string},options:{jobId:string;attempts:number;backoff:{type:'exponential';delay:number}}):Promise<unknown>},
  id:string,campaignCode:string
){
  if(!jobIdPattern.test(id)||!campaignPattern.test(campaignCode)||typeof queue?.add!=='function')
    throw new TypeError('Invalid marketing import enqueue');
  const jobId='marketing-import-'+createHash('sha256').update(campaignCode+'\0'+id).digest('hex').slice(0,48);
  return queue.add('marketing.import',{id,campaignCode},{jobId,attempts:5,backoff:{type:'exponential',delay:5000}});
}
