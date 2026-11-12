import { _runSchema } from '../utils/_run.js';
import { getDefault } from '../methods/index.js';
import type {
  BaseIssue,
  BaseSchema,
  Default,
  InferInput,
  InferIssue,
  SuccessDataset,
} from '../types/index.js';
import { _getStandardProps } from '../utils/index.js';
import type { InferNullableOutput } from './types/nullable.js';

/**
 * Nullable schema interface.
 */
export interface NullableSchema<
  TWrapped extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TDefault extends Default<TWrapped, null>,
> extends BaseSchema<
  InferInput<TWrapped> | null,
  InferNullableOutput<TWrapped, TDefault>,
  InferIssue<TWrapped>
> {
  /**
   * Fixed nullable discriminator: only null selects this default/sentinel branch.
   */
  readonly type: 'nullable';
  /**
   * Authored constructor reference; never loaded from user-controlled source text.
   */
  readonly reference: typeof nullable;
  /**
   * Diagnostic expectation combining wrapped input with null, not a callback.
   */
  readonly expects: `(${TWrapped['expects']} | null)`;
  /**
   * Borrowed schema validating/transforming every non-sentinel replacement.
   */
  readonly wrapped: TWrapped;
  /**
   * Trusted input literal/factory retained by reference; non-null results undergo wrapped validation.
   */
  readonly default: TDefault;
}

/**
 * Accept null or select one trusted input default; non-null replacements still run wrapped validation.
 *
 * @param {TWrapped} wrapped - Borrowed trusted input schema; construction starts no parsing or callback work.
 *
 * @returns {NullableSchema<TWrapped, undefined>} Inert nullable wrapper; undefined is not automatically converted to null.
 */
export function nullable<
  const TWrapped extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(wrapped: TWrapped): NullableSchema<TWrapped, undefined>;

/**
 * Accept null or select one trusted input default; non-null replacements still run wrapped validation.
 *
 * @param {TWrapped} wrapped - Borrowed trusted input schema; construction starts no parsing or callback work.
 * @param {TDefault} default_ - Trusted input-compatible literal/factory; results are not deep-cloned.
 *
 * @returns {NullableSchema<TWrapped, TDefault>} Default-aware nullable wrapper; a returned null short-circuits without another factory call.
 */
export function nullable<
  const TWrapped extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TDefault extends Default<TWrapped, null>,
>(wrapped: TWrapped, default_: TDefault): NullableSchema<TWrapped, TDefault>;

/** Build a nullable wrapper without parsing or starting background work.
 * @param {object} wrapped - Borrowed trusted schema; root execution owns budgets/cancellation.
 * @param {unknown} default_ - Optional trusted input literal/factory; factory work remains host-owned.
 * @returns {object} Inert nullable schema; sync wrappers reject async default misuse, async wrappers await settlement.
 */
// @__NO_SIDE_EFFECTS__
export function nullable(
  wrapped: BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  default_?: unknown
): NullableSchema<BaseSchema<unknown, unknown, BaseIssue<unknown>>, unknown> {
  return {
    kind: 'schema',
    type: 'nullable',
    reference: nullable,
    expects: `(${wrapped.expects} | null)`,
    async: false,
    wrapped,
    default: default_,
    /** Adapt explicit validation calls to bounded root execution.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Apply the default once for null, then validate any non-sentinel replacement.
     * @param {import('../types/index.js').UnknownDataset} dataset - Current private input dataset.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Root-owned budgets/signal shared by nested work.
     * @returns {unknown} Declared sync/async dataset; factory exceptions and hard limits still propagate.
     */
    '~run'(dataset, config) {
      // If value is `null`, override it with default or return dataset
      if (dataset.value === null) {
        // If default is specified, override value of dataset
        if (this.default !== undefined) {
          dataset.value = getDefault(this, dataset, config);
        }

        // If value is still `null`, return dataset
        if (dataset.value === null) {
          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          dataset.typed = true;
          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          return dataset as SuccessDataset<unknown>;
        }
      }

      // Otherwise, return dataset of wrapped schema
      return _runSchema(this.wrapped, dataset, config);
    },
  };
}
