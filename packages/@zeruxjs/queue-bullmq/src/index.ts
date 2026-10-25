import { randomUUID } from 'node:crypto';
import {createQueueDashboard, type QueueDashboardOptions} from './dashboard.js';
export {createQueueDashboard} from './dashboard.js';
export type {QueueDashboardOptions} from './dashboard.js';
export * from './delivery.js';
export * from './scheduling.js';
import {createQueueTaskScheduler, type ScheduledTaskSpec, type TaskScheduleOptions} from './scheduling.js';
import { createBullMQRedisOptions, createBullMQRedisClusterConnections, type RedisConnectionSettings, type BullMQClusterConstructor, type BullMQClusterClient } from '@zeruxjs/cache-redis';

export type JobData = Record<string, unknown>;
export type JobProcessor = (job: QueueJob, token?: string) => Promise<unknown> | unknown;
export interface QueueJob {
  id?: string; name: string; data: JobData; attemptsMade?: number;
  progress?: unknown; updateProgress?(progress: number | object): Promise<void>;
  timestamp?: number; processedOn?: number; finishedOn?: number;
  getState?(): Promise<string>; retry?(state?: 'failed' | 'completed'): Promise<void>;
  remove?(): Promise<void>;
}
export interface QueueJobOptions {
  jobId?: string; delay?: number; priority?: number; attempts?: number;
  backoff?: number | {type:'fixed'|'exponential';delay:number};
  removeOnComplete?: boolean | number | {age?:number;count?:number};
  removeOnFail?: boolean | number | {age?:number;count?:number};
  repeat?: {every?:number;pattern?:string;limit?:number;immediately?:boolean};
  deduplication?: {id:string;ttl?:number};
}
export interface QueueWorkerOptions {
  concurrency?: number; autorun?: boolean; lockDuration?: number;
  /** BullMQ Redis-coordinated limit, shared by all workers for the same queue. */
  limiter?:{max:number;duration:number};
}
export interface QueueDefinition {
  name:string;
  defaultJobOptions?:QueueJobOptions;
}
export interface QueueServiceConfig {
  enabled?:boolean;
  /** Use a shared Redis server with @zeruxjs/cache-redis but NOT its prefixed keyspace. */
  redis: RedisConnectionSettings;
  prefix?:string;
  queues: Array<string | QueueDefinition>;
  /** Worker processors only run when explicitly supplied by the application. */
  workers?: Record<string, {processor:JobProcessor} & QueueWorkerOptions>;
  /** Wait for producer connections before marking queue ready. */
  readyTimeoutMs?:number;
  /** On shutdown allow running jobs to complete within this time, then force close workers. */
  shutdownGraceMs?:number;
  /** Optional logging hook; caller controls what data is logged. */
  onWorkerError?: (queue:string, error:unknown)=>void;
  /** Optional cross-process BullMQ QueueEvents; no events connection exists unless enabled. */
  events?: {enabled:true;onEvent?:(event:QueueEventNotice)=>void;onError?:(queue:string,error:unknown)=>void};
  /** Required to use privileged controls; no HTTP routes are mounted automatically. */
  administration?: QueueAdministrationPolicy;
  /** Opt-in HTTP dashboard; requires administration.authorize and host session/CSRF callbacks. */
  dashboard?: QueueDashboardOptions;
}
export type QueueAdminAction='inspect'|'retry'|'pause-queue'|'resume-queue'|'pause-worker'|'resume-worker'|'schedule-inspect'|'schedule-create'|'schedule-remove';
export interface QueueAdministrationPolicy {
  /** Fail closed on absent callback, denial or callback error. No permission caching. */
  authorize:(action:QueueAdminAction,queue:string,context:unknown)=>boolean|Promise<boolean>;
  /** Best effort audit: do not include job data, Redis secrets, or message bodies. */
  onAudit?:(entry:{action:QueueAdminAction;queue:string;jobId?:string;success:boolean;at:string})=>void|Promise<void>;
  maxPageSize?:number;
}
export type QueueJobState='waiting'|'active'|'delayed'|'failed'|'completed'|'paused'|'waiting-children'|'prioritized';
export interface QueueJobSummary {
  id:string;name:string;state:string;attemptsMade:number;
  timestamp?:number;processedOn?:number;finishedOn?:number;
}
export interface QueueEventNotice {queue:string;type:'completed'|'failed'|'waiting'|'active'|'stalled'|'progress';jobId?:string;at:string}
export interface QueueEventsLike {
  on(event:string,handler:(...args:any[])=>void):this;
  waitUntilReady?():Promise<unknown>;
  close():Promise<void>;
}
export interface BullJobLike extends QueueJob {}
export interface BullQueueLike {
  add(name:string,data:JobData,options?:QueueJobOptions):Promise<BullJobLike>;
  addBulk(jobs:Array<{name:string;data:JobData;opts?:QueueJobOptions}>):Promise<BullJobLike[]>;
  getJob(id:string):Promise<BullJobLike | undefined | null>;
  getJobCounts(...states:string[]):Promise<Record<string,number>>;
  upsertJobScheduler?(id:string,repeat:Record<string,unknown>,template:{name:string;data:JobData;opts:QueueJobOptions}):Promise<BullJobLike>;
  removeJobScheduler?(id:string):Promise<boolean>;
  getJobSchedulers?(start:number,end:number,asc?:boolean):Promise<Array<Record<string,unknown>>>;
  pause():Promise<void>; resume():Promise<void>;
  waitUntilReady():Promise<unknown>;
  getJobs?(states:string[],start:number,end:number,asc?:boolean):Promise<BullJobLike[]>;
  close():Promise<void>;
}
export interface BullWorkerLike {
  on(event:string,fn:(...args:any[])=>void):this;
  run?():Promise<void>;
  close(force?:boolean):Promise<void>;
  pause?(doNotWaitActive?:boolean):Promise<void>;
  resume?():void;
}
export interface BullMQFactory {
  Queue:new(name:string,opts:Record<string,unknown>)=>BullQueueLike;
  Worker:new(name:string,processor:JobProcessor,opts:Record<string,unknown>)=>BullWorkerLike;
  QueueEvents?:new(name:string,opts:Record<string,unknown>)=>QueueEventsLike;
}
export interface ZeruxQueue {
  add(name:string,data:JobData,options?:QueueJobOptions):Promise<BullJobLike>;
  addBulk(jobs:Array<{name:string;data:JobData;options?:QueueJobOptions}>):Promise<BullJobLike[]>;
  getJob(id:string):Promise<BullJobLike | undefined | null>;
  counts(...states:string[]):Promise<Record<string,number>>;
  pause():Promise<void>; resume():Promise<void>;
}
export interface QueueOperations {
  /** Authenticated, bounded job metadata. Never returns job.data, error stacks, or result bodies. */
  status(queue:string,context:unknown):Promise<{counts:Record<string,number>;worker:boolean}>;
  inspect(queue:string,options:{states?:QueueJobState[];start?:number;limit?:number},context:unknown):Promise<{jobs:QueueJobSummary[];start:number;limit:number}>;
  /** Retry a SINGLE job only if it is currently failed. BullMQ performs atomic state checks. */
  retryFailed(queue:string,id:string,context:unknown):Promise<void>;
  pauseQueue(queue:string,context:unknown):Promise<void>;
  resumeQueue(queue:string,context:unknown):Promise<void>;
  /** Local process control only; global queue pause is a separate action. */
  pauseWorker(queue:string,context:unknown):Promise<void>;
  resumeWorker(queue:string,context:unknown):Promise<void>;
  /** Host-authorized scheduler operations; raw service.schedules() remains trusted code only. */
  listSchedules(queue:string,options:{start?:number;limit?:number},context:unknown):Promise<Array<{id:string;name?:string;next?:number}>>;
  scheduleOnce(queue:string,id:string,spec:ScheduledTaskSpec,when:Date|string|number,context:unknown,options?:TaskScheduleOptions):Promise<{id?:string}>;
  scheduleEvery(queue:string,id:string,spec:ScheduledTaskSpec,intervalMs:number,context:unknown,options?:TaskScheduleOptions):Promise<{id?:string}>;
  scheduleCron(queue:string,id:string,spec:ScheduledTaskSpec,pattern:string,context:unknown,options?:TaskScheduleOptions):Promise<{id?:string}>;
  removeSchedule(queue:string,id:string,context:unknown):Promise<boolean>;
  cancelOneOff(queue:string,id:string,context:unknown):Promise<boolean>;
}
const allowedStates=new Set<QueueJobState>(['waiting','active','delayed','failed','completed','paused','waiting-children','prioritized']);
const validJobId=(id:string)=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id);
const validPositive=(n:number,min:number,max:number,label:string)=>{if(!Number.isSafeInteger(n)||n<min||n>max)throw new RangeError(`Invalid ${label}`);return n;};
const validName = (name:string, kind:string) => {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)) throw new TypeError(`Invalid ${kind} name`);
  return name;
};
function validateJobOptions(options:QueueJobOptions | undefined) {
  if (options === undefined) return;
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Invalid job options');
  if (options.jobId !== undefined && !validJobId(options.jobId)) throw new TypeError('Invalid jobId');
  if (options.delay !== undefined) validPositive(options.delay,0,366*86_400_000,'job delay');
  if (options.priority !== undefined) validPositive(options.priority,0,2_097_152,'job priority');
  if (options.attempts !== undefined) validPositive(options.attempts,1,50,'job attempts');
  if (options.backoff !== undefined) {
    if (typeof options.backoff === 'number') validPositive(options.backoff,1,86_400_000,'job backoff');
    else if (!options.backoff || !['fixed','exponential'].includes(options.backoff.type)) throw new TypeError('Invalid job backoff');
    else validPositive(options.backoff.delay,1,86_400_000,'job backoff');
  }
  for (const key of ['removeOnComplete','removeOnFail'] as const) {
    const value=options[key];
    if (value===undefined || typeof value==='boolean') continue;
    if (typeof value==='number') validPositive(value,0,1_000_000, key);
    else if (!value || typeof value!=='object' || Array.isArray(value)) throw new TypeError(`Invalid ${key}`);
    else {
      if (value.age!==undefined) validPositive(value.age,0,366*86_400,key+' age');
      if (value.count!==undefined) validPositive(value.count,0,1_000_000,key+' count');
    }
  }
  if (options.deduplication!==undefined) {
    if (!options.deduplication || !validJobId(options.deduplication.id)) throw new TypeError('Invalid deduplication ID');
    if(options.deduplication.ttl!==undefined)validPositive(options.deduplication.ttl,1,366*86_400_000,'deduplication TTL');
  }
  if (options.repeat!==undefined) {
    const r=options.repeat;
    if (!r || typeof r!=='object'||Array.isArray(r)) throw new TypeError('Invalid repeat options');
    if (r.every!==undefined) validPositive(r.every,1000,366*86_400_000,'Repeat interval');
    if (r.limit!==undefined) validPositive(r.limit,1,1_000_000,'repeat limit');
    if (r.pattern!==undefined && (typeof r.pattern!=='string'||r.pattern.length>100||!([5,6].includes(r.pattern.trim().split(/\s+/).length))))throw new TypeError('Invalid repeat cron pattern');
  }
}
const deadline = async <T>(promise:Promise<T>, ms:number, message:string):Promise<T> => {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {return await Promise.race([promise,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);timer.unref?.();})]);}
  finally {if(timer)clearTimeout(timer);}
};

