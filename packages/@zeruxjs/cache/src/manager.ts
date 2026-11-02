import {cachePolicy,cacheCapabilities,cacheSetOptions,cacheValue,cacheKey,cacheBulk} from "./policy.js";
import type {CacheRememberOptions,CacheProducerContext,CacheCapabilities} from "./types.js";
import { createRequire } from "node:module";
import path from "node:path";
import { createMemoryCacheHelper } from "./memory.js";
import type { MemoryCacheOptions } from "./memory.js";

import type {
    CacheHelper,
    CacheManager,
    CacheManagerConfig,
    CacheSetOptions,
    CacheValue,
    MaybePromise
} from "./types.js";
import {
    createCacheError,
    extractCacheHelperFactory,
    normalizeCacheConfig
} from "./utils.js";

/**
 * Title: Application-scoped helper import
 * Description: Resolves cache helper packages from the running application's node_modules before falling back to package-local resolution.
 * Global Variables: process.cwd()
 * @param packageName Helper package name from Zerux config.
 * @returns Imported helper module namespace.
 */
const importHelperPackage = async (packageName: string): Promise<Record<string, unknown>> => {
    try {
        const appRequire = createRequire(path.join(process.cwd(), "package.json"));
        return await import(appRequire.resolve(packageName)) as Record<string, unknown>;
    } catch {
        return await import(packageName) as Record<string, unknown>;
    }
};

/**
 * Title: Cache manager implementation
 * Description: Applies global defaults, namespaces keys, and delegates storage operations to one configured helper.
 * Global Variables: none
 */
class CacheManagerImpl implements CacheManager {
    public readonly helper: string;
    public readonly prefix?: string;
    public readonly defaultTtlSeconds?: number;
    public readonly capabilities:Readonly<CacheCapabilities>;
    readonly #policy;readonly #shutdown=new AbortController();#closed=false;#closing?:Promise<void>;
    readonly #work=new Set<Promise<unknown>>();
    readonly #adapter: CacheHelper;
    readonly #pending = new Map<string, Promise<CacheValue>>();

    constructor(config: Required<Pick<CacheManagerConfig, "helper">> & CacheManagerConfig, adapter: CacheHelper) {
        if(!adapter||typeof adapter!=='object'||['get','set','delete','has','clear','getMany','setMany','deleteMany','increment','decrement','touch'].some(name=>typeof (adapter as unknown as Record<string,unknown>)[name]!=='function'))throw createCacheError({code:'INVALID_CACHE_HELPER',message:'Cache helper does not implement the required contract'});
        this.helper = config.helper;
        this.prefix = config.prefix;
        this.defaultTtlSeconds = config.defaultTtlSeconds;
        this.#policy=cachePolicy(config.policy);this.capabilities=cacheCapabilities(adapter.capabilities);
        for(const name of this.#policy.requireCapabilities)if(this.capabilities[name]!=='supported')throw createCacheError({code:'CACHE_CAPABILITY_REQUIRED',message:'Required cache capability unavailable'});
        this.#adapter=new Proxy(adapter,{get:(target,key)=>{const value=Reflect.get(target,key);if(typeof value!=='function')return value;return (...args:unknown[])=>{const result=Reflect.apply(value,target,args);if(result&&typeof (result as Promise<unknown>).then==='function'){const pending=Promise.resolve(result);this.#work.add(pending);void pending.finally(()=>this.#work.delete(pending)).catch(()=>{});return pending;}return result;};}});
    }

    get(key: string): MaybePromise<CacheValue | undefined> {
        const result=this.#adapter.get(this.#key(key));
        const copy=(value:CacheValue|undefined)=>value===undefined?undefined:cacheValue(value,this.#policy);
        return result&&typeof (result as Promise<unknown>).then==='function'?Promise.resolve(result).then(copy):copy(result as CacheValue|undefined);
    }

    set(key: string, value: CacheValue, options: CacheSetOptions = {}): MaybePromise<void> {
        this.#setOptions(options);

        return this.#adapter.set(this.#key(key), cacheValue(value,this.#policy), {
            ...options,
            ttlSeconds: options.ttlSeconds ?? this.defaultTtlSeconds
        });
    }

    delete(key: string): MaybePromise<boolean> {
        return this.#adapter.delete(this.#key(key));
    }

    has(key: string): MaybePromise<boolean> {
        return this.#adapter.has(this.#key(key));
    }

    clear(): MaybePromise<void> {
        this.#open();this.#supported("namespaceClear",Boolean(this.prefix));
        if (!this.prefix) return this.#adapter.clear();
        if (!this.#adapter.clearPrefix) {
            throw createCacheError({ code: "NAMESPACE_CLEAR_UNSUPPORTED", message: "Helper cannot safely clear a namespace" });
        }
        return this.#adapter.clearPrefix(this.prefix);
    }

