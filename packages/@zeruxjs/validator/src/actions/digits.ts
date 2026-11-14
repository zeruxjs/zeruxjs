import { DIGITS_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Digits issue interface.
 */
export interface DigitsIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'digits';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /** Borrowed compatibility RegExp shared with public regex exports; hosts must not mutate it or treat a syntax match as authorization. */
  readonly requirement: RegExp;
}

/**
 * Digits action interface.
 */
export interface DigitsAction<
  TInput extends string,
  TMessage extends ErrorMessage<DigitsIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, DigitsIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'digits';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof digits;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /** Borrowed compatibility RegExp shared with public regex exports; hosts must not mutate it or treat a syntax match as authorization. */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check nonempty ASCII decimal digits without numeric conversion or integer-range validation. This action neither establishes the input schema nor grants permissions.
 * @returns {DigitsAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function digits<TInput extends string>(): DigitsAction<
  TInput,
  undefined
>;

/** Check nonempty ASCII decimal digits without numeric conversion or integer-range validation. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {DigitsAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function digits<
  TInput extends string,
  const TMessage extends ErrorMessage<DigitsIssue<TInput>> | undefined,
>(message: TMessage): DigitsAction<TInput, TMessage>;

/** Check nonempty ASCII decimal digits without numeric conversion or integer-range validation. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<DigitsIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {DigitsAction<string, ErrorMessage<DigitsIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function digits(
  message?: ErrorMessage<DigitsIssue<string>>
): DigitsAction<string, ErrorMessage<DigitsIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'digits',
    reference: digits,
    async: false,
    expects: null,
    requirement: DIGITS_REGEX,
    message,
    /** Check nonempty ASCII decimal digits without numeric conversion or integer-range validation. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native regex errors propagate without any remote lookup, input evaluation or mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'digits', dataset, config);
      }
      return dataset;
    },
  };
}
