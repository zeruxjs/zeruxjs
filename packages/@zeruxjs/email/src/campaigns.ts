import {createHash,randomUUID} from 'node:crypto';
import {validateEmailAddress,addressString} from './validation.js';
import type {EmailMessage} from './types.js';

export type CampaignStatus='draft'|'scheduled'|'running'|'paused'|'completed'|'cancelled';
export type CampaignPrimitive=string|number|boolean|null;
export interface CampaignContact {id:string;email:string;traits?:Record<string,CampaignPrimitive>}
export interface CampaignCondition {field:string;operator:'eq'|'ne'|'in'|'gt'|'gte'|'lt'|'lte'|'exists';value?:CampaignPrimitive|CampaignPrimitive[]}
export interface CampaignSegment {all?:CampaignCondition[];any?:CampaignCondition[]}
export interface CampaignDefinition {
  id:string;name:string;sendAt:number;segment?:CampaignSegment;
  /** Fully independent from consent: absence/disabled is never auto-enabled. */
  tracking?:EmailMessage['tracking'];
}
export interface CampaignTarget {messageId:string;contactId:string;recipient:string}
export interface CampaignState extends CampaignDefinition {
  version:number;status:CampaignStatus;cursor:string|null;endOfScan:boolean;
  pending:CampaignTarget[];scanned:number;eligible:number;queued:number;skipped:number;
  lease:null|{token:string;expiresAt:number};createdAt:number;updatedAt:number;
}
/** Production implementation MUST provide atomic insert-if-absent and version-checked updates. */
export interface CampaignStore {
  create(record:CampaignState):Promise<boolean>;
  load(id:string):Promise<CampaignState|null>;
  save(record:CampaignState,expectedVersion:number):Promise<boolean>;
}
export interface CampaignSource {
  /** Stable, unique contacts; opaque exclusive cursor; repeatable order for resuming. */
  page(args:{cursor:string|null;limit:number}):Promise<{contacts:CampaignContact[];nextCursor:string|null;done:boolean}>;
}
export interface CampaignPlannerOptions {
  store:CampaignStore;source:CampaignSource;
  isSubscribed:(email:string)=>Promise<boolean>;
  isSuppressed:(email:string)=>Promise<boolean>;
  /** Idempotently persist a durable marketing message. DO NOT send here. */
  ensureMessage:(target:CampaignTarget,context:{campaignId:string;tracking:EmailMessage['tracking']})=>Promise<void>;
  /** Idempotently enqueue a stable BullMQ jobId based on messageId. */
  enqueue:(messageId:string,sendAt:number)=>Promise<void>;
  now?:()=>number;batchSize?:number;leaseMs?:number;
  onAudit?:(entry:{campaignId:string;action:string;at:string})=>void|Promise<void>;
  /** Best-effort aggregate operational telemetry; never contains recipient PII or controls activity tracking. */
  onMetric?:(metric:{campaignId:string;kind:'queued'|'scheduled'|'completed'|'cancelled';at:number;count:number})=>Promise<void>|void;
}
const idPattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const fieldPattern=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const validId=(id:unknown):id is string=>typeof id==='string'&&idPattern.test(id);
const isPrimitive=(v:unknown):v is CampaignPrimitive=>v===null||typeof v==='string'&&v.length<=512||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v);
const canonical=(s:string)=>addressString(validateEmailAddress(s)).toLowerCase().trim();
const clone=<T>(value:T):T=>structuredClone(value);
function validateSegment(segment:CampaignSegment|undefined):void{
  if(segment===undefined)return;
  if(!segment||typeof segment!=='object'||Array.isArray(segment))throw new TypeError('Invalid campaign segment');
  if(Object.keys(segment).some(k=>k!=='all'&&k!=='any'))throw new TypeError('Unknown campaign segment key');
  for(const conditions of [segment.all,segment.any]){
    if(conditions===undefined)continue;
    if(!Array.isArray(conditions)||conditions.length>12)throw new RangeError('Invalid segment conditions');
    for(const c of conditions){
      if(!c||!fieldPattern.test(c.field)||['constructor','prototype','__proto__'].includes(c.field)||Object.keys(c).some(k=>!['field','operator','value'].includes(k))||!['eq','ne','in','gt','gte','lt','lte','exists'].includes(c.operator))throw new TypeError('Invalid segment condition');
      if(c.operator==='exists'){
        if(typeof c.value!=='boolean')throw new TypeError('exists expects a boolean');
      }else if(c.operator==='in'){
        if(!Array.isArray(c.value)||!c.value.length||c.value.length>30||!c.value.every(isPrimitive))throw new TypeError('in expects 1..30 primitive values');
      }else if(['gt','gte','lt','lte'].includes(c.operator)){
        if(typeof c.value!=='number'||!Number.isFinite(c.value))throw new TypeError('Numeric comparison required');
      }else if(!isPrimitive(c.value))throw new TypeError('Invalid condition value');
    }
  }
}
function matchesOne(contact:CampaignContact,c:CampaignCondition){
  const value=c.field==='email'?contact.email:contact.traits?.[c.field];
  if(c.operator==='exists')return (value!==undefined&&value!==null)===c.value;
  if(c.operator==='in')return (c.value as CampaignPrimitive[]).includes(value as CampaignPrimitive);
  if(c.operator==='eq')return value===c.value;
  if(c.operator==='ne')return value!==undefined&&value!==c.value;
  if(typeof value!=='number'||!Number.isFinite(value))return false;
  const compare=c.value as number;
  if(c.operator==='gt')return value>compare;
  if(c.operator==='gte')return value>=compare;
  if(c.operator==='lt')return value<compare;
  return value<=compare;
}
export function matchesCampaignSegment(contact:CampaignContact,segment?:CampaignSegment){
  validateSegment(segment);
  return (!segment?.all||segment.all.every(c=>matchesOne(contact,c)))&&(!segment?.any?.length||segment.any.some(c=>matchesOne(contact,c)));
}
function validateTracking(t:CampaignDefinition['tracking']):void{
  if(t===undefined)return;
  if(!t||typeof t!=='object'||Array.isArray(t)||Object.keys(t).some(k=>!['enabled','opens','clicks','downloads','downloadLinks','campaign'].includes(k)))throw new TypeError('Invalid campaign tracking policy');
  for(const field of ['enabled','opens','clicks','downloads'] as const)if(t[field]!==undefined&&typeof t[field]!=='boolean')throw new TypeError('Invalid campaign tracking flag');
  if(t.downloadLinks!==undefined&&(!Array.isArray(t.downloadLinks)||t.downloadLinks.length>20||t.downloadLinks.some(v=>typeof v!=='string'||v.length>2048)))throw new TypeError('Invalid campaign download links');
  if(t.campaign!==undefined&&(!validId(t.campaign)))throw new TypeError('Invalid tracking campaign');
}
function makeMessageId(campaignId:string,recipient:string){return 'cmp_'+createHash('sha256').update(campaignId+'\0'+recipient).digest('hex').slice(0,40);}
export function createMemoryCampaignStore(initial:CampaignState[]=[]):CampaignStore {
  const records=new Map<string,CampaignState>();
  for(const v of initial){if(!validId(v.id)||records.has(v.id))throw new TypeError('Duplicate campaign');records.set(v.id,clone(v));}
  return {
    async create(v){if(records.has(v.id))return false;records.set(v.id,clone(v));return true;},
    async load(id){return records.has(id)?clone(records.get(id)!):null;},
    async save(v,expected){const old=records.get(v.id);if(!old||old.version!==expected||v.version!==expected+1)return false;records.set(v.id,clone(v));return true;}
  };
}
export function createCampaignPlanner(options:CampaignPlannerOptions){
  for(const key of ['store','source','isSubscribed','isSuppressed','ensureMessage','enqueue'] as const)if(!options?.[key])throw new TypeError(`Campaign planner missing ${key}`);
  const batchSize=options.batchSize??100,leaseMs=options.leaseMs??60_000;
  if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>200)throw new RangeError('Invalid campaign batch size');
  if(!Number.isSafeInteger(leaseMs)||leaseMs<3000||leaseMs>3_600_000)throw new RangeError('Invalid campaign lease');
  const clock=options.now??Date.now;
  const now=()=>{const t=clock();if(!Number.isSafeInteger(t)||t<0)throw new Error('Invalid campaign clock');return t;};
  async function save(v:CampaignState,change:Partial<CampaignState>):Promise<CampaignState|null>{
    const next={...v,...change,version:v.version+1,updatedAt:now()};
    return await options.store.save(next,v.version)?next:null;
  }
  async function audit(id:string,action:string){try{await options.onAudit?.({campaignId:id,action,at:new Date(now()).toISOString()});}catch{/* auditing failures cannot replay queue operations */}}
  async function metric(id:string,kind:'queued'|'scheduled'|'completed'|'cancelled',count=1){try{await options.onMetric?.({campaignId:id,kind,count,at:now()});}catch{/* Analytics is best effort and independent from mail activity tracking */}}
  async function create(def:CampaignDefinition){
    if(!validId(def?.id)||typeof def.name!=='string'||def.name.trim().length<1||def.name.length>120||!Number.isSafeInteger(def.sendAt)||def.sendAt<0||def.sendAt>now()+365*86_400_000)throw new TypeError('Invalid campaign definition');
    if(Object.keys(def).some(k=>!['id','name','sendAt','segment','tracking'].includes(k)))throw new TypeError('Unknown campaign definition field');
    validateSegment(def.segment);validateTracking(def.tracking);
    const state:CampaignState={...clone(def),version:1,status:'draft',cursor:null,endOfScan:false,pending:[],scanned:0,eligible:0,queued:0,skipped:0,lease:null,createdAt:now(),updatedAt:now()};
    if(!await options.store.create(state))throw new Error('Campaign already exists');
    await audit(def.id,'create');return clone(state);
  }
  async function command(id:string,action:'schedule'|'pause'|'resume'|'cancel'){
    if(!validId(id))throw new TypeError('Invalid campaign ID');
    for(let i=0;i<20;i++){
      const old=await options.store.load(id);if(!old)throw new Error('Campaign not found');
      let status:CampaignStatus;
      if(action==='schedule'&&old.status==='draft')status='scheduled';
      else if(action==='pause'&&['running','scheduled'].includes(old.status))status='paused';
      else if(action==='resume'&&old.status==='paused')status=now()<old.sendAt?'scheduled':'running';
      else if(action==='cancel'&&['draft','scheduled','running','paused'].includes(old.status))status='cancelled';
      else throw new Error('Invalid campaign transition');
      const updated=await save(old,{status});if(updated){await audit(id,action);if(action==='schedule'||action==='cancel')await metric(id,action==='schedule'?'scheduled':'cancelled');return updated;}
    }
    throw new Error('Campaign state contention');
  }
  async function runOnce(id:string,workerId:string){
    if(!validId(id)||!validId(workerId))throw new TypeError('Invalid campaign/worker ID');
    const token=randomUUID();let claimed:CampaignState|undefined;
    for(let i=0;i<20;i++){
      const old=await options.store.load(id);if(!old)throw new Error('Campaign not found');
      if(['draft','paused','completed','cancelled'].includes(old.status))return {status:old.status,processed:0};
      if(old.sendAt>now())return {status:'scheduled',processed:0};
      if(old.lease&&old.lease.expiresAt>now())return {status:'busy',processed:0};
      const next=await save(old,{status:'running',lease:{token,expiresAt:now()+leaseMs}});
      if(next){claimed=next;break;}
    }
    if(!claimed)throw new Error('Campaign lease contention');
    let current=claimed,processed=0;
    async function commit(change:Partial<CampaignState>){
      const fresh=await options.store.load(id);
      if(!fresh||fresh.version!==current.version||fresh.lease?.token!==token||fresh.lease.expiresAt<=now()||fresh.status!=='running')throw new Error('Campaign lease lost or paused');
      const saved=await save(fresh,change);if(!saved)throw new Error('Campaign checkpoint contention');
      current=saved;
    }
    try{
      if(!current.pending.length&&!current.endOfScan){
        const result=await options.source.page({cursor:current.cursor,limit:batchSize});
        if(!result||!Array.isArray(result.contacts)||result.contacts.length>batchSize||typeof result.done!=='boolean'||result.nextCursor!==null&&(typeof result.nextCursor!=='string'||result.nextCursor.length>1024)||!result.done&&(!result.nextCursor||result.nextCursor===current.cursor))throw new Error('Invalid audience page');
        const seen=new Set<string>(),pending:CampaignTarget[]=[];let skipped=0;
        for(const contact of result.contacts){
          if(!contact||!validId(contact.id)||typeof contact.email!=='string')throw new TypeError('Invalid audience contact');
          const email=canonical(contact.email);
          if(seen.has(email))throw new Error('Duplicate recipient in audience page');seen.add(email);
          if(!matchesCampaignSegment({...contact,email},current.segment)){skipped++;continue;}
          // Consent & suppression outages stop the checkpoint; never assume eligibility.
          const subscribed=await options.isSubscribed(email);
          if(typeof subscribed!=='boolean')throw new Error('Invalid consent response');
          if(!subscribed){skipped++;continue;}
          const suppressed=await options.isSuppressed(email);
          if(typeof suppressed!=='boolean')throw new Error('Invalid suppression response');
          if(suppressed){skipped++;continue;}
          pending.push({messageId:makeMessageId(id,email),contactId:contact.id,recipient:email});
        }
        await commit({cursor:result.nextCursor,endOfScan:result.done,pending,scanned:current.scanned+result.contacts.length,eligible:current.eligible+pending.length,skipped:current.skipped+skipped});
      }
      while(current.pending.length){
        const target=current.pending[0];
        // Recheck the current state before each side effect. Consent is checked again at delivery.
        const fresh=await options.store.load(id);
        if(!fresh||fresh.version!==current.version||fresh.status!=='running'||fresh.lease?.token!==token||fresh.lease.expiresAt<=now())throw new Error('Campaign paused, cancelled, or lease lost');
        await options.ensureMessage(clone(target),{campaignId:id,tracking:clone(current.tracking)});
        await options.enqueue(target.messageId,current.sendAt);
        await commit({pending:current.pending.slice(1),queued:current.queued+1});processed++;await metric(id,'queued');
      }
      if(current.endOfScan){await commit({status:'completed',lease:null});await audit(id,'completed');await metric(id,'completed');return {status:'completed',processed};}
      await commit({lease:null});return {status:'running',processed};
    }catch(error){
      // Preserve pending work and cursor. A stale owner cannot release a newer lease.
      try{const fresh=await options.store.load(id);if(fresh?.lease?.token===token)await save(fresh,{lease:null});}catch{/* lease expires for takeover */}
      throw error;
    }
  }
  return {create,command,runOnce,get:(id:string)=>options.store.load(id)};
}
export type CampaignPlanner=ReturnType<typeof createCampaignPlanner>;
/**
 * Optional delivery-time policy for @zeruxjs/queue's durable email processor.
 * Paused/scheduled campaigns defer pre-SMTP jobs; cancelled campaigns suppress.
 * Completed means planning finished, NOT that pending deliveries should be blocked.
 */
export function createCampaignDeliveryGate(store:CampaignStore){
  return async(record:{campaignId?:string}):Promise<'allow'|'defer'|'suppress'>=>{
    if(!record.campaignId)return 'allow';
    if(!validId(record.campaignId))throw new Error('Invalid campaign delivery reference');
    const campaign=await store.load(record.campaignId);
    if(!campaign)throw new Error('Campaign delivery state unavailable');
    if(campaign.status==='cancelled')return 'suppress';
    if(campaign.status==='running'||campaign.status==='completed')return 'allow';
    return 'defer';
  };
}
