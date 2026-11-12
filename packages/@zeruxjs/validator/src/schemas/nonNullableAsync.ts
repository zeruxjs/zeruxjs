import { _runSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';
import type { nonNullable } from './nonNullable.js';
import type {
  InferNonNullableInput,
  InferNonNullableIssue,
  InferNonNullableOutput,
  NonNullableIssue,
} from './types/nonNullable.js';

/**
 * Non nullable schema async interface.
 */
export interface NonNullableSchemaAsync<
  TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  TMessage extends ErrorMessage<NonNullableIssue> | undefined,
> extends BaseSchemaAsync<
  InferNonNullableInput<TWrapped>,
  InferNonNullableOutput<TWrapped>,
  NonNullableIssue | InferNonNullableIssue<TWrapped>
> {
  /**
   * Fixed exclusion discriminator rejecting only null; undefined still follows the wrapped schema.
   */
  readonly type: 'non_nullable';
  /**
   * Authored constructor reference; never supplied or loaded from untrusted source text.
   */
  readonly reference: typeof nonNullable | typeof nonNullableAsync;
  /**
   * Fixed private diagnostic expectation for the excluded sentinel, not a callback.
   */
  readonly expects: '!null';
  /**
   * Borrowed schema invoked only after the input sentinel guard; transformed output is checked again.
   */
  readonly wrapped: TWrapped;
  /**
   * Optional private diagnostic text or trusted synchronous issue-message callback.
   */
  readonly message: TMessage;
}

/**
 * Exclude null before wrapped execution and again after transformation. This is validation, not coercion or authorization.
 *
 * @param {TWrapped} wrapped - Trusted borrowed schema; excluded inputs never invoke its default/fallback path.
 *
 * @returns {NonNullableSchemaAsync<TWrapped, undefined>} Inert exclusion wrapper; root execution still owns limits and cancellation.
 */
export function nonNullableAsync<
  const TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(wrapped: TWrapped): NonNullableSchemaAsync<TWrapped, undefined>;

/**
 * Exclude null before wrapped execution and again after transformation. This is validation, not coercion or authorization.
 *
 * @param {TWrapped} wrapped - Trusted borrowed schema; excluded inputs never invoke its default/fallback path.
 * @param {TMessage} message - Optional private diagnostic text/callback; escape/redact separately for public presentation.
 *
 * @returns {NonNullableSchemaAsync<TWrapped, TMessage>} Inert wrapper retaining borrowed schema/message references without deep cloning.
 */
export function nonNullableAsync<
  const TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  const TMessage extends ErrorMessage<NonNullableIssue> | undefined,
>(
  wrapped: TWrapped,
  message: TMessage
): NonNullableSchemaAsync<TWrapped, TMessage>;

/** Build an exclusion wrapper without invoking validation or message callbacks.
 * @param {object} wrapped - Borrowed trusted schema; actual parsing remains root-owned.
 * @param {ErrorMessage<NonNullableIssue>} message - Optional private issue message policy, never executable source text.
 * @returns {object} Inert sync/async schema guarding null around wrapped execution.
 */
// @__NO_SIDE_EFFECTS__
export function nonNullableAsync(
  wrapped:
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  message?: ErrorMessage<NonNullableIssue> | undefined
): NonNullableSchemaAsync<
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  ErrorMessage<NonNullableIssue> | undefined
> {
  return {
    kind: 'schema',
    type: 'non_nullable',
    reference: nonNullableAsync,
    expects: '!null',
    async: true,
    wrapped,
    message,
    /** Adapt explicit validation to the same bounded root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Guard excluded input before invoking wrapped code, then reject any excluded transformed output.
     * @param {import('../types/index.js').UnknownDataset} dataset - Current private input dataset.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root budgets and cooperative signal.
     * @returns {unknown} Declared dataset or async settlement; raw issues and operational causes remain private.
     */
    async '~run'(dataset, config) {
      // If value is not `null`, run wrapped schema
      if (dataset.value !== null) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset = await _runSchema(this.wrapped, dataset, config);
      }

      // If value is `null`, add issue to dataset
      if (dataset.value === null) {
        _addIssue(this, 'type', dataset, config);
      }

      // Return output dataset
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<unknown, BaseIssue<unknown>>;
    },
  };
}
