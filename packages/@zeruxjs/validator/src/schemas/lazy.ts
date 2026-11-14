import { _runSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  InferInput,
  InferIssue,
  InferOutput,
} from '../types/index.js';
import { _getStandardProps } from '../utils/index.js';

/**
 * Lazy schema interface.
 */
export interface LazySchema<
  TWrapped extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
> extends BaseSchema<
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
  readonly reference: typeof lazy;
  /**
   * Private diagnostic expectation; never sanitized output or a permission grant.
   */
  readonly expects: 'unknown';
  /**
   * Borrowed trusted child factory; returned schema references are not cloned or memoized.
   * @param {unknown} input - Private current candidate passed to explicitly registered host code.
   * @returns {TWrapped} Child schema parsed under the same root budgets; schema selection grants no permissions.
   */
  readonly getter: (input: unknown) => TWrapped;
}

/** Resolve a trusted child schema from the current input during explicit parsing and retain the shared root budgets. Construction does not parse input or authorize its source.
 * @param {(input: unknown) => TWrapped} getter - Borrowed trusted schema factory, invoked per parse with private input; no memoization or sandbox is implied.
 * @returns {LazySchema<TWrapped>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function lazy<
  const TWrapped extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(getter: (input: unknown) => TWrapped): LazySchema<TWrapped> {
  return {
    kind: 'schema',
    type: 'lazy',
    reference: lazy,
    expects: 'unknown',
    async: false,
    getter,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Resolve a trusted child schema from the current input during explicit parsing and retain the shared root budgets. Raw issues remain private and operational failures propagate.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private current candidate; this schema does not grant permissions or sanitize output.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root budgets, cancellation, abort flags and diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Declared output or private issue dataset; child result identity follows its schema.
     */
    '~run'(dataset, config) {
      return _runSchema(this.getter(dataset.value), dataset, config);
    },
  };
}
