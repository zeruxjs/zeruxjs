import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';

/**
 * Function issue interface.
 */
export interface FunctionIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue category; rejected values/messages remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable native-value type discriminator for structured issue codes.
   */
  readonly type: 'function';
  /**
   * Fixed private diagnostic expectation; no input coercion or serialization policy.
   */
  readonly expected: 'Function';
}

/**
 * Function schema interface.
 */
export interface FunctionSchema<
  TMessage extends ErrorMessage<FunctionIssue> | undefined,
> extends BaseSchema<
  (...args: unknown[]) => unknown,
  (...args: unknown[]) => unknown,
  FunctionIssue
> {
  /**
   * Fixed function schema discriminator; native input identity is not cloned.
   */
  readonly type: 'function';
  /**
   * Authored base constructor reference, not a user-supplied module or callback path.
   */
  readonly reference: typeof function_;
  /**
   * Fixed private diagnostic expectation; no input coercion or serialization policy.
   */
  readonly expects: 'Function';
  /**
   * Optional borrowed trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/**
 * Validate function values as borrowed data without invoking them or evaluating source strings. Root execution still bounds the input graph; construction is inert.
 *
 * @returns {FunctionSchema<undefined>} Inert native-value validator using the default issue policy.
 */
export function function_(): FunctionSchema<undefined>;

/**
 * Validate function values as borrowed data without invoking them or evaluating source strings. Root execution still bounds the input graph; construction is inert.
 *
 * @param {TMessage} message - Optional trusted private diagnostic policy; not untrusted executable text.
 *
 * @returns {FunctionSchema<TMessage>} Inert schema retaining the borrowed diagnostic policy.
 */
export function function_<
  const TMessage extends ErrorMessage<FunctionIssue> | undefined,
>(message: TMessage): FunctionSchema<TMessage>;

/** Build a native-value type validator without parsing, scheduling or executing input values.
 * @param {ErrorMessage<FunctionIssue>} message - Optional trusted private diagnostic text/callback.
 * @returns {FunctionSchema<ErrorMessage<FunctionIssue> | undefined>} Inert schema for function values as borrowed data without invoking them or evaluating source strings.
 */
// @__NO_SIDE_EFFECTS__
export function function_(
  message?: ErrorMessage<FunctionIssue>
): FunctionSchema<ErrorMessage<FunctionIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'function',
    reference: function_,
    expects: 'Function',
    async: false,
    message,
    /** Adapt explicit validation to the same bounded root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Apply only this native type predicate; accepted functions/promises remain host-owned values.
     * @param {import('../types/index.js').UnknownDataset} dataset - Current private candidate input.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root issue budget/private message policy.
     * @returns {OutputDataset<(...args: unknown[]) => unknown, FunctionIssue>} Native-value dataset; raw issues require explicit public redaction.
     */
    '~run'(dataset, config) {
      if (typeof dataset.value === 'function') {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<
        (...args: unknown[]) => unknown,
        FunctionIssue
      >;
    },
  };
}

export { function_ as function };
