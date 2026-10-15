import type { ZeruxConfig } from "../index.js";

type CacheModuleNamespace = {
    configureCacheManager?: (config: Record<string, unknown>) => Promise<unknown>;
    createCacheManager?: (config: Record<string, unknown>) => Promise<unknown>;
    setActiveCacheManager?: (manager: unknown) => void;
};

const withStartupTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(`[zerux cache] Startup timed out after ${timeoutMs}ms`));
                }, timeoutMs);
                timer.unref?.();
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
};

/**
 * Title: Cache runtime bootstrap
 * Description: Initializes the configured helper package and removes raw cache settings from runtime config.
 * Global Variables: none
 * @param config Zerux config object loaded for the current application.
 * @returns Initialized manager or null when cache is not configured.
 */
export const initializeCacheRuntime = async (config: ZeruxConfig): Promise<unknown | null> => {
    const cacheConfig = config.cache;
    const connector = cacheConfig && typeof cacheConfig === "object" && typeof cacheConfig.connector === "string"
        ? cacheConfig.connector
        : undefined;

    delete config.cache;

    if (!connector) {
        return null;
    }

    const resolvedCacheConfig = cacheConfig as NonNullable<ZeruxConfig["cache"]>;
    const startupTimeoutMs = typeof resolvedCacheConfig.startupTimeoutMs === "number" && resolvedCacheConfig.startupTimeoutMs > 0
        ? resolvedCacheConfig.startupTimeoutMs
        : 3_000;
    const required = resolvedCacheConfig.required === true;

    const moduleValue = await import("@zeruxjs/cache") as unknown as CacheModuleNamespace;
    const configure = moduleValue.configureCacheManager ?? moduleValue.createCacheManager;

    if (typeof configure !== "function") {
        throw new Error("[zerux cache] @zeruxjs/cache does not export a manager factory");
    }

    let manager: unknown;
    try {
        manager = await withStartupTimeout(configure({
            ...resolvedCacheConfig,
            helper: connector
        }), startupTimeoutMs);
    } catch (error) {
        if (required) throw error;

        console.warn(error instanceof Error ? error.message : "[zerux cache] Startup failed");
        return null;
    }

    if (moduleValue.setActiveCacheManager) {
        moduleValue.setActiveCacheManager(manager);
    }

    return manager;
};
