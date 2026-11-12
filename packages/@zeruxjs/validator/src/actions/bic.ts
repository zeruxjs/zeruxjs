import { BIC_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * BIC issue interface.
 */
export interface BicIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'bic';
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
 * BIC action interface.
 */
export interface BicAction<
  TInput extends string,
  TMessage extends ErrorMessage<BicIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, BicIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'bic';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof bic;
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

/** Check the configured BIC-shaped text pattern, not bank existence, jurisdiction or payment authorization. This action neither establishes the input schema nor grants permissions.
 * @returns {BicAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function bic<TInput extends string>(): BicAction<TInput, undefined>;

/** Check the configured BIC-shaped text pattern, not bank existence, jurisdiction or payment authorization. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {BicAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function bic<
  TInput extends string,
  const TMessage extends ErrorMessage<BicIssue<TInput>> | undefined,
>(message: TMessage): BicAction<TInput, TMessage>;

/** Check the configured BIC-shaped text pattern, not bank existence, jurisdiction or payment authorization. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<BicIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {BicAction<string, ErrorMessage<BicIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function bic(
  message?: ErrorMessage<BicIssue<string>>
): BicAction<string, ErrorMessage<BicIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'bic',
    reference: bic,
    async: false,
    expects: null,
    requirement: BIC_REGEX,
    message,
    /** Check the configured BIC-shaped text pattern, not bank existence, jurisdiction or payment authorization. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native regex errors propagate without any remote lookup, input evaluation or mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'BIC', dataset, config);
      }
      return dataset;
    },
  };
}
