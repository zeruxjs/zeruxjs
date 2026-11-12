import { _runSchema, bypassCache, consumeCachedIssues } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  Config,
  InferInput,
  InferIssue,
  InferOutput,
  OutputDataset,
  StandardProps,
  UnknownDataset,
} from '../types/index.js';
import { _cloneDataset, _getStandardProps } from '../utils/index.js';
import { _LruCache } from './_LruCache.js';
import type { Cache, CacheConfig } from './types/cache.js';

/**
 * Schema with cache async type.
 *
 * @beta
 */
export type SchemaWithCacheAsync<
  TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  TCacheConfig extends CacheConfig | undefined,
> = Omit<TSchema, 'async' | '~standard' | '~run'> & {
  /**
   * Whether it's async.
   */
  readonly async: true;

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

  /**
   * The Standard Schema properties.
   *
   * @internal
   */
  readonly '~standard': StandardProps<
    InferInput<TSchema>,
    InferOutput<TSchema>
  >;

  /**
   * Parses unknown input values.
   *
   * @param {UnknownDataset} dataset - Current private input dataset.
   * @param {Config<BaseIssue<unknown>>} config - Root-derived private execution configuration.
   *
   * @returns {Promise<OutputDataset<InferOutput<TSchema>, InferIssue<TSchema>>>>} Actual async dataset settlement; controlled root calls bypass cache sharing.
   *
   * @internal
   */
  readonly '~run': (
    dataset: UnknownDataset,
    config: Config<BaseIssue<unknown>>
  ) => Promise<OutputDataset<InferOutput<TSchema>, InferIssue<TSchema>>>;
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
 * @returns {SchemaWithCacheAsync<TSchema, undefined>} Local cached schema; explicit root signal/budgets bypass shared work.
 *
 * @beta
 */
// @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
export function cacheAsync<
  const TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(schema: TSchema): SchemaWithCacheAsync<TSchema, undefined>;

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
 * @returns {SchemaWithCacheAsync<TSchema, TCacheConfig>} Local cached schema; mutable input/output identity caveats remain unchanged.
 *
 * @beta
 */
export function cacheAsync<
  const TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  const TCacheConfig extends CacheConfig | undefined,
>(
  schema: TSchema,
  config: TCacheConfig
): SchemaWithCacheAsync<TSchema, TCacheConfig>;

/** Wrap a schema with legacy process-local result reuse while retaining controlled root-parse isolation.
 * @param {object} schema - Trusted declared schema; callbacks are not sandboxed or automatically retried.
 * @param {CacheConfig} config - Optional local size/age policy; no network cache adapter is selected.
 * @returns {object} Cached schema wrapper with an explicit local clear API, not a resource close owner.
 */
// @__NO_SIDE_EFFECTS__
export function cacheAsync(
  schema:
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  config?: CacheConfig
): SchemaWithCacheAsync<
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  CacheConfig | undefined
> {
  let activeRuns:
    | Map<string, Promise<OutputDataset<unknown, BaseIssue<unknown>>>>
    | undefined;
  return {
    ...schema,
    async: true,
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
     * @param {Config<BaseIssue<unknown>>} runConfig - Current root config carrying private counters/signal.
     * @returns {Promise<OutputDataset<unknown, BaseIssue<unknown>>>} Shallow copied wrapper/issues array; values and nested issue identity remain borrowed.
     */
    async '~run'(dataset, runConfig) {
      if (bypassCache(runConfig)) {
        return _runSchema(schema, dataset, runConfig);
      }
      // Create cache key based on input and config
      /** Instance compatibility key based on input identity/value and legacy parse flags only. */
      const key = this.cache.key(dataset.value, runConfig);

      // Check and return cached output if exists
      /** Borrowed cached dataset; charge its issues against this receiving parse before reuse. */
      const cached = this.cache.get(key);
      if (cached) {
        consumeCachedIssues(runConfig, cached.issues);
        // Hint: We clone the dataset before returning it so downstream pipe
        // items do not mutate the cached dataset wrapper or issues array.
        return _cloneDataset(cached);
      }

      // If not cached, check if a matching run is already in progress
      let promise = activeRuns?.get(key);
      /** Whether compatible legacy default work was already running for this exact cache key. */
      const shared = !!promise;
      if (!promise) {
        activeRuns ??= new Map();
        promise = Promise.resolve(_runSchema(schema, dataset, runConfig));
        activeRuns.set(key, promise);
      }

      // Await pending promise, cache output and return
      try {
        /** Actual settled dataset; only wrapper/issues-array cloning isolates later pipeline mutations. */
        const outputDataset = await promise;
        if (shared) {
          consumeCachedIssues(runConfig, outputDataset.issues);
        }
        this.cache.set(key, outputDataset);
        // Hint: We clone the dataset before returning it so downstream pipe
        // items do not mutate the cached dataset wrapper or issues array.
        return _cloneDataset(outputDataset);

        // Cleanup active runs map
      } finally {
        activeRuns?.delete(key);
      }
    },
  };
}
