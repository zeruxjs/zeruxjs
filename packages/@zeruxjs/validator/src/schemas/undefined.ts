import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';

/**
 * Undefined issue interface.
 */
export interface UndefinedIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue category; raw inputs and messages remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable sentinel/terminal discriminator for structured issue codes.
   */
  readonly type: 'undefined';
  /**
   * Fixed private diagnostic expectation, not a coercion or omission policy.
   */
  readonly expected: 'undefined';
}

/**
 * Undefined schema interface.
 */
export interface UndefinedSchema<
  TMessage extends ErrorMessage<UndefinedIssue> | undefined,
> extends BaseSchema<undefined, undefined, UndefinedIssue> {
  /**
   * Fixed undefined schema discriminator; object presence rules are handled separately.
   */
  readonly type: 'undefined';
  /**
   * Authored base constructor reference, never a user-supplied module path.
   */
  readonly reference: typeof undefined_;
  /**
   * Fixed private diagnostic expectation, not a coercion or omission policy.
   */
  readonly expects: 'undefined';
  /**
   * Optional trusted private diagnostic text/callback retained by reference.
   */
  readonly message: TMessage;
}

/**
 * Validate only an explicit undefined runtime value without coercing null. Root execution still checks budgets before dispatch.
 *
 * @returns {UndefinedSchema<undefined>} Inert schema with default diagnostic policy.
 */
export function undefined_(): UndefinedSchema<undefined>;

/**
 * Validate only an explicit undefined runtime value without coercing null. Root execution still checks budgets before dispatch.
 *
 * @param {TMessage} message - Optional trusted private diagnostic policy.
 *
 * @returns {UndefinedSchema<TMessage>} Inert schema retaining the borrowed trusted message policy.
 */
export function undefined_<
  const TMessage extends ErrorMessage<UndefinedIssue> | undefined,
>(message: TMessage): UndefinedSchema<TMessage>;

/** Build a sentinel/terminal validator without executing any input value.
 * @param {ErrorMessage<UndefinedIssue>} message - Optional private trusted diagnostic text/callback.
 * @returns {UndefinedSchema<ErrorMessage<UndefinedIssue> | undefined>} Inert schema validating only an explicit undefined runtime value without coercing null.
 */
// @__NO_SIDE_EFFECTS__
export function undefined_(
  message?: ErrorMessage<UndefinedIssue>
): UndefinedSchema<ErrorMessage<UndefinedIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'undefined',
    reference: undefined_,
    expects: 'undefined',
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
     * @returns {OutputDataset<undefined, UndefinedIssue>} Declared dataset; raw diagnostics require explicit public redaction.
     */
    '~run'(dataset, config) {
      if (dataset.value === undefined) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<undefined, UndefinedIssue>;
    },
  };
}

export { undefined_ as undefined };
