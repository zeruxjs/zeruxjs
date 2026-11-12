import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';

/**
 * String issue interface.
 */
export interface StringIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue kind; raw rejected input/messages remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable primitive-type discriminator for structured issue codes.
   */
  readonly type: 'string';
  /**
   * Fixed private diagnostic expectation, not a coercion or escaping rule.
   */
  readonly expected: 'string';
}

/**
 * String schema interface.
 */
export interface StringSchema<
  TMessage extends ErrorMessage<StringIssue> | undefined,
> extends BaseSchema<string, string, StringIssue> {
  /**
   * Fixed string discriminator used by metadata and issue generation.
   */
  readonly type: 'string';
  /**
   * Authored base constructor reference; public compatibility aliases may add explicit action-array shorthand.
   */
  readonly reference: typeof string;
  /**
   * Fixed private diagnostic expectation, not a coercion or escaping rule.
   */
  readonly expects: 'string';
  /**
   * Borrowed trusted diagnostic text/callback, not untrusted source code or sanitized HTML.
   */
  readonly message: TMessage;
}

/**
 * Validate native strings without coercion; length bounds require explicit actions or HTTP byte limits. Construction is inert; root execution owns budgets and cancellation.
 *
 * @returns {StringSchema<undefined>} Inert primitive schema with the default private issue policy.
 */
export function string(): StringSchema<undefined>;

/**
 * Validate native strings without coercion; length bounds require explicit actions or HTTP byte limits. Construction is inert; root execution owns budgets and cancellation.
 *
 * @param {TMessage} message - Optional trusted private diagnostic text or issue callback.
 *
 * @returns {StringSchema<TMessage>} Inert primitive schema retaining the supplied diagnostic policy.
 */
export function string<
  const TMessage extends ErrorMessage<StringIssue> | undefined,
>(message: TMessage): StringSchema<TMessage>;

/** Build a primitive type validator without parsing or executing message callbacks.
 * @param {ErrorMessage<StringIssue>} message - Optional trusted private diagnostic policy.
 * @returns {StringSchema<ErrorMessage<StringIssue> | undefined>} Inert schema for native strings without coercion; length bounds require explicit actions or HTTP byte limits.
 */
// @__NO_SIDE_EFFECTS__
export function string(
  message?: ErrorMessage<StringIssue>
): StringSchema<ErrorMessage<StringIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'string',
    reference: string,
    expects: 'string',
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
     * @returns {OutputDataset<string, StringIssue>} Declared primitive dataset; raw issues require explicit public sanitization.
     */
    '~run'(dataset, config) {
      if (typeof dataset.value === 'string') {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<string, StringIssue>;
    },
  };
}
