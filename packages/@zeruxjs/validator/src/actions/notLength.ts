import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { LengthInput } from './types.js';

/**
 * Not length issue interface.
 */
export interface NotLengthIssue<
  TInput extends LengthInput,
  TRequirement extends number,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'not_length';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `!${TRequirement}`;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${TRequirement}`;
  /**
   * The not required length.
   */
  readonly requirement: TRequirement;
}

/**
 * Not length action interface.
 */
export interface NotLengthAction<
  TInput extends LengthInput,
  TRequirement extends number,
  TMessage extends
    | ErrorMessage<NotLengthIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<TInput, TInput, NotLengthIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'not_length';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof notLength;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `!${TRequirement}`;
  /**
   * The not required length.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Reject exactly the configured native length; retain the original string or array-like value. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @returns {NotLengthAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function notLength<
  TInput extends LengthInput,
  const TRequirement extends number,
>(requirement: TRequirement): NotLengthAction<TInput, TRequirement, undefined>;

/** Reject exactly the configured native length; retain the original string or array-like value. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {NotLengthAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function notLength<
  TInput extends LengthInput,
  const TRequirement extends number,
  const TMessage extends
    | ErrorMessage<NotLengthIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): NotLengthAction<TInput, TRequirement, TMessage>;

/** Reject exactly the configured native length; retain the original string or array-like value. This action neither establishes the input schema nor grants permissions.
 * @param {number} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @param {ErrorMessage<NotLengthIssue<LengthInput, number>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {NotLengthAction<LengthInput, number, ErrorMessage<NotLengthIssue<LengthInput, number>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function notLength(
  requirement: number,
  message?: ErrorMessage<NotLengthIssue<LengthInput, number>>
): NotLengthAction<
  LengthInput,
  number,
  ErrorMessage<NotLengthIssue<LengthInput, number>> | undefined
> {
  return {
    kind: 'validation',
    type: 'not_length',
    reference: notLength,
    async: false,
    expects: `!${requirement}`,
    requirement,
    message,
    /** Reject exactly the configured native length; retain the original string or array-like value. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native property/getter exceptions propagate; diagnostic formatting can read length/size again.
     */
    '~run'(dataset, config) {
      if (dataset.typed && dataset.value.length === this.requirement) {
        _addIssue(this, 'length', dataset, config, {
          received: `${dataset.value.length}`,
        });
      }
      return dataset;
    },
  };
}
