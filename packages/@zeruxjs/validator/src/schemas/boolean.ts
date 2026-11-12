import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';

/**
 * Boolean issue interface.
 */
export interface BooleanIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue kind; raw rejected input/messages remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable primitive-type discriminator for structured issue codes.
   */
  readonly type: 'boolean';
  /**
   * Fixed private diagnostic expectation, not a coercion or escaping rule.
   */
  readonly expected: 'boolean';
}

/**
 * Boolean schema interface.
 */
export interface BooleanSchema<
  TMessage extends ErrorMessage<BooleanIssue> | undefined,
> extends BaseSchema<boolean, boolean, BooleanIssue> {
  /**
   * Fixed boolean discriminator used by metadata and issue generation.
   */
  readonly type: 'boolean';
  /**
   * Authored base constructor reference; public compatibility aliases may add explicit action-array shorthand.
   */
  readonly reference: typeof boolean;
  /**
   * Fixed private diagnostic expectation, not a coercion or escaping rule.
   */
  readonly expects: 'boolean';
  /**
   * Borrowed trusted diagnostic text/callback, not untrusted source code or sanitized HTML.
   */
  readonly message: TMessage;
}

/**
 * Validate native Boolean values without string/number truthiness coercion. Construction is inert; root execution owns budgets and cancellation.
 *
 * @returns {BooleanSchema<undefined>} Inert primitive schema with the default private issue policy.
 */
export function boolean(): BooleanSchema<undefined>;

/**
 * Validate native Boolean values without string/number truthiness coercion. Construction is inert; root execution owns budgets and cancellation.
 *
 * @param {TMessage} message - Optional trusted private diagnostic text or issue callback.
 *
 * @returns {BooleanSchema<TMessage>} Inert primitive schema retaining the supplied diagnostic policy.
 */
export function boolean<
  const TMessage extends ErrorMessage<BooleanIssue> | undefined,
>(message: TMessage): BooleanSchema<TMessage>;

/** Build a primitive type validator without parsing or executing message callbacks.
 * @param {ErrorMessage<BooleanIssue>} message - Optional trusted private diagnostic policy.
 * @returns {BooleanSchema<ErrorMessage<BooleanIssue> | undefined>} Inert schema for native Boolean values without string/number truthiness coercion.
 */
// @__NO_SIDE_EFFECTS__
export function boolean(
  message?: ErrorMessage<BooleanIssue>
): BooleanSchema<ErrorMessage<BooleanIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'boolean',
    reference: boolean,
    expects: 'boolean',
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
     * @returns {OutputDataset<boolean, BooleanIssue>} Declared primitive dataset; raw issues require explicit public sanitization.
     */
    '~run'(dataset, config) {
      if (typeof dataset.value === 'boolean') {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<boolean, BooleanIssue>;
    },
  };
}
