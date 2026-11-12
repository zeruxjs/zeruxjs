import { DECIMAL_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Decimal issue interface.
 */
export interface DecimalIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'decimal';
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
 * Decimal action interface.
 */
export interface DecimalAction<
  TInput extends string,
  TMessage extends ErrorMessage<DecimalIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, DecimalIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'decimal';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof decimal;
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

/** Check signed decimal text with the existing optional fractional syntax; no numeric conversion, rounding or exponent support is introduced. This action neither establishes the input schema nor grants permissions.
 * @returns {DecimalAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function decimal<TInput extends string>(): DecimalAction<
  TInput,
  undefined
>;

/** Check signed decimal text with the existing optional fractional syntax; no numeric conversion, rounding or exponent support is introduced. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {DecimalAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function decimal<
  TInput extends string,
  const TMessage extends ErrorMessage<DecimalIssue<TInput>> | undefined,
>(message: TMessage): DecimalAction<TInput, TMessage>;

/** Check signed decimal text with the existing optional fractional syntax; no numeric conversion, rounding or exponent support is introduced. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<DecimalIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {DecimalAction<string, ErrorMessage<DecimalIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function decimal(
  message?: ErrorMessage<DecimalIssue<string>>
): DecimalAction<string, ErrorMessage<DecimalIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'decimal',
    reference: decimal,
    async: false,
    expects: null,
    requirement: DECIMAL_REGEX,
    message,
    /** Check signed decimal text with the existing optional fractional syntax; no numeric conversion, rounding or exponent support is introduced. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native regex errors propagate without any remote lookup, input evaluation or mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'decimal', dataset, config);
      }
      return dataset;
    },
  };
}
