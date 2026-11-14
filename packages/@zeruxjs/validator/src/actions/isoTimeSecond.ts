import { ISO_TIME_SECOND_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * ISO time second issue interface.
 */
export interface IsoTimeSecondIssue<
  TInput extends string,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'iso_time_second';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /**
   * The ISO time with seconds regex.
   */
  readonly requirement: RegExp;
}

/**
 * ISO time second action interface.
 */
export interface IsoTimeSecondAction<
  TInput extends string,
  TMessage extends ErrorMessage<IsoTimeSecondIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, IsoTimeSecondIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'iso_time_second';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof isoTimeSecond;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The ISO time second regex.
   */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check configured hour/minute/second text ranges; leap seconds and timezone handling are outside this syntax subset. This action neither establishes the input schema nor grants permissions.
 * @returns {IsoTimeSecondAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function isoTimeSecond<TInput extends string>(): IsoTimeSecondAction<
  TInput,
  undefined
>;

/** Check configured hour/minute/second text ranges; leap seconds and timezone handling are outside this syntax subset. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {IsoTimeSecondAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function isoTimeSecond<
  TInput extends string,
  const TMessage extends ErrorMessage<IsoTimeSecondIssue<TInput>> | undefined,
>(message: TMessage): IsoTimeSecondAction<TInput, TMessage>;

/** Check configured hour/minute/second text ranges; leap seconds and timezone handling are outside this syntax subset. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<IsoTimeSecondIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {IsoTimeSecondAction<string, ErrorMessage<IsoTimeSecondIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function isoTimeSecond(
  message?: ErrorMessage<IsoTimeSecondIssue<string>>
): IsoTimeSecondAction<
  string,
  ErrorMessage<IsoTimeSecondIssue<string>> | undefined
> {
  return {
    kind: 'validation',
    type: 'iso_time_second',
    reference: isoTimeSecond,
    async: false,
    expects: null,
    requirement: ISO_TIME_SECOND_REGEX,
    message,
    /** Check configured hour/minute/second text ranges; leap seconds and timezone handling are outside this syntax subset. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'time-second', dataset, config);
      }
      return dataset;
    },
  };
}
