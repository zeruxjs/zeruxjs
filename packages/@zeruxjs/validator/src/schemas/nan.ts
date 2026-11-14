import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';

/**
 * NaN issue interface.
 */
export interface NanIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue category; rejected values/messages remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable native-value type discriminator for structured issue codes.
   */
  readonly type: 'nan';
  /**
   * Fixed private diagnostic expectation; no input coercion or serialization policy.
   */
  readonly expected: 'NaN';
}

/**
 * NaN schema interface.
 */
export interface NanSchema<
  TMessage extends ErrorMessage<NanIssue> | undefined,
> extends BaseSchema<number, number, NanIssue> {
  /**
   * Fixed nan schema discriminator; native input identity is not cloned.
   */
  readonly type: 'nan';
  /**
   * Authored base constructor reference, not a user-supplied module or callback path.
   */
  readonly reference: typeof nan;
  /**
   * Fixed private diagnostic expectation; no input coercion or serialization policy.
   */
  readonly expects: 'NaN';
  /**
   * Optional borrowed trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/**
 * Validate only values accepted by Number.isNaN, without coercing strings. Root execution still bounds the input graph; construction is inert.
 *
 * @returns {NanSchema<undefined>} Inert native-value validator using the default issue policy.
 */
export function nan(): NanSchema<undefined>;

/**
 * Validate only values accepted by Number.isNaN, without coercing strings. Root execution still bounds the input graph; construction is inert.
 *
 * @param {TMessage} message - Optional trusted private diagnostic policy; not untrusted executable text.
 *
 * @returns {NanSchema<TMessage>} Inert schema retaining the borrowed diagnostic policy.
 */
export function nan<const TMessage extends ErrorMessage<NanIssue> | undefined>(
  message: TMessage
): NanSchema<TMessage>;

/** Build a native-value type validator without parsing, scheduling or executing input values.
 * @param {ErrorMessage<NanIssue>} message - Optional trusted private diagnostic text/callback.
 * @returns {NanSchema<ErrorMessage<NanIssue> | undefined>} Inert schema for only values accepted by Number.isNaN, without coercing strings.
 */
// @__NO_SIDE_EFFECTS__
export function nan(
  message?: ErrorMessage<NanIssue>
): NanSchema<ErrorMessage<NanIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'nan',
    reference: nan,
    expects: 'NaN',
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
     * @returns {OutputDataset<number, NanIssue>} Native-value dataset; raw issues require explicit public redaction.
     */
    '~run'(dataset, config) {
      if (Number.isNaN(dataset.value)) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<number, NanIssue>;
    },
  };
}
