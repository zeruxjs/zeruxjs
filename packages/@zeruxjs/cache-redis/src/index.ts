import type { CacheHelperFactory } from "@zeruxjs/cache";
import { createRedisCacheHelper } from "./helper.js";
import type { RedisCacheClient, RedisCacheHelperOptions } from "./types.js";
import { createIORedisCacheHelper, type IORedisCompatibleClient } from "./ioredis.js";

/** Choose node-redis (default) or ioredis. Injected clients remain caller-owned. */
export const createCacheHelper: CacheHelperFactory = async (rawOptions) => {
    const options = rawOptions as RedisCacheHelperOptions & {driver?: 'redis' | 'ioredis'; url?: string};
    const { driver = 'redis', allowFlushDb, ownClient, client, ...connectionOptions } = options;
    if (driver !== 'redis' && driver !== 'ioredis') throw new TypeError('Unknown Redis cache driver');
    if (driver === 'ioredis') {
        if (client) return createIORedisCacheHelper(client as unknown as IORedisCompatibleClient, {allowFlushDb, ownClient});
        const moduleId = 'ioredis';
        const {default: IORedis} = await import(moduleId) as {default: new (...args: unknown[]) => IORedisCompatibleClient & {connect():Promise<void>}};
        const {url, ...opts} = connectionOptions;
        // Lazy connect prevents racing client startup and lets us await errors.
        const connection = url ? new IORedis(url, {...opts,lazyConnect:true}) : new IORedis({...opts,lazyConnect:true});
        connection.on('error', () => undefined);
        try {await connection.connect();}
        catch(error) {try {await connection.quit();} catch {/* startup failure */} throw error;}
        return createIORedisCacheHelper(connection, {allowFlushDb,ownClient:true});
    }
    if (client) return createRedisCacheHelper(client, {allowFlushDb, ownClient});
    const moduleId = 'redis';
    const redis = await import(moduleId) as {createClient:(options:Record<string,unknown>)=>{on:(event:string,callback:(...args:unknown[])=>void)=>unknown;connect:()=>Promise<void>;close:()=>Promise<void>}};
    const connection = redis.createClient(connectionOptions);
    connection.on('error', () => undefined);
    try {await connection.connect();}
    catch(error) {try {await connection.close();} catch {/* startup failure */} throw error;}
    return createRedisCacheHelper(connection as unknown as RedisCacheClient, {allowFlushDb, ownClient: true});
};
export { RedisCacheHelper, createRedisCacheHelper } from "./helper.js";
export type { RedisCacheClient, RedisCacheHelperOptions } from "./types.js";
export { adaptIORedis, createIORedisCacheHelper, createBullMQRedisOptions, createBullMQRedisClusterConnections } from "./ioredis.js";
export type { IORedisCompatibleClient, RedisConnectionSettings, RedisClusterSettings, BullMQClusterClient, BullMQClusterConstructor } from "./ioredis.js";
export default createCacheHelper;
