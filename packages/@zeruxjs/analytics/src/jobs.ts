import {randomUUID} from 'node:crypto';
import type {NumericReconciliationQuery,NumericReconciliationResult} from './reconciliation.js';
import type {VersionedStore} from './documents.js';

/** A durable *scan checkpoint*, not a transactional completeness certificate. */
export interface NumericReconciliationJobDocument {
  version:number;
  id:string;
  /** Immutable projection identity: table and sorted numeric fields, created with the job. */
  projectionKey:string;
  pass:number;
  query:Readonly<Pick<NumericReconciliationQuery,'since'|'until'|'site'|'batchSize'>>;
  status:'pending'|'running'|'failed'|'completed';
  cursor:string|null;
  scanned:number;
  created:number;
  existing:number;
  invalidRows:number;
  expectedFacts:number;
  pages:number;
  epoch:number;
  lease:null|{owner:string;token:string;expiresAt:number};
  updatedAt:number;
  lastError:string|null;
}
export type ReconciliationJobState=Omit<NumericReconciliationJobDocument,'lease'> & {lease:null|{owner:string;expiresAt:number}};
export interface NumericReconciliationLease {readonly owner:string;readonly token:string;readonly epoch:number}
export interface NumericReconciliationJobOptions {
  id:string;
  query:NumericReconciliationQuery;
  store:VersionedStore<NumericReconciliationJobDocument>;
  projectionKey?:string;
  /** An isolated caller must use a shared DB-backed CAS store in production. */
  reconcile:(query:NumericReconciliationQuery)=>Promise<NumericReconciliationResult>;
  leaseMs?:number;
  /** Test-only deterministic clock; production defaults to Date.now. */
  now?:()=>number;
}

function validateJob(id:string,query:NumericReconciliationQuery):NumericReconciliationJobDocument['query']{
  if(!/^[A-Za-z0-9_.:-]{1,90}$/.test(id))throw new TypeError('Invalid reconciliation job ID');
  if(!query||!Number.isSafeInteger(query.since)||query.since<0||!Number.isSafeInteger(query.until)||query.until<query.since)
    throw new RangeError('Reconciliation job requires an explicit closed time window');
  if(query.cursor!==undefined)throw new TypeError('Job cursor is managed by the durable checkpoint');
  if(query.site!==undefined&&(typeof query.site!=='string'||query.site.length>200||/[\x00-\x1f]/.test(query.site)))throw new TypeError('Invalid reconciliation job site');
  const batchSize=query.batchSize??100;
  if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>200)throw new RangeError('Invalid reconciliation job batch size');
  return {since:query.since,until:query.until,...(query.site===undefined?{}:{site:query.site}),batchSize};
}
function publicState(document:NumericReconciliationJobDocument):ReconciliationJobState {
  const {lease,...remaining}=document;
  return structuredClone({...remaining,lease:lease?{owner:lease.owner,expiresAt:lease.expiresAt}:null});
}

/**
 * A fenced, persisted one-window backfill coordinator. State transitions use atomic
 * version CAS. A crashed worker leaves an expiring lease, never an advanced cursor.
 * Concurrent in-flight fact writes are safe only with UNIQUE(event_id,property_name).
 */
