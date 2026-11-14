import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue, _getByteCount } from '../utils/index.js';

/**
 * Max bytes issue interface.
 */
export interface MaxBytesIssue<
  TInput extends string,
  TRequirement extends number,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'max_bytes';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `<=${TRequirement}`;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${number}`;
  /**
   * The maximum bytes.
   */
  readonly requirement: TRequirement;
}

/**
 * Max bytes action interface.
 */
export interface MaxBytesAction<
  TInput extends string,
  TRequirement extends number,
  TMessage extends
    | ErrorMessage<MaxBytesIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<TInput, TInput, MaxBytesIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'max_bytes';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof maxBytes;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `<=${TRequirement}`;
  /**
   * The maximum bytes.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Require at most the configured count of UTF-8 encoded bytes; encoding allocates a complete byte array and is not streaming HTTP admission. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @returns {MaxBytesAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function maxBytes<
  TInput extends string,
  const TRequirement extends number,
>(requirement: TRequirement): MaxBytesAction<TInput, TRequirement, undefined>;

/** Require at most the configured count of UTF-8 encoded bytes; encoding allocates a complete byte array and is not streaming HTTP admission. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MaxBytesAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function maxBytes<
  TInput extends string,
  const TRequirement extends number,
  const TMessage extends
    | ErrorMessage<MaxBytesIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): MaxBytesAction<TInput, TRequirement, TMessage>;

/** Require at most the configured count of UTF-8 encoded bytes; encoding allocates a complete byte array and is not streaming HTTP admission. This action neither establishes the input schema nor grants permissions.
 * @param {number} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {ErrorMessage<MaxBytesIssue<string, number>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MaxBytesAction<string, number, ErrorMessage<MaxBytesIssue<string, number>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function maxBytes(
  requirement: number,
  message?: ErrorMessage<MaxBytesIssue<string, number>>
): MaxBytesAction<
  string,
  number,
  ErrorMessage<MaxBytesIssue<string, number>> | undefined
> {
  return {
    kind: 'validation',
    type: 'max_bytes',
    reference: maxBytes,
    async: false,
    expects: `<=${requirement}`,
    requirement,
    message,
    /** Require at most the configured count of UTF-8 encoded bytes; encoding allocates a complete byte array and is not streaming HTTP admission. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed) {
        /** Measured UTF-8 byte count; the encoder allocation is completed before comparison. */
        const length = _getByteCount(dataset.value);
        if (length > this.requirement) {
          _addIssue(this, 'bytes', dataset, config, {
            received: `${length}`,
          });
        }
      }
      return dataset;
    },
  };
}
