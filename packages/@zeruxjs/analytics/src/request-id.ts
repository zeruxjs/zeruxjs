import {randomBytes} from 'node:crypto';
import type {AnalyticsConnection} from './types.js';

const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const requestIdPattern=/^[A-Za-z0-9]{16}$/;
/** An unguessable, 16-character ID. Rejection sampling avoids modulo bias. */
export function createRequestId():string{
  let id='';
  while(id.length<16){for(const byte of randomBytes(32)){if(byte>=248)continue;id+=alphabet[byte%62]!;if(id.length===16)break;}}
  return id;
}
export function validRequestId(id:unknown):id is string{return typeof id==='string'&&requestIdPattern.test(id);}
export function requestUtcDay(at=Date.now()):string{
  if(!Number.isSafeInteger(at)||at<0)throw new RangeError('Invalid request time');
  return new Date(at).toISOString().slice(0,10);
}
/** reserve MUST be atomic across all replicas, returning false for a duplicate UTC day + ID. */
export interface RequestIdStore {
  reserve(day:string,id:string):Promise<boolean>;
}
/** Dev-only; single-process uniqueness, bounded to today and yesterday. */
export function createMemoryRequestIdStore(max=100_000):RequestIdStore & {size():number}{
  if(!Number.isSafeInteger(max)||max<1)throw new RangeError('Invalid reservation limit');
  const days=new Map<string,Set<string>>();
  return {
    async reserve(day,id){
      if(!/^\d{4}-\d\d-\d\d$/.test(day)||!validRequestId(id))throw new TypeError('Invalid request reservation');
      const now=requestUtcDay(),yesterday=requestUtcDay(Date.now()-86400000);
      if(day!==now&&day!==yesterday)throw new RangeError('Reservation day is outside supported window');
      for(const key of days.keys())if(key!==now&&key!==yesterday)days.delete(key);
      let set=days.get(day);if(!set){set=new Set();days.set(day,set);}
      if(set.has(id))return false;
      if(set.size>=max)throw new Error('Request reservation capacity exceeded');
      set.add(id);return true;
    },
    size(){let n=0;for(const set of days.values())n+=set.size;return n;}
  };
}
/** A DB-backed atomic primary-key reservation. All replicas must use the SAME table/DB. */
export function createDatabaseRequestIdStore(connection:AnalyticsConnection,table='analytics_request_ids'):RequestIdStore & {initialize():Promise<boolean>}{
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(table))throw new TypeError('Invalid request ID table');
  let initialized=false;let lastMaintenanceDay:string|undefined;
  const initialize=async()=>{
    if(initialized)return true;
    const result=await connection.createTable({table,ifNotExists:true,columns:[
      {name:'id',type:'varchar',length:32,primary:true,notNull:true},
      {name:'utc_day',type:'varchar',length:10,notNull:true},
      {name:'created_at',type:'bigint',notNull:true}
    ]});
    initialized=result?.ok===true;return initialized;
  };
  return {initialize,async reserve(day,id){
    if(!validRequestId(id)||!/^\d{4}-\d\d-\d\d$/.test(day))throw new TypeError('Invalid request ID');
    if(!await initialize())throw new Error('Request reservation storage unavailable');
    // Retention is opportunistic and non-blocking; an optional connector delete can
    // prune days older than yesterday without interrupting ingestion.
    if(lastMaintenanceDay!==day){lastMaintenanceDay=day;
      const cleaner=connection as AnalyticsConnection & {delete?:(operation:{table:string;where:{field:string;operator:'lte';value:string}})=>Promise<unknown>|unknown};
      if(cleaner.delete){const before=requestUtcDay(Date.now()-2*86400000);
        Promise.resolve().then(()=>cleaner.delete!({table,where:{field:'utc_day',operator:'lte',value:before}})).catch(()=>{});
      }
    }
    const result=await connection.insert({table,values:{id:`${day.replace(/-/g,'')}:${id}`,utc_day:day,created_at:Date.now()}});
    if(result?.ok)return true;
    const code=String(result?.error?.code??'');
    if(['23505','ER_DUP_ENTRY','1062','SQLITE_CONSTRAINT','SQLITE_CONSTRAINT_PRIMARYKEY','11000'].includes(code))return false;
    throw new Error('Request reservation storage unavailable');
  }};
}
/** Retry collisions when an ID is allocated by a trusted server; never silently accept duplicates. */
export async function reserveNewRequestId(store:RequestIdStore,day=requestUtcDay(),attempts=5):Promise<string>{
  for(let i=0;i<attempts;i++){const id=createRequestId();if(await store.reserve(day,id))return id;}
  throw new Error('Unable to allocate unique request ID');
}
