import type {EmailMessage,EmailResult} from './types.js';
export interface EmailQueueOptions {concurrency?:number;maxPending?:number;retries?:number;backoffMs?:number;maxBackoffMs?:number}
interface Job {message:EmailMessage;resolve:(r:EmailResult)=>void;reject:(e:unknown)=>void;signal?:AbortSignal}
/** Memory-only bounded worker queue. Retry only transient transport/network errors, never authorization failures. */
export function createEmailQueue(sender:{send(message:EmailMessage):Promise<EmailResult>},settings:EmailQueueOptions={}){
  const concurrency=settings.concurrency??2,maxPending=settings.maxPending??100,retries=settings.retries??2,backoff=settings.backoffMs??250,maxBackoff=settings.maxBackoffMs??5000;
  for(const [label,n,max] of [['concurrency',concurrency,32],['maxPending',maxPending,100000],['retries',retries,10],['backoffMs',backoff,60000],['maxBackoffMs',maxBackoff,600000]] as const){if(!Number.isSafeInteger(n)||n<(label==='retries'||label.includes('backoff')?0:1)||n>max)throw new RangeError(`Invalid ${label}`);}
  const queue:Job[]=[];let active=0,closed=false;let drainWaiters:Array<()=>void>=[];
  const wake=()=>{if(active===0&&queue.length===0){for(const done of drainWaiters)done();drainWaiters=[];}};
  const transient=(err:unknown)=>{const code=(err as {code?:string})?.code;return ['ECONNECTION','ETIMEDOUT','ESOCKET','ECONNRESET','EAI_AGAIN','EMESSAGE'].includes(String(code));};
  const delay=(ms:number,signal?:AbortSignal)=>new Promise<void>((resolve,reject)=>{
    if(signal?.aborted){reject(signal.reason??new Error('Aborted'));return;}
    const timeout=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
    function abort(){clearTimeout(timeout);reject(signal?.reason??new Error('Aborted'));}
    signal?.addEventListener('abort',abort,{once:true});
  });
  async function send(job:Job){
    for(let attempt=0;;attempt++){
      if(job.signal?.aborted)throw job.signal.reason??new Error('Aborted');
      try{return await sender.send(job.message);}catch(error){if(attempt>=retries||!transient(error))throw error;await delay(Math.min(backoff*2**attempt,maxBackoff),job.signal);}
    }
  }
  function tick(){while(!closed&&active<concurrency&&queue.length){const job=queue.shift()!;active++;void send(job).then(job.resolve,job.reject).finally(()=>{active--;tick();wake();});}wake();}
  return {
    enqueue(message:EmailMessage,options:{signal?:AbortSignal}={}):Promise<EmailResult>{
      if(closed)return Promise.reject(new Error('Queue closed'));
      if(queue.length+active>=maxPending)return Promise.reject(Object.assign(new Error('Email queue full'),{code:'EMAIL_QUEUE_FULL'}));
      return new Promise((resolve,reject)=>{queue.push({message,resolve,reject,signal:options.signal});tick();});
    },
    stats(){return {active,pending:queue.length,closed};},
    async flush(){if(!active&&!queue.length)return;await new Promise<void>(resolve=>drainWaiters.push(resolve));},
    async close(options:{drain?:boolean}={}){
      if(options.drain){await this.flush();closed=true;return;}
      closed=true;for(const item of queue.splice(0))item.reject(new Error('Queue closed'));wake();
    },
  };
}
