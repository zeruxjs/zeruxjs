import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue, _stringify } from '../utils/index.js';
import type { ValueInput } from './types.js';

/**
 * Value issue interface.
 */
export interface ValueIssue<
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
  readonly type: 'value';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: string;
  /**
   * Relational equality requirement using native <= and >=, not strict object identity.
   */
  readonly requirement: TRequirement;
}

/**
 * Value action interface.
 */
export interface ValueAction<
  TInput extends ValueInput,
  TRequirement extends TInput,
  TMessage extends ErrorMessage<ValueIssue<TInput, TRequirement>> | undefined,
> extends BaseValidation<TInput, TInput, ValueIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'value';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof value;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: string;
  /**
   * Relational equality requirement using native <= and >=, not strict object identity.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Require both native <= and >= comparisons to hold; this is relational equality, not strict identity. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted comparison/divisor requirement; mutable Date references and native metadata methods remain host-owned.
 * @returns {ValueAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function value<
  TInput extends ValueInput,
  const TRequirement extends TInput,
>(requirement: TRequirement): ValueAction<TInput, TRequirement, undefined>;

/** Require both native <= and >= comparisons to hold; this is relational equality, not strict identity. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted comparison/divisor requirement; mutable Date references and native metadata methods remain host-owned.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {ValueAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function value<
  TInput extends ValueInput,
  const TRequirement extends TInput,
  const TMessage extends
    | ErrorMessage<ValueIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): ValueAction<TInput, TRequirement, TMessage>;

/** Require both native <= and >= comparisons to hold; this is relational equality, not strict identity. This action neither establishes the input schema nor grants permissions.
 * @param {ValueInput} requirement - Explicit trusted comparison/divisor requirement; mutable Date references and native metadata methods remain host-owned.
 * @param {ErrorMessage<ValueIssue<ValueInput, ValueInput>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {ValueAction<ValueInput, ValueInput, ErrorMessage<ValueIssue<ValueInput, ValueInput>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function value(
  requirement: ValueInput,
  message?: ErrorMessage<ValueIssue<ValueInput, ValueInput>>
): ValueAction<
  ValueInput,
  ValueInput,
  ErrorMessage<ValueIssue<ValueInput, ValueInput>> | undefined
> {
  return {
    kind: 'validation',
    type: 'value',
    reference: value,
    async: false,
    expects:
      requirement instanceof Date
        ? requirement.toJSON()
        : _stringify(requirement),
    requirement,
    message,
    /** Require both native <= and >= comparisons to hold; this is relational equality, not strict identity. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (
        dataset.typed &&
        !(
          this.requirement <= dataset.value && this.requirement >= dataset.value
        )
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
