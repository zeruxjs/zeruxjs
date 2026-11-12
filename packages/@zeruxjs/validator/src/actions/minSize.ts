import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { SizeInput } from './types.js';

/**
 * Min size issue interface.
 */
export interface MinSizeIssue<
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
  readonly type: 'min_size';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `>=${TRequirement}`;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${number}`;
  /**
   * The minimum size.
   */
  readonly requirement: TRequirement;
}

/**
 * Min size action interface.
 */
export interface MinSizeAction<
  TInput extends SizeInput,
  TRequirement extends number,
  TMessage extends ErrorMessage<MinSizeIssue<TInput, TRequirement>> | undefined,
> extends BaseValidation<TInput, TInput, MinSizeIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'min_size';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof minSize;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `>=${TRequirement}`;
  /**
   * The minimum size.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Require native Blob byte size or Map/Set count at least the threshold; units follow the input kind. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @returns {MinSizeAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function minSize<
  TInput extends SizeInput,
  const TRequirement extends number,
>(requirement: TRequirement): MinSizeAction<TInput, TRequirement, undefined>;

/** Require native Blob byte size or Map/Set count at least the threshold; units follow the input kind. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MinSizeAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function minSize<
  TInput extends SizeInput,
  const TRequirement extends number,
  const TMessage extends
    | ErrorMessage<MinSizeIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): MinSizeAction<TInput, TRequirement, TMessage>;

/** Require native Blob byte size or Map/Set count at least the threshold; units follow the input kind. This action neither establishes the input schema nor grants permissions.
 * @param {number} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @param {ErrorMessage<MinSizeIssue<SizeInput, number>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MinSizeAction<SizeInput, number, ErrorMessage<MinSizeIssue<SizeInput, number>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function minSize(
  requirement: number,
  message?: ErrorMessage<MinSizeIssue<SizeInput, number>>
): MinSizeAction<
  SizeInput,
  number,
  ErrorMessage<MinSizeIssue<SizeInput, number>> | undefined
> {
  return {
    kind: 'validation',
    type: 'min_size',
    reference: minSize,
    async: false,
    expects: `>=${requirement}`,
    requirement,
    message,
    /** Require native Blob byte size or Map/Set count at least the threshold; units follow the input kind. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native property/getter exceptions propagate; diagnostic formatting can read length/size again.
     */
    '~run'(dataset, config) {
      if (dataset.typed && dataset.value.size < this.requirement) {
        _addIssue(this, 'size', dataset, config, {
          received: `${dataset.value.size}`,
        });
      }
      return dataset;
    },
  };
}
