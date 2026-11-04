import type { DatabaseExecutionContext } from '@zeruxjs/db';
import type { PgPoolLike, PgPoolClientLike, PgConnectorOptions } from './pool.js';
import { pgPolicy,pgError } from './pool.js';
export interface PgPoolStatus {owned:boolean;closed:boolean;pendingAcquisitions:number;legacyPending:number;activeLeases:number;acquisitionTimeouts:number;discarded:number;lateReleases:number;failures:number;total?:number;idle?:number;waiting?:number}
type Context=Pick<DatabaseExecutionContext,'signal'|'deadline'>;
const readSettings="SELECT current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout";
const setSettings="SELECT set_config('statement_timeout', $1, false), set_config('lock_timeout', $2, false)";
const localSettings="SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true)";
export interface PgSessionLease {bad:boolean;terminate():Promise<void>;raw(sql:string,params?:unknown[],context?:Context):Promise<unknown>;initialize(context?:Context):Promise<void>;configure(context:Context,local?:boolean):Promise<void>;query(sql:string,params:unknown[],context:Context,local?:boolean):Promise<unknown>;finish():Promise<void>}
export interface PgSessions {acquire(context?:Context):Promise<PgSessionLease>;status():PgPoolStatus;legacy<T>(run:()=>Promise<T>,context?:Context):Promise<T>;close():Promise<void>}
/** Driver-owned acquisition and lease lifecycle. No credentials, SQL values or backend IDs enter status. */
export function createPgSessions(pool:PgPoolLike,owned:boolean,options:PgConnectorOptions):PgSessions{
    const policy=pgPolicy(options),leases=new Set<PgLease>(),pending=new Set<Promise<unknown>>(),legacyWork=new Set<Promise<unknown>>();
    const shutdown=new AbortController();let closed=false,closing:Promise<void>|undefined,acquisitionTimeouts=0,discarded=0,lateReleases=0,failures=0;
    const onPoolError=()=>{failures++;};pool.on?.('error',onPoolError);
    const safeCount=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=1000000?value:undefined;
    const status=():PgPoolStatus=>({owned,closed,pendingAcquisitions:pending.size,legacyPending:legacyWork.size,activeLeases:leases.size,acquisitionTimeouts,discarded,lateReleases,failures,total:safeCount(pool.totalCount),idle:safeCount(pool.idleCount),waiting:safeCount(pool.waitingCount)});
    const context=(ctx:Context):Context=>{if(ctx.signal!==undefined&&!(ctx.signal instanceof AbortSignal)||ctx.deadline!==undefined&&(!Number.isSafeInteger(ctx.deadline)||ctx.deadline<0))throw pgError('INVALID_PG_EXECUTION_CONTEXT');return {signal:AbortSignal.any([shutdown.signal,...(ctx.signal?[ctx.signal]:[])]),deadline:ctx.deadline};};
    async function acquire(raw:Context={}):Promise<PgLease>{
        const ctx=context(raw);if(closed||ctx.signal?.aborted)throw pgError('PG_ACQUIRE_CANCELLED');
        if(pending.size+leases.size>=policy.maxPendingAcquires)throw pgError('PG_POOL_SATURATED');
        if(!pool.connect)throw pgError('UNSUPPORTED_PG_PINNED_CLIENT');
        const ms=Math.min(policy.acquireTimeoutMs,ctx.deadline===undefined?Infinity:ctx.deadline-Date.now());if(ms<=0)throw pgError('PG_ACQUIRE_TIMEOUT');
        let abandoned=false,timer:ReturnType<typeof setTimeout>|undefined,abort:()=>void=()=>{};
        const source=Promise.resolve().then(()=>pool.connect!()).then(client=>{
            if(!client||typeof client.query!=='function'||typeof client.release!=='function'||typeof client.end!=='function'){try{client?.release?.(true);}catch{failures++;}throw pgError('INVALID_PG_POOL_CLIENT');}
            if(abandoned||closed){lateReleases++;client.release(true);throw pgError('PG_ACQUIRE_CANCELLED');}
            const lease=new PgLease(client);leases.add(lease);return lease;
        });
        pending.add(source);void source.finally(()=>pending.delete(source)).catch(()=>{});
        const cancelled=new Promise<never>((_,reject)=>{abort=()=>{abandoned=true;reject(pgError('PG_ACQUIRE_CANCELLED'));};ctx.signal!.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{abandoned=true;acquisitionTimeouts++;reject(pgError('PG_ACQUIRE_TIMEOUT'));},ms);if(ctx.signal!.aborted)abort();});
        try{return await Promise.race([source,cancelled]);}catch(error){failures++;throw error;}finally{if(timer)clearTimeout(timer);ctx.signal!.removeEventListener('abort',abort);}
    }
    class PgLease {
        bad=false;private released=false;private finishing?:Promise<void>;private ending?:Promise<void>;private endingError?:unknown;private hasEndingError=false;private connectionError?:unknown;private active=new Set<Promise<unknown>>();private baseline?:{statement_timeout:string;lock_timeout:string};
        private onError=(error:unknown)=>{this.bad=true;this.connectionError=error;failures++;void this.terminate();};
        constructor(private client:PgPoolClientLike){client.on?.('error',this.onError);}
        terminate(){this.bad=true;return this.ending??=Promise.resolve().then(async()=>{try{await this.client.end();}catch(error){failures++;this.hasEndingError=true;this.endingError=error;}});}
        async raw(sql:string,params:unknown[]=[],rawContext:Context={}):Promise<unknown>{
            const ctx=context(rawContext);if(this.released||this.bad||ctx.signal?.aborted)throw pgError('PG_CLIENT_UNAVAILABLE',this.connectionError);
            const budget=Math.min(policy.queryTimeoutMs,ctx.deadline===undefined?Infinity:ctx.deadline-Date.now());if(budget<=0)throw pgError('PG_QUERY_TIMEOUT');
            let aborted=false,timedOut=false;const abort=()=>{aborted=true;void this.terminate();};
            const timer=setTimeout(()=>{timedOut=true;abort();},budget);ctx.signal!.addEventListener('abort',abort,{once:true});
            const work=Promise.resolve().then(()=>{if(ctx.signal!.aborted){abort();throw pgError('PG_QUERY_CANCELLED');}return this.client.query(sql,params);});this.active.add(work);
            try{
                const value=await work;if(this.ending)await this.ending;
                if(aborted)throw pgError(timedOut?'PG_QUERY_TIMEOUT':'PG_QUERY_CANCELLED');if(this.bad)throw pgError('PG_CLIENT_UNAVAILABLE',this.connectionError);return value;
            }catch(error){
                // Non-SQL errors (including pg query_timeout) cannot establish backend readiness.
                if(!error||typeof error!=='object'||!('code'in error)||typeof error.code!=='string'||! /^[0-9A-Z]{5}$/.test(error.code))await this.terminate();
                if(this.ending)await this.ending;
                if(aborted)throw pgError(timedOut?'PG_QUERY_TIMEOUT':'PG_QUERY_CANCELLED',error);throw error;
            }finally{this.active.delete(work);clearTimeout(timer);ctx.signal!.removeEventListener('abort',abort);}
        }
        async initialize(ctx:Context={}){
            const result=await this.raw(readSettings,[],ctx) as {rows?:Array<{statement_timeout?:unknown;lock_timeout?:unknown}>};const row=result?.rows?.[0];
            if(!row||typeof row.statement_timeout!=='string'||typeof row.lock_timeout!=='string')throw pgError('PG_SETTINGS_UNAVAILABLE');
            this.baseline={statement_timeout:row.statement_timeout,lock_timeout:row.lock_timeout};
        }
        async configure(ctx:Context,local=false){
            const remaining=ctx.deadline===undefined?policy.statementTimeoutMs:Math.max(1,ctx.deadline-Date.now());
            const statement=Math.min(policy.statementTimeoutMs,remaining),lock=policy.lockTimeoutMs===0?0:Math.min(policy.lockTimeoutMs,statement);
            await this.raw(local?localSettings:setSettings,[String(statement),String(lock)],ctx);
        }
        async query(sql:string,params:unknown[],ctx:Context,local=false){await this.configure(ctx,local);return this.raw(sql,params,ctx);}
        finish(){return this.finishing??=Promise.resolve().then(async()=>{
            try{
                await Promise.allSettled([...this.active]);if(this.ending)await this.ending;if(this.hasEndingError)throw pgError('PG_END_FAILED',this.endingError);
                if(!this.bad&&this.baseline){
                    await this.raw(setSettings,[this.baseline.statement_timeout,this.baseline.lock_timeout]);
                    const result=await this.raw(readSettings) as {rows?:Array<{statement_timeout?:unknown;lock_timeout?:unknown}>};const row=result?.rows?.[0];
                    if(row?.statement_timeout!==this.baseline.statement_timeout||row.lock_timeout!==this.baseline.lock_timeout)throw pgError('PG_SETTINGS_RESET_FAILED');
                }
            }catch(error){failures++;await this.terminate();throw error;}
            finally{if(this.ending)await this.ending;this.released=true;this.client.off?.('error',this.onError);try{this.client.release(this.bad);}finally{leases.delete(this);if(this.bad)discarded++;}}
        });}
    }
    return {acquire,status,
        async legacy<T>(run:()=>Promise<T>,raw:Context={}):Promise<T>{
            const ctx=context(raw);if(closed||ctx.signal?.aborted)throw pgError('PG_QUERY_CANCELLED');if(ctx.deadline!==undefined&&ctx.deadline<=Date.now())throw pgError('PG_QUERY_TIMEOUT');if(legacyWork.size>=policy.maxPendingAcquires)throw pgError('PG_POOL_SATURATED');
            const work=Promise.resolve().then(()=>{if(ctx.signal!.aborted)throw pgError('PG_QUERY_CANCELLED');return run();});legacyWork.add(work);void work.finally(()=>legacyWork.delete(work)).catch(()=>{});
            let timer:ReturnType<typeof setTimeout>|undefined,abort=()=>{};
            const stopped=new Promise<never>((_,reject)=>{abort=()=>reject(pgError('PG_QUERY_CANCELLED'));ctx.signal!.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>reject(pgError('PG_QUERY_TIMEOUT')),Math.max(1,Math.min(policy.queryTimeoutMs,ctx.deadline===undefined?Infinity:ctx.deadline-Date.now())));});
            try{return await Promise.race([work,stopped]);}finally{if(timer)clearTimeout(timer);ctx.signal!.removeEventListener('abort',abort);}
        },
        close(){if(closing)return closing;closed=true;return closing=Promise.resolve().then(async()=>{shutdown.abort();
            const work=(async()=>{const results=await Promise.allSettled([...leases].map(async lease=>{await lease.terminate();await lease.finish();}));const errors=results.filter((r):r is PromiseRejectedResult=>r.status==='rejected').map(r=>r.reason);try{if(owned)await pool.end?.();}catch(error){errors.push(error);}finally{pool.off?.('error',onPoolError);}if(errors.length)throw new AggregateError(errors,'PostgreSQL shutdown cleanup failed');})();
            let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(pgError('PG_SHUTDOWN_TIMEOUT')),policy.shutdownTimeoutMs);})]);}finally{if(timer)clearTimeout(timer);}
        });}
    };
}
