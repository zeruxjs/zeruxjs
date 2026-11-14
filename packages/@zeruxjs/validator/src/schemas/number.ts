import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';

/**
 * Number issue interface.
 */
export interface NumberIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue kind; raw rejected input/messages remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable primitive-type discriminator for structured issue codes.
   */
  readonly type: 'number';
  /**
   * Fixed private diagnostic expectation, not a coercion or escaping rule.
   */
  readonly expected: 'number';
}

/**
 * Number schema interface.
 */
export interface NumberSchema<
  TMessage extends ErrorMessage<NumberIssue> | undefined,
> extends BaseSchema<number, number, NumberIssue> {
  /**
   * Fixed number discriminator used by metadata and issue generation.
   */
  readonly type: 'number';
  /**
   * Authored base constructor reference; public compatibility aliases may add explicit action-array shorthand.
   */
  readonly reference: typeof number;
  /**
   * Fixed private diagnostic expectation, not a coercion or escaping rule.
   */
  readonly expects: 'number';
  /**
   * Borrowed trusted diagnostic text/callback, not untrusted source code or sanitized HTML.
   */
  readonly message: TMessage;
}

/**
 * Validate native numbers excluding NaN; Infinity is permitted unless an explicit finite action rejects it. Construction is inert; root execution owns budgets and cancellation.
 *
 * @returns {NumberSchema<undefined>} Inert primitive schema with the default private issue policy.
 */
export function number(): NumberSchema<undefined>;

/**
 * Validate native numbers excluding NaN; Infinity is permitted unless an explicit finite action rejects it. Construction is inert; root execution owns budgets and cancellation.
 *
 * @param {TMessage} message - Optional trusted private diagnostic text or issue callback.
 *
 * @returns {NumberSchema<TMessage>} Inert primitive schema retaining the supplied diagnostic policy.
 */
export function number<
  const TMessage extends ErrorMessage<NumberIssue> | undefined,
>(message: TMessage): NumberSchema<TMessage>;

/** Build a primitive type validator without parsing or executing message callbacks.
 * @param {ErrorMessage<NumberIssue>} message - Optional trusted private diagnostic policy.
 * @returns {NumberSchema<ErrorMessage<NumberIssue> | undefined>} Inert schema for native numbers excluding NaN; Infinity is permitted unless an explicit finite action rejects it.
 */
// @__NO_SIDE_EFFECTS__
export function number(
  message?: ErrorMessage<NumberIssue>
): NumberSchema<ErrorMessage<NumberIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'number',
    reference: number,
    expects: 'number',
    async: false,
    message,
    /** Adapt explicit validation to the same bounded root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Check the native input type without coercion, then retain a private structured issue on mismatch.
     * @param {import('../types/index.js').UnknownDataset} dataset - Current private candidate input.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Root budgets and private message policy.
     * @returns {OutputDataset<number, NumberIssue>} Declared primitive dataset; raw issues require explicit public sanitization.
     */
    '~run'(dataset, config) {
      if (typeof dataset.value === 'number' && !isNaN(dataset.value)) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<number, NumberIssue>;
    },
  };
}
