import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';

/**
 * Void issue interface.
 */
export interface VoidIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue category; raw inputs and messages remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable sentinel/terminal discriminator for structured issue codes.
   */
  readonly type: 'void';
  /**
   * Fixed private diagnostic expectation, not a coercion or omission policy.
   */
  readonly expected: 'void';
}

/**
 * Void schema interface.
 */
export interface VoidSchema<
  TMessage extends ErrorMessage<VoidIssue> | undefined,
> extends BaseSchema<void, void, VoidIssue> {
  /**
   * Fixed void schema discriminator; object presence rules are handled separately.
   */
  readonly type: 'void';
  /**
   * Authored base constructor reference, never a user-supplied module path.
   */
  readonly reference: typeof void_;
  /**
   * Fixed private diagnostic expectation, not a coercion or omission policy.
   */
  readonly expects: 'void';
  /**
   * Optional trusted private diagnostic text/callback retained by reference.
   */
  readonly message: TMessage;
}

/**
 * Validate the undefined runtime value with the declared TypeScript void contract. Root execution still checks budgets before dispatch.
 *
 * @returns {VoidSchema<undefined>} Inert schema with default diagnostic policy.
 */
export function void_(): VoidSchema<undefined>;

/**
 * Validate the undefined runtime value with the declared TypeScript void contract. Root execution still checks budgets before dispatch.
 *
 * @param {TMessage} message - Optional trusted private diagnostic policy.
 *
 * @returns {VoidSchema<TMessage>} Inert schema retaining the borrowed trusted message policy.
 */
export function void_<
  const TMessage extends ErrorMessage<VoidIssue> | undefined,
>(message: TMessage): VoidSchema<TMessage>;

/** Build a sentinel/terminal validator without executing any input value.
 * @param {ErrorMessage<VoidIssue>} message - Optional private trusted diagnostic text/callback.
 * @returns {VoidSchema<ErrorMessage<VoidIssue> | undefined>} Inert schema validating the undefined runtime value with the declared TypeScript void contract.
 */
// @__NO_SIDE_EFFECTS__
export function void_(
  message?: ErrorMessage<VoidIssue>
): VoidSchema<ErrorMessage<VoidIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'void',
    reference: void_,
    expects: 'void',
    async: false,
    message,
    /** Adapt explicit validation to the shared bounded root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Apply this exact sentinel/terminal rule without coercion or permission inference.
     * @param {import('../types/index.js').UnknownDataset} dataset - Current private input dataset.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Root issue budget and private message policy.
     * @returns {OutputDataset<void, VoidIssue>} Declared dataset; raw diagnostics require explicit public redaction.
     */
    '~run'(dataset, config) {
      if (dataset.value === undefined) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<void, VoidIssue>;
    },
  };
}

export { void_ as void };
