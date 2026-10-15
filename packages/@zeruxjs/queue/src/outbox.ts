/** Section 69: a durable, DB-backed queue publish-intent ledger.
 * Registration commits before Redis publish. This is recoverable at-least-once
 * queue publication, NOT a cross-database/Redis transaction or exactly-once SMTP. */
import {randomUUID} from 'node:crypto';
import type {DeliveryDatabase} from './reporting.js';
import type {ZeruxQueue,JobProcessor} from './index.js';
import type {DurableEmailDeliveryStore} from './delivery.js';

const identifier=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const tableName=/^[a-z][a-z0-9_]{0,62}$/;
const validTime=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=8_640_000_000_000_000;
export type DeliveryOutboxStatus='pending'|'leased'|'published'|'abandoned';
export interface DeliveryOutboxIntent {
  id:string;version:number;status:DeliveryOutboxStatus;scheduledAt:number;attempts:number;
  lease:null|{token:string;expiresAt:number};createdAt:number;updatedAt:number;
}
export interface DeliveryPublishOutbox {
  register(id:string,options:{scheduledAt:number;attempts?:number}):Promise<{created:boolean;status:DeliveryOutboxStatus}>;
  get(id:string):Promise<DeliveryOutboxIntent|null>;
  page(options?:{cursor?:string|null;limit?:number}):Promise<{items:DeliveryOutboxIntent[];nextCursor:string|null;done:boolean}>;
  due(options?:{cursor?:string|null;limit?:number}):Promise<{items:DeliveryOutboxIntent[];nextCursor:string|null;done:boolean}>;
  claim(id:string,leaseMs:number):Promise<DeliveryOutboxIntent|null>;
  settle(id:string,token:string,status:'pending'|'published'|'abandoned'):Promise<boolean>;
  /** Admin-only hook; must be gated by an authenticated service (see redriver). */
  reopen(id:string):Promise<boolean>;
}
/** No recipient, SMTP credential, MIME, template or campaign payload is written into this ledger. */
export function createDatabaseDeliveryOutbox(db:DeliveryDatabase,table='zerux_email_publish_outbox',now:()=>number=Date.now):DeliveryPublishOutbox {
  if(!db||!['createTable','insert','select','update'].every(name=>typeof (db as any)[name]==='function')||!tableName.test(table))throw new TypeError('Invalid delivery outbox database');
  const clock=()=>{const t=now();if(!validTime(t))throw new Error('Invalid outbox clock');return t;};
  let ready:Promise<void>|undefined;
  const ensure=()=>ready??=(async()=>{
    const r=await db.createTable({table,ifNotExists:true,columns:[
      {name:'id',type:'varchar',length:128,primary:true,notNull:true},
      {name:'version',type:'bigint',notNull:true},
      {name:'status',type:'varchar',length:16,notNull:true},
      {name:'lease_until',type:'bigint'},
      {name:'payload_json',type:'text',notNull:true}
    ]});
    if(!r?.ok)throw new Error('Delivery outbox table unavailable');
    if(db.createIndex)try{await db.createIndex({table,name:`${table.slice(0,42)}_status`,columns:['status','id'],ifNotExists:true});}catch{/* optimization only */}
  })().catch(e=>{ready=undefined;throw e;});
  const columns=['id','version','status','lease_until','payload_json'];
  const validate=(row:DeliveryOutboxIntent)=>{
    if(!row||!identifier.test(row.id)||!Number.isSafeInteger(row.version)||row.version<1||
      !['pending','leased','published','abandoned'].includes(row.status)||!validTime(row.scheduledAt)||
      !Number.isSafeInteger(row.attempts)||row.attempts<1||row.attempts>20||
      !validTime(row.createdAt)||!validTime(row.updatedAt)||
      (row.lease!==null&&(!row.lease||!/^[-a-f0-9]{36}$/.test(row.lease.token)||!validTime(row.lease.expiresAt)))||
      (row.status==='leased')!==(row.lease!==null))throw new Error('Invalid durable outbox record');
  };
  const decode=(raw:unknown):DeliveryOutboxIntent=>{
    const r=raw as Record<string,unknown>;
    if(!r||typeof r.payload_json!=='string')throw new Error('Corrupt outbox payload');
    const entry=JSON.parse(r.payload_json) as DeliveryOutboxIntent;validate(entry);
    if(entry.id!==r.id||entry.version!==Number(r.version)||entry.status!==r.status||
      (entry.lease?.expiresAt??null)!==(r.lease_until===null||r.lease_until===undefined?null:Number(r.lease_until)))
      throw new Error('Outbox payload/index mismatch');
    return entry;
  };
  const get=async(id:string)=>{
    if(!identifier.test(id))throw new TypeError('Invalid outbox message ID');
    await ensure();const r=await db.select({table,columns,where:{field:'id',operator:'eq',value:id},limit:1});
    if(!r?.ok||!Array.isArray(r.rows)||r.rows.length>1)throw new Error('Outbox read unavailable');
    return r.rows.length?decode(r.rows[0]):null;
  };
  const update=async(old:DeliveryOutboxIntent,next:DeliveryOutboxIntent):Promise<boolean>=>{
    if(next.id!==old.id||next.version!==old.version+1||next.scheduledAt!==old.scheduledAt||next.attempts!==old.attempts)throw new Error('Invalid outbox transition');
    validate(next);
    const r=await db.update({table,values:{version:next.version,status:next.status,lease_until:next.lease?.expiresAt??null,payload_json:JSON.stringify(next)},
      where:{and:[{field:'id',operator:'eq',value:old.id},{field:'version',operator:'eq',value:old.version}]}});
    if(!r?.ok)throw new Error('Outbox CAS unavailable');
    const affected=r.affectedCount??r.rowCount;
    if(typeof affected!=='number'||!Number.isSafeInteger(affected)||affected<0||affected>1)throw new Error('Outbox requires atomic affectedCount');
    return affected===1;
  };
  return {
    get,
    async register(id,{scheduledAt,attempts=3}){
      if(!identifier.test(id)||!validTime(scheduledAt)||!Number.isSafeInteger(attempts)||attempts<1||attempts>20)throw new TypeError('Invalid outbox intent');
      const existing=await get(id);
      // The schedule is immutable: callers must not silently reschedule a durable intent.
      if(existing){if(existing.scheduledAt!==scheduledAt||existing.attempts!==attempts)throw new Error('Conflicting delivery publish intent');return {created:false,status:existing.status};}
      const t=clock();const item:DeliveryOutboxIntent={id,version:1,status:'pending',scheduledAt,attempts,lease:null,createdAt:t,updatedAt:t};
      try{const r=await db.insert({table,values:{id,version:1,status:'pending',lease_until:null,payload_json:JSON.stringify(item)}});
        if(r?.ok)return {created:true,status:'pending'};}
      catch(error){const old=await get(id);if(!old)throw error;if(old.scheduledAt!==scheduledAt||old.attempts!==attempts)throw new Error('Conflicting delivery publish intent');return {created:false,status:old.status};}
      const old=await get(id);if(old&&old.scheduledAt===scheduledAt&&old.attempts===attempts)return {created:false,status:old.status};
      throw new Error('Outbox registration failed');
    },
    async page({cursor=null,limit=100}:{cursor?:string|null;limit?:number}={}){
      if(cursor!==null&&!identifier.test(cursor)||!Number.isSafeInteger(limit)||limit<1||limit>250)throw new TypeError('Invalid outbox scan bounds');
      await ensure();const r=await db.select({table,columns,...(cursor?{where:{field:'id',operator:'gt',value:cursor}}:{}),orderBy:[{by:'id',direction:'asc'}],limit:limit+1});
      if(!r?.ok||!Array.isArray(r.rows)||r.rows.length>limit+1)throw new Error('Outbox scan unavailable');
      const more=r.rows.length>limit,items=r.rows.slice(0,limit).map(decode);
      for(let i=0;i<items.length;i++)if(cursor&&items[i]!.id<=cursor||i>0&&items[i]!.id<=items[i-1]!.id)throw new Error('Outbox scan unordered');
      return {items,nextCursor:more?items.at(-1)!.id:null,done:!more};
    },
    /** Only actionable records; a large published archive cannot starve new work. */
    async due({cursor=null,limit=100}:{cursor?:string|null;limit?:number}={}){
      if(cursor!==null&&!identifier.test(cursor)||!Number.isSafeInteger(limit)||limit<1||limit>250)throw new TypeError('Invalid due outbox scan bounds');
      await ensure();const t=clock();
      const conditions:any[]=[{field:'status',operator:'eq',value:'pending'},
        {and:[{field:'status',operator:'eq',value:'leased'},{field:'lease_until',operator:'lte',value:t}]}];
      const where={and:[{or:conditions},...(cursor?[{field:'id',operator:'gt',value:cursor}]:[])]};
      const r=await db.select({table,columns,where,orderBy:[{by:'id',direction:'asc'}],limit:limit+1});
      if(!r?.ok||!Array.isArray(r.rows)||r.rows.length>limit+1)throw new Error('Outbox due scan unavailable');
      const more=r.rows.length>limit,items=r.rows.slice(0,limit).map(decode);
      for(let i=0;i<items.length;i++)if(items[i]!.status!=='pending'&&!(items[i]!.status==='leased'&&items[i]!.lease!.expiresAt<=t)||
        cursor&&items[i]!.id<=cursor||i>0&&items[i]!.id<=items[i-1]!.id)throw new Error('Outbox due scan returned invalid records');
      return {items,nextCursor:more?items.at(-1)!.id:null,done:!more};
    },
    async claim(id,leaseMs){
      if(!Number.isSafeInteger(leaseMs)||leaseMs<3000||leaseMs>3_600_000)throw new RangeError('Invalid publish lease');
      for(let i=0;i<12;i++){
        const old=await get(id);if(!old)return null;
        const t=clock();
        if(old.status==='published'||old.status==='abandoned'||old.status==='leased'&&old.lease!.expiresAt>t)return null;
        const next:DeliveryOutboxIntent={...old,version:old.version+1,status:'leased',updatedAt:t,
          lease:{token:randomUUID(),expiresAt:t+leaseMs}};
        if(!validTime(next.lease!.expiresAt))throw new RangeError('Invalid outbox lease expiration');
        if(await update(old,next))return next;
      }
      throw new Error('Outbox claim contention');
    },
    async reopen(id){
      for(let i=0;i<12;i++){
        const old=await get(id);if(!old||old.status!=='published')return false;
        const next:DeliveryOutboxIntent={...old,version:old.version+1,status:'pending',lease:null,updatedAt:clock()};
        if(await update(old,next))return true;
      }
      throw new Error('Outbox redrive contention');
    },
    async settle(id,token,status){
      if(!/^[-a-f0-9]{36}$/.test(token)||!['pending','published','abandoned'].includes(status))throw new TypeError('Invalid outbox settlement');
      for(let i=0;i<12;i++){
        const old=await get(id);if(!old||old.status!=='leased'||old.lease?.token!==token||old.lease.expiresAt<=clock())return false;
        const next:DeliveryOutboxIntent={...old,version:old.version+1,status,lease:null,updatedAt:clock()};
        if(await update(old,next))return true;
      }
      throw new Error('Outbox settlement contention');
    }
  };
}
export function createDeliveryOutboxDispatcher(options:{outbox:DeliveryPublishOutbox;queue:Pick<ZeruxQueue,'add'>;
  delivery:Pick<DurableEmailDeliveryStore,'load'>;now?:()=>number;leaseMs?:number}){
  if(!options?.outbox||typeof options.outbox.claim!=='function'||typeof options.outbox.settle!=='function'||typeof options.outbox.due!=='function'||typeof options.queue?.add!=='function'||typeof options.delivery?.load!=='function')throw new TypeError('Outbox dispatcher requires durable intent and queue');
  const now=options.now??Date.now,leaseMs=options.leaseMs??60_000;
  if(!Number.isSafeInteger(leaseMs)||leaseMs<3000||leaseMs>3_600_000)throw new RangeError('Invalid dispatcher lease');
  const dispatch=async(id:string)=>{
    const claim=await options.outbox.claim(id,leaseMs);
    if(!claim)return 'skipped' as const;
    const token=claim.lease!.token;
    try{
      {
        const state=await options.delivery.load(id);
        if(!state||state.id!==id)throw new Error('Outbox message has no matching durable delivery');
        // An in-flight (even expired) pre-SMTP claim requires the separate
        // recovery scanner before republishing; never abandon it forever.
        if(state.state==='claimed'){
          if(!await options.outbox.settle(id,token,'pending'))throw new Error('Lost outbox lease while deferring claimed delivery');
          return 'deferred' as const;
        }
        // Sending might have reached SMTP; terminal deliveries must never replay.
        if(state.state!=='pending'){
          if(!await options.outbox.settle(id,token,'abandoned'))throw new Error('Lost outbox lease after skip');
          return 'abandoned' as const;
        }
      }
      const time=now();if(!validTime(time))throw new Error('Invalid dispatch clock');
      // Both job name and payload are fixed. PII must never be included in Redis.
      await options.queue.add('email.deliver',{messageId:id},{jobId:id,delay:Math.max(0,claim.scheduledAt-time),attempts:claim.attempts});
      if(!await options.outbox.settle(id,token,'published')){
        // Queue accepted the job, but the DB acknowledgement is unknown. Safe to
        // retry the same stable BullMQ job ID; durable delivery CAS gates SMTP.
        throw new Error('Outbox acknowledgement lost after queue publication');
      }
      return 'published' as const;
    }catch(error){try{await options.outbox.settle(id,token,'pending');}catch{/* expired claims can be reclaimed */}throw error;}
  };
  const runPage=async({cursor=null,limit=100}:{cursor?:string|null;limit?:number}={})=>{
    const page=await options.outbox.due({cursor,limit});
    let published=0,skipped=0,abandoned=0,deferred=0,failed=0;
    for(const item of page.items){
      if(item.status==='published'||item.status==='abandoned'){skipped++;continue;}
      if(item.status==='leased'&&item.lease!.expiresAt>now()){skipped++;continue;}
      try{const result=await dispatch(item.id);if(result==='published')published++;else if(result==='abandoned')abandoned++;else if(result==='deferred')deferred++;else skipped++;}
      catch{failed++;}
    }
    return {scanned:page.items.length,published,skipped,abandoned,deferred,failed,nextCursor:page.nextCursor,done:page.done};
  };
  return {dispatch,runPage};
}
/** Drop-in producer for marketing.enqueue()/redrivePending().
 * Returns after durable registration, not after Redis acceptance. A scheduler must
 * periodically run the dispatcher. Dynamic relative delays on replay are ignored;
 * the original immutable scheduledAt is preserved. */
