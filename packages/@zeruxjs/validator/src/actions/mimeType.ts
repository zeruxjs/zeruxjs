import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue, _joinExpects } from '../utils/index.js';

/**
 * Requirement type.
 */
type Requirement = readonly `${string}/${string}`[];

/**
 * MIME type issue interface.
 */
export interface MimeTypeIssue<
  TInput extends Blob,
  TRequirement extends Requirement,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'mime_type';
  /**
   * The expected input.
   */
  readonly expected: string;
  /**
   * The received input.
   */
  readonly received: `"${string}"`;
  /**
   * The MIME types.
   */
  readonly requirement: TRequirement;
}

/**
 * MIME type action interface.
 */
export interface MimeTypeAction<
  TInput extends Blob,
  TRequirement extends Requirement,
  TMessage extends
    | ErrorMessage<MimeTypeIssue<TInput, TRequirement>>
    | undefined,
> extends BaseValidation<TInput, TInput, MimeTypeIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'mime_type';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof mimeType;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: string;
  /**
   * The MIME types.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Compare declared Blob MIME metadata against an explicit exact list; no bytes are read, sniffed, fetched or authenticated. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Trusted native RegExp or exact declared MIME list; runtime admission and allowed destinations remain host-owned.
 * @returns {MimeTypeAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function mimeType<
  TInput extends Blob,
  const TRequirement extends Requirement,
>(requirement: TRequirement): MimeTypeAction<TInput, TRequirement, undefined>;

/** Compare declared Blob MIME metadata against an explicit exact list; no bytes are read, sniffed, fetched or authenticated. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Trusted native RegExp or exact declared MIME list; runtime admission and allowed destinations remain host-owned.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MimeTypeAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function mimeType<
  TInput extends Blob,
  const TRequirement extends Requirement,
  const TMessage extends
    | ErrorMessage<MimeTypeIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): MimeTypeAction<TInput, TRequirement, TMessage>;

/** Compare declared Blob MIME metadata against an explicit exact list; no bytes are read, sniffed, fetched or authenticated. This action neither establishes the input schema nor grants permissions.
 * @param {Requirement} requirement - Trusted native RegExp or exact declared MIME list; runtime admission and allowed destinations remain host-owned.
 * @param {ErrorMessage<MimeTypeIssue<Blob, Requirement>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MimeTypeAction<Blob, Requirement, ErrorMessage<MimeTypeIssue<Blob, Requirement>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function mimeType(
  requirement: Requirement,
  message?: ErrorMessage<MimeTypeIssue<Blob, Requirement>>
): MimeTypeAction<
  Blob,
  Requirement,
  ErrorMessage<MimeTypeIssue<Blob, Requirement>> | undefined
> {
  return {
    kind: 'validation',
    type: 'mime_type',
    reference: mimeType,
    async: false,
    expects: _joinExpects(
      requirement.map((option) => `"${option}"`),
      '|'
    ),
    requirement,
    message,
    /** Compare declared Blob MIME metadata against an explicit exact list; no bytes are read, sniffed, fetched or authenticated. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (
        dataset.typed &&
        !this.requirement.includes(dataset.value.type as `${string}/${string}`)
      ) {
        _addIssue(this, 'MIME type', dataset, config, {
          received: `"${dataset.value.type}"`,
        });
      }
      return dataset;
    },
  };
}
