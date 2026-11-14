import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { SizeInput } from './types.js';

/**
 * Max size issue interface.
 */
export interface MaxSizeIssue<
  TInput extends SizeInput,
  TRequirement extends number,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'max_size';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `<=${TRequirement}`;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${number}`;
  /**
   * The maximum size.
   */
  readonly requirement: TRequirement;
}

/**
 * Max size action interface.
 */
export interface MaxSizeAction<
  TInput extends SizeInput,
  TRequirement extends number,
  TMessage extends ErrorMessage<MaxSizeIssue<TInput, TRequirement>> | undefined,
> extends BaseValidation<TInput, TInput, MaxSizeIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'max_size';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof maxSize;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `<=${TRequirement}`;
  /**
   * The maximum size.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Require native Blob byte size or Map/Set count at most the threshold; this is not transport read admission. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @returns {MaxSizeAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function maxSize<
  TInput extends SizeInput,
  const TRequirement extends number,
>(requirement: TRequirement): MaxSizeAction<TInput, TRequirement, undefined>;

/** Require native Blob byte size or Map/Set count at most the threshold; this is not transport read admission. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MaxSizeAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function maxSize<
  TInput extends SizeInput,
  const TRequirement extends number,
  const TMessage extends
    | ErrorMessage<MaxSizeIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): MaxSizeAction<TInput, TRequirement, TMessage>;

/** Require native Blob byte size or Map/Set count at most the threshold; this is not transport read admission. This action neither establishes the input schema nor grants permissions.
 * @param {number} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @param {ErrorMessage<MaxSizeIssue<SizeInput, number>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MaxSizeAction<SizeInput, number, ErrorMessage<MaxSizeIssue<SizeInput, number>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function maxSize(
  requirement: number,
  message?: ErrorMessage<MaxSizeIssue<SizeInput, number>>
): MaxSizeAction<
  SizeInput,
  number,
  ErrorMessage<MaxSizeIssue<SizeInput, number>> | undefined
> {
  return {
    kind: 'validation',
    type: 'max_size',
    reference: maxSize,
    async: false,
    expects: `<=${requirement}`,
    requirement,
    message,
    /** Require native Blob byte size or Map/Set count at most the threshold; this is not transport read admission. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native property/getter exceptions propagate; diagnostic formatting can read length/size again.
     */
    '~run'(dataset, config) {
      if (dataset.typed && dataset.value.size > this.requirement) {
        _addIssue(this, 'size', dataset, config, {
          received: `${dataset.value.size}`,
        });
      }
      return dataset;
    },
  };
}
