import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { LengthInput } from './types.js';

/**
 * Min length issue interface.
 */
export interface MinLengthIssue<
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
  readonly type: 'min_length';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `>=${TRequirement}`;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${number}`;
  /**
   * The minimum length.
   */
  readonly requirement: TRequirement;
}

/**
 * Min length action interface.
 */
export interface MinLengthAction<
  TInput extends LengthInput,
  TRequirement extends number,
  TMessage extends
    | ErrorMessage<MinLengthIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<TInput, TInput, MinLengthIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'min_length';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof minLength;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `>=${TRequirement}`;
  /**
   * The minimum length.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Require a native length at least the configured threshold; no input truncation or Unicode grapheme counting occurs. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @returns {MinLengthAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function minLength<
  TInput extends LengthInput,
  const TRequirement extends number,
>(requirement: TRequirement): MinLengthAction<TInput, TRequirement, undefined>;

/** Require a native length at least the configured threshold; no input truncation or Unicode grapheme counting occurs. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MinLengthAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function minLength<
  TInput extends LengthInput,
  const TRequirement extends number,
  const TMessage extends
    | ErrorMessage<MinLengthIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): MinLengthAction<TInput, TRequirement, TMessage>;

/** Require a native length at least the configured threshold; no input truncation or Unicode grapheme counting occurs. This action neither establishes the input schema nor grants permissions.
 * @param {number} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @param {ErrorMessage<MinLengthIssue<LengthInput, number>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MinLengthAction<LengthInput, number, ErrorMessage<MinLengthIssue<LengthInput, number>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function minLength(
  requirement: number,
  message?: ErrorMessage<MinLengthIssue<LengthInput, number>>
): MinLengthAction<
  LengthInput,
  number,
  ErrorMessage<MinLengthIssue<LengthInput, number>> | undefined
> {
  return {
    kind: 'validation',
    type: 'min_length',
    reference: minLength,
    async: false,
    expects: `>=${requirement}`,
    requirement,
    message,
    /** Require a native length at least the configured threshold; no input truncation or Unicode grapheme counting occurs. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native property/getter exceptions propagate; diagnostic formatting can read length/size again.
     */
    '~run'(dataset, config) {
      if (dataset.typed && dataset.value.length < this.requirement) {
        _addIssue(this, 'length', dataset, config, {
          received: `${dataset.value.length}`,
        });
      }
      return dataset;
    },
  };
}
