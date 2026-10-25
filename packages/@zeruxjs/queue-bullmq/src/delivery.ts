import {randomUUID} from 'node:crypto';
import type {JobProcessor,ZeruxQueue,BullJobLike} from './index.js';

export type EmailDeliveryState='pending'|'claimed'|'sending'|'sent'|'suppressed'|'uncertain'|'rejected';
export interface DurableEmailDeliveryRecord {
  version:number;
  id:string;
  purpose:'marketing'|'transactional';
  recipient?:string;
  /** Optional campaign reference; persisted in the durable mail record, never Redis. */
  campaignId?:string;
  state:EmailDeliveryState;
  /** Trusted internal metadata. Never return this object in queue dashboard API. */
  lease:null|{owner:string;token:string;expiresAt:number};
  attemptedAt?:number;
  completedAt?:number;
  updatedAt:number;
}
/** Must be implemented with shared, atomic conditional updates (affectedCount=1). */
export interface DurableEmailDeliveryStore {
  load(id:string):Promise<DurableEmailDeliveryRecord|null>;
  save(id:string,next:DurableEmailDeliveryRecord,expectedVersion:number):Promise<boolean>;
}
export interface DurableEmailDeliveryOptions {
  store:DurableEmailDeliveryStore;
  /** Fresh preference check. Called before beginning delivery; sender must recheck at SMTP boundary. */
  isSubscribed:(email:string)=>Promise<boolean>;
  /** Fresh hard-bounce/complaint/manual suppression check, separate from marketing opt-in. */
  isSuppressed?:(email:string)=>Promise<boolean>;
  /** Optional live campaign gate: paused -> defer, cancelled -> suppress. */
  campaignGate?:(record:Readonly<DurableEmailDeliveryRecord>)=>Promise<'allow'|'defer'|'suppress'>;
  /** Send exactly one message ID; provider credentials and contents stay outside the queue. */
  send:(messageId:string,record:Readonly<DurableEmailDeliveryRecord>)=>Promise<unknown>;
  onUncertain?:(messageId:string)=>void|Promise<void>;
  leaseMs?:number;
  now?:()=>number;
}
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id);
/** Single-process fake for tests/development ONLY; production requires shared CAS persistence. */
export function createMemoryEmailDeliveryStore(initial:DurableEmailDeliveryRecord[]=[]):DurableEmailDeliveryStore & {insert(record:DurableEmailDeliveryRecord):void}{
  const records=new Map<string,DurableEmailDeliveryRecord>();
  const insert=(record:DurableEmailDeliveryRecord)=>{if(!validId(record.id)||records.has(record.id))throw new TypeError('Invalid or duplicated email record');records.set(record.id,structuredClone(record));};
  for(const record of initial)insert(record);
  return {
    insert,
    async load(id){const record=records.get(id);return record?structuredClone(record):null;},
    async save(id,next,expected){const current=records.get(id);if(!current||current.version!==expected||next.version!==expected+1||next.id!==id)return false;records.set(id,structuredClone(next));return true;}
  };
}
/**
 * Durable, conservative SMTP state machine. It never automatically sends again after
 * entering 'sending'. An ambiguous provider outcome becomes 'uncertain' for review.
 * A database CAS store and provider-level idempotency are recommended in production.
 */
