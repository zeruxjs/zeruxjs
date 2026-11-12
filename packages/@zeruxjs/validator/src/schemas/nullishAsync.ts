import { _runSchema } from '../utils/_run.js';
import { getDefault } from '../methods/index.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  DefaultAsync,
  InferInput,
  InferIssue,
  SuccessDataset,
} from '../types/index.js';
import { _getStandardProps } from '../utils/index.js';
import type { nullish } from './nullish.js';
import type { InferNullishOutput } from './types/nullish.js';

/**
 * Nullish schema async interface.
 */
export interface NullishSchemaAsync<
  TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  TDefault extends DefaultAsync<TWrapped, null | undefined>,
> extends BaseSchemaAsync<
  InferInput<TWrapped> | null | undefined,
  InferNullishOutput<TWrapped, TDefault>,
  InferIssue<TWrapped>
> {
  /**
   * Fixed nullish discriminator: only null or undefined selects this default/sentinel branch.
   */
  readonly type: 'nullish';
  /**
   * Authored constructor reference; never loaded from user-controlled source text.
   */
  readonly reference: typeof nullish | typeof nullishAsync;
  /**
   * Diagnostic expectation combining wrapped input with null/undefined, not a callback.
   */
  readonly expects: `(${TWrapped['expects']} | null | undefined)`;
  /**
   * Borrowed schema validating/transforming every non-sentinel replacement.
   */
  readonly wrapped: TWrapped;
  /**
   * Trusted input literal/factory retained by reference; non-nullish results undergo wrapped validation.
   */
  readonly default: TDefault;
}

/**
 * Accept null/undefined or select a trusted input default before wrapped validation. A default returning null/undefined short-circuits without another factory call.
 *
 * @param {TWrapped} wrapped - Borrowed trusted input schema; construction starts no parsing or callback work.
 *
 * @returns {NullishSchemaAsync<TWrapped, undefined>} Inert nullish wrapper preserving null and undefined sentinel handling.
 */
export function nullishAsync<
  const TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(wrapped: TWrapped): NullishSchemaAsync<TWrapped, undefined>;

/**
 * Accept null/undefined or select a trusted input default before wrapped validation. A default returning null/undefined short-circuits without another factory call.
 *
 * @param {TWrapped} wrapped - Borrowed trusted input schema; construction starts no parsing or callback work.
 * @param {TDefault} default_ - Trusted input-compatible literal/factory; results are not deep-cloned.
 *
 * @returns {NullishSchemaAsync<TWrapped, TDefault>} Default-aware wrapper; non-sentinel replacements run through wrapped validation.
 */
export function nullishAsync<
  const TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  const TDefault extends DefaultAsync<TWrapped, null | undefined>,
>(
  wrapped: TWrapped,
  default_: TDefault
): NullishSchemaAsync<TWrapped, TDefault>;

/** Build a nullish wrapper without parsing or starting background work.
 * @param {object} wrapped - Borrowed trusted schema; root execution owns budgets/cancellation.
 * @param {unknown} default_ - Optional trusted input literal/factory; factory work remains host-owned.
 * @returns {object} Inert nullish schema; sync wrappers reject async default misuse, async wrappers await settlement.
 */
// @__NO_SIDE_EFFECTS__
export function nullishAsync(
  wrapped:
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  default_?: unknown
): NullishSchemaAsync<
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  unknown
> {
  return {
    kind: 'schema',
    type: 'nullish',
    reference: nullishAsync,
    expects: `(${wrapped.expects} | null | undefined)`,
    async: true,
    wrapped,
    default: default_,
    /** Adapt explicit validation calls to bounded root execution.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Apply the default once for null/undefined, then validate any non-sentinel replacement.
     * @param {import('../types/index.js').UnknownDataset} dataset - Current private input dataset.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Root-owned budgets/signal shared by nested work.
     * @returns {unknown} Declared sync/async dataset; factory exceptions and hard limits still propagate.
     */
    async '~run'(dataset, config) {
      // If value is `null` or `undefined`, override it with default or return
      // dataset
      if (dataset.value === null || dataset.value === undefined) {
        // If default is specified, override value of dataset
        if (this.default !== undefined) {
          dataset.value = await getDefault(this, dataset, config);
        }

        // If value is still `null` or `undefined`, return dataset
        if (dataset.value === null || dataset.value === undefined) {
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
