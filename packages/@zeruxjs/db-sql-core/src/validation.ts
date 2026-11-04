import { createDatabaseError } from '@zeruxjs/db';
import type { QueryOperation } from '@zeruxjs/db';
export const refuseSql=(code:string,message='Invalid structured SQL input'):never=>{throw createDatabaseError({code,message});};
/** Own-data snapshot: direct compiler callers receive the same bounded boundary as facade callers. */
export function snapshotSqlOperation(input:unknown):QueryOperation {
 let nodes=0;const seen=new WeakSet<object>();
 const copy=(value:any,depth:number):any=>{
  if(++nodes>20000||depth>32)refuseSql('SQL_INPUT_LIMIT');
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))refuseSql('INVALID_SQL_VALUE');return value;}
  if(typeof value==='string'){if(value.length>8*1024*1024)refuseSql('SQL_INPUT_LIMIT');return value;}
  if(!value||typeof value!=='object'||(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value))))refuseSql('INVALID_SQL_VALUE');
  if(seen.has(value))refuseSql('SQL_INPUT_LIMIT');seen.add(value);
  const result:any=Array.isArray(value)?[]:Object.create(null);
  if(Array.isArray(value)){if(value.length>10000)refuseSql('SQL_INPUT_LIMIT');for(let i=0;i<value.length;i++)if(!Object.hasOwn(value,i))refuseSql('INVALID_SQL_VALUE');if(Object.keys(value).some(key=>! /^(0|[1-9][0-9]*)$/.test(key)))refuseSql('INVALID_SQL_VALUE');}
  for(const key of Object.keys(value)){if(['__proto__','prototype','constructor'].includes(key))refuseSql('INVALID_SQL_VALUE');const descriptor=Object.getOwnPropertyDescriptor(value,key)!;if(!('value'in descriptor))refuseSql('INVALID_SQL_VALUE');result[key]=copy(descriptor.value,depth+1);}
  seen.delete(value);return result;
 };
 const result=copy(input,0);if(Buffer.byteLength(JSON.stringify(result))>8*1024*1024)refuseSql('SQL_INPUT_LIMIT');return result;
}
export function sqlObject(value:unknown,allowed:readonly string[]):asserts value is Record<string,any>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))refuseSql('INVALID_SQL_SHAPE');
}
export function sqlList(value:unknown,max=256):asserts value is any[]{if(!Array.isArray(value)||value.length>max)refuseSql('INVALID_SQL_SHAPE');}
const base=['op','connection','dependsOn','use'];
const keys:Record<string,string[]>={createDb:['name','ifNotExists'],dropDb:['name','ifExists','force'],switchDB:['name'],createTable:['table','ifNotExists','columns','indexes'],dropTable:['table','ifExists','cascade'],alterTable:['table','actions'],turcunateTable:['table','restartIdentity','cascade'],createIndex:['table','name','columns','unique','ifNotExists','using'],dropIndex:['table','name','ifExists'],insert:['table','into','values','returning'],select:['table','as','into','distinct','columns','joins','where','groupBy','having','orderBy','limit','offset','top','fetch','union','unionAll'],update:['table','values','where','returning'],delete:['table','where','returning']};
export function validateSqlOperation(operation:QueryOperation):void {
 if(!operation||typeof operation.op!=='string'||!Object.hasOwn(keys,operation.op))refuseSql('UNSUPPORTED_OPERATION');
 if(operation.op==='insert'&&['upsert','onConflict','onDuplicateKey','onDuplicateKeyUpdate','ignore','replace'].some(k=>Object.hasOwn(operation,k)))refuseSql('UNSUPPORTED_UPSERT','SQL upsert/conflict clauses are unavailable');
 sqlObject(operation,[...base,...keys[operation.op]]);
 const data=operation as unknown as Record<string,unknown>;
 for(const flag of ['ifExists','ifNotExists','force','cascade','restartIdentity','distinct','unique'])if(data[flag]!==undefined&&typeof data[flag]!=='boolean')refuseSql('INVALID_SQL_SHAPE');
 if('returning'in operation&&operation.returning!==undefined){sqlList(operation.returning);if(operation.returning.some(v=>typeof v!=='string'))refuseSql('INVALID_SQL_SHAPE');}
 for(const key of ['columns','indexes','actions','joins','groupBy','orderBy','union','unionAll'])if(data[key]!==undefined)sqlList(data[key]);
}
