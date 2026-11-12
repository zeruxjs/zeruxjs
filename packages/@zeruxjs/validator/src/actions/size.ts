import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { SizeInput } from './types.js';

/**
 * Size issue interface.
 */
export interface SizeIssue<
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
  readonly type: 'size';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `${TRequirement}`;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${number}`;
  /**
   * The required size.
   */
  readonly requirement: TRequirement;
}

/**
 * Size action interface.
 */
export interface SizeAction<
  TInput extends SizeInput,
  TRequirement extends number,
  TMessage extends ErrorMessage<SizeIssue<TInput, TRequirement>> | undefined,
> extends BaseValidation<TInput, TInput, SizeIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'size';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof size;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `${TRequirement}`;
  /**
   * The required size.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Require exact native size: Blob bytes or Map/Set element count, depending on input kind. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @returns {SizeAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function size<
  TInput extends SizeInput,
  const TRequirement extends number,
>(requirement: TRequirement): SizeAction<TInput, TRequirement, undefined>;

/** Require exact native size: Blob bytes or Map/Set element count, depending on input kind. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {SizeAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function size<
  TInput extends SizeInput,
  const TRequirement extends number,
  const TMessage extends
    | ErrorMessage<SizeIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): SizeAction<TInput, TRequirement, TMessage>;

/** Require exact native size: Blob bytes or Map/Set element count, depending on input kind. This action neither establishes the input schema nor grants permissions.
 * @param {number} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @param {ErrorMessage<SizeIssue<SizeInput, number>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {SizeAction<SizeInput, number, ErrorMessage<SizeIssue<SizeInput, number>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function size(
  requirement: number,
  message?: ErrorMessage<SizeIssue<SizeInput, number>>
): SizeAction<
  SizeInput,
  number,
  ErrorMessage<SizeIssue<SizeInput, number>> | undefined
> {
  return {
    kind: 'validation',
    type: 'size',
    reference: size,
    async: false,
    expects: `${requirement}`,
    requirement,
    message,
    /** Require exact native size: Blob bytes or Map/Set element count, depending on input kind. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native property/getter exceptions propagate; diagnostic formatting can read length/size again.
     */
    '~run'(dataset, config) {
      if (dataset.typed && dataset.value.size !== this.requirement) {
        _addIssue(this, 'size', dataset, config, {
          received: `${dataset.value.size}`,
        });
      }
      return dataset;
    },
  };
}
