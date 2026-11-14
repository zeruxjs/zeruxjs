import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue, _isLuhnAlgo } from '../utils/index.js';

/**
 * Credit card issue interface.
 */
export interface CreditCardIssue<
  TInput extends string,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'credit_card';
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
 * Credit card action interface.
 */
export interface CreditCardAction<
  TInput extends string,
  TMessage extends ErrorMessage<CreditCardIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, CreditCardIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'credit_card';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof creditCard;
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

/**
 * Credit card regex.
 */
const CREDIT_CARD_REGEX =
  /^(?:\d{13,19}|\d{4}(?: \d{3,6}){2,4}|\d{4}(?:-\d{3,6}){2,4})$/u;

/**
 * Sanitize regex.
 */
const SANITIZE_REGEX = /[- ]/gu;

/**
 * Provider regex list.
 */
const PROVIDER_REGEX_LIST = [
  // American Express
  /^3[47]\d{13}$/u,
  // Diners Club
  /^3(?:0[0-5]|[68]\d)\d{11,13}$/u,
  // Discover
  /^6(?:011|5\d{2})\d{12,15}$/u,
  // JCB
  /^(?:2131|1800|35\d{3})\d{11}$/u,
  // Mastercard
  // Compatibility expression; previous external ReDoS lint exclusions are not used here.
  /^5[1-5]\d{2}|(?:222\d|22[3-9]\d|2[3-6]\d{2}|27[01]\d|2720)\d{12}$/u,
  // UnionPay
  /^(?:6[27]\d{14,17}|81\d{14,17})$/u,
  // Visa
  /^4\d{12}(?:\d{3,6})?$/u,
];

/** Check retained card format, provider-prefix patterns and Luhn checksum; this never contacts a payment provider or proves issuance/authorization. This action neither establishes the input schema nor grants permissions.
 * @returns {CreditCardAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function creditCard<TInput extends string>(): CreditCardAction<
  TInput,
  undefined
>;

/** Check retained card format, provider-prefix patterns and Luhn checksum; this never contacts a payment provider or proves issuance/authorization. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {CreditCardAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function creditCard<
  TInput extends string,
  const TMessage extends ErrorMessage<CreditCardIssue<TInput>> | undefined,
>(message: TMessage): CreditCardAction<TInput, TMessage>;

/** Check retained card format, provider-prefix patterns and Luhn checksum; this never contacts a payment provider or proves issuance/authorization. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<CreditCardIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {CreditCardAction<string, ErrorMessage<CreditCardIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function creditCard(
  message?: ErrorMessage<CreditCardIssue<string>>
): CreditCardAction<string, ErrorMessage<CreditCardIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'credit_card',
    reference: creditCard,
    async: false,
    expects: null,
    /** Apply retained presentation/checksum rules to local text without any provider or registry request.
     * @param {string} input - Private candidate string; text is never treated as executable source.
     * @returns {boolean} Whether the retained syntax/checksum predicate accepts it; no issuance, ownership or permission follows.
     */
    requirement(input) {
      let sanitized: string | undefined;
      return (CREDIT_CARD_REGEX.test(input) &&
        // Remove any hyphens and blanks
        (sanitized = input.replace(SANITIZE_REGEX, '')) &&
        // Check if it matches a provider
        PROVIDER_REGEX_LIST.some((regex) => regex.test(sanitized!)) &&
        // Check if passes luhn algorithm
        _isLuhnAlgo(sanitized)) as boolean;
    },
    message,
    /** Check retained card format, provider-prefix patterns and Luhn checksum; this never contacts a payment provider or proves issuance/authorization. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement(dataset.value)) {
        _addIssue(this, 'credit card', dataset, config);
      }
      return dataset;
    },
  };
}