export function createOutboxBackedEmailQueue(options:{outbox:DeliveryPublishOutbox;now?:()=>number;dispatch?:{dispatch(id:string):Promise<unknown>};onDispatchFailure?:(error:unknown)=>void|Promise<void>}){
  if(!options?.outbox||typeof options.outbox.register!=='function')throw new TypeError('Durable outbox required');
  const now=options.now??Date.now;
  return {
    async add(name:string,data:{messageId:string},settings:{jobId:string;delay:number;attempts:number}){
      if(name!=='email.deliver'||!identifier.test(data?.messageId)||settings?.jobId!==data.messageId||
        !Number.isSafeInteger(settings.delay)||settings.delay<0||!Number.isSafeInteger(settings.attempts)||settings.attempts<1||settings.attempts>20)
        throw new TypeError('Invalid durable email queue intent');
      const existing=await options.outbox.get(data.messageId);
      if(!existing){const t=now();if(!validTime(t)||!validTime(t+settings.delay))throw new Error('Invalid queued schedule');
        await options.outbox.register(data.messageId,{scheduledAt:t+settings.delay,attempts:settings.attempts});}
      else if(existing.attempts!==settings.attempts)throw new Error('Conflicting delivery retry configuration');
      if(options.dispatch)try{await options.dispatch.dispatch(data.messageId);}catch(error){try{await options.onDispatchFailure?.(error);}catch{/* no throwing after durable intent */}}
      return {id:data.messageId,persisted:true};
    }
  };
}

