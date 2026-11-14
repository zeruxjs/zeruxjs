import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue, _stringify } from '../utils/index.js';
import type { ValueInput } from './types.js';

/**
 * Min value issue interface.
 */
export interface MinValueIssue<
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
  readonly type: 'min_value';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `>=${string}`;
  /**
   * Inclusive native lower bound; mutable Date requirements remain borrowed.
   */
  readonly requirement: TRequirement;
}

/**
 * Min value action interface.
 */
export interface MinValueAction<
  TInput extends ValueInput,
  TRequirement extends TInput,
  TMessage extends
    | ErrorMessage<MinValueIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<TInput, TInput, MinValueIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'min_value';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof minValue;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `>=${string}`;
  /**
   * Inclusive native lower bound; mutable Date requirements remain borrowed.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Apply the native inclusive >= comparison to a typed value and its configured lower bound. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted comparison/divisor requirement; mutable Date references and native metadata methods remain host-owned.
 * @returns {MinValueAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function minValue<
  TInput extends ValueInput,
  const TRequirement extends TInput,
>(requirement: TRequirement): MinValueAction<TInput, TRequirement, undefined>;

/** Apply the native inclusive >= comparison to a typed value and its configured lower bound. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted comparison/divisor requirement; mutable Date references and native metadata methods remain host-owned.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MinValueAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function minValue<
  TInput extends ValueInput,
  const TRequirement extends TInput,
  const TMessage extends
    | ErrorMessage<MinValueIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): MinValueAction<TInput, TRequirement, TMessage>;

/** Apply the native inclusive >= comparison to a typed value and its configured lower bound. This action neither establishes the input schema nor grants permissions.
 * @param {ValueInput} requirement - Explicit trusted comparison/divisor requirement; mutable Date references and native metadata methods remain host-owned.
 * @param {ErrorMessage<MinValueIssue<ValueInput, ValueInput>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MinValueAction<ValueInput, ValueInput, ErrorMessage<MinValueIssue<ValueInput, ValueInput>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function minValue(
  requirement: ValueInput,
  message?: ErrorMessage<MinValueIssue<ValueInput, ValueInput>>
): MinValueAction<
  ValueInput,
  ValueInput,
  ErrorMessage<MinValueIssue<ValueInput, ValueInput>> | undefined
> {
  return {
    kind: 'validation',
    type: 'min_value',
    reference: minValue,
    async: false,
    expects: `>=${
      requirement instanceof Date
        ? requirement.toJSON()
        : _stringify(requirement)
    }`,
    requirement,
    message,
    /** Apply the native inclusive >= comparison to a typed value and its configured lower bound. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !(dataset.value >= this.requirement)) {
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
