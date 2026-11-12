import { _runSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';
import type {
  InferNonOptionalInput,
  InferNonOptionalIssue,
  InferNonOptionalOutput,
  NonOptionalIssue,
} from './types/nonOptional.js';

/**
 * Non optional schema interface.
 */
export interface NonOptionalSchema<
  TWrapped extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TMessage extends ErrorMessage<NonOptionalIssue> | undefined,
> extends BaseSchema<
  InferNonOptionalInput<TWrapped>,
  InferNonOptionalOutput<TWrapped>,
  NonOptionalIssue | InferNonOptionalIssue<TWrapped>
> {
  /**
   * Fixed exclusion discriminator rejecting only undefined; null still follows the wrapped schema.
   */
  readonly type: 'non_optional';
  /**
   * Authored constructor reference; never supplied or loaded from untrusted source text.
   */
  readonly reference: typeof nonOptional;
  /**
   * Fixed private diagnostic expectation for the excluded sentinel, not a callback.
   */
  readonly expects: '!undefined';
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
 * Exclude undefined before wrapped execution and again after transformation. This is validation, not coercion or authorization.
 *
 * @param {TWrapped} wrapped - Trusted borrowed schema; excluded inputs never invoke its default/fallback path.
 *
 * @returns {NonOptionalSchema<TWrapped, undefined>} Inert exclusion wrapper; root execution still owns limits and cancellation.
 */
export function nonOptional<
  const TWrapped extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(wrapped: TWrapped): NonOptionalSchema<TWrapped, undefined>;

/**
 * Exclude undefined before wrapped execution and again after transformation. This is validation, not coercion or authorization.
 *
 * @param {TWrapped} wrapped - Trusted borrowed schema; excluded inputs never invoke its default/fallback path.
 * @param {TMessage} message - Optional private diagnostic text/callback; escape/redact separately for public presentation.
 *
 * @returns {NonOptionalSchema<TWrapped, TMessage>} Inert wrapper retaining borrowed schema/message references without deep cloning.
 */
export function nonOptional<
  const TWrapped extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TMessage extends ErrorMessage<NonOptionalIssue> | undefined,
>(wrapped: TWrapped, message: TMessage): NonOptionalSchema<TWrapped, TMessage>;

/** Build an exclusion wrapper without invoking validation or message callbacks.
 * @param {object} wrapped - Borrowed trusted schema; actual parsing remains root-owned.
 * @param {ErrorMessage<NonOptionalIssue>} message - Optional private issue message policy, never executable source text.
 * @returns {object} Inert sync/async schema guarding undefined around wrapped execution.
 */
// @__NO_SIDE_EFFECTS__
export function nonOptional(
  wrapped: BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  message?: ErrorMessage<NonOptionalIssue> | undefined
): NonOptionalSchema<
  BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  ErrorMessage<NonOptionalIssue> | undefined
> {
  return {
    kind: 'schema',
    type: 'non_optional',
    reference: nonOptional,
    expects: '!undefined',
    async: false,
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
    '~run'(dataset, config) {
      // If value is not `undefined`, run wrapped schema
      if (dataset.value !== undefined) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset = _runSchema(this.wrapped, dataset, config);
      }

      // If value is `undefined`, add issue to dataset
      if (dataset.value === undefined) {
        _addIssue(this, 'type', dataset, config);
      }

      // Return output dataset
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<unknown, BaseIssue<unknown>>;
    },
  };
}
