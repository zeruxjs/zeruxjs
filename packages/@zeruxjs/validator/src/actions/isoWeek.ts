import { ISO_WEEK_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * ISO week issue interface.
 */
export interface IsoWeekIssue<TInput extends string> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'iso_week';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /**
   * The ISO week regex.
   */
  readonly requirement: RegExp;
}

/**
 * ISO week action interface.
 */
export interface IsoWeekAction<
  TInput extends string,
  TMessage extends ErrorMessage<IsoWeekIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, IsoWeekIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'iso_week';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof isoWeek;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The ISO week regex.
   */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check year-W01..W53 spelling without verifying whether that ISO week exists in the selected year. This action neither establishes the input schema nor grants permissions.
 * @returns {IsoWeekAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function isoWeek<TInput extends string>(): IsoWeekAction<
  TInput,
  undefined
>;

/** Check year-W01..W53 spelling without verifying whether that ISO week exists in the selected year. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {IsoWeekAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function isoWeek<
  TInput extends string,
  const TMessage extends ErrorMessage<IsoWeekIssue<TInput>> | undefined,
>(message: TMessage): IsoWeekAction<TInput, TMessage>;

/** Check year-W01..W53 spelling without verifying whether that ISO week exists in the selected year. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<IsoWeekIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {IsoWeekAction<string, ErrorMessage<IsoWeekIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function isoWeek(
  message?: ErrorMessage<IsoWeekIssue<string>>
): IsoWeekAction<string, ErrorMessage<IsoWeekIssue<string>> | undefined> {
  return {
    kind: 'validation',
    type: 'iso_week',
    reference: isoWeek,
    async: false,
    expects: null,
    requirement: ISO_WEEK_REGEX,
    message,
    /** Check year-W01..W53 spelling without verifying whether that ISO week exists in the selected year. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'week', dataset, config);
      }
      return dataset;
    },
  };
}