    getMany(keys: string[]): MaybePromise<Record<string, CacheValue | undefined>> {
        this.#open();cacheBulk(keys,this.#policy);
        const namespaced = keys.map((key) => this.#key(key));
        const restore = (result: Record<string, CacheValue | undefined>) => {
            const mapped: Record<string, CacheValue | undefined> = Object.create(null);
            keys.forEach((key, index) => { Object.defineProperty(mapped, key, { value: result[namespaced[index]]===undefined?undefined:cacheValue(result[namespaced[index]]!,this.#policy), enumerable: true, configurable: true, writable: true }); });
            return mapped;
        };
        const result = this.#adapter.getMany(namespaced);
        return result && typeof (result as Promise<unknown>).then === "function"
            ? Promise.resolve(result).then(restore)
            : restore(result as Record<string, CacheValue | undefined>);
    }

    setMany(values: Record<string, CacheValue>, options: CacheSetOptions = {}): MaybePromise<void> {
        this.#setOptions(options);
        if(!values||typeof values!=="object"||Array.isArray(values))throw new TypeError("Invalid cache bulk values");
        cacheBulk(Object.keys(values),this.#policy);
        const copied=Object.fromEntries(Object.entries(values).map(([key,value])=>[this.#key(key),cacheValue(value,this.#policy)]));
        return this.#adapter.setMany(
            copied,
            { ...options, ttlSeconds: options.ttlSeconds ?? this.defaultTtlSeconds }
        );
    }

    deleteMany(keys: string[]): MaybePromise<number> {
        this.#open();cacheBulk(keys,this.#policy);
        return this.#adapter.deleteMany(keys.map((key) => this.#key(key)));
    }

    increment(key: string, amount = 1): MaybePromise<number> {
        this.#open();this.#supported("counters");this.#assertAmount(amount);
        return this.#counter(this.#adapter.increment(this.#key(key), amount));
    }

    decrement(key: string, amount = 1): MaybePromise<number> {
        this.#open();this.#supported("counters");this.#assertAmount(amount);
        return this.#counter(this.#adapter.decrement(this.#key(key), amount));
    }

    touch(key: string, ttlSeconds: number): MaybePromise<boolean> {
        this.#assertTtl(ttlSeconds);
        return this.#adapter.touch(this.#key(key), ttlSeconds);
    }

    close(): Promise<void> {
        this.#closed=true;
        return this.#closing??=Promise.resolve().then(async()=>{this.#shutdown.abort();await Promise.allSettled([...this.#pending.values(),...this.#work]);if(this.#policy.ownHelper)await this.#adapter.close?.();});
    }

    /** Coalesce production, while caller cancellation only detaches that waiter. */
    async remember(key:string,producer:(context:CacheProducerContext)=>MaybePromise<CacheValue>,options:CacheRememberOptions={}):Promise<CacheValue>{
        const scoped=this.#key(key);this.#setOptions(options);
        if(typeof producer!=="function"||options.signal!==undefined&&!(options.signal instanceof AbortSignal)||options.deadline!==undefined&&(!Number.isSafeInteger(options.deadline)||options.deadline<0||options.deadline>Date.now()+600000)||options.timeoutMs!==undefined&&(!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<1||options.timeoutMs>600000))throw new TypeError("Invalid cache producer options");
        const deadline=Math.min(options.deadline??Infinity,options.timeoutMs===undefined?Infinity:Date.now()+options.timeoutMs);
        if(options.signal?.aborted||deadline<=Date.now())throw createCacheError({code:'CACHE_PRODUCER_CANCELLED',message:'Cache producer cancelled'});
        let job=this.#pending.get(scoped);
        if(!job){
            if(this.#pending.size>=this.#policy.maxPendingProducers)throw createCacheError({code:'CACHE_PRODUCER_LIMIT',message:'Cache producer capacity exceeded'});
            const controller=new AbortController(),abort=()=>controller.abort();this.#shutdown.signal.addEventListener('abort',abort,{once:true});
            let timer:ReturnType<typeof setTimeout>|undefined;
            if(Number.isFinite(deadline))timer=setTimeout(abort,Math.max(1,deadline-Date.now()));
            job=Promise.resolve().then(async()=>{const existing=await this.get(key);if(existing!==undefined)return existing;if(controller.signal.aborted||deadline<=Date.now())throw createCacheError({code:'CACHE_PRODUCER_CANCELLED',message:'Cache producer cancelled'});const value=await producer({signal:controller.signal,deadline:Number.isFinite(deadline)?deadline:undefined});if(controller.signal.aborted||deadline<=Date.now())throw createCacheError({code:'CACHE_PRODUCER_CANCELLED',message:'Cache producer cancelled'});await this.set(key,value,{ttlSeconds:options.ttlSeconds,ifAbsent:options.ifAbsent,ifPresent:options.ifPresent});return value;});
            this.#pending.set(scoped,job);const captured=job;
            void job.finally(()=>{if(timer)clearTimeout(timer);this.#shutdown.signal.removeEventListener('abort',abort);if(this.#pending.get(scoped)===captured)this.#pending.delete(scoped);}).catch(()=>{});
        }
        const waitingSignal=AbortSignal.any([this.#shutdown.signal,...(options.signal?[options.signal]:[])]);let timer:ReturnType<typeof setTimeout>|undefined,abort=()=>{};
        try{return await Promise.race([job,new Promise<never>((_,reject)=>{abort=()=>reject(createCacheError({code:'CACHE_PRODUCER_CANCELLED',message:'Cache producer cancelled'}));waitingSignal.addEventListener('abort',abort,{once:true});if(Number.isFinite(deadline))timer=setTimeout(abort,Math.max(1,deadline-Date.now()));if(waitingSignal.aborted)abort();})]);}
        finally{if(timer)clearTimeout(timer);waitingSignal.removeEventListener('abort',abort);}
    }

    native(): unknown {
        this.#open();
        return this.#adapter.native?.() ?? this.#adapter;
    }

    #counter(result:MaybePromise<number>):MaybePromise<number>{const check=(value:number)=>{if(!Number.isSafeInteger(value))throw createCacheError({code:'INVALID_COUNTER_RESULT',message:'Cache counter result must be a safe integer'});return value;};return result&&typeof (result as Promise<number>).then==='function'?Promise.resolve(result).then(check):check(result as number);}
    #open(){if(this.#closed)throw createCacheError({code:"CACHE_CLOSED",message:"Cache manager closed"});}
    #supported(name:keyof CacheCapabilities,requested=true){if(requested&&this.capabilities[name]==='unsupported')throw createCacheError({code:'CACHE_OPERATION_UNSUPPORTED',message:'Cache operation unsupported'});}
    #setOptions(options:CacheSetOptions){this.#open();cacheSetOptions(options);this.#supported('conditionalWrites',Boolean(options.ifAbsent||options.ifPresent));}
    #key(key: string): string {
        this.#open();cacheKey(key,this.#policy);
        if (typeof key !== "string" || key.length === 0) {
            throw createCacheError({
                code: "INVALID_KEY",
                message: "Cache key must be a non-empty string"
            });
        }

        return cacheKey(this.prefix ? `${this.prefix}:${key}` : key,this.#policy);
    }

    #assertTtl(ttlSeconds: number | undefined): void {
        if (ttlSeconds !== undefined && (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0)) {
            throw createCacheError({
                code: "INVALID_TTL",
                message: "ttlSeconds must be a positive finite number"
            });
        }
    }

    #assertAmount(amount: number): void {
        if (!Number.isSafeInteger(amount) || amount < 0) {
            throw createCacheError({
                code: "INVALID_AMOUNT",
                message: "Cache increment and decrement amounts must be non-negative safe integers"
            });
        }
    }
}

let activeManager: CacheManager | null = null;

/**
 * Title: Cache manager factory
 * Description: Creates a manager and loads the configured helper package.
 * Global Variables: none
 * @param config Cache manager config.
 * @returns Cache manager.
 */
export const createCacheManager = async (config: CacheManagerConfig): Promise<CacheManager> => {
    const normalized = normalizeCacheConfig(config);
    if (normalized.helper === "memory" || normalized.helper === "@zeruxjs/cache/memory") {
        return new CacheManagerImpl(normalized, createMemoryCacheHelper({...normalized.options as MemoryCacheOptions,policy:normalized.policy}));
    }
    const imported = await importHelperPackage(normalized.helper);
    const factory = extractCacheHelperFactory(imported);
    const adapter = await factory(normalized.options ?? {});

    try{return new CacheManagerImpl(normalized, adapter);}catch(error){try{await adapter.close?.();}catch(cleanup){throw new AggregateError([error,cleanup],"Cache initialization cleanup failed");}throw error;}
};

/**
 * Title: Active cache manager setter
 * Description: Updates the process-wide manager used by convenience exports.
 * Global Variables: activeManager
 * @param manager Cache manager instance.
 */
export const setActiveCacheManager = (manager: CacheManager): void => {
    activeManager = manager;
};

/**
 * Title: Active cache manager getter
 * Description: Returns the configured process-wide cache manager.
 * Global Variables: activeManager
 * @returns Active manager instance.
 */
export const getActiveCacheManager = (): CacheManager => {
    if (!activeManager) {
        throw createCacheError({
            code: "CACHE_MANAGER_NOT_INITIALIZED",
            message: "Cache manager has not been initialized yet"
        });
    }

    return activeManager;
};

/**
 * Title: Cache manager configurator
 * Description: Creates and installs the active manager in one step.
 * Global Variables: activeManager
 * @param config Cache manager config.
 * @returns Installed manager.
 */
export const configureCacheManager = async (config: CacheManagerConfig): Promise<CacheManager> => {
    const manager = await createCacheManager(config);
    setActiveCacheManager(manager);
    return manager;
};

/** Construct a manager from an existing adapter (useful for memory and test adapters). */
export const createCacheManagerWithHelper = (helper: CacheHelper, config: Omit<CacheManagerConfig, "helper"> & { helper?: string } = {}): CacheManager => {
    const normalized = normalizeCacheConfig({ ...config, helper: config.helper ?? "custom" });
    return new CacheManagerImpl(normalized, helper);
};
