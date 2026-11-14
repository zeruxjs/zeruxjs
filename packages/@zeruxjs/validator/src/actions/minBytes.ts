import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue, _getByteCount } from '../utils/index.js';

/**
 * Min bytes issue interface.
 */
export interface MinBytesIssue<
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
  readonly type: 'min_bytes';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `>=${TRequirement}`;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${number}`;
  /**
   * The minimum bytes.
   */
  readonly requirement: TRequirement;
}

/**
 * Min bytes action interface.
 */
export interface MinBytesAction<
  TInput extends string,
  TRequirement extends number,
  TMessage extends
    | ErrorMessage<MinBytesIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<TInput, TInput, MinBytesIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'min_bytes';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof minBytes;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `>=${TRequirement}`;
  /**
   * The minimum bytes.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Require at least the configured count of UTF-8 encoded bytes; encoding allocates a complete byte array and is not streaming HTTP admission. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @returns {MinBytesAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function minBytes<
  TInput extends string,
  const TRequirement extends number,
>(requirement: TRequirement): MinBytesAction<TInput, TRequirement, undefined>;

/** Require at least the configured count of UTF-8 encoded bytes; encoding allocates a complete byte array and is not streaming HTTP admission. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MinBytesAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function minBytes<
  TInput extends string,
  const TRequirement extends number,
  const TMessage extends
    | ErrorMessage<MinBytesIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): MinBytesAction<TInput, TRequirement, TMessage>;

/** Require at least the configured count of UTF-8 encoded bytes; encoding allocates a complete byte array and is not streaming HTTP admission. This action neither establishes the input schema nor grants permissions.
 * @param {number} requirement - Explicit trusted measurement/comparison requirement; this constructor does not independently validate every threshold or clone Date references.
 * @param {ErrorMessage<MinBytesIssue<string, number>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MinBytesAction<string, number, ErrorMessage<MinBytesIssue<string, number>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function minBytes(
  requirement: number,
  message?: ErrorMessage<MinBytesIssue<string, number>>
): MinBytesAction<
  string,
  number,
  ErrorMessage<MinBytesIssue<string, number>> | undefined
> {
  return {
    kind: 'validation',
    type: 'min_bytes',
    reference: minBytes,
    async: false,
    expects: `>=${requirement}`,
    requirement,
    message,
    /** Require at least the configured count of UTF-8 encoded bytes; encoding allocates a complete byte array and is not streaming HTTP admission. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed) {
        /** Measured UTF-8 byte count; the encoder allocation is completed before comparison. */
        const length = _getByteCount(dataset.value);
        if (length < this.requirement) {
          _addIssue(this, 'bytes', dataset, config, {
            received: `${length}`,
          });
        }
      }
      return dataset;
    },
  };
}