export function createDurableEmailDeliveryProcessor(options:DurableEmailDeliveryOptions):JobProcessor {
  if(!options||typeof options.store?.load!=='function'||typeof options.store?.save!=='function'||
    typeof options.isSubscribed!=='function'||typeof options.send!=='function')throw new TypeError('Durable email delivery requires a store, consent check and sender');
  const leaseMs=options.leaseMs??60_000;
  if(!Number.isSafeInteger(leaseMs)||leaseMs<3000||leaseMs>3_600_000)throw new RangeError('Invalid email delivery lease');
  const clock=options.now??Date.now;
  const now=()=>{const value=clock();if(!Number.isSafeInteger(value)||value<0)throw new Error('Invalid clock');return value;};
  const read=async(id:string)=>{
    const record=await options.store.load(id);
    if(!record||record.id!==id||!Number.isSafeInteger(record.version)||record.version<1||
      !['pending','claimed','sending','sent','suppressed','uncertain','rejected'].includes(record.state)||
      !['transactional','marketing'].includes(record.purpose))throw new Error('Email record missing or invalid');
    return record;
  };
  const save=(old:DurableEmailDeliveryRecord,changes:Partial<DurableEmailDeliveryRecord>)=>options.store.save(old.id,{
    ...old,...changes,id:old.id,version:old.version+1,updatedAt:now()
  },old.version);
  const terminal=(state:EmailDeliveryState)=>state==='sent'||state==='suppressed'||state==='uncertain'||state==='rejected';
  async function transition(id:string,token:string,state:EmailDeliveryState){
    for(let i=0;i<12;i++){
      const current=await read(id);
      if(current.lease?.token!==token)throw new Error('Email delivery lease lost');
      if(await save(current,{state,lease:null,...(terminal(state)?{completedAt:now()}:{})}))return;
    }
    throw new Error('Email delivery state contention');
  }
  async function acquire(id:string){
    for(let i=0;i<12;i++){
      const current=await read(id),time=now();
      if(terminal(current.state))return {state:current.state} as const;
      if(current.state==='sending'){
        if(current.lease&&current.lease.expiresAt>time)return {state:'busy'} as const;
        // A crashed sender may have reached SMTP. Do NOT resend automatically.
        if(await save(current,{state:'uncertain',lease:null,completedAt:time}))return {state:'uncertain',recovered:true} as const;
        continue;
      }
      if(current.state==='claimed'&&current.lease&&current.lease.expiresAt>time)return {state:'busy'} as const;
      const token=randomUUID(),owner=randomUUID();
      if(await save(current,{state:'claimed',lease:{owner,token,expiresAt:time+leaseMs}}))return {state:'claimed',token} as const;
    }
    throw new Error('Email delivery claim contention');
  }
  return async job=>{
    if(job.name!=='email.deliver'||!validId(job.data?.messageId))throw new TypeError('Invalid email delivery job');
    const id=job.data.messageId;
    const claim=await acquire(id);
    if(claim.state==='busy')throw Object.assign(new Error('Email delivery claim busy; retry later'),{code:'EMAIL_DELIVERY_BUSY'});
    if(claim.state==='uncertain'&&'recovered' in claim&&claim.recovered){try{await options.onUncertain?.(id);}catch{/* Cannot affect state */}}
    if(claim.state!=='claimed')return {status:claim.state};
    const token=claim.token;
    let record=await read(id);
    try{
      if(record.purpose==='marketing'){
        if(typeof record.recipient!=='string'||!record.recipient.trim())throw new Error('Marketing recipient unavailable');
        const subscribed=await options.isSubscribed(record.recipient);
        if(subscribed!==true){
          if(subscribed!==false)throw new Error('Invalid marketing consent response');
          await transition(id,token,'suppressed');return {status:'suppressed'};
        }
        if(options.isSuppressed){
          const suppressed=await options.isSuppressed(record.recipient);
          if(typeof suppressed!=='boolean')throw new Error('Invalid marketing suppression response');
          if(suppressed){await transition(id,token,'suppressed');return {status:'suppressed'};}
        }
        if(options.campaignGate){
          const policy=await options.campaignGate(record);
          if(policy==='suppress'){await transition(id,token,'suppressed');return {status:'suppressed'};}
          if(policy==='defer')throw Object.assign(new Error('Campaign not accepting delivery'),{code:'CAMPAIGN_DELIVERY_DEFERRED'});
          if(policy!=='allow')throw new Error('Invalid campaign delivery policy');
        }
      }
    }catch(error){
      // Before SMTP begins, a failed consent read may be retried without duplicate delivery.
      const current=await read(id);
      if(current.state==='claimed'&&current.lease?.token===token)await save(current,{state:'pending',lease:null});
      throw error;
    }
    record=await read(id);
    if(record.state!=='claimed'||record.lease?.token!==token||record.lease.expiresAt<=now())throw new Error('Email delivery lease expired');
    if(!await save(record,{state:'sending',attemptedAt:now()}))throw new Error('Email delivery lease contested');
    // The sender must check marketing consent again immediately before SMTP acceptance.
    // No heartbeat after 'sending': expiration is *uncertain*, never a replay trigger.
    try{
      const provider=await options.send(id,record);
      // New email manager callers disclose explicit SMTP envelope uncertainty.
      // Legacy custom senders that return void remain responsible for their own verified result.
      if(provider&&typeof provider==='object'&&'submissionStatus' in provider){
        const reported=(provider as {submissionStatus:unknown}).submissionStatus;
        if(!['accepted','partial','rejected','unknown'].includes(String(reported)))throw new Error('Invalid SMTP submission classification');
        if(reported==='rejected'){await transition(id,token,'rejected');return {status:'rejected'};}
        if(reported!=='accepted'){
          await transition(id,token,'uncertain');
          try{await options.onUncertain?.(id);}catch{/* No duplicate send */}
          return {status:'uncertain'};
        }
      }
      await transition(id,token,'sent');
      return {status:'sent'};
    }catch{
      // Even an ETIMEDOUT may have been accepted. Never auto retry an ambiguous outcome.
      let recorded=false;
      try{await transition(id,token,'uncertain');recorded=true;}catch{/* Lease expiry/recovery will mark uncertain. */}
      if(recorded)try{await options.onUncertain?.(id);}catch{/* notification cannot trigger duplicate delivery */}
      return {status:'uncertain'};
    }
  };
}
/** One bounded campaign batch. Application must persist and authorize recipient/message IDs beforehand. */
export async function enqueueEmailCampaignBatch(
  queue:ZeruxQueue,ids:readonly string[],options:{sendAt:number;attempts?:number;now?:number}
):Promise<BullJobLike[]>{
  if(!Array.isArray(ids)||ids.length<1||ids.length>200||ids.some(id=>!validId(id))||new Set(ids).size!==ids.length)
    throw new TypeError('Campaign batch must contain 1..200 distinct durable message IDs');
  const now=options.now??Date.now();
  if(!Number.isSafeInteger(options.sendAt)||!Number.isSafeInteger(now)||options.sendAt<now-30_000||options.sendAt>now+365*86_400_000)
    throw new RangeError('Invalid campaign delivery time');
  const attempts=options.attempts??5;
  if(!Number.isSafeInteger(attempts)||attempts<1||attempts>20)throw new RangeError('Invalid campaign attempts');
  const delay=Math.max(0,options.sendAt-now);
  return queue.addBulk(ids.map(messageId=>({name:'email.deliver',data:{messageId},options:{
    jobId:`email-${messageId}`,delay,attempts,backoff:{type:'exponential',delay:5000} as const
  }})));
}