/** Create a managed BullMQ service. Inject a factory in unit tests; normally load real bullmq. */
export async function createQueueService(config:QueueServiceConfig, injected?:BullMQFactory, injectedCluster?:BullMQClusterConstructor) {
  if (!config || !config.redis || !Array.isArray(config.queues) || !config.queues.length) throw new TypeError('Queue requires Redis settings and at least one named queue');
  const prefix = config.prefix ?? 'zerux';
  if (config.redis.cluster) {
    if (!/^\{[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\}$/.test(prefix))throw new TypeError('Redis Cluster needs an explicit hash-tagged BullMQ prefix, e.g. {tenant-a}');
  } else validName(prefix,'queue prefix');
  const queueDefs = config.queues.map(item=>typeof item==='string'? {name:item}:item);
  const defined=new Set<string>();
  for(const def of queueDefs) {validName(def.name,'queue');if(defined.has(def.name))throw new TypeError('Duplicate queue name');defined.add(def.name);validateJobOptions(def.defaultJobOptions);}
  for(const name of Object.keys(config.workers??{})) {
    if(!defined.has(name))throw new TypeError(`Worker targets unknown queue ${name}`);
    const w=config.workers![name];if(typeof w.processor !== 'function')throw new TypeError('Worker processor must be a function');
    if(w.concurrency !== undefined && (!Number.isSafeInteger(w.concurrency)||w.concurrency<1||w.concurrency>1024))throw new TypeError('Worker concurrency must be 1..1024');
    if(w.autorun!==undefined&&typeof w.autorun!=='boolean')throw new TypeError('Worker autorun must be boolean');
    if(w.lockDuration!==undefined)validPositive(w.lockDuration,1000,600_000,'worker lock duration');
    if(w.limiter&&(!Number.isSafeInteger(w.limiter.max)||w.limiter.max<1||w.limiter.max>1_000_000||!Number.isSafeInteger(w.limiter.duration)||w.limiter.duration<1000||w.limiter.duration>86_400_000))throw new RangeError('Invalid Redis worker rate limit');
  }
  // Validate host-controlled operational limits before allocating Cluster sockets.
  if(config.shutdownGraceMs!==undefined)validPositive(config.shutdownGraceMs,1,300_000,'shutdown grace period');
  if(config.readyTimeoutMs!==undefined)validPositive(config.readyTimeoutMs,1,120_000,'queue ready timeout');
  if(config.administration?.maxPageSize!==undefined)validPositive(config.administration.maxPageSize,1,100,'administration.maxPageSize');
  const moduleName='bullmq';
  const bullmq=injected??await import(moduleName) as unknown as BullMQFactory;
  let ownedCluster: {producer:BullMQClusterClient;worker:BullMQClusterClient}|undefined;
  let connection: {producer:Record<string,unknown>|BullMQClusterClient;worker:Record<string,unknown>|BullMQClusterClient};
  if (config.redis.cluster) {
    const clusterModule='ioredis';
    const Cluster=injectedCluster??(await import(clusterModule) as {default:{Cluster:BullMQClusterConstructor}}).default.Cluster;
    ownedCluster=createBullMQRedisClusterConnections(config.redis,Cluster);
    connection=ownedCluster;
  } else connection=createBullMQRedisOptions(config.redis);
  const defaultJobOptions:QueueJobOptions={
    attempts:3,backoff:{type:'exponential',delay:1000},
    removeOnComplete:{age:86_400,count:10_000},removeOnFail:{age:604_800,count:10_000}
  };
  const queues=new Map<string,BullQueueLike>();
  const workers=new Map<string,BullWorkerLike>();
  const eventStreams=new Map<string,QueueEventsLike>();
  let closed=false,closePromise:Promise<void>|undefined;
  const ensureOpen=()=>{if(closed)throw new Error('Queue service is closed');};
  const getQueue=(name:string)=>{ensureOpen();const q=queues.get(name);if(!q)throw new Error(`Unknown queue: ${name}`);return q;};
  const policy=config.administration;
  const authorize=async(action:QueueAdminAction,name:string,context:unknown)=>{
    getQueue(name);
    if(!policy?.authorize||await policy.authorize(action,name,context)!==true)throw new Error('Queue administrative operation forbidden');
  };
  const audit=async(action:QueueAdminAction,queue:string,success:boolean,jobId?:string)=>{
    try{await policy?.onAudit?.({action,queue,success,at:new Date().toISOString(),...(jobId&&validJobId(jobId)?{jobId}:{})});}
    catch{/* Audit hook cannot cause a successful state transition to be retried. */}
  };
  const perform=async(action:QueueAdminAction,name:string,context:unknown,operation:()=>Promise<void>,id?:string)=>{
    await authorize(action,name,context);
    try{await operation();await audit(action,name,true,id);}
    catch(error){await audit(action,name,false,id);throw error;}
  };
  const performResult=async<T>(action:QueueAdminAction,name:string,context:unknown,operation:()=>Promise<T>,id?:string):Promise<T>=>{
    await authorize(action,name,context);
    try{const result=await operation();await audit(action,name,true,id);return result;}
    catch(error){await audit(action,name,false,id);throw error;}
  };
  const operations:QueueOperations={
    async status(name,context){
      await authorize('inspect',name,context);
      const counts=await getQueue(name).getJobCounts('waiting','active','delayed','failed','completed','paused','waiting-children','prioritized');
      await audit('inspect',name,true);
      return {counts,worker:workers.has(name)};
    },
    async inspect(name,options,context){
      await authorize('inspect',name,context);
      const states=options?.states??['failed'];
      if(!Array.isArray(states)||!states.length||states.length>8||states.some(s=>!allowedStates.has(s)))throw new TypeError('Invalid job states');
      const start=validPositive(options?.start??0,0,1_000_000,'inspection offset');
      const limit=validPositive(options?.limit??20,1,policy?.maxPageSize??50,'inspection limit');
      const q=getQueue(name);
      if(typeof q.getJobs!=='function')throw new Error('Queue driver does not support job inspection');
      const jobs=await q.getJobs(states,start,start+limit-1,false);
      await audit('inspect',name,true);
      const summaries=await Promise.all(jobs.slice(0,limit).map(async job=>({
        id:String(job.id??''),name:String(job.name),
        state:job.getState?await job.getState():states.length===1?states[0]:'unknown',
        attemptsMade:Number.isSafeInteger(job.attemptsMade)?job.attemptsMade!:0,
        ...(Number.isFinite(job.timestamp)?{timestamp:job.timestamp}:{}),
        ...(Number.isFinite(job.processedOn)?{processedOn:job.processedOn}:{}),
        ...(Number.isFinite(job.finishedOn)?{finishedOn:job.finishedOn}:{})
      })));
      return {start,limit,jobs:summaries};
    },
    retryFailed(name,id,context){
      if(!validJobId(id))return Promise.reject(new TypeError('Invalid job ID'));
      return perform('retry',name,context,async()=>{
        const job=await getQueue(name).getJob(id);
        if(!job||typeof job.retry!=='function'||typeof job.getState!=='function')throw new Error('Job not found or retry unsupported');
        if(await job.getState()!=='failed')throw new Error('Only failed jobs can be retried');
        await job.retry('failed');
      },id);
    },
    pauseQueue(name,context){return perform('pause-queue',name,context,()=>getQueue(name).pause());},
    resumeQueue(name,context){return perform('resume-queue',name,context,()=>getQueue(name).resume());},
    pauseWorker(name,context){return perform('pause-worker',name,context,async()=>{
      const worker=workers.get(name);if(!worker?.pause)throw new Error('No local worker for queue');
      await worker.pause();
    });},
    resumeWorker(name,context){return perform('resume-worker',name,context,async()=>{
      const worker=workers.get(name);if(!worker?.resume)throw new Error('No local worker for queue');
      await worker.resume();
    });},
    listSchedules(name,options,context){return performResult('schedule-inspect',name,context,()=>{
      return manager.schedules(name).list(options?.start??0,options?.limit??20);
    });},
    scheduleOnce(name,id,spec,when,context,options){return performResult('schedule-create',name,context,
      async()=>{const job=await manager.schedules(name).once(id,spec,when,options);return {id:job.id};},id);},
    scheduleEvery(name,id,spec,interval,context,options){return performResult('schedule-create',name,context,
      async()=>{const job=await manager.schedules(name).every(id,spec,interval,options);return {id:job.id};},id);},
    scheduleCron(name,id,spec,pattern,context,options){return performResult('schedule-create',name,context,
      async()=>{const job=await manager.schedules(name).cron(id,spec,pattern,options);return {id:job.id};},id);},
    removeSchedule(name,id,context){return performResult('schedule-remove',name,context,
      ()=>manager.schedules(name).remove(id),id);},
    cancelOneOff(name,id,context){return performResult('schedule-remove',name,context,
      ()=>manager.schedules(name).cancelOnce(id),id);}
  };
  const manager={
    operations,
    routes:()=>config.dashboard?createQueueDashboard({names:()=>[...queues.keys()],operations},config.dashboard).routes():[],
    schedules(name:string) {
      const q=getQueue(name);
      // Bind the scheduler to this runtime generation: calls after close are rejected.
      return createQueueTaskScheduler({
        add:(jobName,data,opts)=>{ensureOpen();return q.add(jobName,data,opts);},
        addBulk:jobs=>{ensureOpen();return q.addBulk(jobs.map(j=>({name:j.name,data:j.data,opts:j.options})));},
        getJob:id=>{ensureOpen();return q.getJob(id);},
        counts:(...states)=>{ensureOpen();return q.getJobCounts(...states);},
        pause:()=>{ensureOpen();return q.pause();},resume:()=>{ensureOpen();return q.resume();},
        upsertJobScheduler:(id,repeat,template)=>{ensureOpen();if(!q.upsertJobScheduler)throw new Error("BullMQ Job Scheduler unavailable");return q.upsertJobScheduler(id,repeat,template);},
        removeJobScheduler:(id)=>{ensureOpen();if(!q.removeJobScheduler)throw new Error("BullMQ Job Scheduler unavailable");return q.removeJobScheduler(id);},
        getJobSchedulers:(start,end,asc)=>{ensureOpen();if(!q.getJobSchedulers)throw new Error("BullMQ Job Scheduler unavailable");return q.getJobSchedulers(start,end,asc);}
      });
    },
    queue(name:string):ZeruxQueue {
      const q=getQueue(name);
      return {
        add(jobName,data,opts){ensureOpen();validName(jobName,'job');validateJobOptions(opts);return q.add(jobName,data,opts);},
        addBulk(jobs){ensureOpen();for(const job of jobs){validName(job.name,'job');validateJobOptions(job.options);}return q.addBulk(jobs.map(j=>({name:j.name,data:j.data,opts:j.options})));},
        getJob(id){ensureOpen();return q.getJob(id);},
        counts(...states){ensureOpen();return q.getJobCounts(...states);},
        pause(){ensureOpen();return q.pause();},resume(){ensureOpen();return q.resume();}
      };
    },
    names:()=>[...queues.keys()],
    worker:(name:string)=>workers.get(name),
    async snapshot() {
      ensureOpen();const result:Record<string,{counts:Record<string,number>;worker:boolean;events:boolean}>={};
      for(const [name,q] of queues)result[name]={
        counts:await q.getJobCounts('waiting','active','delayed','failed','completed','paused','waiting-children','prioritized'),
        worker:workers.has(name),events:eventStreams.has(name)
      };
      return result;
    },
    async health() {
      ensureOpen();const result:Record<string,boolean>={};
      for(const [name,queue] of queues) {
        try {await deadline(queue.waitUntilReady(),config.readyTimeoutMs??3_000,'Queue Redis check timed out');result[name]=true;} catch {result[name]=false;}
      }
      return result;
    },
    async close() {
      if(closePromise)return closePromise;
      closed=true;
      closePromise=(async()=>{
        const errors:unknown[]=[];
        const grace=config.shutdownGraceMs??30_000;
        for(const worker of [...workers.values()].reverse()) {
          // A worker can be stuck in a user-supplied processor; force-close after the grace period.
          try {await deadline(worker.close(),grace,'Worker shutdown deadline');}
          catch(error){try {await deadline(worker.close(true),Math.min(grace,5_000),'Forced worker shutdown deadline');}catch(forceError){errors.push(error,forceError);}}
        }
        for(const stream of [...eventStreams.values()].reverse()) {try{await deadline(stream.close(),Math.min(grace,5_000),'Queue events shutdown deadline');}catch(error){errors.push(error);}}
        for(const queue of [...queues.values()].reverse()) {try {await deadline(queue.close(),Math.min(grace,5_000),'Queue shutdown deadline');}catch(error){errors.push(error);}}
        workers.clear();eventStreams.clear();queues.clear();
        if(ownedCluster)for(const cluster of [ownedCluster.worker,ownedCluster.producer]){
          try{await deadline(cluster.quit(),Math.min(grace,5_000),'Redis Cluster close deadline');}
          catch(error){errors.push(error);}
        }
        if(errors.length)throw new AggregateError(errors,'Queue service shutdown failed');
      })();
      return closePromise;
    }
  };
  try {
    if(config.dashboard){
      if(!policy?.authorize)throw new TypeError('Queue dashboard requires administrative authorization');
      createQueueDashboard({names:()=>[...queues.keys()],operations},config.dashboard);
    }
    for(const def of queueDefs) {
      const q=new bullmq.Queue(def.name,{connection:connection.producer,prefix,defaultJobOptions:{...defaultJobOptions,...def.defaultJobOptions}});
      queues.set(def.name,q);
    }
    const timeout=config.readyTimeoutMs??3_000;
    if(!Number.isSafeInteger(timeout)||timeout<1||timeout>120_000)throw new TypeError('Invalid queue readyTimeoutMs');
    for(const q of queues.values()) await deadline(q.waitUntilReady(),timeout,'Queue Redis connection timed out');
    if(config.events?.enabled){
      if(!bullmq.QueueEvents)throw new Error('QueueEvents is unavailable in the installed BullMQ driver');
      for(const def of queueDefs){
        const stream=new bullmq.QueueEvents(def.name,{connection:connection.worker,prefix});
        eventStreams.set(def.name,stream);
        for(const type of ['completed','failed','waiting','active','stalled','progress'] as const){
          stream.on(type,(payload:unknown)=>{
            const obj=payload&&typeof payload==='object'?payload as {jobId?:unknown}:{};
            const jobId=typeof obj.jobId==='string'?obj.jobId:undefined;
            try{config.events?.onEvent?.({queue:def.name,type,at:new Date().toISOString(),...(jobId?{jobId}:{})});}catch{/* No callback may crash the stream */}
          });
        }
        stream.on('error',(error:unknown)=>{try{config.events?.onError?.(def.name,error);}catch{/* log only */}});
        if(stream.waitUntilReady)await deadline(stream.waitUntilReady(),timeout,'QueueEvents Redis connection timed out');
      }
    }
    for(const [name,options] of Object.entries(config.workers??{})) {
      // The Worker uses a dedicated connection configuration for blocking operations.
      const worker=new bullmq.Worker(name,options.processor,{connection:connection.worker,prefix,concurrency:options.concurrency??1,autorun:options.autorun??true,...(options.lockDuration?{lockDuration:options.lockDuration}:{}),...(options.limiter?{limiter:options.limiter}:{})});
      worker.on('error',(error:unknown)=>{try{config.onWorkerError?.(name,error);}catch{/* logging must never terminate a worker */}});
      workers.set(name,worker);
    }
    return manager;
  }catch(error){try{await manager.close();}catch{/* preserve the startup error */}throw error;}
}
export type QueueService=Awaited<ReturnType<typeof createQueueService>>;

/** Map trusted durable analytics jobs into queue workers without exposing a public endpoint. */
export function createAnalyticsReconciliationProcessor(
  jobs:Record<string,{runOnce(owner:string):Promise<{busy:boolean;state:{status:string}}>}>,
):JobProcessor {
  return async (job) => {
    if(job.name!=='analytics.reconcile') throw new Error('Unexpected analytics maintenance job');
    const id=job.data.id;
    if(typeof id!=='string'||!Object.hasOwn(jobs,id)) throw new Error('Unknown analytics reconciliation job');
    const target=jobs[id];
    const result=await target.runOnce(`bullmq-${randomUUID()}`);
    return {busy:result.busy,status:result.state.status};
  };
}

export interface QueuedEmailDescriptor {
  /** Durable message ID only; content, recipients and credentials live outside Redis. */
  id:string;
  purpose:'marketing'|'transactional';
  /** Recipient of a marketing email; transactional sends may omit it. */
  recipient?:string;
}
export interface QueuedEmailDeliveryAdapter {
  /** Resolve the CURRENT message state from a shared database. */
  load:(messageId:string)=>Promise<QueuedEmailDescriptor|null>;
  /** Read fresh, durable marketing consent; any store outage must reject, never assume consent. */
  isSubscribed:(recipient:string)=>Promise<boolean>;
  /** Durable suppression update, committed before this worker acknowledges the job. */
  suppress:(messageId:string,reason:'unsubscribed')=>Promise<void>;
  /** Must implement delivery idempotency/fencing in durable storage before SMTP sending. */
  deliver:(messageId:string)=>Promise<'sent'|'already-sent'|'suppressed'>;
}
/**
 * Bridge trusted email records to BullMQ. Redis jobs carry only a durable message ID.
 * Consent governs MARKETING delivery, not optional per-email activity tracking.
 * @warning BullMQ is at-least-once: delivery idempotency must be implemented in `deliver`.
 */
export function createEmailDeliveryProcessor(adapter:QueuedEmailDeliveryAdapter):JobProcessor {
  for(const key of ['load','isSubscribed','suppress','deliver'] as const){
    if(typeof adapter?.[key]!=='function')throw new TypeError(`Email queue adapter requires ${key}`);
  }
  return async(job)=>{
    if(job.name!=='email.deliver')throw new Error('Unexpected email queue job name');
    const messageId=job.data?.messageId;
    if(typeof messageId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(messageId))throw new TypeError('Invalid queued message ID');
    const message=await adapter.load(messageId);
    if(!message)throw new Error('Queued email record missing');
    if(message.id!==messageId||!['marketing','transactional'].includes(message.purpose))throw new Error('Invalid queued email record');
    if(message.purpose==='marketing'){
      if(typeof message.recipient!=='string'||!message.recipient.trim())throw new Error('Marketing recipient unavailable');
      // No fallback to transactional, no stale cached opt-in, and no dependence on tracking policy.
      if(!await adapter.isSubscribed(message.recipient)){
        await adapter.suppress(messageId,'unsubscribed');
        return {status:'suppressed'};
      }
    }
    const outcome=await adapter.deliver(messageId);
    if(!['sent','already-sent','suppressed'].includes(outcome))throw new Error('Invalid email delivery result');
    return {status:outcome};
  };
}

/** Enqueue only an opaque, durable message reference, never email content or SMTP credentials. */
export async function enqueueEmailById(
  queue:ZeruxQueue,messageId:string,options:{delay?:number;attempts?:number}={}
):Promise<BullJobLike>{
  if(typeof messageId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(messageId))throw new TypeError('Invalid queued message ID');
  if(options.delay!==undefined)validPositive(options.delay,0,365*24*60*60*1000,'email delay');
  if(options.attempts!==undefined)validPositive(options.attempts,1,20,'email attempts');
  return queue.add('email.deliver',{messageId},{
    jobId:`email-${messageId}`,...(options.delay===undefined?{}:{delay:options.delay}),
    attempts:options.attempts??5,backoff:{type:'exponential',delay:5000}
  });
}

export * from './campaigns.js';

export * from './reporting.js';
export * from './performance.js';
export * from './trends.js';
export * from './history.js';
export * from './history-gaps.js';

export * from './outbox.js';
export * from './recovery.js';
