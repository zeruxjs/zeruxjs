import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';

/**
 * Null issue interface.
 */
export interface NullIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue category; raw inputs and messages remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable sentinel/terminal discriminator for structured issue codes.
   */
  readonly type: 'null';
  /**
   * Fixed private diagnostic expectation, not a coercion or omission policy.
   */
  readonly expected: 'null';
}

/**
 * Null schema interface.
 */
export interface NullSchema<
  TMessage extends ErrorMessage<NullIssue> | undefined,
> extends BaseSchema<null, null, NullIssue> {
  /**
   * Fixed null schema discriminator; object presence rules are handled separately.
   */
  readonly type: 'null';
  /**
   * Authored base constructor reference, never a user-supplied module path.
   */
  readonly reference: typeof null_;
  /**
   * Fixed private diagnostic expectation, not a coercion or omission policy.
   */
  readonly expects: 'null';
  /**
   * Optional trusted private diagnostic text/callback retained by reference.
   */
  readonly message: TMessage;
}

/**
 * Validate only the null value without treating absence/undefined as equivalent. Root execution still checks budgets before dispatch.
 *
 * @returns {NullSchema<undefined>} Inert schema with default diagnostic policy.
 */
export function null_(): NullSchema<undefined>;

/**
 * Validate only the null value without treating absence/undefined as equivalent. Root execution still checks budgets before dispatch.
 *
 * @param {TMessage} message - Optional trusted private diagnostic policy.
 *
 * @returns {NullSchema<TMessage>} Inert schema retaining the borrowed trusted message policy.
 */
export function null_<
  const TMessage extends ErrorMessage<NullIssue> | undefined,
>(message: TMessage): NullSchema<TMessage>;

/** Build a sentinel/terminal validator without executing any input value.
 * @param {ErrorMessage<NullIssue>} message - Optional private trusted diagnostic text/callback.
 * @returns {NullSchema<ErrorMessage<NullIssue> | undefined>} Inert schema validating only the null value without treating absence/undefined as equivalent.
 */
// @__NO_SIDE_EFFECTS__
export function null_(
  message?: ErrorMessage<NullIssue>
): NullSchema<ErrorMessage<NullIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'null',
    reference: null_,
    expects: 'null',
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
     * @returns {OutputDataset<null, NullIssue>} Declared dataset; raw diagnostics require explicit public redaction.
     */
    '~run'(dataset, config) {
      if (dataset.value === null) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
      } else {
        _addIssue(this, 'type', dataset, config);
      }
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<null, NullIssue>;
    },
  };
}

export { null_ as null };
