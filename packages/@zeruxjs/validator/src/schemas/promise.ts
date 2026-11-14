import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';

/**
 * Promise issue interface.
 */
export interface PromiseIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue category; rejected values/messages remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable native-value type discriminator for structured issue codes.
   */
  readonly type: 'promise';
  /**
   * Fixed private diagnostic expectation; no input coercion or serialization policy.
   */
  readonly expected: 'Promise';
}

/**
 * Promise schema interface.
 */
export interface PromiseSchema<
  TMessage extends ErrorMessage<PromiseIssue> | undefined,
> extends BaseSchema<Promise<unknown>, Promise<unknown>, PromiseIssue> {
  /**
   * Fixed promise schema discriminator; native input identity is not cloned.
   */
  readonly type: 'promise';
  /**
   * Authored base constructor reference, not a user-supplied module or callback path.
   */
  readonly reference: typeof promise;
  /**
   * Fixed private diagnostic expectation; no input coercion or serialization policy.
   */
  readonly expects: 'Promise';
  /**
   * Optional borrowed trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/**
 * Validate native Promise instances without awaiting, unwrapping or taking ownership of their settlement. Root execution still bounds the input graph; construction is inert.
 *
 * @returns {PromiseSchema<undefined>} Inert native-value validator using the default issue policy.
 */
export function promise(): PromiseSchema<undefined>;

/**
 * Validate native Promise instances without awaiting, unwrapping or taking ownership of their settlement. Root execution still bounds the input graph; construction is inert.
 *
 * @param {TMessage} message - Optional trusted private diagnostic policy; not untrusted executable text.
 *
 * @returns {PromiseSchema<TMessage>} Inert schema retaining the borrowed diagnostic policy.
 */
export function promise<
  const TMessage extends ErrorMessage<PromiseIssue> | undefined,
>(message: TMessage): PromiseSchema<TMessage>;

/** Build a native-value type validator without parsing, scheduling or executing input values.
 * @param {ErrorMessage<PromiseIssue>} message - Optional trusted private diagnostic text/callback.
 * @returns {PromiseSchema<ErrorMessage<PromiseIssue> | undefined>} Inert schema for native Promise instances without awaiting, unwrapping or taking ownership of their settlement.
 */
// @__NO_SIDE_EFFECTS__
export function promise(
  message?: ErrorMessage<PromiseIssue>
): PromiseSchema<ErrorMessage<PromiseIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'promise',
    reference: promise,
    expects: 'Promise',
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
     * @returns {OutputDataset<Promise<unknown>, PromiseIssue>} Native-value dataset; raw issues require explicit public redaction.
     */
    '~run'(dataset, config) {
      if (dataset.value instanceof Promise) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<Promise<unknown>, PromiseIssue>;
    },
  };
}
