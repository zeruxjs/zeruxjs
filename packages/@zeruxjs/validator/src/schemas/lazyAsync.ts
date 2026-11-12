import { _runSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  InferInput,
  InferIssue,
  InferOutput,
  MaybePromise,
  OutputDataset,
} from '../types/index.js';
import { _getStandardProps } from '../utils/index.js';
import type { lazy } from './lazy.js';

/**
 * Lazy schema async interface.
 */
export interface LazySchemaAsync<
  TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> extends BaseSchemaAsync<
  InferInput<TWrapped>,
  InferOutput<TWrapped>,
  InferIssue<TWrapped>
> {
  /**
   * Stable schema discriminator used by structured issue consumers.
   */
  readonly type: 'lazy';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof lazy | typeof lazyAsync;
  /**
   * Private diagnostic expectation; never sanitized output or a permission grant.
   */
  readonly expects: 'unknown';
  /**
   * Borrowed trusted child factory; returned schema references are not cloned or memoized.
   * @param {unknown} input - Private current candidate passed to explicitly registered host code.
   * @returns {MaybePromise<TWrapped>} Child schema parsed under the same root budgets; schema selection grants no permissions.
   */
  readonly getter: (input: unknown) => MaybePromise<TWrapped>;
}

/** Await a trusted child-schema factory during explicit parsing; the factory owns its additional work and cancellation. Construction does not parse input or authorize its source.
 * @param {(input: unknown) => MaybePromise<TWrapped>} getter - Borrowed trusted schema factory, invoked per parse with private input; no memoization or sandbox is implied.
 * @returns {LazySchemaAsync<TWrapped>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function lazyAsync<
  const TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(
  getter: (input: unknown) => MaybePromise<TWrapped>
): LazySchemaAsync<TWrapped> {
  return {
    kind: 'schema',
    type: 'lazy',
    reference: lazyAsync,
    expects: 'unknown',
    async: true,
    getter,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Await a trusted child-schema factory during explicit parsing; the factory owns its additional work and cancellation. Raw issues remain private and operational failures propagate.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private current candidate; this schema does not grant permissions or sanitize output.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root budgets, cancellation, abort flags and diagnostic policy.
     * @returns {Promise<import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>>} Declared output or private issue dataset; child result identity follows its schema.
     */
    async '~run'(dataset, config) {
      return (await _runSchema(
        await this.getter(dataset.value),
        dataset,
        config
      )) as OutputDataset<InferOutput<TWrapped>, InferIssue<TWrapped>>;
    },
  };
}