export function createNumericReconciliationJob(options:NumericReconciliationJobOptions){
  const {id,store,reconcile}=options;
  const projectionKey=options.projectionKey??'';
  const query=validateJob(id,options.query);
  const leaseMs=options.leaseMs??60_000;
  if(!Number.isSafeInteger(leaseMs)||leaseMs<3_000||leaseMs>3_600_000)throw new RangeError('Invalid reconciliation lease duration');
  const clock=options.now??Date.now;
  const time=()=>{const value=clock();if(!Number.isSafeInteger(value)||value<0)throw new Error('Invalid reconciliation clock');return value;};
  const initial:NumericReconciliationJobDocument={version:1,id,projectionKey,pass:1,query,status:'pending',cursor:null,scanned:0,created:0,existing:0,
    invalidRows:0,expectedFacts:0,pages:0,epoch:0,lease:null,updatedAt:time(),lastError:null};
  // The persisted row owns its identity. An existing ID with different bounds or
  // batch size must never quietly adopt a new job's settings.
  async function read(){
    const document=await store.load();
    if(document.id!==id||document.projectionKey!==projectionKey||JSON.stringify(document.query)!==JSON.stringify(query)||
      !Number.isSafeInteger(document.version)||document.version<1||!Number.isSafeInteger(document.epoch)||document.epoch<0||
      !Number.isSafeInteger(document.pass)||document.pass<1||
      !['pending','running','failed','completed'].includes(document.status)||
      (document.cursor!==null&&(typeof document.cursor!=='string'||document.cursor.length>36))||
      ![document.scanned,document.created,document.existing,document.invalidRows,document.expectedFacts,document.pages].every(v=>Number.isSafeInteger(v)&&v>=0))
      throw new Error('Reconciliation job identity or configuration conflict');
    return document;
  }
  async function cas(previous:NumericReconciliationJobDocument,next:NumericReconciliationJobDocument){
    return store.save({...next,version:previous.version+1},previous.version);
  }
  const belongs=(doc:NumericReconciliationJobDocument,lease:NumericReconciliationLease,now:number)=>
    doc.status==='running'&&doc.lease?.owner===lease.owner&&doc.lease.token===lease.token&&
    doc.epoch===lease.epoch&&doc.lease.expiresAt>now;
  const tokenFor=(doc:NumericReconciliationJobDocument):NumericReconciliationLease=>({
    owner:doc.lease!.owner,token:doc.lease!.token,epoch:doc.epoch
  });
  const validOwner=(owner:string)=>{if(typeof owner!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(owner))throw new TypeError('Invalid reconciliation worker ID');};
  async function acquire(owner:string):Promise<NumericReconciliationLease|null>{
    validOwner(owner);
    for(let attempt=0;attempt<12;attempt++){
      const current=await read(),now=time();
      if(current.status==='completed'||current.lease&&current.lease.expiresAt>now)return null;
      const next:NumericReconciliationJobDocument={...current,status:'running',epoch:current.epoch+1,
        lease:{owner,token:randomUUID(),expiresAt:now+leaseMs},updatedAt:now,lastError:null};
      if(await cas(current,next))return tokenFor(next);
    }
    throw new Error('Reconciliation lease contention exceeded retry budget');
  }
  async function renew(lease:NumericReconciliationLease):Promise<void>{
    for(let attempt=0;attempt<12;attempt++){
      const current=await read(),now=time();
      if(!belongs(current,lease,now))throw new Error('Reconciliation lease lost');
      if(await cas(current,{...current,lease:{...current.lease!,expiresAt:now+leaseMs},updatedAt:now}))return;
    }
    throw new Error('Reconciliation heartbeat contention exceeded retry budget');
  }
  async function checkpoint(lease:NumericReconciliationLease,page:NumericReconciliationResult):Promise<ReconciliationJobState>{
    const current=await read(),now=time();
    if(!belongs(current,lease,now))throw new Error('Reconciliation lease lost');
    for(const key of ['scanned','expectedFacts','created','existing','invalidRows'] as const)
      if(!Number.isSafeInteger(page[key])||page[key]<0)throw new Error('Invalid reconciliation page metrics');
    if(page.created+page.existing!==page.expectedFacts||page.hasMore===page.windowExhausted||
      (page.hasMore&&(!page.nextCursor||typeof page.nextCursor!=='string'||page.nextCursor.length>36||
      /[\x00-\x20\x7f]/.test(page.nextCursor)||
      (current.cursor!==null&&page.nextCursor<=current.cursor)))||
      (!page.hasMore&&page.nextCursor!==null)||page.scanned<1&&page.hasMore)
      throw new Error('Invalid reconciliation checkpoint result');
    const next:NumericReconciliationJobDocument={...current,
      status:page.hasMore?'pending':'completed',cursor:page.hasMore?page.nextCursor:current.cursor,
      scanned:current.scanned+page.scanned,created:current.created+page.created,existing:current.existing+page.existing,
      invalidRows:current.invalidRows+page.invalidRows,expectedFacts:current.expectedFacts+page.expectedFacts,
      pages:current.pages+1,lease:null,lastError:null,updatedAt:now};
    // Never persist a precision-losing checkpoint. Large scans must be partitioned into smaller jobs.
    if(![next.scanned,next.created,next.existing,next.invalidRows,next.expectedFacts,next.pages].every(Number.isSafeInteger))
      throw new Error('Reconciliation checkpoint exceeds safe integer range');
    // Fencing: renewal/takeover moves the document version. A losing CAS cannot commit.
    if(!await cas(current,next))throw new Error('Reconciliation checkpoint version changed; replay after lease expiry');
    return publicState({...next,version:current.version+1});
  }
  async function fail(lease:NumericReconciliationLease,error:unknown):Promise<boolean>{
    const message=error instanceof Error?error.message:String(error);
    for(let attempt=0;attempt<12;attempt++){
      const current=await read(),now=time();
      if(!belongs(current,lease,now))return false;
      if(await cas(current,{...current,status:'failed',lease:null,updatedAt:now,lastError:message.slice(0,400)}))return true;
    }
    throw new Error('Reconciliation failure checkpoint contention exceeded retry budget');
  }
  /** Begin a new full scan, after completion or failure, to include late/backdated events. */
  async function restart():Promise<ReconciliationJobState>{
    for(let attempt=0;attempt<12;attempt++){
      const current=await read(),now=time();
      if(current.lease&&current.lease.expiresAt>now)throw new Error('Reconciliation job is leased by another worker');
      const next:NumericReconciliationJobDocument={...initial,version:current.version+1,pass:current.pass+1,
        epoch:current.epoch+1,updatedAt:now};
      if(await store.save(next,current.version))return publicState(next);
    }
    throw new Error('Reconciliation restart contention exceeded retry budget');
  }
  async function runOnce(owner:string):Promise<{busy:boolean;state:ReconciliationJobState}>{
    const lease=await acquire(owner);
    if(!lease)return {busy:true,state:publicState(await read())};
    // Renew during long-running pages. Timer only exists for this actively awaited job.
    let active=true,lost:unknown;
    let heartbeat=Promise.resolve();
    const timer=setInterval(()=>{
      if(!active||lost)return;
      heartbeat=heartbeat.then(()=>renew(lease)).catch(error=>{lost=error;});
    },Math.max(1000,Math.floor(leaseMs/3)));
    timer.unref?.();
    try{
      const state=await read();
      const page=await reconcile({...query,...(state.cursor?{cursor:state.cursor}:{})});
      active=false;clearInterval(timer);await heartbeat;
      if(lost)throw lost;
      return {busy:false,state:await checkpoint(lease,page)};
    }catch(error){
      active=false;clearInterval(timer);await heartbeat;
      // Failed pages do not advance the durable cursor; a replacement worker
      // may replay them after failure or expiry.
      try{await fail(lease,error);}catch{/* keep the original failure */}
      throw error;
    }finally{active=false;clearInterval(timer);}
  }
  return {get:async()=>publicState(await read()),acquire,renew,checkpoint,fail,runOnce,restart};
}
