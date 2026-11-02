import type {CachePolicy,CacheSetOptions} from '@zeruxjs/cache';
export interface ValkeyClient {
 readonly options:Record<string,any>;
 get(key:string):Promise<string|null>;
 set(key:string,value:string,...args:(string|number)[]):Promise<unknown>;
 del(key:string):Promise<number|string>;
 exists(key:string):Promise<number|string>;
 incrby(key:string,amount:number):Promise<number|string>;
 decrby(key:string,amount:number):Promise<number|string>;
 expire(key:string,seconds:number):Promise<number|string>;
 scan(cursor:string,...args:(string|number)[]):Promise<[string,string[]]>;
 nodes?(role:'master'):ValkeyClient[];
 flushdb():Promise<unknown>;quit():Promise<unknown>;disconnect(reconnect?:boolean):void;
 on(event:string,listener:(...args:any[])=>void):unknown;
 off(event:string,listener:(...args:any[])=>void):unknown;
}
export interface ValkeyRequestOptions {signal?:AbortSignal;deadline?:number}
export interface ValkeySetOptions extends CacheSetOptions,ValkeyRequestOptions {}
export type ValkeyOperation='get'|'set'|'delete'|'has'|'clear'|'clearPrefix'|'getMany'|'setMany'|'deleteMany'|'increment'|'decrement'|'touch';
export interface ValkeyOperationRecord {operation:ValkeyOperation;durationMs:number;outcome:'ok'|'error'|'deadline'|'cancelled'|'overload';code?:string;writeOutcome?:'unknown'}
export interface ValkeyHelperOptions {
 ownClient?:boolean;allowFlushDb?:boolean;commandTimeoutMs?:number;shutdownTimeoutMs?:number;
 maxPendingCommands?:number;maxScanPages?:number;
 valueLimits?:Pick<CachePolicy,'maxBulk'|'maxKeyBytes'|'maxValueBytes'|'maxDepth'>;
 onOperation?:(record:Readonly<ValkeyOperationRecord>)=>void|Promise<void>;
}
export interface ValkeyConnectionOptions extends ValkeyHelperOptions {
 client?:ValkeyClient;url?:string;host?:string;port?:number;username?:string;password?:string;db?:number;
 tls?:{ca?:string|string[];cert?:string;key?:string;servername?:string};
 cluster?:{nodes:readonly {host:string;port:number}[]};
 connectTimeoutMs?:number;maxReconnectAttempts?:number;
}
