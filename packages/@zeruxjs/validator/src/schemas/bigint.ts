import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';

/**
 * Bigint issue interface.
 */
export interface BigintIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue category; rejected values/messages remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable native-value type discriminator for structured issue codes.
   */
  readonly type: 'bigint';
  /**
   * Fixed private diagnostic expectation; no input coercion or serialization policy.
   */
  readonly expected: 'bigint';
}

/**
 * Bigint schema interface.
 */
export interface BigintSchema<
  TMessage extends ErrorMessage<BigintIssue> | undefined,
> extends BaseSchema<bigint, bigint, BigintIssue> {
  /**
   * Fixed bigint schema discriminator; native input identity is not cloned.
   */
  readonly type: 'bigint';
  /**
   * Authored base constructor reference, not a user-supplied module or callback path.
   */
  readonly reference: typeof bigint;
  /**
   * Fixed private diagnostic expectation; no input coercion or serialization policy.
   */
  readonly expects: 'bigint';
  /**
   * Optional borrowed trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/**
 * Validate native bigint values without numeric/string coercion or JSON serialization. Root execution still bounds the input graph; construction is inert.
 *
 * @returns {BigintSchema<undefined>} Inert native-value validator using the default issue policy.
 */
export function bigint(): BigintSchema<undefined>;

/**
 * Validate native bigint values without numeric/string coercion or JSON serialization. Root execution still bounds the input graph; construction is inert.
 *
 * @param {TMessage} message - Optional trusted private diagnostic policy; not untrusted executable text.
 *
 * @returns {BigintSchema<TMessage>} Inert schema retaining the borrowed diagnostic policy.
 */
export function bigint<
  const TMessage extends ErrorMessage<BigintIssue> | undefined,
>(message: TMessage): BigintSchema<TMessage>;

/** Build a native-value type validator without parsing, scheduling or executing input values.
 * @param {ErrorMessage<BigintIssue>} message - Optional trusted private diagnostic text/callback.
 * @returns {BigintSchema<ErrorMessage<BigintIssue> | undefined>} Inert schema for native bigint values without numeric/string coercion or JSON serialization.
 */
// @__NO_SIDE_EFFECTS__
export function bigint(
  message?: ErrorMessage<BigintIssue>
): BigintSchema<ErrorMessage<BigintIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'bigint',
    reference: bigint,
    expects: 'bigint',
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
     * @returns {OutputDataset<bigint, BigintIssue>} Native-value dataset; raw issues require explicit public redaction.
     */
    '~run'(dataset, config) {
      if (typeof dataset.value === 'bigint') {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<bigint, BigintIssue>;
    },
  };
}
