import { BASE64_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Base64 issue interface.
 */
export interface Base64Issue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'base64';
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
 * Base64 action interface.
 */
export interface Base64Action<
  TInput extends string,
  TMessage extends ErrorMessage<Base64Issue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, Base64Issue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'base64';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof base64;
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

/** Check the compatibility padded Base64 alphabet/group pattern without decoding bytes or enforcing canonical padding bits. This action neither establishes the input schema nor grants permissions.
 * @returns {Base64Action<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function base64<TInput extends string>(): Base64Action<
  TInput,
  undefined
>;

/** Check the compatibility padded Base64 alphabet/group pattern without decoding bytes or enforcing canonical padding bits. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {Base64Action<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function base64<
  TInput extends string,
  const TMessage extends ErrorMessage<Base64Issue<TInput>> | undefined,
>(message: TMessage): Base64Action<TInput, TMessage>;

/** Check the compatibility padded Base64 alphabet/group pattern without decoding bytes or enforcing canonical padding bits. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<Base64Issue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {Base64Action<string, ErrorMessage<Base64Issue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function base64(
  message?: ErrorMessage<Base64Issue<string>>
): Base64Action<string, ErrorMessage<Base64Issue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'base64',
    reference: base64,
    async: false,
    expects: null,
    requirement: BASE64_REGEX,
    message,
    /** Check the compatibility padded Base64 alphabet/group pattern without decoding bytes or enforcing canonical padding bits. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native regex errors propagate without any remote lookup, input evaluation or mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'Base64', dataset, config);
      }
      return dataset;
    },
  };
}
