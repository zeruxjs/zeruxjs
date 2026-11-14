import { IMEI_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue, _isLuhnAlgo } from '../utils/index.js';

/**
 * IMEI issue interface.
 */
export interface ImeiIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'imei';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /**
   * Native numeric predicate identity; not an executable function string.
   */
  readonly requirement: (input: string) => boolean;
}

/**
 * IMEI action interface.
 */
export interface ImeiAction<
  TInput extends string,
  TMessage extends ErrorMessage<ImeiIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, ImeiIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'imei';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof imei;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * Native numeric predicate identity; not an executable function string.
   */
  readonly requirement: (input: string) => boolean;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check retained IMEI formatting and Luhn checksum only; never assert registration, device identity or authorization. This action neither establishes the input schema nor grants permissions.
 * @returns {ImeiAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function imei<TInput extends string>(): ImeiAction<TInput, undefined>;

/** Check retained IMEI formatting and Luhn checksum only; never assert registration, device identity or authorization. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {ImeiAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function imei<
  TInput extends string,
  const TMessage extends ErrorMessage<ImeiIssue<TInput>> | undefined,
>(message: TMessage): ImeiAction<TInput, TMessage>;

/** Check retained IMEI formatting and Luhn checksum only; never assert registration, device identity or authorization. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<ImeiIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {ImeiAction<string, ErrorMessage<ImeiIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function imei(
  message?: ErrorMessage<ImeiIssue<string>>
): ImeiAction<string, ErrorMessage<ImeiIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'imei',
    reference: imei,
    async: false,
    expects: null,
    /** Apply retained presentation/checksum rules to local text without any provider or registry request.
     * @param {string} input - Private candidate string; text is never treated as executable source.
     * @returns {boolean} Whether the retained syntax/checksum predicate accepts it; no issuance, ownership or permission follows.
     */
    requirement(input) {
      return IMEI_REGEX.test(input) && _isLuhnAlgo(input);
    },
    message,
    /** Check retained IMEI formatting and Luhn checksum only; never assert registration, device identity or authorization. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement(dataset.value)) {
        _addIssue(this, 'IMEI', dataset, config);
      }
      return dataset;
    },
  };
}
