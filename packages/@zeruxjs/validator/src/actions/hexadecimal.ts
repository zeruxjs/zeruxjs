import { HEXADECIMAL_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Hexadecimal issue interface.
 */
export interface HexadecimalIssue<
  TInput extends string,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'hexadecimal';
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
 * Hexadecimal action interface.
 */
export interface HexadecimalAction<
  TInput extends string,
  TMessage extends ErrorMessage<HexadecimalIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, HexadecimalIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'hexadecimal';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof hexadecimal;
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

/** Check hexadecimal digits with the retained optional lowercase 0h/0x prefix; do not convert or execute input. This action neither establishes the input schema nor grants permissions.
 * @returns {HexadecimalAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function hexadecimal<TInput extends string>(): HexadecimalAction<
  TInput,
  undefined
>;

/** Check hexadecimal digits with the retained optional lowercase 0h/0x prefix; do not convert or execute input. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {HexadecimalAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function hexadecimal<
  TInput extends string,
  const TMessage extends ErrorMessage<HexadecimalIssue<TInput>> | undefined,
>(message: TMessage): HexadecimalAction<TInput, TMessage>;

/** Check hexadecimal digits with the retained optional lowercase 0h/0x prefix; do not convert or execute input. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<HexadecimalIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {HexadecimalAction<string, ErrorMessage<HexadecimalIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function hexadecimal(
  message?: ErrorMessage<HexadecimalIssue<string>>
): HexadecimalAction<
  string,
  ErrorMessage<HexadecimalIssue<string>> | undefined
> {
  return {
    kind: 'validation',
    type: 'hexadecimal',
    reference: hexadecimal,
    async: false,
    expects: null,
    requirement: HEXADECIMAL_REGEX,
    message,
    /** Check hexadecimal digits with the retained optional lowercase 0h/0x prefix; do not convert or execute input. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native regex errors propagate without any remote lookup, input evaluation or mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'hexadecimal', dataset, config);
      }
      return dataset;
    },
  };
}
