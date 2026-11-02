import { createPinnedTransaction } from '@zeruxjs/db';
import type { DatabaseConnector, DatabaseTransaction, DatabaseExecutionContext, NormalizedConnectionConfig, PinnedTransactionAdapter, QueryOperation } from '@zeruxjs/db';
import { compileSql, createSqlConnector } from '@zeruxjs/db-sql-core';
import { createManagedPool, validateOptions } from './pool.js';
import type { MySqlConnectorOptions } from './pool.js';
import { mysqlDialect } from './dialect.js';
export type { MySqlConnectorOptions, MySqlPoolLike, MySqlConnectionLike } from './pool.js';
export interface MySqlConnector extends DatabaseConnector { transaction:DatabaseTransaction;disconnect():Promise<void> }
/** Owns pool leases, never the injected pool. Cancellation remains cooperative and waits for native settlement. */
export async function createConnector(options:MySqlConnectorOptions={},connection?:NormalizedConnectionConfig):Promise<MySqlConnector>{
    const limits=validateOptions(options),{pool,owned}=await createManagedPool(options);
    const leases=new Set<Promise<void>>();
    const fallback={connection:connection??{name:'MySQL',slug:'default',connector:'@zeruxjs/db-mysql',options:{}}};
    let closed=false,closing:Promise<void>|undefined;const pending=new Set<Promise<unknown>>(),active=new Set<Promise<unknown>>();
    const check=(ctx:DatabaseExecutionContext)=>{if(closed)throw new Error('MySQL connector closed');if(!ctx||!ctx.connection||typeof ctx.connection.slug!=='string'||typeof ctx.connection.connector!=='string'||ctx.signal!==undefined&&!(ctx.signal instanceof AbortSignal)||ctx.deadline!==undefined&&(!Number.isSafeInteger(ctx.deadline)||ctx.deadline<0))throw new Error('Invalid MySQL execution context');if(ctx.signal?.aborted||ctx.deadline!==undefined&&ctx.deadline<=Date.now())throw new Error('MySQL operation cancelled or deadline exceeded');};
    async function acquire(ctx:DatabaseExecutionContext){
        check(ctx);if(pending.size+leases.size>=limits.maxPendingAcquires)throw new Error('MySQL acquisition capacity exceeded');
        let abandoned=false,timer:ReturnType<typeof setTimeout>|undefined,abort=()=>{};
        const work=Promise.resolve().then(()=>pool.getConnection!()).then(client=>{if(!client||typeof client.execute!=='function'||typeof client.query!=='function'||typeof client.release!=='function'||typeof client.destroy!=='function'){client?.destroy?.();throw new Error('Invalid MySQL pool connection');}if(abandoned||closed){client.release();throw new Error('MySQL acquisition cancelled');}return client;});
        pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});
        try{return await Promise.race([work,new Promise<never>((_,reject)=>{abort=()=>{abandoned=true;reject(new Error('MySQL acquisition cancelled'));};ctx.signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{abandoned=true;reject(new Error('MySQL acquisition deadline exceeded'));},Math.max(1,Math.min(limits.acquireTimeoutMs,(ctx.deadline??Infinity)-Date.now())));if(ctx.signal?.aborted)abort();})]);}
        finally{if(timer)clearTimeout(timer);ctx.signal?.removeEventListener('abort',abort);}
    }
    const mode=options.affectedRowsMode??(owned?'matched':undefined);
    const normalize=(execute:(sql:string,params:unknown[])=>Promise<[unknown,unknown]>)=>async(operation:QueryOperation,ctx:DatabaseExecutionContext)=>{
        let header:Record<string,unknown>|undefined;
        const result=await createSqlConnector(mysqlDialect,{executor:async(sql,params)=>{const [value]=await execute(sql,params);if(value&&typeof value==='object'&&!Array.isArray(value))header=value as Record<string,unknown>;
            // Rounded injected numbers cannot be repaired by converting them to strings.
            const queue:unknown[]=[value],seen=new WeakSet<object>();let visited=0;
            while(queue.length){if(++visited>100000)throw new Error('MySQL result inspection limit exceeded');const item=queue.pop();if(typeof item==='number'&&Number.isInteger(item)&&!Number.isSafeInteger(item))throw new Error('Unsafe MySQL integer result');if(item&&typeof item==='object'&&!seen.has(item)&&!ArrayBuffer.isView(item)){seen.add(item);for(const value of Object.values(item)){if(queue.length>=100000)throw new Error('MySQL result inspection limit exceeded');queue.push(value);}}}
            return value;}}).execute(operation,ctx);
        if(operation.op==='update'&&mode&&header){
            result.counts={...result.counts,affected:'exact',affectedMeaning:mode};
            if(mode==='matched'){result.matchedCount=result.affectedCount;result.counts.matched='exact';}
            else {result.changedCount=result.affectedCount;result.counts.changed='exact';}
            // mysql2's changedRows is distinct from FOUND_ROWS affectedRows.
            if(Number.isSafeInteger(header.changedRows)&&Number(header.changedRows)>=0){result.changedCount=Number(header.changedRows);result.counts.changed='exact';}
        }
        return result;
    };
    const adapter:PinnedTransactionAdapter|undefined=pool.getConnection?{
        capabilities:{isolationLevels:['read-uncommitted','read-committed','repeatable-read','serializable'],timeout:'cooperative',savepoints:false,transactionalDdl:false},
        async acquire(ctx){const client=await acquire(ctx);let complete!:()=>void;const lifetime=new Promise<void>(resolve=>{complete=resolve;});leases.add(lifetime);let begun=false,done=false,bad=false,released=false;
            const run=async(sql:string,params:unknown[]=[])=>{try{return await client.query(sql,params);}catch(error){bad=true;throw error;}};
            return {
                async begin(opts){if(begun||!opts||typeof opts!=='object'||Array.isArray(opts))throw new Error('Invalid MySQL transaction state');const levels:Record<string,string>={'read-uncommitted':'READ UNCOMMITTED','read-committed':'READ COMMITTED','repeatable-read':'REPEATABLE READ',serializable:'SERIALIZABLE'};if(opts.isolation!==undefined){if(!Object.hasOwn(levels,opts.isolation))throw new Error('Invalid MySQL isolation');await run(`SET TRANSACTION ISOLATION LEVEL ${levels[opts.isolation]}`);}begun=true;await run('START TRANSACTION');},
                async execute(op,context){if(!begun||done||released)throw new Error('MySQL transaction closed');check(context);return normalize((sql,params)=>client.execute(sql,params))(op,context);},
                async commit(){if(!begun||done||released)throw new Error('MySQL transaction closed');await run('COMMIT');done=true;},
                async rollback(){if(!begun||done)return;await run('ROLLBACK');done=true;},
                release(){if(released)return;released=true;try{if(bad||begun&&!done)client.destroy();else client.release();}finally{leases.delete(lifetime);complete();}}
            };
        }
    }:undefined;
    const transaction=adapter?createPinnedTransaction(adapter,fallback.connection):undefined;
    const base=createSqlConnector(mysqlDialect,{executor:async(sql,params)=>(await pool.execute(sql,params))[0]});
    async function tracked<T>(run:()=>Promise<T>):Promise<T>{if(active.size>=limits.maxPendingAcquires)throw new Error('MySQL execution capacity exceeded');const work=Promise.resolve().then(run);active.add(work);try{return await work;}finally{active.delete(work);}}
    return {...base,capabilities:{...base.capabilities,transactions:adapter?'supported':'unsupported',cancellation:'unsupported'},...(adapter?{transactionAdapter:adapter}:{}),
        execute(op,ctx=fallback){compileSql(mysqlDialect,op);check(ctx);return tracked(async()=>{if(!pool.getConnection)return normalize((sql,params)=>pool.execute(sql,params))(op,ctx);const client=await acquire(ctx);let bad=false;try{check(ctx);return await normalize((sql,params)=>client.execute(sql,params))(op,ctx);}catch(error){bad=true;throw error;}finally{if(bad)client.destroy();else client.release();}});},
        transaction(run,opts){check(fallback);return tracked(()=>transaction?transaction(run,opts):Promise.reject(new Error('MySQL pinned transactions unavailable')));},
        disconnect(){closed=true;return closing??=Promise.resolve().then(async()=>{await Promise.allSettled([...active,...pending,...leases]);if(owned)await pool.end?.();});},
        getNativeConnection(){if(closed)throw new Error('MySQL connector closed');return pool;}
    };
}
export default createConnector;
