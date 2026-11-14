import { MAC_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * MAC issue interface.
 */
export interface MacIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'mac';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /**
   * The MAC regex.
   */
  readonly requirement: RegExp;
}

/**
 * MAC action interface.
 */
export interface MacAction<
  TInput extends string,
  TMessage extends ErrorMessage<MacIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, MacIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'mac';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof mac;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The MAC regex.
   */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check retained 48/64-bit MAC text spellings; no device presence, hardware identity or permission is proven. This action neither establishes the input schema nor grants permissions.
 * @returns {MacAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function mac<TInput extends string>(): MacAction<TInput, undefined>;

/** Check retained 48/64-bit MAC text spellings; no device presence, hardware identity or permission is proven. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MacAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function mac<
  TInput extends string,
  const TMessage extends ErrorMessage<MacIssue<TInput>> | undefined,
>(message: TMessage): MacAction<TInput, TMessage>;

/** Check retained 48/64-bit MAC text spellings; no device presence, hardware identity or permission is proven. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<MacIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {MacAction<string, ErrorMessage<MacIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function mac(
  message?: ErrorMessage<MacIssue<string>>
): MacAction<string, ErrorMessage<MacIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'mac',
    reference: mac,
    async: false,
    expects: null,
    requirement: MAC_REGEX,
    message,
    /** Check retained 48/64-bit MAC text spellings; no device presence, hardware identity or permission is proven. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'MAC', dataset, config);
      }
      return dataset;
    },
  };
}
