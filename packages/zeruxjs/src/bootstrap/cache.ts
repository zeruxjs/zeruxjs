import type { ZeruxConfig } from '../index.js';

type CacheModuleNamespace = {
  /** Legacy factory that may publish a process-wide active manager. */
  configureCacheManager?: (config: Record<string, unknown>) => Promise<unknown>;
  /** Preferred scoped factory that does not publish during preparation. */
  createCacheManager?: (config: Record<string, unknown>) => Promise<unknown>;
  /** Compatibility publication hook invoked only on activation. */
  setActiveCacheManager?: (manager: unknown) => void;
};

/** Bound caller waiting for cache startup, without force-cancelling the underlying factory.
 * @param {Promise<T>} promise - Native manager startup that may outlive this wait.
 * @param {number} timeoutMs - Positive host startup deadline in milliseconds.
 * @returns {Promise<T>} Startup result or deadline rejection; timer is always released.
 */
const withStartupTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(`[zerux cache] Startup timed out after ${timeoutMs}ms`)
          );
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

/**
 * Prepare a configured cache manager and remove private settings from runtime config.
 * Optional startup failure returns null; timeout does not cancel native factory work.
 * @param {ZeruxConfig} config - Mutable generation settings consumed by this bootstrap.
 * @param {object} activation - Optional generation activation registrar.
 * @param {Function} activation.onActivate - Register publication after successful preparation.
 * @returns {Promise<unknown | null>} Prepared manager, or null when disabled or optional startup fails.
 */
export const initializeCacheRuntime = async (
  config: ZeruxConfig,
  activation?: {
    /** Host registrar for publication after successful generation preparation. */
    onActivate: (callback: () => void) => void;
  }
): Promise<unknown | null> => {
  /** Private cache settings captured before their removal from runtime configuration. */
  const cacheConfig = config.cache;
  /** Explicit configured helper package; missing configuration leaves integration inert. */
  const connector =
    cacheConfig &&
    typeof cacheConfig === 'object' &&
    typeof cacheConfig.connector === 'string'
      ? cacheConfig.connector
      : undefined;

  delete config.cache;

  if (!connector) {
    return null;
  }

  /** Configured cache settings after the connector-presence guard. */
  const resolvedCacheConfig = cacheConfig as NonNullable<ZeruxConfig['cache']>;
  /** Positive configured wait budget or the compatibility three-second default. */
  const startupTimeoutMs =
    typeof resolvedCacheConfig.startupTimeoutMs === 'number' &&
    resolvedCacheConfig.startupTimeoutMs > 0
      ? resolvedCacheConfig.startupTimeoutMs
      : 3_000;
  /** Whether a failed or timed-out startup must fail application preparation. */
  const required = resolvedCacheConfig.required === true;

  /** Cache-owned factories loaded only after an explicit connector is selected. */
  const moduleValue =
    (await import('@zeruxjs/cache')) as unknown as CacheModuleNamespace;
  if (activation && typeof moduleValue.createCacheManager !== 'function') {
    throw new Error('Staged services require a non-publishing manager factory');
  }
  /** Prefer the non-publishing factory; legacy publishing fallback remains compatible. */
  const configure =
    moduleValue.createCacheManager ?? moduleValue.configureCacheManager;

  if (typeof configure !== 'function') {
    throw new Error(
      '[zerux cache] @zeruxjs/cache does not export a manager factory'
    );
  }

  let manager: unknown;
  try {
    manager = await withStartupTimeout(
      configure({
        ...resolvedCacheConfig,
        helper: connector,
      }),
      startupTimeoutMs
    );
  } catch (error) {
    if (required) {
      throw error;
    }

    console.warn(
      error instanceof Error ? error.message : '[zerux cache] Startup failed'
    );
    return null;
  }

  /** Publish only the prepared manager when the generation becomes active.
   * @returns {void} Compatibility active-manager update, when supported.
   */
  const activate = () => moduleValue.setActiveCacheManager?.(manager);
  if (activation) {
    activation.onActivate(activate);
  } else {
    activate();
  }

  return manager;
};
