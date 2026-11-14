import { ISO_DATE_TIME_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * ISO date time issue interface.
 */
export interface IsoDateTimeIssue<
  TInput extends string,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'iso_date_time';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /**
   * The ISO date time regex.
   */
  readonly requirement: RegExp;
}

/**
 * ISO date time action interface.
 */
export interface IsoDateTimeAction<
  TInput extends string,
  TMessage extends ErrorMessage<IsoDateTimeIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, IsoDateTimeIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'iso_date_time';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof isoDateTime;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The ISO date time regex.
   */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check the configured date plus minute-precision local time syntax; no calendar validity, zone conversion or date parsing occurs. This action neither establishes the input schema nor grants permissions.
 * @returns {IsoDateTimeAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function isoDateTime<TInput extends string>(): IsoDateTimeAction<
  TInput,
  undefined
>;

/** Check the configured date plus minute-precision local time syntax; no calendar validity, zone conversion or date parsing occurs. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {IsoDateTimeAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function isoDateTime<
  TInput extends string,
  const TMessage extends ErrorMessage<IsoDateTimeIssue<TInput>> | undefined,
>(message: TMessage): IsoDateTimeAction<TInput, TMessage>;

/** Check the configured date plus minute-precision local time syntax; no calendar validity, zone conversion or date parsing occurs. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<IsoDateTimeIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {IsoDateTimeAction<string, ErrorMessage<IsoDateTimeIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function isoDateTime(
  message?: ErrorMessage<IsoDateTimeIssue<string>>
): IsoDateTimeAction<
  string,
  ErrorMessage<IsoDateTimeIssue<string>> | undefined
> {
  return {
    kind: 'validation',
    type: 'iso_date_time',
    reference: isoDateTime,
    async: false,
    expects: null,
    requirement: ISO_DATE_TIME_REGEX,
    message,
    /** Check the configured date plus minute-precision local time syntax; no calendar validity, zone conversion or date parsing occurs. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'date-time', dataset, config);
      }
      return dataset;
    },
  };
}
