import { ISRC_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * ISRC issue interface.
 */
export interface IsrcIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'isrc';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /**
   * The ISRC regex.
   */
  readonly requirement: RegExp;
}

/**
 * ISRC action interface.
 */
export interface IsrcAction<
  TInput extends string,
  TMessage extends ErrorMessage<IsrcIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, IsrcIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'isrc';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof isrc;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The ISRC regex.
   */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check uppercase ISRC-shaped text with the retained optional separators; no registry lookup or rights verification occurs. This action neither establishes the input schema nor grants permissions.
 * @returns {IsrcAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 * @beta
 */
export function isrc<TInput extends string>(): IsrcAction<TInput, undefined>;

/** Check uppercase ISRC-shaped text with the retained optional separators; no registry lookup or rights verification occurs. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {IsrcAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 * @beta
 */
export function isrc<
  TInput extends string,
  const TMessage extends ErrorMessage<IsrcIssue<TInput>> | undefined,
>(message: TMessage): IsrcAction<TInput, TMessage>;

/** Check uppercase ISRC-shaped text with the retained optional separators; no registry lookup or rights verification occurs. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<IsrcIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {IsrcAction<string, ErrorMessage<IsrcIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function isrc(
  message?: ErrorMessage<IsrcIssue<string>>
): IsrcAction<string, ErrorMessage<IsrcIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'isrc',
    reference: isrc,
    async: false,
    expects: null,
    requirement: ISRC_REGEX,
    message,
    /** Check uppercase ISRC-shaped text with the retained optional separators; no registry lookup or rights verification occurs. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'ISRC', dataset, config);
      }
      return dataset;
    },
  };
}
