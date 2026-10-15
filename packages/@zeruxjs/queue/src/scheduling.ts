import type {BullJobLike,JobProcessor,JobData,QueueJobOptions,ZeruxQueue} from './index.js';

const identifier=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const validId=(value:string,kind:string)=>{if(typeof value!=='string'||!identifier.test(value))throw new TypeError(`Invalid ${kind}`);return value;};
const clonePayload=(data:JobData):JobData=>{
  if(!data||typeof data!=='object'||Array.isArray(data))throw new TypeError('Scheduled task data must be an object');
  const json=JSON.stringify(data);
  if(typeof json!=='string'||Buffer.byteLength(json)>8192)throw new RangeError('Scheduled task data exceeds 8 KiB');
  const parsed=JSON.parse(json) as JobData;
  if(Object.keys(parsed).some(k=>['__proto__','constructor','prototype'].includes(k)))throw new TypeError('Unsafe task data key');
  return parsed;
};
const validTime=(date:Date|string|number):number=>{
  const value=date instanceof Date?date.getTime():typeof date==='string'?Date.parse(date):date;
  if(!Number.isSafeInteger(value)||value<=Date.now()||value>Date.now()+366*86_400_000)throw new RangeError('Scheduled execution must be within the next 366 days');
  return value;
};
export interface TaskScheduleOptions {
  attempts?:number;
  backoffMs?:number;
  startDate?:string|number|Date;
  endDate?:string|number|Date;
  limit?:number;
  timezone?:string;
}
export interface ScheduledTaskSpec {task:string;data?:JobData;}
export interface BullSchedulerQueueLike extends ZeruxQueue {
  upsertJobScheduler?(id:string,repeat:Record<string,unknown>,template:{name:string;data:JobData;opts:QueueJobOptions}):Promise<BullJobLike>;
  removeJobScheduler?(id:string):Promise<boolean>;
  getJobSchedulers?(start:number,end:number,asc?:boolean):Promise<Array<Record<string,unknown>>>;
}
const defaultOptions=(options:TaskScheduleOptions)=>{
  const attempts=options.attempts??3,backoffMs=options.backoffMs??1000;
  if(!Number.isSafeInteger(attempts)||attempts<1||attempts>30||!Number.isSafeInteger(backoffMs)||backoffMs<100||backoffMs>3_600_000)throw new RangeError('Invalid scheduled task retry policy');
  return {attempts,backoff:{type:'exponential' as const,delay:backoffMs}};
};
function repeatDates(options:TaskScheduleOptions){
  const repeat:Record<string,unknown>={};
  if(options.startDate!==undefined)repeat.startDate=new Date(validTime(options.startDate));
  if(options.endDate!==undefined){const end=options.endDate instanceof Date?options.endDate.getTime():typeof options.endDate==='string'?Date.parse(options.endDate):options.endDate;
    if(!Number.isSafeInteger(end)||end<=Date.now())throw new RangeError('Invalid schedule end date');repeat.endDate=new Date(end);}
  if(options.startDate&&options.endDate&&Number(repeat.endDate instanceof Date?repeat.endDate.getTime():0)<=Number((repeat.startDate as Date).getTime()))throw new RangeError('Schedule end must follow start');
  if(options.limit!==undefined){if(!Number.isSafeInteger(options.limit)||options.limit<1||options.limit>1_000_000)throw new RangeError('Invalid schedule limit');repeat.limit=options.limit;}
  return repeat;
}
/** BullMQ Job Scheduler facade. Scheduler state is Redis durable, with no per-process timers. */
export function createQueueTaskScheduler(queue:BullSchedulerQueueLike){
  const recurring=(id:string,spec:ScheduledTaskSpec,options:TaskScheduleOptions,repeat:Record<string,unknown>)=>{
    validId(id,'schedule ID');validId(spec.task,'task name');
    if(!queue.upsertJobScheduler)throw new Error('This BullMQ version does not support Job Schedulers');
    return queue.upsertJobScheduler(id,{...repeatDates(options),...repeat},{name:'zerux.task',data:{task:spec.task,payload:clonePayload(spec.data??{})},opts:defaultOptions(options)});
  };
  return {
    once(id:string,spec:ScheduledTaskSpec,when:Date|string|number,options:TaskScheduleOptions={}):Promise<BullJobLike>{
      validId(id,'schedule ID');validId(spec.task,'task name');
      const time=validTime(when);
      return queue.add('zerux.task',{task:spec.task,payload:clonePayload(spec.data??{})},{jobId:`task-${id}`,delay:time-Date.now(),...defaultOptions(options)});
    },
    every(id:string,spec:ScheduledTaskSpec,intervalMs:number,options:TaskScheduleOptions={}):Promise<BullJobLike>{
      if(!Number.isSafeInteger(intervalMs)||intervalMs<1000||intervalMs>366*86_400_000)throw new RangeError('Invalid schedule interval');
      return recurring(id,spec,options,{every:intervalMs});
    },
    cron(id:string,spec:ScheduledTaskSpec,pattern:string,options:TaskScheduleOptions={}):Promise<BullJobLike>{
      // Reject user-supplied command syntax; the BullMQ cron parser validates ranges and calendar semantics.
      if(typeof pattern!=='string'||pattern.length>100||!/^[\d\s*,/\-LW#?A-Za-z]+$/.test(pattern)||!([5,6].includes(pattern.trim().split(/\s+/).length)))throw new TypeError('Invalid cron pattern');
      const timezone=options.timezone??'UTC';
      try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{throw new TypeError('Invalid cron timezone');}
      return recurring(id,spec,options,{pattern:pattern.trim(),tz:timezone});
    },
    /** Cancel one delayed/waiting task. Recurring schedulers use remove(), not cancelOnce(). */
    async cancelOnce(id:string):Promise<boolean>{
      validId(id,'schedule ID');
      const job=await queue.getJob(`task-${id}`);
      if(!job)return false;
      if(typeof job.getState!=='function'||typeof job.remove!=='function')throw new Error('This queue driver cannot safely cancel one-off tasks');
      const state=await job.getState();
      if(state!=='delayed'&&state!=='waiting')throw new Error('Only pending one-off tasks can be canceled');
      // BullMQ itself refuses removal if a worker acquires the job concurrently.
      await job.remove();
      return true;
    },
    async remove(id:string):Promise<boolean>{
      validId(id,'schedule ID');if(!queue.removeJobScheduler)throw new Error('Scheduler removal unsupported');return queue.removeJobScheduler(id);
    },
    async list(start=0,limit=20):Promise<Array<{id:string;name?:string;next?:number}>>{
      if(!Number.isSafeInteger(start)||start<0||start>100_000||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new RangeError('Invalid scheduler pagination');
      if(!queue.getJobSchedulers)throw new Error('Scheduler listing unsupported');
      const results=await queue.getJobSchedulers(start,start+limit-1,true);
      // Never expose a scheduled job's payload or credentials through inventory.
      return results.map(item=>({id:String(item.id??''),...(typeof item.name==='string'?{name:item.name}:{}),...(typeof item.next==='number'?{next:item.next}:{})}));
    }
  };
}

export type ScheduledTaskHandler=(payload:JobData,context:{jobId?:string;attemptsMade:number;timestamp?:number})=>Promise<unknown>|unknown;
/** Register code-owned handlers at application startup. Redis never chooses executable code. */
export function createTaskRegistry(){
  const handlers=new Map<string,ScheduledTaskHandler>();
  return {
    register(name:string,handler:ScheduledTaskHandler){validId(name,'task name');if(typeof handler!=='function'||handlers.has(name))throw new TypeError('Invalid or duplicate task handler');handlers.set(name,handler);return this;},
    unregister(name:string){return handlers.delete(name);},
    names(){return [...handlers.keys()];},
    processor: (async job=>{
      if(job.name!=='zerux.task')throw new TypeError('Unexpected scheduled job');
      const name=job.data?.task;
      if(typeof name!=='string'||!identifier.test(name))throw new TypeError('Invalid scheduled task');
      const handler=handlers.get(name);if(!handler)throw new Error(`Unregistered task ${name}`);
      return handler(clonePayload(job.data.payload as JobData??{}),{jobId:job.id,attemptsMade:job.attemptsMade??0,timestamp:job.timestamp});
    }) satisfies JobProcessor
  };
}
