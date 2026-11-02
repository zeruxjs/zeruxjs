import { createDatabaseError } from '@zeruxjs/db';
export interface PgPoolClientLike {
    query(statement:string,params?:unknown[]):Promise<unknown>;
    end():Promise<void>;
    release(destroy?:boolean):void;
    on?(event:'error',listener:(error:unknown)=>void):unknown;
    off?(event:'error',listener:(error:unknown)=>void):unknown;
}
export interface PgPoolLike {
    query(statement:string,params?:unknown[]):Promise<unknown>;
    connect?():Promise<PgPoolClientLike>;
    on?(event:'error',listener:(error:unknown)=>void):unknown;
    off?(event:'error',listener:(error:unknown)=>void):unknown;
    end?():Promise<void>;
    readonly totalCount?:number;readonly idleCount?:number;readonly waitingCount?:number;
}
export interface PgConnectorOptions extends Record<string,unknown> {
    client?:{query?:(statement:string,params?:unknown[])=>Promise<unknown>;execute?:(statement:string,params?:unknown[])=>Promise<unknown>};
    pool?:PgPoolLike;
    host?:string;hostname?:string;username?:string;user?:string;password?:string;database?:string;
    port?:number;ssl?:unknown;max?:number;connectionString?:string;
    executor?:(statement:string,params:unknown[])=>Promise<unknown>|unknown;
    acquireTimeoutMs?:number;statementTimeoutMs?:number;queryTimeoutMs?:number;lockTimeoutMs?:number;
    maxPendingAcquires?:number;shutdownTimeoutMs?:number;
}
export const pgError=(code:string,cause?:unknown)=>createDatabaseError({code,message:code.toLowerCase().replaceAll('_',' '),...(cause!==undefined?{cause}:{})});
export function pgPolicy(options:PgConnectorOptions){
    if(!options||typeof options!=='object'||Array.isArray(options))throw pgError('INVALID_PG_OPTIONS');
    if([options.pool,options.client,options.executor].filter(v=>v!==undefined).length>1)throw pgError('AMBIGUOUS_PG_TRANSPORT');
    if(options.pool!==undefined&&(!options.pool||typeof options.pool.query!=='function'||options.pool.connect!==undefined&&typeof options.pool.connect!=='function'))throw pgError('INVALID_PG_POOL');
    if(options.client!==undefined&&(!options.client||typeof options.client.query!=='function'&&typeof options.client.execute!=='function'))throw pgError('INVALID_PG_CLIENT');
    if(options.executor!==undefined&&typeof options.executor!=='function')throw pgError('INVALID_PG_EXECUTOR');
    const integer=(value:unknown,fallback:number,min:number,max:number)=>{const result=value===undefined?fallback:value;if(typeof result!=='number'||!Number.isSafeInteger(result)||result<min||result>max)throw pgError('INVALID_PG_LIMIT');return result;};
    for(const key of ['host','hostname','user','username','password','database','connectionString'] as const)if(options[key]!==undefined&&typeof options[key]!=='string')throw pgError('INVALID_PG_OPTIONS');
    return {acquireTimeoutMs:integer(options.acquireTimeoutMs,5000,1,60000),statementTimeoutMs:integer(options.statementTimeoutMs,10000,1,600000),queryTimeoutMs:integer(options.queryTimeoutMs,15000,1,600000),lockTimeoutMs:integer(options.lockTimeoutMs,5000,0,600000),maxPendingAcquires:integer(options.maxPendingAcquires,32,1,1024),shutdownTimeoutMs:integer(options.shutdownTimeoutMs,5000,1,60000),max:integer(options.max,10,1,1024),port:integer(options.port,5432,1,65535)};
}
/** Builds only the configured pool/transport; owned pg pools connect lazily. */
export async function createManagedPool(options:PgConnectorOptions):Promise<{pool:PgPoolLike;owned:boolean}>{
    const policy=pgPolicy(options);
    if(options.pool)return {pool:options.pool,owned:false};
    if(options.client||options.executor)return {pool:{query:async(sql,params)=>options.executor?options.executor(sql,params??[]):options.client?.query?options.client.query(sql,params):options.client!.execute!(sql,params)},owned:false};
    for(const key of ['host','hostname','user','username','password','database','connectionString'] as const)if(options[key]!==undefined&&typeof options[key]!=='string')throw pgError('INVALID_PG_OPTIONS');
    const pg=await import('pg');
    const pool=new pg.Pool({host:options.host??options.hostname,user:options.user??options.username,password:options.password,database:options.database,port:policy.port,ssl:options.ssl as any,max:policy.max,connectionString:options.connectionString,connectionTimeoutMillis:policy.acquireTimeoutMs,
        // Query watchdogs must not masquerade as server cancellation or permit early client reuse.
        query_timeout:0,statement_timeout:policy.statementTimeoutMs,lock_timeout:policy.lockTimeoutMs});
    return {pool:pool as unknown as PgPoolLike,owned:true};
}
