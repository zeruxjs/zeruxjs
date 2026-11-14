import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { LengthInput } from './types.js';

/**
 * Length issue interface.
 */
export interface LengthIssue<
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
  readonly type: 'length';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: `${TRequirement}`;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${number}`;
  /**
   * The required length.
   */
  readonly requirement: TRequirement;
}

/**
 * Length action interface.
 */
export interface LengthAction<
  TInput extends LengthInput,
  TRequirement extends number,
  TMessage extends ErrorMessage<LengthIssue<TInput, TRequirement>> | undefined,
> extends BaseValidation<TInput, TInput, LengthIssue<TInput, TRequirement>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'length';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof length;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: `${TRequirement}`;
  /**
   * The required length.
   */
  readonly requirement: TRequirement;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Require exact native length: string UTF-16 code units or array-like positions, never graphemes or bytes. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @returns {LengthAction<TInput, TRequirement, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function length<
  TInput extends LengthInput,
  const TRequirement extends number,
>(requirement: TRequirement): LengthAction<TInput, TRequirement, undefined>;

/** Require exact native length: string UTF-16 code units or array-like positions, never graphemes or bytes. This action neither establishes the input schema nor grants permissions.
 * @param {TRequirement} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {LengthAction<TInput, TRequirement, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function length<
  TInput extends LengthInput,
  const TRequirement extends number,
  const TMessage extends
    | ErrorMessage<LengthIssue<TInput, TRequirement>>
    | undefined,
>(
  requirement: TRequirement,
  message: TMessage
): LengthAction<TInput, TRequirement, TMessage>;

/** Require exact native length: string UTF-16 code units or array-like positions, never graphemes or bytes. This action neither establishes the input schema nor grants permissions.
 * @param {number} requirement - Explicit trusted numeric threshold; this legacy constructor does not independently enforce finite, nonnegative or integer configuration.
 * @param {ErrorMessage<LengthIssue<LengthInput, number>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {LengthAction<LengthInput, number, ErrorMessage<LengthIssue<LengthInput, number>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function length(
  requirement: number,
  message?: ErrorMessage<LengthIssue<LengthInput, number>>
): LengthAction<
  LengthInput,
  number,
  ErrorMessage<LengthIssue<LengthInput, number>> | undefined
> {
  return {
    kind: 'validation',
    type: 'length',
    reference: length,
    async: false,
    expects: `${requirement}`,
    requirement,
    message,
    /** Require exact native length: string UTF-16 code units or array-like positions, never graphemes or bytes. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native property/getter exceptions propagate; diagnostic formatting can read length/size again.
     */
    '~run'(dataset, config) {
      if (dataset.typed && dataset.value.length !== this.requirement) {
        _addIssue(this, 'length', dataset, config, {
          received: `${dataset.value.length}`,
        });
      }
      return dataset;
    },
  };
}
