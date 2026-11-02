import type {AtomicRateLimitStore,AtomicRateLimitClaim,RateLimitRequest} from '@zeruxjs/security';
import type {RedisCacheHelper} from './helper.js';
import {redisError} from './policy.js';
export interface RedisRateLimitStoreOptions {namespace:string;maxKeys?:number;maxWindowMs?:number;ownHelper?:boolean}
/** Uses only the helper's reviewed atomic strategy, never cache get/set or ad hoc script text. */
export function createRedisRateLimitStore(helper:RedisCacheHelper,options:RedisRateLimitStoreOptions):AtomicRateLimitStore{
 if(!helper||typeof helper.claimRateLimit!=='function'||!options||typeof options!=='object'||Object.keys(options).some(key=>!['namespace','maxKeys','maxWindowMs','ownHelper'].includes(key))||typeof options.namespace!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(options.namespace)||options.ownHelper!==undefined&&typeof options.ownHelper!=='boolean')throw redisError('REDIS_INVALID_LIMITER_STORE');
 if(typeof helper.native().eval!=='function')throw redisError('REDIS_ATOMIC_LIMITER_UNSUPPORTED');
 const maxKeys=options.maxKeys===undefined?10000:options.maxKeys,maxWindowMs=options.maxWindowMs===undefined?86400000:options.maxWindowMs;if(!Number.isSafeInteger(maxKeys)||maxKeys<1||maxKeys>100000||!Number.isSafeInteger(maxWindowMs)||maxWindowMs<1||maxWindowMs>86400000)throw redisError('REDIS_INVALID_LIMITER_STORE');
 const namespace=options.namespace,own=options.ownHelper===true;let closed=false;
 return {capability:'atomic-fixed-window-v1',scope:'distributed',async claim(input:AtomicRateLimitClaim,request:RateLimitRequest={}){if(closed)throw redisError('REDIS_LIMITER_CLOSED');return helper.claimRateLimit(input,{namespace,maxKeys,maxWindowMs},request);},async close(){if(closed)return;closed=true;if(own)await helper.close();}};
}
