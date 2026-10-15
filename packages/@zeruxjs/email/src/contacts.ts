import {createHash} from 'node:crypto';
import {validateEmailAddress,addressString} from './validation.js';
import type {CampaignDatabaseConnection} from './campaign-storage.js';
import type {CampaignContact,CampaignPrimitive,CampaignSource} from './campaigns.js';
const idPattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const fieldPattern=/^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export interface MailingContact extends CampaignContact {
  version:number;lists:string[];createdAt:number;updatedAt:number;
}
export interface MailingContactStore {
  load(id:string):Promise<MailingContact|null>;
  create(contact:MailingContact):Promise<boolean>;
  save(contact:MailingContact,expectedVersion:number):Promise<boolean>;
  /** Atomic version-checked deletion, for contact erasure. */
  delete?(id:string,expectedVersion:number):Promise<boolean>;
  page(cursor:string|null,limit:number):Promise<{items:MailingContact[];nextCursor:string|null;done:boolean}>;
}
const keyFor=(email:string)=>createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
const clone=<T>(value:T)=>structuredClone(value);
const validateTraits=(traits:Record<string,CampaignPrimitive>|undefined)=>{
  if(traits===undefined)return {};
  if(!traits||typeof traits!=='object'||Array.isArray(traits)||Object.keys(traits).length>40)throw new TypeError('Invalid recipient traits');
  const result:Record<string,CampaignPrimitive>={};
  for(const [key,value] of Object.entries(traits)){
    if(!fieldPattern.test(key)||['constructor','prototype','__proto__'].includes(key)||!(value===null||typeof value==='boolean'||typeof value==='string'&&value.length<=500||typeof value==='number'&&Number.isFinite(value)))throw new TypeError('Invalid recipient trait');
    result[key]=value;
  }
  return result;
};
export function createMemoryMailingContactStore():MailingContactStore{
  const data=new Map<string,MailingContact>();return {
    async load(id){return data.has(id)?clone(data.get(id)!):null;},
    async create(v){if(data.has(v.id))return false;data.set(v.id,clone(v));return true;},
    async save(v,expected){const old=data.get(v.id);if(!old||old.version!==expected||v.version!==expected+1)return false;data.set(v.id,clone(v));return true;},
    async delete(id,expected){const existing=data.get(id);if(!existing||existing.version!==expected)return false;return data.delete(id);},
    async page(cursor,limit){const rows=[...data.values()].sort((a,b)=>a.id.localeCompare(b.id)).filter(v=>cursor===null||v.id>cursor).slice(0,limit);
      return {items:rows.map(clone),nextCursor:rows.length===limit?rows.at(-1)!.id:null,done:rows.length<limit};}
  };
}
/** Durable contact rows with CAS updates and keyset pagination. Keep recipient PII out of Redis jobs. */
export function createDatabaseMailingContactStore(db:CampaignDatabaseConnection,table='zerux_email_contacts'):MailingContactStore{
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(table))throw new TypeError('Invalid contact table');
  let ready:Promise<void>|undefined;
  const ensure=()=>ready??=(async()=>{const result=await db.createTable({table,ifNotExists:true,columns:[
    {name:'id',type:'varchar',length:64,primary:true,notNull:true},
    {name:'version',type:'bigint',notNull:true},
    {name:'payload_json',type:'text',notNull:true}
  ]});if(!result?.ok)throw new Error('Recipient table unavailable');})().catch(error=>{ready=undefined;throw error;});
  const encode=(v:MailingContact)=>{const json=JSON.stringify(v);if(Buffer.byteLength(json)>16_000)throw new RangeError('Recipient exceeds portable document size');return json;};
  return {
    async load(id){await ensure();const r=await db.select({table,columns:['id','version','payload_json'],where:{field:'id',operator:'eq',value:id},limit:1});if(!r?.ok)throw new Error('Recipient lookup failed');const row=r.rows?.[0] as Record<string,unknown>|undefined;
      if(!row)return null;if(typeof row.payload_json!=='string')throw new Error('Corrupt recipient record');const v=JSON.parse(row.payload_json) as MailingContact;
      if(v.id!==id||v.version!==Number(row.version))throw new Error('Recipient version mismatch');return v;},
    async create(v){await ensure();try{const r=await db.insert({table,values:{id:v.id,version:v.version,payload_json:encode(v)}});if(r?.ok)return true;}
      catch(error){const r=await db.select({table,columns:['id'],where:{field:'id',operator:'eq',value:v.id},limit:1});if(r?.ok&&r.rows?.length)return false;throw error;}
      throw new Error('Recipient insertion failed');},
    async save(v,expected){await ensure();const r=await db.update({table,values:{version:v.version,payload_json:encode(v)},where:{and:[{field:'id',operator:'eq',value:v.id},{field:'version',operator:'eq',value:expected}]}});
      if(!r?.ok)throw new Error('Recipient update failed');const affected=r.affectedCount??r.rowCount;if(affected===undefined)throw new Error('Recipient CAS requires affectedCount');return affected===1;},
    async delete(id,expected){
      await ensure();
      if(!db.delete)throw new Error('Contact erasure requires a database connector with atomic delete support');
      const result=await db.delete({table,where:{and:[{field:'id',operator:'eq',value:id},{field:'version',operator:'eq',value:expected}]}});
      if(!result?.ok)throw new Error('Contact deletion failed');
      const affected=result.affectedCount??result.rowCount;
      if(typeof affected!=='number'||!Number.isSafeInteger(affected)||affected<0||affected>1)throw new Error('Contact erasure requires an atomic affectedCount');
      return affected===1;
    },
    async page(cursor,limit){await ensure();const r=await db.select({table,columns:['id','version','payload_json'],...(cursor?{where:{field:'id',operator:'gt',value:cursor}}:{}),orderBy:[{by:'id',direction:'asc'}],limit});
      if(!r?.ok||!Array.isArray(r.rows))throw new Error('Recipient listing failed');const items=r.rows.map(row=>{
        const r=row as Record<string,unknown>,v=JSON.parse(String(r.payload_json)) as MailingContact;
        if(v.id!==r.id||v.version!==Number(r.version))throw new Error('Corrupt recipient document');return v;});
      return {items,nextCursor:items.length===limit?items.at(-1)!.id:null,done:items.length<limit};}
  };
}
export function createMailingListService(options:{store:MailingContactStore;now?:()=>number}){
  if(!options?.store)throw new TypeError('Contact store required');const clock=options.now??Date.now;
  const service={
    async upsert(email:string,lists:string[]=[],traits?:Record<string,CampaignPrimitive>):Promise<MailingContact>{
      const canonical=addressString(validateEmailAddress(email)).trim().toLowerCase();
      if(!Array.isArray(lists)||lists.length>50||lists.some(v=>typeof v!=='string'||!idPattern.test(v)))throw new TypeError('Invalid recipient list memberships');
      const normalized=[...new Set(lists)];const data=validateTraits(traits),id=keyFor(canonical);
      for(let i=0;i<30;i++){
        const old=await options.store.load(id);
        const next:MailingContact=old?{...old,lists:[...new Set([...old.lists,...normalized])],traits:{...old.traits,...data},version:old.version+1,updatedAt:clock()}:
          {id,email:canonical,version:1,lists:normalized,traits:data,createdAt:clock(),updatedAt:clock()};
        if(old?await options.store.save(next,old.version):await options.store.create(next))return clone(next);
      }
      throw new Error('Concurrent contact updates exceeded retry budget');
    },
    async removeFromList(email:string,list:string):Promise<boolean>{
      const canonical=addressString(validateEmailAddress(email)).trim().toLowerCase();if(!idPattern.test(list))throw new TypeError('Invalid list');const id=keyFor(canonical);
      for(let i=0;i<30;i++){const old=await options.store.load(id);if(!old||!old.lists.includes(list))return false;
        const next={...old,version:old.version+1,lists:old.lists.filter(v=>v!==list),updatedAt:clock()};
        if(await options.store.save(next,old.version))return true;
      }throw new Error('Concurrent contact updates exceeded retry budget');
    },
    /** Remove a contact and its plaintext email/traits from storage, using version-checked deletion. */
    async erase(email:string):Promise<boolean>{
      const canonical=addressString(validateEmailAddress(email)).trim().toLowerCase();
      if(!options.store.delete)throw new Error('This contact store does not support atomic erasure');
      const id=keyFor(canonical);
      for(let i=0;i<30;i++){
        const existing=await options.store.load(id);
        if(!existing)return false;
        if(await options.store.delete(id,existing.version))return true;
      }
      throw new Error('Concurrent contact erasure exceeded retry budget');
    },
    async page(list:string,cursor:string|null=null,limit=100):Promise<{contacts:CampaignContact[];nextCursor:string|null;done:boolean}>{
      if(!idPattern.test(list)||cursor!==null&&!/^[a-f0-9]{64}$/.test(cursor)||!Number.isSafeInteger(limit)||limit<1||limit>200)throw new TypeError('Invalid contact scan');
      const source=await options.store.page(cursor,limit);
      return {contacts:source.items.filter(v=>v.lists.includes(list)).map(v=>({id:v.id,email:v.email,traits:v.traits})),nextCursor:source.nextCursor,done:source.done};
    },
    /** Adapter for Section 55 CampaignPlanner. Consent and suppression still checked by planner. */
    campaignSource(list:string):CampaignSource{
      if(!idPattern.test(list))throw new TypeError('Invalid list');
      return {page:({cursor,limit})=>service.page(list,cursor,limit)};
    }
  };
  return service;
}
