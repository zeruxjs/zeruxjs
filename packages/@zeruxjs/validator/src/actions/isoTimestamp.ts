import { ISO_TIMESTAMP_REGEX } from '../regex.js';
import type {
  BaseIssue,
  BaseValidation,
  ErrorMessage,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';

/**
 * ISO timestamp issue interface.
 */
export interface IsoTimestampIssue<
  TInput extends string,
> extends BaseIssue<TInput> {
  /**
   * Fixed validation category; raw rejected values remain private.
   */
  readonly kind: 'validation';
  /**
   * Stable refinement discriminator for structured issue consumers.
   */
  readonly type: 'iso_timestamp';
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expected: null;
  /**
   * Private textual rejected-value diagnostic; do not expose it through public responses.
   */
  readonly received: `"${string}"`;
  /**
   * The ISO timestamp regex.
   */
  readonly requirement: RegExp;
}

/**
 * ISO timestamp action interface.
 */
export interface IsoTimestampAction<
  TInput extends string,
  TMessage extends ErrorMessage<IsoTimestampIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, IsoTimestampIssue<TInput>> {
  /**
   * Stable refinement discriminator; this action never coerces input into the declared schema type.
   */
  readonly type: 'iso_timestamp';
  /**
   * Authored constructor identity; no handler is loaded from submitted data.
   */
  readonly reference: typeof isoTimestamp;
  /**
   * Private diagnostic expectation, not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The ISO timestamp regex.
   */
  readonly requirement: RegExp;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Check retained timestamp/date/offset syntax and fractional-second width; no calendar validation or time conversion occurs. This action neither establishes the input schema nor grants permissions.
 * @returns {IsoTimestampAction<TInput, undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function isoTimestamp<TInput extends string>(): IsoTimestampAction<
  TInput,
  undefined
>;

/** Check retained timestamp/date/offset syntax and fractional-second width; no calendar validation or time conversion occurs. This action neither establishes the input schema nor grants permissions.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {IsoTimestampAction<TInput, TMessage>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
export function isoTimestamp<
  TInput extends string,
  const TMessage extends ErrorMessage<IsoTimestampIssue<TInput>> | undefined,
>(message: TMessage): IsoTimestampAction<TInput, TMessage>;

/** Check retained timestamp/date/offset syntax and fractional-second width; no calendar validation or time conversion occurs. This action neither establishes the input schema nor grants permissions.
 * @param {ErrorMessage<IsoTimestampIssue<string>>} message - Optional trusted private diagnostic text/callback; rejected values may be included in raw issues.
 * @returns {IsoTimestampAction<string, ErrorMessage<IsoTimestampIssue<string>> | undefined>} Structured refinement retaining its requirement/message policy; use an explicit schema/pipe to validate input first.
 */
// @__NO_SIDE_EFFECTS__
export function isoTimestamp(
  message?: ErrorMessage<IsoTimestampIssue<string>>
): IsoTimestampAction<
  string,
  ErrorMessage<IsoTimestampIssue<string>> | undefined
> {
  return {
    kind: 'validation',
    type: 'iso_timestamp',
    reference: isoTimestamp,
    async: false,
    expects: null,
    requirement: ISO_TIMESTAMP_REGEX,
    message,
    /** Check retained timestamp/date/offset syntax and fractional-second width; no calendar validation or time conversion occurs. Untyped datasets are left for the owning schema to reject.
     * @param {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} dataset - Private current dataset; input type admission belongs to the preceding schema.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private diagnostic policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, BaseIssue<unknown>>} Same dataset with a private issue on ordinary mismatch; native exceptions propagate without mutation replay.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !this.requirement.test(dataset.value)) {
        _addIssue(this, 'timestamp', dataset, config);
      }
      return dataset;
    },
  };
}
