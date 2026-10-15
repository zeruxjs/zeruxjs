import {createHash} from 'node:crypto';
import {validateEmailAddress,addressString} from './validation.js';
import type {CampaignDatabaseConnection} from './campaign-storage.js';

export type MarketingFeedbackKind='hard-bounce'|'soft-bounce'|'complaint'|'manual';
export interface MarketingSuppressionRecord {
  /** SHA-256 of normalized address, used as stable internal key. */
  id:string;email:string;version:number;blocked:boolean;reason:MarketingFeedbackKind;
  softBounces:number;lastAt:number;eventIds:string[];
}
export interface MarketingSuppressionStore {
  load(id:string):Promise<MarketingSuppressionRecord|null>;
  create(record:MarketingSuppressionRecord):Promise<boolean>;
  save(record:MarketingSuppressionRecord,expectedVersion:number):Promise<boolean>;
}
export interface MarketingFeedback {
  email:string;eventId:string;kind:MarketingFeedbackKind;
  /** Source must be authenticated by provider webhook caller, outside this service. */
  at?:number;
}
const keyFor=(email:string)=>createHash('sha256').update(email).digest('hex');
const canonical=(email:string)=>addressString(validateEmailAddress(email)).trim().toLowerCase();
const validEvent=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9:_./-]{1,160}$/.test(id);
export function createMemoryMarketingSuppressionStore():MarketingSuppressionStore{
  const map=new Map<string,MarketingSuppressionRecord>();
  return {
    async load(id){const result=map.get(id);return result?structuredClone(result):null;},
    async create(r){if(map.has(r.id))return false;map.set(r.id,structuredClone(r));return true;},
    async save(r,expected){const old=map.get(r.id);if(!old||old.version!==expected||r.version!==expected+1)return false;map.set(r.id,structuredClone(r));return true;}
  };
}
/** Redis/database deployments should use this atomic, shared CAS-backed store. */
export function createDatabaseMarketingSuppressionStore(db:CampaignDatabaseConnection,table='zerux_marketing_suppressions'):MarketingSuppressionStore{
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(table))throw new TypeError('Invalid suppression table');
  let ready:Promise<void>|undefined;
  const ensure=()=>ready??=(async()=>{
    const r=await db.createTable({table,ifNotExists:true,columns:[
      {name:'id',type:'varchar',length:64,primary:true,notNull:true},
      {name:'version',type:'bigint',notNull:true},
      {name:'payload_json',type:'text',notNull:true}
    ]});if(!r?.ok)throw new Error('Suppression table unavailable');
  })().catch(e=>{ready=undefined;throw e;});
  const encode=(r:MarketingSuppressionRecord)=>JSON.stringify(r);
  const load=async(id:string)=>{
    await ensure();const r=await db.select({table,columns:['id','version','payload_json'],where:{field:'id',operator:'eq',value:id},limit:1});
    if(!r?.ok)throw new Error('Suppression read failed');const row=r.rows?.[0] as Record<string,unknown>|undefined;if(!row)return null;
    if(typeof row.payload_json!=='string')throw new Error('Corrupt suppression row');
    const value=JSON.parse(row.payload_json) as MarketingSuppressionRecord;
    if(value.id!==id||value.version!==Number(row.version))throw new Error('Suppression version mismatch');return value;
  };
  return {
    load,
    async create(record){await ensure();try{
      const result=await db.insert({table,values:{id:record.id,version:record.version,payload_json:encode(record)}});
      if(result?.ok)return true;
    }catch(e){if(await load(record.id))return false;throw e;}
      if(await load(record.id))return false;
      throw new Error('Suppression insertion failed');
    },
    async save(record,expected){
      if(record.version!==expected+1)return false;
      await ensure();const r=await db.update({table,values:{version:record.version,payload_json:encode(record)},where:{and:[{field:'id',operator:'eq',value:record.id},{field:'version',operator:'eq',value:expected}]}});
      if(!r?.ok)throw new Error('Suppression update failed');
      const affected=r.affectedCount??r.rowCount;if(affected===undefined)throw new Error('Suppression CAS requires affectedCount');
      if(!Number.isSafeInteger(affected)||affected<0||affected>1)throw new Error('Invalid suppression CAS response');
      return affected===1;
    }
  };
}
export function createMarketingSuppressionService(options:{store:MarketingSuppressionStore;softBounceThreshold?:number;now?:()=>number}){
  if(!options?.store||typeof options.store.load!=='function'||typeof options.store.create!=='function'||typeof options.store.save!=='function')throw new TypeError('Durable suppression store required');
  const threshold=options.softBounceThreshold??3;
  if(!Number.isSafeInteger(threshold)||threshold<1||threshold>20)throw new RangeError('Invalid soft bounce threshold');
  const now=options.now??Date.now;
  const status=async(email:string)=>options.store.load(keyFor(canonical(email)));
  async function isSuppressed(email:string){const r=await status(email);return r?.blocked===true;}
  /** Call this ONLY after authenticating a signed provider webhook or trusted operator event. */
  async function recordFeedback(event:MarketingFeedback){
    if(!event||!validEvent(event.eventId)||!['hard-bounce','soft-bounce','complaint','manual'].includes(event.kind))throw new TypeError('Invalid provider feedback');
    const email=canonical(event.email),id=keyFor(email),at=event.at??now();
    if(!Number.isSafeInteger(at)||at<0||at>now()+300_000)throw new TypeError('Invalid provider feedback time');
    for(let attempt=0;attempt<30;attempt++){
      const old=await options.store.load(id);
      if(old?.eventIds.includes(event.eventId))return {blocked:old.blocked,duplicate:true};
      const softBounces=(old?.softBounces??0)+(event.kind==='soft-bounce'?1:0);
      const blocked=!!old?.blocked||event.kind!=='soft-bounce'||softBounces>=threshold;
      const next:MarketingSuppressionRecord={id,email,version:(old?.version??0)+1,blocked,reason:blocked?(event.kind==='soft-bounce'?'soft-bounce':old?.blocked?old.reason:event.kind):'soft-bounce',softBounces,lastAt:at,eventIds:[...(old?.eventIds??[]).slice(-127),event.eventId]};
      const success=old?await options.store.save(next,old.version):await options.store.create(next);
      if(success)return {blocked,duplicate:false};
    }
    throw new Error('Concurrent suppression updates exceeded retry budget');
  }
  return {status,isSuppressed,recordFeedback};
}