/** Explicit, authorized repair of a LOST queue job. Not called by normal workers.
 * Checking BullMQ is an observation, not a multi-system lock; delivery CAS is
 * the authoritative guard against duplicate SMTP sends. */
export function createDeliveryOutboxRedriver(options:{outbox:DeliveryPublishOutbox;
  delivery:Pick<DurableEmailDeliveryStore,'load'>;
  queue:Pick<ZeruxQueue,'getJob'>;authorize:(id:string)=>Promise<boolean>|boolean}){
  if(!options?.outbox||typeof options.outbox.reopen!=='function'||typeof options.delivery?.load!=='function'||
    typeof options.queue?.getJob!=='function'||typeof options.authorize!=='function')throw new TypeError('Authenticated redrive requires outbox, delivery and queue');
  return async function redrive(id:string){
    if(!identifier.test(id))throw new TypeError('Invalid outbox message identity');
    if(await options.authorize(id)!==true)throw new Error('Outbox redrive not authorized');
    const row=await options.outbox.get(id);if(!row||row.status!=='published')return {reopened:false,reason:'not-published' as const};
    const delivery=await options.delivery.load(id);
    if(!delivery||delivery.id!==id||delivery.state!=='pending')return {reopened:false,reason:'not-pending' as const};
    const job=await options.queue.getJob(id);
    if(job)return {reopened:false,reason:'queue-job-present' as const};
    return {reopened:await options.outbox.reopen(id),reason:'queue-job-missing' as const};
  };
}

