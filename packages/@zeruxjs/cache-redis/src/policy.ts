export type RedisOperation='get'|'set'|'delete'|'has'|'clear'|'clearPrefix'|'getMany'|'setMany'|'deleteMany'|'increment'|'decrement'|'touch'|'rateLimit';
export interface RedisOperationRecord {readonly operation:RedisOperation;readonly durationMs:number;readonly outcome:'ok'|'error'|'deadline'|'cancelled'|'overload';readonly code?:string;readonly writeOutcome?:'unknown'}
export interface RedisRequestOptions {signal?:AbortSignal;deadline?:number}
export interface RedisCachePolicy {commandTimeoutMs?:number;connectTimeoutMs?:number;shutdownTimeoutMs?:number;maxPendingCommands?:number;maxReconnectAttempts?:number;maxScanPages?:number;onOperation?:(record:RedisOperationRecord)=>void|Promise<void>}
export class RedisCacheError extends Error {readonly details:{code:string;message:string;writeOutcome?:'unknown'};constructor(readonly code:string,message:string,options?:{cause?:unknown;writeOutcome?:'unknown'}){super(message,options?.cause===undefined?undefined:{cause:options.cause});this.name='RedisCacheError';this.details={code,message,...(options?.writeOutcome?{writeOutcome:options.writeOutcome}:{})};}}
export const redisError=(code:string,cause?:unknown,write=false)=>new RedisCacheError(code,code.toLowerCase().replaceAll('_',' '),{cause,...(write?{writeOutcome:'unknown' as const}:{})});
export function redisPolicy(raw:RedisCachePolicy={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw redisError('REDIS_INVALID_OPTIONS');
 const n=(value:unknown,fallback:number,max:number,min=1)=>{const result=value===undefined?fallback:value;if(typeof result!=='number'||!Number.isSafeInteger(result)||result<min||result>max)throw redisError('REDIS_INVALID_LIMIT');return result;};
 if(raw.onOperation!==undefined&&typeof raw.onOperation!=='function')throw redisError('REDIS_INVALID_HOOK');
 return {commandTimeoutMs:n(raw.commandTimeoutMs,3000,120000),connectTimeoutMs:n(raw.connectTimeoutMs,3000,120000),shutdownTimeoutMs:n(raw.shutdownTimeoutMs,5000,120000),maxPendingCommands:n(raw.maxPendingCommands,64,1024),maxReconnectAttempts:n(raw.maxReconnectAttempts,0,3,0),maxScanPages:n(raw.maxScanPages,10000,100000),onOperation:raw.onOperation};
}
export const redisKey=(key:unknown)=>{if(typeof key!=='string'||!key.length||Buffer.byteLength(key)>1024)throw redisError('REDIS_INVALID_KEY');return key;};
export const redisBulk=(keys:unknown)=>{if(!Array.isArray(keys)||keys.length>1000)throw redisError('REDIS_BULK_LIMIT');return keys.map(redisKey);};
