import { ISO_TIME_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * ISO time issue interface.
 */
export interface IsoTimeIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'iso_time';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /**
   * The ISO time regex.
   */
  readonly requirement: RegExp;
}

/**
 * ISO time action interface.
 */
export interface IsoTimeAction<
  TInput extends string,
  TMessage extends ErrorMessage<IsoTimeIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, IsoTimeIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'iso_time';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof isoTime;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The ISO time regex.
   */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check configured hour/minute text ranges without a date, timezone or duration interpretation. This action neither establishes the input schema nor grants permissions.
 * @returns {IsoTimeAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function isoTime<TInput extends string>(): IsoTimeAction<
  TInput,
  undefined
>;

/** Check configured hour/minute text ranges without a date, timezone or duration interpretation. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {IsoTimeAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function isoTime<
  TInput extends string,
  const TMessage extends ErrorMessage<IsoTimeIssue<TInput>> | undefined,
>(message: TMessage): IsoTimeAction<TInput, TMessage>;

/** Check configured hour/minute text ranges without a date, timezone or duration interpretation. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<IsoTimeIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {IsoTimeAction<string, ErrorMessage<IsoTimeIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function isoTime(
  message?: ErrorMessage<IsoTimeIssue<string>>
): IsoTimeAction<string, ErrorMessage<IsoTimeIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'iso_time',
    reference: isoTime,
    async: false,
    expects: null,
    requirement: ISO_TIME_REGEX,
    message,
    /** Check configured hour/minute text ranges without a date, timezone or duration interpretation. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'time', dataset, config);
      }
      return dataset;
    },
  };
}
