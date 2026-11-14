import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue, _stringify } from '../utils/index.js';
import type { ValueInput } from './types.js';

/**
 * Not value issue interface.
 */
export interface NotValueIssue<
  TInput extends ValueInput,
  TRequirement extends TInput,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'not_value';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `!${string}`;
  /**
   * The not required value.
   */
  readonly requirement: TRequirement;
}

/**
 * Not value action interface.
 */
export interface NotValueAction<
  TInput extends ValueInput,
  TRequirement extends TInput,
  TMessage extends
    | ErrorMessage<NotValueIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<TInput, TInput, NotValueIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'not_value';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof notValue;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `!${string}`;
  /**
   * The not required value.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Reject values for which both native <= and >= comparisons hold; retain native Date/coercion semantics. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted comparison/divisor requirement; mutable Date references and native metadata methods remain host-owned.
 * @returns {NotValueAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function notValue<
  TInput extends ValueInput,
  const TRequirement extends TInput,
>(requirement: TRequirement): NotValueAction<TInput, TRequirement, undefined>;

/** Reject values for which both native <= and >= comparisons hold; retain native Date/coercion semantics. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted comparison/divisor requirement; mutable Date references and native metadata methods remain host-owned.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {NotValueAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function notValue<
  TInput extends ValueInput,
  const TRequirement extends TInput,
  const TMessage extends
    | ErrorMessage<NotValueIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): NotValueAction<TInput, TRequirement, TMessage>;

/** Reject values for which both native <= and >= comparisons hold; retain native Date/coercion semantics. This action neither establishes the input schema nor grants permissions.
 * @param {ValueInput} requirement - Explicit trusted comparison/divisor requirement; mutable Date references and native metadata methods remain host-owned.
 * @param {ErrorMessage<NotValueIssue<ValueInput, ValueInput>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {NotValueAction<ValueInput, ValueInput, ErrorMessage<NotValueIssue<ValueInput, ValueInput>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function notValue(
  requirement: ValueInput,
  message?: ErrorMessage<NotValueIssue<ValueInput, ValueInput>>
): NotValueAction<
  ValueInput,
  ValueInput,
  ErrorMessage<NotValueIssue<ValueInput, ValueInput>> | undefined
> {
  return {
    kind: 'validation',
    type: 'not_value',
    reference: notValue,
    async: false,
    expects:
      requirement instanceof Date
        ? `!${requirement.toJSON()}`
        : `!${_stringify(requirement)}`,
    requirement,
    message,
    /** Reject values for which both native <= and >= comparisons hold; retain native Date/coercion semantics. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (
        dataset.typed &&
        this.requirement <= dataset.value &&
        this.requirement >= dataset.value
      ) {
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
