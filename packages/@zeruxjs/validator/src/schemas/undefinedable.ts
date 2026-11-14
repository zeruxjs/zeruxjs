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
import type { InferUndefinedableOutput } from './types/undefinedable.js';

/**
 * Undefinedable schema interface.
 */
export interface UndefinedableSchema<
  TWrapped extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TDefault extends Default<TWrapped, undefined>,
> extends BaseSchema<
  InferInput<TWrapped> | undefined,
  InferUndefinedableOutput<TWrapped, TDefault>,
  InferIssue<TWrapped>
> {
  /**
   * Fixed undefinedable discriminator: only undefined selects this default/sentinel branch.
   */
  readonly type: 'undefinedable';
  /**
   * Authored constructor reference; never loaded from user-controlled source text.
   */
  readonly reference: typeof undefinedable;
  /**
   * Diagnostic expectation combining wrapped input with undefined, not a callback.
   */
  readonly expects: `(${TWrapped['expects']} | undefined)`;
  /**
   * Borrowed schema validating/transforming every non-sentinel replacement.
   */
  readonly wrapped: TWrapped;
  /**
   * Trusted input literal/factory retained by reference; non-undefined results undergo wrapped validation.
   */
  readonly default: TDefault;
}

/**
 * Accept undefined or select a trusted input default before wrapped validation. A default returning undefined short-circuits without another factory call.
 *
 * @param {TWrapped} wrapped - Borrowed trusted input schema; construction starts no parsing or callback work.
 *
 * @returns {UndefinedableSchema<TWrapped, undefined>} Inert undefinedable value wrapper; this discriminator does not make an object key optional.
 */
export function undefinedable<
  const TWrapped extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(wrapped: TWrapped): UndefinedableSchema<TWrapped, undefined>;

/**
 * Accept undefined or select a trusted input default before wrapped validation. A default returning undefined short-circuits without another factory call.
 *
 * @param {TWrapped} wrapped - Borrowed trusted input schema; construction starts no parsing or callback work.
 * @param {TDefault} default_ - Trusted input-compatible literal/factory; results are not deep-cloned.
 *
 * @returns {UndefinedableSchema<TWrapped, TDefault>} Default-aware wrapper; non-sentinel replacements run through wrapped validation.
 */
export function undefinedable<
  const TWrapped extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TDefault extends Default<TWrapped, undefined>,
>(
  wrapped: TWrapped,
  default_: TDefault
): UndefinedableSchema<TWrapped, TDefault>;

/** Build an undefinedable value wrapper without parsing or starting background work.
 * @param {object} wrapped - Borrowed trusted schema; root execution owns budgets/cancellation.
 * @param {unknown} default_ - Optional trusted input literal/factory; factory work remains host-owned.
 * @returns {object} Inert undefinedable schema; sync wrappers reject async default misuse, async wrappers await settlement.
 */
// @__NO_SIDE_EFFECTS__
export function undefinedable(
  wrapped: BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  default_?: unknown
): UndefinedableSchema<
  BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  unknown
> {
  return {
    kind: 'schema',
    type: 'undefinedable',
    reference: undefinedable,
    expects: `(${wrapped.expects} | undefined)`,
    async: false,
    wrapped,
    default: default_,
    /** Adapt explicit validation calls to bounded root execution.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Apply the default once for undefined, then validate any non-sentinel replacement.
     * @param {import('../types/index.js').UnknownDataset} dataset - Current private input dataset.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Root-owned budgets/signal shared by nested work.
     * @returns {unknown} Declared sync/async dataset; factory exceptions and hard limits still propagate.
     */
    '~run'(dataset, config) {
      // If value is `undefined`, override it with default or return dataset
      if (dataset.value === undefined) {
        // If default is specified, override value of dataset
        if (this.default !== undefined) {
          dataset.value = getDefault(this, dataset, config);
        }

        // If value is still `undefined`, return dataset
        if (dataset.value === undefined) {
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
