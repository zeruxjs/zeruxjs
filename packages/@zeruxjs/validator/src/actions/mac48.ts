import { MAC48_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * 48-bit MAC issue interface.
 */
export interface Mac48Issue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'mac48';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /**
   * The 48-bit MAC regex.
   */
  readonly requirement: RegExp;
}

/**
 * 48-bit MAC action interface.
 */
export interface Mac48Action<
  TInput extends string,
  TMessage extends ErrorMessage<Mac48Issue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, Mac48Issue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'mac48';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof mac48;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The 48-bit MAC regex.
   */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check retained 48-bit MAC text spellings; no device presence, hardware identity or permission is proven. This action neither establishes the input schema nor grants permissions.
 * @returns {Mac48Action<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function mac48<TInput extends string>(): Mac48Action<TInput, undefined>;

/** Check retained 48-bit MAC text spellings; no device presence, hardware identity or permission is proven. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {Mac48Action<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function mac48<
  TInput extends string,
  const TMessage extends ErrorMessage<Mac48Issue<TInput>> | undefined,
>(message: TMessage): Mac48Action<TInput, TMessage>;

/** Check retained 48-bit MAC text spellings; no device presence, hardware identity or permission is proven. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<Mac48Issue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {Mac48Action<string, ErrorMessage<Mac48Issue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function mac48(
  message?: ErrorMessage<Mac48Issue<string>>
): Mac48Action<string, ErrorMessage<Mac48Issue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'mac48',
    reference: mac48,
    async: false,
    expects: null,
    requirement: MAC48_REGEX,
    message,
    /** Check retained 48-bit MAC text spellings; no device presence, hardware identity or permission is proven. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, '48-bit MAC', dataset, config);
      }
      return dataset;
    },
  };
}
