import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';

/**
 * Date issue interface.
 */
export interface DateIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue category; raw objects and messages remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable native-object discriminator for structured issue codes.
   */
  readonly type: 'date';
  /**
   * Fixed private diagnostic expectation, not a content, URL or authorization policy.
   */
  readonly expected: 'Date';
}

/**
 * Date schema interface.
 */
export interface DateSchema<
  TMessage extends ErrorMessage<DateIssue> | undefined,
> extends BaseSchema<Date, Date, DateIssue> {
  /**
   * Fixed date discriminator; accepted objects retain borrowed identity.
   */
  readonly type: 'date';
  /**
   * Authored constructor reference; no native object is created on import.
   */
  readonly reference: typeof date;
  /**
   * Fixed private diagnostic expectation, not a content, URL or authorization policy.
   */
  readonly expects: 'Date';
  /**
   * Optional borrowed trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/**
 * Validate Date instances passing the existing numeric NaN check; custom object coercion remains trusted host behavior. The required runtime class is accessed only during explicit validation.
 *
 * @returns {DateSchema<undefined>} Inert native-object schema; no content read, cloning or ownership transfer.
 */
export function date(): DateSchema<undefined>;

/**
 * Validate Date instances passing the existing numeric NaN check; custom object coercion remains trusted host behavior. The required runtime class is accessed only during explicit validation.
 *
 * @param {TMessage} message - Optional trusted private diagnostic policy.
 *
 * @returns {DateSchema<TMessage>} Inert schema retaining the supplied private diagnostic policy.
 */
export function date<
  const TMessage extends ErrorMessage<DateIssue> | undefined,
>(message: TMessage): DateSchema<TMessage>;

/** Build an explicit runtime-class check without creating, reading or storing binary/date objects.
 * @param {ErrorMessage<DateIssue>} message - Optional trusted private diagnostic text/callback.
 * @returns {DateSchema<ErrorMessage<DateIssue> | undefined>} Inert schema validating Date instances passing the existing numeric NaN check; custom object coercion remains trusted host behavior.
 */
// @__NO_SIDE_EFFECTS__
export function date(
  message?: ErrorMessage<DateIssue>
): DateSchema<ErrorMessage<DateIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'date',
    reference: date,
    expects: 'Date',
    async: false,
    message,
    /** Adapt explicit validation to shared root budgets and cleanup.
     * @returns {object} Inert Standard Schema V1 adapter; no DOM access occurs merely on import.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Perform the declared native-object check while preserving caller-owned identity.
     * @param {import('../types/index.js').UnknownDataset} dataset - Current private candidate object.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Root issue budget and private message policy.
     * @returns {OutputDataset<Date, DateIssue>} Declared native-object dataset; host still owns content validation and lifetime.
     */
    '~run'(dataset, config) {
      if (dataset.value instanceof Date) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        if (!isNaN(dataset.value)) {
          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          dataset.typed = true;
        } else {
          _addIssue(this, 'type', dataset, config, {
            received: '"Invalid Date"',
          });
        }
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<Date, DateIssue>;
    },
  };
}
