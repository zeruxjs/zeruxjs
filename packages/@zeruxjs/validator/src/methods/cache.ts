import { _runSchema, bypassCache, consumeCachedIssues } from '../utils/_run.js';
import type { OutputDataset } from '../types/index.js';
import type {
  BaseIssue,
  BaseSchema,
  InferIssue,
  InferOutput,
} from '../types/index.js';
import { _cloneDataset, _getStandardProps } from '../utils/index.js';
import { _LruCache } from './_LruCache.js';
import type { Cache, CacheConfig } from './types/cache.js';

/**
 * Schema with cache type.
 *
 * @beta
 */
export type SchemaWithCache<
  TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TCacheConfig extends CacheConfig | undefined,
> = TSchema & {
  /**
   * The cache config.
   */
  readonly cacheConfig: TCacheConfig;
  /**
   * The cache instance.
   */
  readonly cache: Cache<
    OutputDataset<InferOutput<TSchema>, InferIssue<TSchema>>
  >;
};

/**
 * Caches the output of a schema.
 *
 * Hint: Primitive inputs are cached by value. Object and function inputs are
 * cached by reference identity, so mutating input objects and reusing the same
 * reference can return a stale cached dataset. Returned objects are also
 * reused by reference, so mutating cached output can affect later cache hits.
 *
 * @param {TSchema} schema - Trusted schema whose callbacks and mutable output identity remain caller-owned.
 *
 * @returns {SchemaWithCache<TSchema, undefined>} Local cached schema; explicit root signal/budgets bypass shared work.
 *
 * @beta
 */
export function cache<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(schema: TSchema): SchemaWithCache<TSchema, undefined>;

/**
 * Caches the output of a schema.
 *
 * Hint: Primitive inputs are cached by value. Object and function inputs are
 * cached by reference identity, so mutating input objects and reusing the same
 * reference can return a stale cached dataset. Returned objects are also
 * reused by reference, so mutating cached output can affect later cache hits.
 *
 * @param {TSchema} schema - Trusted schema whose callbacks and mutable output identity remain caller-owned.
 * @param {TCacheConfig} config - Optional legacy local maxSize/maxAge policy; no persistence or automatic cleanup owner.
 *
 * @returns {SchemaWithCache<TSchema, TCacheConfig>} Local cached schema; mutable input/output identity caveats remain unchanged.
 *
 * @beta
 */
export function cache<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TCacheConfig extends CacheConfig | undefined,
>(
  schema: TSchema,
  config: TCacheConfig
): SchemaWithCache<TSchema, TCacheConfig>;

/** Wrap a schema with legacy process-local result reuse while retaining controlled root-parse isolation.
 * @param {object} schema - Trusted declared schema; callbacks are not sandboxed or automatically retried.
 * @param {CacheConfig} config - Optional local size/age policy; no network cache adapter is selected.
 * @returns {object} Cached schema wrapper with an explicit local clear API, not a resource close owner.
 */
// @__NO_SIDE_EFFECTS__
export function cache(
  schema: BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  config?: CacheConfig
): SchemaWithCache<
  BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  CacheConfig | undefined
> {
  return {
    ...schema,
    cacheConfig: config,
    cache: new _LruCache(config),
    /** Build the bounded root-execution Standard Schema adapter for this wrapper.
     * @returns {object} Inert V1 adapter; validation starts only when explicitly called.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Execute/reuse only compatible default work; controlled parses bypass this cache.
     * @param {import('../types/index.js').UnknownDataset} dataset - Current internal input dataset.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} runConfig - Current root config carrying private counters/signal.
     * @returns {OutputDataset<unknown, BaseIssue<unknown>>} Shallow copied wrapper/issues array; values and nested issue identity remain borrowed.
     */
    '~run'(dataset, runConfig) {
      if (bypassCache(runConfig)) {
        return _runSchema(schema, dataset, runConfig);
      }
      /** Instance compatibility key based on input identity/value and legacy parse flags only. */
      const key = this.cache.key(dataset.value, runConfig);
      let outputDataset = this.cache.get(key);
      if (!outputDataset) {
        this.cache.set(
          key,
          (outputDataset = _runSchema(schema, dataset, runConfig))
        );
      } else {
        consumeCachedIssues(runConfig, outputDataset.issues);
      }
      // Hint: We clone the dataset before returning it so downstream pipe items
      // do not mutate the cached dataset wrapper or issues array.
      return _cloneDataset(outputDataset);
    },
  };
}
