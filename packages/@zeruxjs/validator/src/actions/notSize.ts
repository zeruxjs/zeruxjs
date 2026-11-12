import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { SizeInput } from './types.js';

/**
 * Not size issue interface.
 */
export interface NotSizeIssue<
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
  readonly type: 'not_size';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `!${TRequirement}`;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${TRequirement}`;
  /**
   * The not required size.
   */
  readonly requirement: TRequirement;
}

/**
 * Not size action interface.
 */
export interface NotSizeAction<
  TInput extends SizeInput,
  TRequirement extends number,
  TMessage extends ErrorMessage<NotSizeIssue<TInput, TRequirement>> | undefined,
> extends BaseValidation<TInput, TInput, NotSizeIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'not_size';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof notSize;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `!${TRequirement}`;
  /**
   * The not required size.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Reject exactly the configured native Blob byte size or Map/Set count without mutating the input. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @returns {NotSizeAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function notSize<
  TInput extends SizeInput,
  const TRequirement extends number,
>(requirement: TRequirement): NotSizeAction<TInput, TRequirement, undefined>;

/** Reject exactly the configured native Blob byte size or Map/Set count without mutating the input. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {NotSizeAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function notSize<
  TInput extends SizeInput,
  const TRequirement extends number,
  const TMessage extends
    | ErrorMessage<NotSizeIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): NotSizeAction<TInput, TRequirement, TMessage>;

/** Reject exactly the configured native Blob byte size or Map/Set count without mutating the input. This action neither establishes the input schema nor grants permissions.
 * @param {number} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @param {ErrorMessage<NotSizeIssue<SizeInput, number>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {NotSizeAction<SizeInput, number, ErrorMessage<NotSizeIssue<SizeInput, number>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function notSize(
  requirement: number,
  message?: ErrorMessage<NotSizeIssue<SizeInput, number>>
): NotSizeAction<
  SizeInput,
  number,
  ErrorMessage<NotSizeIssue<SizeInput, number>> | undefined
> {
  return {
    kind: 'validation',
    type: 'not_size',
    reference: notSize,
    async: false,
    expects: `!${requirement}`,
    requirement,
    message,
    /** Reject exactly the configured native Blob byte size or Map/Set count without mutating the input. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native property/getter exceptions propagate; diagnostic formatting can read length/size again.
     */
    '~run'(dataset, config) {
      if (dataset.typed && dataset.value.size === this.requirement) {
        _addIssue(this, 'size', dataset, config, {
          received: `${dataset.value.size}`,
        });
      }
      return dataset;
    },
  };
}