/** Call from an opt-in cron/interval job, or call dispatcher.runPage yourself.
 * Does not schedule recurring jobs automatically or store PII in the job. */
export function createDeliveryOutboxJobProcessor(
  dispatcher:ReturnType<typeof createDeliveryOutboxDispatcher>,options:{pageSize?:number;maxPages?:number}={}):JobProcessor {
  if(!dispatcher||typeof dispatcher.runPage!=='function')throw new TypeError('Outbox dispatcher required');
  const pageSize=options.pageSize??100,maxPages=options.maxPages??10;
  if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>250||!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>100)
    throw new RangeError('Invalid outbox job scan limits');
  return async job=>{
    if(job.name!=='email.outbox.poll'||!job.data||Object.keys(job.data).length!==0)throw new TypeError('Outbox poll accepts no job payload');
    let cursor:string|null=null,pages=0,scanned=0,published=0,skipped=0,abandoned=0,deferred=0,failed=0,done=false;
    while(pages<maxPages){
      const result=await dispatcher.runPage({cursor,limit:pageSize});
      pages++;scanned+=result.scanned;published+=result.published;skipped+=result.skipped;abandoned+=result.abandoned;deferred+=result.deferred;failed+=result.failed;
      if(result.done){done=true;break;}
      if(!result.nextCursor||result.nextCursor===cursor)throw new Error('Outbox scan cursor did not advance');
      cursor=result.nextCursor;
    }
    return {pages,scanned,published,skipped,abandoned,deferred,failed,done,nextCursor:done?null:cursor};
  };
}
