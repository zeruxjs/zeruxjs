import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * Regex issue interface.
 */
export interface RegexIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'regex';
  /**
   * The expected input.
   */
  readonly expected: string;
  /**
   * The received input.
   */
  readonly received: `"${string}"`;
  /**
   * The regex pattern.
   */
  readonly requirement: RegExp;
}

/**
 * Regex action interface.
 */
export interface RegexAction<
  TInput extends string,
  TMessage extends ErrorMessage<RegexIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, RegexIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'regex';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof regex;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: string;
  /**
   * The regex pattern.
   */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Apply an explicit trusted RegExp without cloning/resetting lastIndex. Global/sticky state is borrowed and native matching cannot be force-interrupted by a cooperative deadline. This action neither establishes the input schema nor grants permissions.
 * @param {RegExp} requirement - Trusted native RegExp or exact declared MIME list; runtime admission and allowed destinations remain host-owned.
 * @returns {RegexAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function regex<TInput extends string>(
  requirement: RegExp
): RegexAction<TInput, undefined>;

/** Apply an explicit trusted RegExp without cloning/resetting lastIndex. Global/sticky state is borrowed and native matching cannot be force-interrupted by a cooperative deadline. This action neither establishes the input schema nor grants permissions.
 * @param {RegExp} requirement - Trusted native RegExp or exact declared MIME list; runtime admission and allowed destinations remain host-owned.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {RegexAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function regex<
  TInput extends string,
  const TMessage extends ErrorMessage<RegexIssue<TInput>> | undefined,
>(requirement: RegExp, message: TMessage): RegexAction<TInput, TMessage>;

/** Apply an explicit trusted RegExp without cloning/resetting lastIndex. Global/sticky state is borrowed and native matching cannot be force-interrupted by a cooperative deadline. This action neither establishes the input schema nor grants permissions.
 * @param {RegExp} requirement - Trusted native RegExp or exact declared MIME list; runtime admission and allowed destinations remain host-owned.
 * @param {ErrorMessage<RegexIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {RegexAction<string, ErrorMessage<RegexIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function regex(
  requirement: RegExp,
  message?: ErrorMessage<RegexIssue<string>>
): RegexAction<string, ErrorMessage<RegexIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'regex',
    reference: regex,
    async: false,
    expects: `${requirement}`,
    requirement,
    message,
    /** Apply an explicit trusted RegExp without cloning/resetting lastIndex. Global/sticky state is borrowed and native matching cannot be force-interrupted by a cooperative deadline. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'format', dataset, config);
      }
      return dataset;
    },
  };
}
