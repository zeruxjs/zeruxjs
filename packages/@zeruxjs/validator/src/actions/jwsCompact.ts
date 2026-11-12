import { JWS_COMPACT_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * JWS compact issue interface.
 *
 * @beta
 */
export interface JwsCompactIssue<
  TInput extends string,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'jws_compact';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /**
   * The JWS compact regex.
   */
  readonly requirement: RegExp;
}

/**
 * JWS compact action interface.
 *
 * @beta
 */
export interface JwsCompactAction<
  TInput extends string,
  TMessage extends ErrorMessage<JwsCompactIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, JwsCompactIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'jws_compact';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof jwsCompact;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The JWS compact regex.
   */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check compact Base64URL segment syntax, permitting empty payload/signature segments; no cryptographic signature or JWT claim verification occurs. This action neither establishes the input schema nor grants permissions.
 * @returns {JwsCompactAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 * @beta
 */
export function jwsCompact<TInput extends string>(): JwsCompactAction<
  TInput,
  undefined
>;

/** Check compact Base64URL segment syntax, permitting empty payload/signature segments; no cryptographic signature or JWT claim verification occurs. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {JwsCompactAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 * @beta
 */
export function jwsCompact<
  TInput extends string,
  const TMessage extends ErrorMessage<JwsCompactIssue<TInput>> | undefined,
>(message: TMessage): JwsCompactAction<TInput, TMessage>;

/** Check compact Base64URL segment syntax, permitting empty payload/signature segments; no cryptographic signature or JWT claim verification occurs. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<JwsCompactIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {JwsCompactAction<string, ErrorMessage<JwsCompactIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function jwsCompact(
  message?: ErrorMessage<JwsCompactIssue<string>>
): JwsCompactAction<string, ErrorMessage<JwsCompactIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'jws_compact',
    reference: jwsCompact,
    async: false,
    expects: null,
    requirement: JWS_COMPACT_REGEX,
    message,
    /** Check compact Base64URL segment syntax, permitting empty payload/signature segments; no cryptographic signature or JWT claim verification occurs. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'JWS compact', dataset, config);
      }
      return dataset;
    },
  };
}
