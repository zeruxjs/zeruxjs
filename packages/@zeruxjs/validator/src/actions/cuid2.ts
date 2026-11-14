import { CUID2_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Cuid2 issue interface.
 */
export interface Cuid2Issue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'cuid2';
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
 * Cuid2 action interface.
 */
export interface Cuid2Action<
  TInput extends string,
  TMessage extends ErrorMessage<Cuid2Issue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, Cuid2Issue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'cuid2';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof cuid2;
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

/** Check a lowercase letter followed by lowercase ASCII letters/digits; no fixed generated-ID length or entropy is proven. This action neither establishes the input schema nor grants permissions.
 * @returns {Cuid2Action<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function cuid2<TInput extends string>(): Cuid2Action<TInput, undefined>;

/** Check a lowercase letter followed by lowercase ASCII letters/digits; no fixed generated-ID length or entropy is proven. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {Cuid2Action<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function cuid2<
  TInput extends string,
  const TMessage extends ErrorMessage<Cuid2Issue<TInput>> | undefined,
>(message: TMessage): Cuid2Action<TInput, TMessage>;

/** Check a lowercase letter followed by lowercase ASCII letters/digits; no fixed generated-ID length or entropy is proven. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<Cuid2Issue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {Cuid2Action<string, ErrorMessage<Cuid2Issue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function cuid2(
  message?: ErrorMessage<Cuid2Issue<string>>
): Cuid2Action<string, ErrorMessage<Cuid2Issue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'cuid2',
    reference: cuid2,
    async: false,
    expects: null,
    requirement: CUID2_REGEX,
    message,
    /** Check a lowercase letter followed by lowercase ASCII letters/digits; no fixed generated-ID length or entropy is proven. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native regex errors propagate without any remote lookup, input evaluation or mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'Cuid2', dataset, config);
      }
      return dataset;
    },
  };
}
