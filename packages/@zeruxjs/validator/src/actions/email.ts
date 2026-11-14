import { EMAIL_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Email issue interface.
 */
export interface EmailIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'email';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /**
   * The email regex.
   */
  readonly requirement: RegExp;
}

/**
 * Email action interface.
 */
export interface EmailAction<
  TInput extends string,
  TMessage extends ErrorMessage<EmailIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, EmailIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'email';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof email;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The email regex.
   */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check the retained email text pattern without mailbox verification, SMTP/DNS traffic or complete standards conformance. This action neither establishes the input schema nor grants permissions.
 * @returns {EmailAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function email<TInput extends string>(): EmailAction<TInput, undefined>;

/** Check the retained email text pattern without mailbox verification, SMTP/DNS traffic or complete standards conformance. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {EmailAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function email<
  TInput extends string,
  const TMessage extends ErrorMessage<EmailIssue<TInput>> | undefined,
>(message: TMessage): EmailAction<TInput, TMessage>;

/** Check the retained email text pattern without mailbox verification, SMTP/DNS traffic or complete standards conformance. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<EmailIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {EmailAction<string, ErrorMessage<EmailIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function email(
  message?: ErrorMessage<EmailIssue<string>>
): EmailAction<string, ErrorMessage<EmailIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'email',
    reference: email,
    expects: null,
    async: false,
    requirement: EMAIL_REGEX,
    message,
    /** Check the retained email text pattern without mailbox verification, SMTP/DNS traffic or complete standards conformance. Untyped datasets are left for the owning schema to reject.
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
