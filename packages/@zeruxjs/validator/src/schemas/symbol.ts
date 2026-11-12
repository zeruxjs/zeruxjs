import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';

/**
 * Symbol issue interface.
 */
export interface SymbolIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue category; rejected values/messages remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable native-value type discriminator for structured issue codes.
   */
  readonly type: 'symbol';
  /**
   * Fixed private diagnostic expectation; no input coercion or serialization policy.
   */
  readonly expected: 'symbol';
}

/**
 * Symbol schema interface.
 */
export interface SymbolSchema<
  TMessage extends ErrorMessage<SymbolIssue> | undefined,
> extends BaseSchema<symbol, symbol, SymbolIssue> {
  /**
   * Fixed symbol schema discriminator; native input identity is not cloned.
   */
  readonly type: 'symbol';
  /**
   * Authored base constructor reference, not a user-supplied module or callback path.
   */
  readonly reference: typeof symbol;
  /**
   * Fixed private diagnostic expectation; no input coercion or serialization policy.
   */
  readonly expects: 'symbol';
  /**
   * Optional borrowed trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/**
 * Validate native symbol values while preserving their borrowed identity. Root execution still bounds the input graph; construction is inert.
 *
 * @returns {SymbolSchema<undefined>} Inert native-value validator using the default issue policy.
 */
export function symbol(): SymbolSchema<undefined>;

/**
 * Validate native symbol values while preserving their borrowed identity. Root execution still bounds the input graph; construction is inert.
 *
 * @param {TMessage} message - Optional trusted private diagnostic policy; not untrusted executable text.
 *
 * @returns {SymbolSchema<TMessage>} Inert schema retaining the borrowed diagnostic policy.
 */
export function symbol<
  const TMessage extends ErrorMessage<SymbolIssue> | undefined,
>(message: TMessage): SymbolSchema<TMessage>;

/** Build a native-value type validator without parsing, scheduling or executing input values.
 * @param {ErrorMessage<SymbolIssue>} message - Optional trusted private diagnostic text/callback.
 * @returns {SymbolSchema<ErrorMessage<SymbolIssue> | undefined>} Inert schema for native symbol values while preserving their borrowed identity.
 */
// @__NO_SIDE_EFFECTS__
export function symbol(
  message?: ErrorMessage<SymbolIssue>
): SymbolSchema<ErrorMessage<SymbolIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'symbol',
    reference: symbol,
    expects: 'symbol',
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
     * @returns {OutputDataset<symbol, SymbolIssue>} Native-value dataset; raw issues require explicit public redaction.
     */
    '~run'(dataset, config) {
      if (typeof dataset.value === 'symbol') {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<symbol, SymbolIssue>;
    },
  };
}
