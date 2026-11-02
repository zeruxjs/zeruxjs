import {cachePolicy,cacheKey,cacheSetOptions} from "./policy.js";
import type {
    CacheErrorShape,
    CacheHelperFactory,
    CacheManagerConfig
} from "./types.js";

/**
 * Title: Cache error creator
 * Description: Builds a consistent error payload for cache abstraction failures.
 * Global Variables: none
 * @param error Partial error information.
 * @returns Normalized Error instance.
 */
export const createCacheError = (error: CacheErrorShape): Error & { details: CacheErrorShape; } => {
    const instance = new Error(error.message) as Error & { details: CacheErrorShape; };
    instance.name = "ZeruxCacheError";
    instance.details = error;
    return instance;
};

/**
 * Title: Cache manager config normalization
 * Description: Validates helper package, key prefix, and default TTL before helper loading.
 * Global Variables: none
 * @param config Raw cache manager config.
 * @returns Validated cache manager config.
 */
export const normalizeCacheConfig = (config: CacheManagerConfig): Required<Pick<CacheManagerConfig, "helper">> & CacheManagerConfig => {
    if(!config||typeof config!=="object"||Array.isArray(config)||typeof config.helper!=="string")throw createCacheError({code:"INVALID_CONFIG",message:"Invalid cache configuration"});
    const policy=cachePolicy(config.policy);
    if(config.prefix!==undefined)cacheKey(config.prefix,policy);
    if(config.options!==undefined&&(!config.options||typeof config.options!=="object"||Array.isArray(config.options)))throw createCacheError({code:"INVALID_CONFIG",message:"Invalid cache options"});
    cacheSetOptions({ttlSeconds:config.defaultTtlSeconds});
    const helper = config.helper.trim();
    if (!helper) {
        throw createCacheError({
            code: "MISSING_HELPER",
            message: "A cache helper package is required"
        });
    }

    if (config.defaultTtlSeconds !== undefined && (!Number.isFinite(config.defaultTtlSeconds) || config.defaultTtlSeconds <= 0)) {
        throw createCacheError({
            code: "INVALID_TTL",
            message: "defaultTtlSeconds must be a positive finite number"
        });
    }

    return {
        helper,
        policy,
        options: typeof config.options === "object" && config.options !== null ? { ...config.options } : {},
        prefix: typeof config.prefix === "string" && config.prefix.length > 0 ? config.prefix : undefined,
        defaultTtlSeconds: config.defaultTtlSeconds
    };
};

/**
 * Title: Helper factory extraction
 * Description: Reads supported factory export shapes from a dynamically imported helper package.
 * Global Variables: none
 * @param moduleValue Imported module namespace.
 * @returns Cache helper factory.
 */
export const extractCacheHelperFactory = (moduleValue: Record<string, unknown>): CacheHelperFactory => {
    const candidate = moduleValue.createCacheHelper ??
        moduleValue.createHelper ??
        moduleValue.default;

    if (typeof candidate !== "function") {
        throw createCacheError({
            code: "INVALID_HELPER_FACTORY",
            message: "Cache helper package does not export a helper factory"
        });
    }

    return candidate as CacheHelperFactory;
};
