import { RFC_EMAIL_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * RFC email issue interface.
 */
export interface RfcEmailIssue<
  TInput extends string,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'rfc_email';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /**
   * The RFC email regex.
   */
  readonly requirement: RegExp;
}

/**
 * RFC email action interface.
 */
export interface RfcEmailAction<
  TInput extends string,
  TMessage extends ErrorMessage<RfcEmailIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, RfcEmailIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'rfc_email';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof rfcEmail;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The RFC email regex.
   */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check the retained HTML-input-derived email pattern; this deliberately does not implement all RFC 5322 address syntax. This action neither establishes the input schema nor grants permissions.
 * @returns {RfcEmailAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function rfcEmail<TInput extends string>(): RfcEmailAction<
  TInput,
  undefined
>;

/** Check the retained HTML-input-derived email pattern; this deliberately does not implement all RFC 5322 address syntax. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {RfcEmailAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function rfcEmail<
  TInput extends string,
  const TMessage extends ErrorMessage<RfcEmailIssue<TInput>> | undefined,
>(message: TMessage): RfcEmailAction<TInput, TMessage>;

/** Check the retained HTML-input-derived email pattern; this deliberately does not implement all RFC 5322 address syntax. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<RfcEmailIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {RfcEmailAction<string, ErrorMessage<RfcEmailIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function rfcEmail(
  message?: ErrorMessage<RfcEmailIssue<string>>
): RfcEmailAction<string, ErrorMessage<RfcEmailIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'rfc_email',
    reference: rfcEmail,
    expects: null,
    async: false,
    requirement: RFC_EMAIL_REGEX,
    message,
    /** Check the retained HTML-input-derived email pattern; this deliberately does not implement all RFC 5322 address syntax. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'email', dataset, config);
      }
      return dataset;
    },
  };
}
