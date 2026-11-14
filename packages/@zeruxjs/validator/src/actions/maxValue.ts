import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue, _stringify } from '../utils/index.js';
import type { ValueInput } from './types.js';

/**
 * Max value issue interface.
 */
export interface MaxValueIssue<
  TInput extends ValueInput,
  TRequirement extends ValueInput,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'max_value';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `<=${string}`;
  /**
   * Inclusive native upper bound; mutable Date requirements remain borrowed.
   */
  readonly requirement: TRequirement;
}

/**
 * Max value action interface.
 */
export interface MaxValueAction<
  TInput extends ValueInput,
  TRequirement extends TInput,
  TMessage extends
    | ErrorMessage<MaxValueIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<TInput, TInput, MaxValueIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'max_value';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof maxValue;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `<=${string}`;
  /**
   * Inclusive native upper bound; mutable Date requirements remain borrowed.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Apply the native inclusive <= comparison to a typed value and its configured upper bound. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted comparison/divisor requirement; mutable Date references and native metadata methods remain host-owned.
 * @returns {MaxValueAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function maxValue<
  TInput extends ValueInput,
  const TRequirement extends TInput,
>(requirement: TRequirement): MaxValueAction<TInput, TRequirement, undefined>;

/** Apply the native inclusive <= comparison to a typed value and its configured upper bound. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted comparison/divisor requirement; mutable Date references and native metadata methods remain host-owned.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MaxValueAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function maxValue<
  TInput extends ValueInput,
  const TRequirement extends TInput,
  const TMessage extends
    | ErrorMessage<MaxValueIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): MaxValueAction<TInput, TRequirement, TMessage>;

/** Apply the native inclusive <= comparison to a typed value and its configured upper bound. This action neither establishes the input schema nor grants permissions.
 * @param {ValueInput} requirement - Explicit trusted comparison/divisor requirement; mutable Date references and native metadata methods remain host-owned.
 * @param {ErrorMessage<MaxValueIssue<ValueInput, ValueInput>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MaxValueAction<ValueInput, ValueInput, ErrorMessage<MaxValueIssue<ValueInput, ValueInput>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function maxValue(
  requirement: ValueInput,
  message?: ErrorMessage<MaxValueIssue<ValueInput, ValueInput>>
): MaxValueAction<
  ValueInput,
  ValueInput,
  ErrorMessage<MaxValueIssue<ValueInput, ValueInput>> | undefined
> {
  return {
    kind: 'validation',
    type: 'max_value',
    reference: maxValue,
    async: false,
    expects: `<=${
      requirement instanceof Date
        ? requirement.toJSON()
        : _stringify(requirement)
    }`,
    requirement,
    message,
    /** Apply the native inclusive <= comparison to a typed value and its configured upper bound. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !(dataset.value <= this.requirement)) {
        _addIssue(this, 'value', dataset, config, {
          received:
            dataset.value instanceof Date
              ? dataset.value.toJSON()
              : _stringify(dataset.value),
        });
      }
      return dataset;
    },
  };
}
