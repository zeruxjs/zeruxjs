import type {AtomicRateLimitClaim,AtomicRateLimitDecision,RateLimitRequest} from '@zeruxjs/security';
import {fixedWindowScript} from './limiter-script.js';
import type { CacheHelper, CacheSetOptions, CacheValue } from '@zeruxjs/cache';
import { serialize, deserialize, expiration, counterAmount, prefixGlob } from './codec.js';
import type { RedisCacheClient } from './types.js';
import {redisPolicy,redisError,RedisCacheError,redisKey,redisBulk} from './policy.js';
import type {RedisCachePolicy,RedisOperation,RedisOperationRecord,RedisRequestOptions} from './policy.js';
export interface RedisHelperConfig extends RedisCachePolicy {allowFlushDb?:boolean;ownClient?:boolean;cluster?:boolean}
export interface RedisSetOptions extends CacheSetOptions,RedisRequestOptions {}
/** Wait for every issued batch command, including siblings of a failed command. */
async function settle<T>(promises:Promise<T>[]):Promise<T[]>{const results=await Promise.allSettled(promises);const errors=results.filter((r):r is PromiseRejectedResult=>r.status==='rejected').map(r=>r.reason);if(errors.length)throw errors.length===1?errors[0]:new AggregateError(errors,'Redis batch failed');return results.map(r=>(r as PromiseFulfilledResult<T>).value);}
/** One scoped cache wrapper. Deadlines do not cancel or replay native writes. */
export class RedisCacheHelper implements CacheHelper {
    readonly capabilities;readonly #policy;readonly #active=new Set<Promise<unknown>>();readonly #controllers=new Set<AbortController>();
    #closed=false;#closing?:Promise<void>;#hookPending=0;#hookErrors=0;#hookDropped=0;#backendErrors=0;readonly #onError=()=>{this.#backendErrors++;};
    constructor(private readonly client:RedisCacheClient,private readonly config:RedisHelperConfig={}){
        this.#policy=redisPolicy(config);this.config={...config};
        for(const flag of ['ownClient','allowFlushDb','cluster'] as const)if(config[flag]!==undefined&&typeof config[flag]!=='boolean')throw redisError('REDIS_INVALID_OPTIONS');
        if(!client||['get','set','del','exists','mGet','mSet','incrBy','decrBy','expire','scanIterator'].some(key=>typeof (client as unknown as Record<string,unknown>)[key]!=='function'))throw redisError('REDIS_INVALID_CLIENT');
        if(client.off)client.on?.('error',this.#onError);
        this.capabilities=Object.freeze({conditionalWrites:'supported' as const,counters:'supported' as const,namespaceClear:'supported' as const,bulkAtomicity:'unsupported' as const,ownership:config.ownClient?'owned' as const:'borrowed' as const});
    }
    #emit(record:RedisOperationRecord){const hook=this.#policy.onOperation;if(!hook)return;if(this.#hookPending>=16){this.#hookDropped++;return;}try{const pending=hook(Object.freeze(record));if(pending&&typeof pending.then==='function'){this.#hookPending++;void Promise.resolve(pending).catch(()=>{this.#hookErrors++;}).finally(()=>{this.#hookPending--;});}}catch{this.#hookErrors++;}}
    async #run<T>(operation:RedisOperation,execute:(check:()=>void)=>Promise<T>,options:RedisRequestOptions={}):Promise<T>{
        if(this.#closed)throw redisError('REDIS_CACHE_CLOSED');
        if(!options||typeof options!=='object'||Array.isArray(options)||options.signal!==undefined&&!(options.signal instanceof AbortSignal)||options.deadline!==undefined&&(!Number.isSafeInteger(options.deadline)||options.deadline<0))throw redisError('REDIS_INVALID_REQUEST');
        options={...options};
        const start=performance.now(),write=!['get','has','getMany'].includes(operation),controller=new AbortController();let timedOut=false,timer:ReturnType<typeof setTimeout>|undefined;
        const abort=()=>controller.abort();const deadline=Math.min(Date.now()+this.#policy.commandTimeoutMs,options.deadline??Infinity);
        if(options.signal?.aborted||deadline<=Date.now())throw redisError(deadline<=Date.now()?'REDIS_COMMAND_DEADLINE':'REDIS_COMMAND_CANCELLED');
        if(this.#active.size>=this.#policy.maxPendingCommands){this.#emit({operation,durationMs:0,outcome:'overload',code:'REDIS_COMMAND_OVERLOAD'});throw redisError('REDIS_COMMAND_OVERLOAD');}
        options.signal?.addEventListener('abort',abort,{once:true});this.#controllers.add(controller);
        const check=()=>{if(this.#closed||controller.signal.aborted||Date.now()>=deadline)throw redisError(this.#closed?'REDIS_CACHE_CLOSED':timedOut||Date.now()>=deadline?'REDIS_COMMAND_DEADLINE':'REDIS_COMMAND_CANCELLED',undefined,write);};
        const work=Promise.resolve().then(()=>{check();return execute(check);});this.#active.add(work);
        void work.finally(()=>{this.#active.delete(work);this.#controllers.delete(controller);}).catch(()=>{});
        let cancel=()=>{};
        const stopped=new Promise<never>((_,reject)=>{cancel=()=>reject(redisError(this.#closed?'REDIS_CACHE_CLOSED':timedOut?'REDIS_COMMAND_DEADLINE':'REDIS_COMMAND_CANCELLED',undefined,write));controller.signal.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>{timedOut=true;controller.abort();},Math.max(1,deadline-Date.now()));if(controller.signal.aborted)cancel();});
        try{const result=await Promise.race([work,stopped]);check();this.#emit({operation,durationMs:performance.now()-start,outcome:'ok'});return result;}
        catch(cause){const known=['REDIS_CACHE_CLOSED','REDIS_COMMAND_DEADLINE','REDIS_COMMAND_CANCELLED','REDIS_COUNTER_RANGE','REDIS_INVALID_RESULT','REDIS_INVALID_JSON','REDIS_JSON_LIMIT','REDIS_SCAN_LIMIT','REDIS_INVALID_KEY','REDIS_CLUSTER_MASTERS_UNAVAILABLE','REDIS_INVALID_LIMITER_RESULT'];const error=cause instanceof RedisCacheError&&known.includes(cause.code)?cause:redisError('REDIS_BACKEND_ERROR',cause,write);this.#emit({operation,durationMs:performance.now()-start,outcome:error.code==='REDIS_COMMAND_DEADLINE'?'deadline':['REDIS_COMMAND_CANCELLED','REDIS_CACHE_CLOSED'].includes(error.code)?'cancelled':'error',code:error.code,...(error.details.writeOutcome?{writeOutcome:'unknown' as const}:{})});throw error;}
        finally{if(timer)clearTimeout(timer);controller.signal.removeEventListener('abort',cancel);options.signal?.removeEventListener('abort',abort);}
    }
    getDiagnostics(){return Object.freeze({closed:this.#closed,pending:this.#active.size,hookPending:this.#hookPending,hookErrors:this.#hookErrors,hookDropped:this.#hookDropped,backendErrors:this.#backendErrors});}
    async get(key:string,options:RedisRequestOptions={}):Promise<CacheValue|undefined>{redisKey(key);return this.#run('get',async()=>{const value=await this.client.get(key);if(value===null)return undefined;if(typeof value!=='string')throw redisError('REDIS_INVALID_RESULT');return deserialize(value);},options);}
    async set(key:string,value:CacheValue,opts:RedisSetOptions={}):Promise<void>{redisKey(key);this.#conditions(opts);opts={...opts};const expiry=expiration(opts.ttlSeconds),body=serialize(value);return this.#run('set',async()=>{await this.client.set(key,body,{...(expiry===undefined?{}:{EX:expiry}),...(opts.ifAbsent?{NX:true}:{}),...(opts.ifPresent?{XX:true}:{})});},opts);}
    async delete(key:string){redisKey(key);return this.#run('delete',async()=>await this.client.del(key)>0);}
    async has(key:string){redisKey(key);return this.#run('has',async()=>await this.client.exists(key)>0);}
    async clear(){if(!this.config.allowFlushDb||!this.client.flushDb)throw new Error('Redis FLUSHDB is disabled');return this.#run('clear',async()=>{await this.client.flushDb!();});}
    async clearPrefix(prefix:string){if(typeof prefix!=='string'||!prefix.length||prefix.length>256)throw redisError('REDIS_INVALID_PREFIX');return this.#run('clearPrefix',async check=>{
        const iterator=this.client.scanIterator({MATCH:prefixGlob(prefix),COUNT:100})[Symbol.asyncIterator]();let pages=0;
        try{while(true){check();const page=await iterator.next();if(page.done)break;if(++pages>this.#policy.maxScanPages)throw redisError('REDIS_SCAN_LIMIT');const keys=typeof page.value==='string'?[page.value]:page.value;if(!Array.isArray(keys)||keys.length>10000)throw redisError('REDIS_INVALID_RESULT');for(let i=0;i<keys.length;i+=32){check();await settle(keys.slice(i,i+32).map(async key=>{if(typeof key!=='string')throw redisError('REDIS_INVALID_RESULT');if(!key.startsWith(prefix+':'))return 0;redisKey(key);return this.client.del(key);}));}}}finally{await iterator.return?.();}
    });}
    async getMany(keys:string[]){keys=redisBulk(keys);return this.#run('getMany',async check=>{const result:Record<string,CacheValue|undefined>=Object.create(null);if(!keys.length)return result;let data:Array<string|null>;if(this.config.cluster){data=[];for(let i=0;i<keys.length;i+=32){check();data.push(...await settle(keys.slice(i,i+32).map(async key=>this.client.get(key))));}}else data=await this.client.mGet(keys);if(!Array.isArray(data)||data.length!==keys.length)throw redisError('REDIS_INVALID_RESULT');keys.forEach((key,i)=>{result[key]=data[i]===null?undefined:deserialize(data[i]!);});return result;});}
    async setMany(values:Record<string,CacheValue>,opts:RedisSetOptions={}){this.#conditions(opts);opts={...opts};expiration(opts.ttlSeconds);if(!values||typeof values!=='object'||Array.isArray(values))throw redisError('REDIS_INVALID_VALUE');const keys=redisBulk(Object.keys(values)),encoded=Object.fromEntries(keys.map(key=>[key,serialize(values[key])]));return this.#run('setMany',async check=>{if(!keys.length)return;if(this.config.cluster||opts.ttlSeconds!==undefined||opts.ifAbsent||opts.ifPresent){for(let i=0;i<keys.length;i+=32){check();await settle(keys.slice(i,i+32).map(async key=>this.client.set(key,encoded[key],{...(opts.ttlSeconds===undefined?{}:{EX:expiration(opts.ttlSeconds)}),...(opts.ifAbsent?{NX:true}:{}),...(opts.ifPresent?{XX:true}:{})})));}}else await this.client.mSet(encoded);},opts);}
    async deleteMany(keys:string[]){keys=redisBulk(keys);return this.#run('deleteMany',async check=>{let removed=0;for(let i=0;i<keys.length;i+=32){check();for(const count of await settle(keys.slice(i,i+32).map(async key=>this.client.del(key)))){if(!Number.isSafeInteger(count)||count<0)throw redisError('REDIS_INVALID_RESULT');removed+=count;}}return removed;});}
    async increment(key:string,amount=1){redisKey(key);counterAmount(amount);return this.#run('increment',async()=>this.#counter(await this.client.incrBy(key,amount)));}
    async decrement(key:string,amount=1){redisKey(key);counterAmount(amount);return this.#run('decrement',async()=>this.#counter(await this.client.decrBy(key,amount)));}
    async touch(key:string,seconds:number){redisKey(key);if(seconds===undefined)throw redisError('REDIS_INVALID_TTL');const ttl=expiration(seconds)!;return this.#run('touch',async()=>Boolean(await this.client.expire(key,ttl)));}
    /** Fixed script only; explicit Cluster hash tag and bounded opaque subject cardinality. */
    async claimRateLimit(input:AtomicRateLimitClaim,store:{namespace:string;maxKeys:number;maxWindowMs:number},request:RateLimitRequest={}):Promise<AtomicRateLimitDecision>{
        if(!input||typeof input.key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.key)||!Number.isSafeInteger(input.windowMs)||input.windowMs<1||!Number.isSafeInteger(input.max)||input.max<1||input.max>1000000||!Number.isSafeInteger(input.weight)||input.weight<1||input.weight>1000000||!store||typeof store.namespace!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(store.namespace)||!Number.isSafeInteger(store.maxKeys)||store.maxKeys<1||store.maxKeys>100000||!Number.isSafeInteger(store.maxWindowMs)||store.maxWindowMs<1||store.maxWindowMs>86400000||input.windowMs>store.maxWindowMs)throw redisError('REDIS_INVALID_LIMITER_CLAIM');
        if(!this.client.eval)throw redisError('REDIS_ATOMIC_LIMITER_UNSUPPORTED');
        return this.#run('rateLimit',async()=>{
            const result=await this.client.eval!(fixedWindowScript,{keys:[`zerux:rl:{${store.namespace}}:counts`,`zerux:rl:{${store.namespace}}:expires`],arguments:[input.key,String(input.windowMs),String(input.max),String(input.weight),String(store.maxKeys),String(store.maxWindowMs)]});
            if(!Array.isArray(result)||result.length!==5||result.some(value=>!Number.isSafeInteger(value)||value<0)||![0,1].includes(result[0])||![0,1].includes(result[4])||result[1]>input.max||result[2]<=result[3]||result[2]-result[3]>store.maxWindowMs||result[0]===1&&result[4]===1)throw redisError('REDIS_INVALID_LIMITER_RESULT');
            return {allowed:result[0]===1,remaining:result[1],resetAt:result[2],now:result[3],reason:result[0]===1?'allowed':result[4]===1?'capacity':'rate'};
        },request);
    }
    close():Promise<void>{this.#closed=true;return this.#closing??=Promise.resolve().then(async()=>{for(const controller of this.#controllers)controller.abort();const cleanup=Promise.allSettled([...this.#active]).then(async()=>{try{if(this.config.ownClient)await this.client.close?.();}finally{this.client.off?.('error',this.#onError);}});let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([cleanup,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{try{if(this.config.ownClient)this.client.destroy?.();}catch(cause){reject(redisError('REDIS_CLOSE_FAILED',cause));return;}reject(redisError('REDIS_SHUTDOWN_DEADLINE'));},this.#policy.shutdownTimeoutMs);})]);}catch(cause){throw cause instanceof RedisCacheError?cause:redisError('REDIS_CLOSE_FAILED',cause);}finally{if(timer)clearTimeout(timer);}});}
    native():RedisCacheClient{if(this.#closed)throw redisError('REDIS_CACHE_CLOSED');return this.client;}
    #counter(value:number){if(!Number.isSafeInteger(value))throw redisError('REDIS_COUNTER_RANGE',undefined,true);return value;}
    #conditions(opts:CacheSetOptions){if(!opts||typeof opts!=='object'||Array.isArray(opts)||opts.ifAbsent!==undefined&&typeof opts.ifAbsent!=='boolean'||opts.ifPresent!==undefined&&typeof opts.ifPresent!=='boolean'||opts.ifAbsent&&opts.ifPresent)throw redisError('REDIS_INVALID_CONDITION');}
}
export const createRedisCacheHelper=(client:RedisCacheClient,config:RedisHelperConfig={}):RedisCacheHelper=>new RedisCacheHelper(client,config);
