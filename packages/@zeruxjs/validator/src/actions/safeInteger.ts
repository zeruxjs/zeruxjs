import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Safe integer issue interface.
 */
export interface SafeIntegerIssue<
  TInput extends number,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'safe_integer';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `${number}`;
  /**
   * Native numeric predicate identity; not an executable function string.
   */
  readonly requirement: (input: number) => boolean;
}

/**
 * Safe integer action interface.
 */
export interface SafeIntegerAction<
  TInput extends number,
  TMessage extends ErrorMessage<SafeIntegerIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, SafeIntegerIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'safe_integer';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof safeInteger;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * Native numeric predicate identity; not an executable function string.
   */
  readonly requirement: (input: number) => boolean;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Refine typed numbers with native Number.isSafeInteger; numeric strings are never converted. This action neither establishes the input schema nor grants permissions.
 * @returns {SafeIntegerAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function safeInteger<TInput extends number>(): SafeIntegerAction<
  TInput,
  undefined
>;

/** Refine typed numbers with native Number.isSafeInteger; numeric strings are never converted. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {SafeIntegerAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function safeInteger<
  TInput extends number,
  const TMessage extends ErrorMessage<SafeIntegerIssue<TInput>> | undefined,
>(message: TMessage): SafeIntegerAction<TInput, TMessage>;

/** Refine typed numbers with native Number.isSafeInteger; numeric strings are never converted. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<SafeIntegerIssue<number>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {SafeIntegerAction<number, ErrorMessage<SafeIntegerIssue<number>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function safeInteger(
  message?: ErrorMessage<SafeIntegerIssue<number>>
): SafeIntegerAction<
  number,
  ErrorMessage<SafeIntegerIssue<number>> | undefined
> {
  return {
    kind: 'validation',
    type: 'safe_integer',
    reference: safeInteger,
    async: false,
    expects: null,
    requirement: Number.isSafeInteger,
    message,
    /** Refine typed numbers with native Number.isSafeInteger; numeric strings are never converted. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement(dataset.value)) {
        _addIssue(this, 'safe integer', dataset, config);
      }
      return dataset;
    },
  };
}
