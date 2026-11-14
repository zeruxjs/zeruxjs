import { cachePolicy, cacheKey, cacheSetOptions } from './policy.js';
import type {
  CacheErrorShape,
  CacheHelperFactory,
  CacheManagerConfig,
} from './types.js';

/** Create the compatible cache error shape; host-supplied details still require redaction before client/log output.
 * @param {CacheErrorShape} error - Explicit public code/message and optional private diagnostic details.
 * @returns {Error & {details: CacheErrorShape}} Error retaining the supplied shape; no secret scrubbing is implied. */
export const createCacheError = (
  error: CacheErrorShape
): Error & { details: CacheErrorShape } => {
  /** Owned error object with the compatible ZeruxCacheError name and attached details. */
  const instance = new Error(error.message) as Error & {
    details: CacheErrorShape;
  };
  instance.name = 'ZeruxCacheError';
  instance.details = error;
  return instance;
};

/** Validate policy, prefix and TTL before any explicitly configured helper module loads.
 * @param {CacheManagerConfig} config - Trusted executable host helper configuration, never request-controlled module input.
 * @returns {Required<Pick<CacheManagerConfig, 'helper'>> & CacheManagerConfig} Normalized compatible config with copied options and effective policy. */
export const normalizeCacheConfig = (
  config: CacheManagerConfig
): Required<Pick<CacheManagerConfig, 'helper'>> & CacheManagerConfig => {
  if (
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    typeof config.helper !== 'string'
  ) {
    throw createCacheError({
      code: 'INVALID_CONFIG',
      message: 'Invalid cache configuration',
    });
  }
  /** Validated finite key/value/bulk/producer limits and helper ownership policy. */
  const policy = cachePolicy(config.policy);
  if (config.prefix !== undefined) {
    cacheKey(config.prefix, policy);
  }
  if (
    config.options !== undefined &&
    (!config.options ||
      typeof config.options !== 'object' ||
      Array.isArray(config.options))
  ) {
    throw createCacheError({
      code: 'INVALID_CONFIG',
      message: 'Invalid cache options',
    });
  }
  cacheSetOptions({ ttlSeconds: config.defaultTtlSeconds });
  /** Trimmed explicit host-selected helper name; not a disk-discovered adapter. */
  const helper = config.helper.trim();
  if (!helper) {
    throw createCacheError({
      code: 'MISSING_HELPER',
      message: 'A cache helper package is required',
    });
  }

  if (
    config.defaultTtlSeconds !== undefined &&
    (!Number.isFinite(config.defaultTtlSeconds) ||
      config.defaultTtlSeconds <= 0)
  ) {
    throw createCacheError({
      code: 'INVALID_TTL',
      message: 'defaultTtlSeconds must be a positive finite number',
    });
  }

  return {
    helper,
    policy,
    options:
      typeof config.options === 'object' && config.options !== null
        ? { ...config.options }
        : {},
    prefix:
      typeof config.prefix === 'string' && config.prefix.length > 0
        ? config.prefix
        : undefined,
    defaultTtlSeconds: config.defaultTtlSeconds,
  };
};

/** Select only supported factory export shapes from the explicitly imported host helper module.
 * @param {Record<string, unknown>} moduleValue - Namespace of a trusted configured executable adapter module.
 * @returns {CacheHelperFactory} Factory or fixed unsupported-export error; loading arbitrary untrusted configuration is unsafe. */
export const extractCacheHelperFactory = (
  moduleValue: Record<string, unknown>
): CacheHelperFactory => {
  /** First supported named/default factory export; no additional package code is evaluated here. */
  const candidate =
    moduleValue.createCacheHelper ??
    moduleValue.createHelper ??
    moduleValue.default;

  if (typeof candidate !== 'function') {
    throw createCacheError({
      code: 'INVALID_HELPER_FACTORY',
      message: 'Cache helper package does not export a helper factory',
    });
  }

  return candidate as CacheHelperFactory;
};
