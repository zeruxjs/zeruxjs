import type { DatabaseCapabilities, DatabaseExecutionPolicy, DatabaseQueryOptions, QueryOperation } from './types.js';
import { createDatabaseError } from './utils.js';
export const capabilityNames = ['returning','transactions','cancellation','schema','indexes','nativeAggregation'] as const;
export const executionError=(code:string)=>createDatabaseError({code,message:({QUERY_CANCELLED:'Database query cancelled',QUERY_DEADLINE:'Database query deadline exceeded',QUERY_LIMIT:'Database pending query limit exceeded',BATCH_LIMIT:'Database batch limit exceeded',UNSUPPORTED_CAPABILITY:'Database capability is unavailable',INVALID_EXECUTION_OPTIONS:'Invalid database execution options'} as Record<string,string>)[code]??'Database execution failed'});
export function capabilities(value:Partial<DatabaseCapabilities>|undefined):Readonly<DatabaseCapabilities>{
 const result={} as DatabaseCapabilities;
 for(const key of capabilityNames){const support=value?.[key]??'unknown';if(!['supported','unsupported','unknown'].includes(support))throw executionError('INVALID_EXECUTION_OPTIONS');result[key]=support;}
 return Object.freeze(result);
}
/** Validate application-owned budgets before opening any connection. Returns a normalized policy. */
export function executionPolicy(value:DatabaseExecutionPolicy={}):Required<Omit<DatabaseExecutionPolicy,'onMetric'>>&Pick<DatabaseExecutionPolicy,'onMetric'>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['maxPending','maxBatch','shutdownGraceMs','onMetric'].includes(k)))throw executionError('INVALID_EXECUTION_OPTIONS');
 const maxPending=value.maxPending??64,maxBatch=value.maxBatch??128,shutdownGraceMs=value.shutdownGraceMs??5000;
 for(const n of [maxPending,maxBatch])if(!Number.isSafeInteger(n)||n<1||n>4096)throw executionError('INVALID_EXECUTION_OPTIONS');
 if(!Number.isSafeInteger(shutdownGraceMs)||shutdownGraceMs<1||shutdownGraceMs>60000||value.onMetric!==undefined&&typeof value.onMetric!=='function')throw executionError('INVALID_EXECUTION_OPTIONS');
 return {maxPending,maxBatch,shutdownGraceMs,onMetric:value.onMetric};
}
export function queryOptions(value:DatabaseQueryOptions={}):DatabaseQueryOptions {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['signal','deadline','timeoutMs','require'].includes(k)))throw executionError('INVALID_EXECUTION_OPTIONS');
 if(value.signal!==undefined&&!(value.signal instanceof AbortSignal))throw executionError('INVALID_EXECUTION_OPTIONS');
 if(value.deadline!==undefined&&(!Number.isSafeInteger(value.deadline)||value.deadline<0||value.deadline>Date.now()+600000))throw executionError('INVALID_EXECUTION_OPTIONS');
 if(value.timeoutMs!==undefined&&(!Number.isSafeInteger(value.timeoutMs)||value.timeoutMs<1||value.timeoutMs>600000))throw executionError('INVALID_EXECUTION_OPTIONS');
 if(value.require!==undefined&&(!Array.isArray(value.require)||value.require.length>6||value.require.some(k=>!capabilityNames.includes(k))))throw executionError('INVALID_EXECUTION_OPTIONS');
 const deadline=value.timeoutMs===undefined?value.deadline:Math.min(value.deadline??Infinity,Date.now()+value.timeoutMs);
 return {...value,deadline};
}
export function checkCapabilities(operation:QueryOperation,available:DatabaseCapabilities,options:DatabaseQueryOptions):void {
 const required=[...(options.require??[])];
 if('returning'in operation&&operation.returning?.length&&available.returning!=='unknown')required.push('returning');
 if(['createDb','dropDb','switchDB','createTable','dropTable','alterTable','turcunateTable'].includes(operation.op)&&available.schema!=='unknown')required.push('schema');
 if((['createIndex','dropIndex'].includes(operation.op)||operation.op==='createTable'&&operation.indexes?.length||operation.op==='alterTable'&&operation.actions.some(a=>a.type==='addIndex'||a.type==='dropIndex'))&&available.indexes!=='unknown')required.push('indexes');
 for(const key of required)if(available[key]!=='supported')throw executionError('UNSUPPORTED_CAPABILITY');
}
