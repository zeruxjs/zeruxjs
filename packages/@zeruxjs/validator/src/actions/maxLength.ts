import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { LengthInput } from './types.js';

/**
 * Max length issue interface.
 */
export interface MaxLengthIssue<
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
  readonly type: 'max_length';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `<=${TRequirement}`;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${number}`;
  /**
   * The maximum length.
   */
  readonly requirement: TRequirement;
}

/**
 * Max length action interface.
 */
export interface MaxLengthAction<
  TInput extends LengthInput,
  TRequirement extends number,
  TMessage extends
    | ErrorMessage<MaxLengthIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<TInput, TInput, MaxLengthIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'max_length';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof maxLength;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `<=${TRequirement}`;
  /**
   * The maximum length.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Require a native length at most the configured threshold; this post-parse refinement is not a streaming admission limit. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @returns {MaxLengthAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function maxLength<
  TInput extends LengthInput,
  const TRequirement extends number,
>(requirement: TRequirement): MaxLengthAction<TInput, TRequirement, undefined>;

/** Require a native length at most the configured threshold; this post-parse refinement is not a streaming admission limit. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MaxLengthAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function maxLength<
  TInput extends LengthInput,
  const TRequirement extends number,
  const TMessage extends
    | ErrorMessage<MaxLengthIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): MaxLengthAction<TInput, TRequirement, TMessage>;

/** Require a native length at most the configured threshold; this post-parse refinement is not a streaming admission limit. This action neither establishes the input schema nor grants permissions.
 * @param {number} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @param {ErrorMessage<MaxLengthIssue<LengthInput, number>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MaxLengthAction<LengthInput, number, ErrorMessage<MaxLengthIssue<LengthInput, number>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function maxLength(
  requirement: number,
  message?: ErrorMessage<MaxLengthIssue<LengthInput, number>>
): MaxLengthAction<
  LengthInput,
  number,
  ErrorMessage<MaxLengthIssue<LengthInput, number>> | undefined
> {
  return {
    kind: 'validation',
    type: 'max_length',
    reference: maxLength,
    async: false,
    expects: `<=${requirement}`,
    requirement,
    message,
    /** Require a native length at most the configured threshold; this post-parse refinement is not a streaming admission limit. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native property/getter exceptions propagate; diagnostic formatting can read length/size again.
     */
    '~run'(dataset, config) {
      if (dataset.typed && dataset.value.length > this.requirement) {
        _addIssue(this, 'length', dataset, config, {
          received: `${dataset.value.length}`,
        });
      }
      return dataset;
    },
  };
}
