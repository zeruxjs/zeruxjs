import type { JsonPrimitive, SelectOperation, WhereClause } from './types.js';
import { assertJsonSerializable, createDatabaseError } from './utils.js';
export interface KeysetOrder {column:string;direction:'asc'|'desc'}
export interface KeysetContinuation {version:1;table:string;order:KeysetOrder[];values:Exclude<JsonPrimitive,null>[]}
export interface KeysetPageOptions {table:string;order:KeysetOrder[];uniqueKey:string;limit:number;after?:KeysetContinuation;where?:WhereClause}
const fail=():never=>{throw createDatabaseError({code:'INVALID_CONTINUATION',message:'Invalid keyset pagination contract'});};
/** Flat non-null scalar keys only. Host guarantees final key uniqueness and stable collation. */
export function createKeysetPage(options:KeysetPageOptions):{operation:SelectOperation;continuation(row:Record<string,unknown>):KeysetContinuation}{
 assertJsonSerializable(options,'Keyset options');
 if(Object.keys(options).some(k=>!['table','uniqueKey','limit','order','where','after'].includes(k)))fail();
 const {table,uniqueKey,limit}=options;const order=structuredClone(options.order);
 if(typeof table!=='string'||typeof uniqueKey!=='string'||!/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(table)||!Array.isArray(order)||!order.length||order.length>4||!Number.isSafeInteger(limit)||limit<1||limit>1000||order.at(-1)?.column!==uniqueKey||new Set(order.map(k=>k?.column)).size!==order.length)fail();
 for(const key of order)if(!key||typeof key.column!=='string'||!/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(key.column)||!['asc','desc'].includes(key.direction))fail();
 const scalar=(value:unknown):value is Exclude<JsonPrimitive,null>=>typeof value==='string'&&value.length<=4096||typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean';
 let where=options.where?structuredClone(options.where):undefined;
 if(options.after!==undefined){const after=options.after;if(!after||typeof after!=='object'||Object.keys(after).some(k=>!['version','table','order','values'].includes(k)))fail();if(after.version!==1||after.table!==table||!Array.isArray(after.order)||after.order.length!==order.length||after.order.some((k,i)=>!k||k.column!==order[i].column||k.direction!==order[i].direction)||!Array.isArray(after.values)||after.values.length!==order.length||!after.values.every(scalar))fail();
 const seek:WhereClause={or:order.map((key,index)=>({and:[...order.slice(0,index).map((prefix,i)=>({field:prefix.column,operator:'eq' as const,value:after.values[i]})),{field:key.column,operator:key.direction==='asc'?'gt' as const:'lt' as const,value:after.values[index]}]}))};
 where=where?{and:[where,seek]}:seek;
 }
 return {operation:{op:'select',table,orderBy:order.map(k=>({by:k.column,direction:k.direction})),limit,...(where?{where}:{})},continuation(row){if(!row||typeof row!=='object'||Array.isArray(row))fail();const values=order.map(key=>{if(!Object.hasOwn(row,key.column)||!scalar(row[key.column]))fail();return row[key.column] as Exclude<JsonPrimitive,null>;});return {version:1,table,order:structuredClone(order),values};}};
}