/**
 * Resolve SMTP uncertainty only after an operator independently verifies a provider record.
 * This never requeues or sends a message. Persist your evidence in an audit store.
 */
export async function resolveUncertainEmailDelivery(
  store:DurableEmailDeliveryStore,id:string,
  decision:'sent'|'suppressed'|'rejected',
  options:{context:unknown;authorize:(context:unknown,id:string,decision:string)=>Promise<boolean>|boolean;onAudit?:(entry:{id:string;decision:string;at:string})=>Promise<void>|void}
):Promise<boolean>{
  if(!validId(id)||!['sent','suppressed','rejected'].includes(decision)||typeof options?.authorize!=='function')throw new TypeError('Invalid delivery resolution');
  if(await options.authorize(options.context,id,decision)!==true)throw new Error('Delivery resolution forbidden');
  for(let i=0;i<12;i++){
    const record=await store.load(id);
    if(!record||record.id!==id)throw new Error('Unknown email delivery record');
    if(record.state!== 'uncertain')throw new Error('Only uncertain delivery may be manually resolved');
    const timestamp=Date.now();
    if(await store.save(id,{...record,version:record.version+1,state:decision,lease:null,completedAt:timestamp,updatedAt:timestamp},record.version)){
      try{await options.onAudit?.({id,decision,at:new Date(timestamp).toISOString()});}catch{/* No replay after committed transition */}
      return true;
    }
  }
  throw new Error('Delivery resolution contention');
}
