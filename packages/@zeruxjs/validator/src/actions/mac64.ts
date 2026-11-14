import { MAC64_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * 64-bit MAC issue interface.
 */
export interface Mac64Issue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'mac64';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /**
   * The 64-bit MAC regex.
   */
  readonly requirement: RegExp;
}

/**
 * 64-bit MAC action interface.
 */
export interface Mac64Action<
  TInput extends string,
  TMessage extends ErrorMessage<Mac64Issue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, Mac64Issue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'mac64';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof mac64;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The 64-bit MAC regex.
   */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check retained 64-bit MAC text spellings; no device presence, hardware identity or permission is proven. This action neither establishes the input schema nor grants permissions.
 * @returns {Mac64Action<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function mac64<TInput extends string>(): Mac64Action<TInput, undefined>;

/** Check retained 64-bit MAC text spellings; no device presence, hardware identity or permission is proven. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {Mac64Action<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function mac64<
  TInput extends string,
  const TMessage extends ErrorMessage<Mac64Issue<TInput>> | undefined,
>(message: TMessage): Mac64Action<TInput, TMessage>;

/** Check retained 64-bit MAC text spellings; no device presence, hardware identity or permission is proven. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<Mac64Issue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {Mac64Action<string, ErrorMessage<Mac64Issue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function mac64(
  message?: ErrorMessage<Mac64Issue<string>>
): Mac64Action<string, ErrorMessage<Mac64Issue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'mac64',
    reference: mac64,
    async: false,
    expects: null,
    requirement: MAC64_REGEX,
    message,
    /** Check retained 64-bit MAC text spellings; no device presence, hardware identity or permission is proven. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, '64-bit MAC', dataset, config);
      }
      return dataset;
    },
  };
}
