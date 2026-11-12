import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  FailureDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';

/**
 * Never issue interface.
 */
export interface NeverIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue category; raw inputs and messages remain private.
   */
  readonly kind: 'schema';
  /**
   * Stable sentinel/terminal discriminator for structured issue codes.
   */
  readonly type: 'never';
  /**
   * Fixed private diagnostic expectation, not a coercion or omission policy.
   */
  readonly expected: 'never';
}

/**
 * Never schema interface.
 */
export interface NeverSchema<
  TMessage extends ErrorMessage<NeverIssue> | undefined,
> extends BaseSchema<never, never, NeverIssue> {
  /**
   * Fixed never schema discriminator; object presence rules are handled separately.
   */
  readonly type: 'never';
  /**
   * Authored base constructor reference, never a user-supplied module path.
   */
  readonly reference: typeof never;
  /**
   * Fixed private diagnostic expectation, not a coercion or omission policy.
   */
  readonly expects: 'never';
  /**
   * Optional trusted private diagnostic text/callback retained by reference.
   */
  readonly message: TMessage;
}

/**
 * Validate no runtime value; every reached execution adds a private schema issue. Root execution still checks budgets before dispatch.
 *
 * @returns {NeverSchema<undefined>} Inert schema with default diagnostic policy.
 */
export function never(): NeverSchema<undefined>;

/**
 * Validate no runtime value; every reached execution adds a private schema issue. Root execution still checks budgets before dispatch.
 *
 * @param {TMessage} message - Optional trusted private diagnostic policy.
 *
 * @returns {NeverSchema<TMessage>} Inert schema retaining the borrowed trusted message policy.
 */
export function never<
  const TMessage extends ErrorMessage<NeverIssue> | undefined,
>(message: TMessage): NeverSchema<TMessage>;

/** Build a sentinel/terminal validator without executing any input value.
 * @param {ErrorMessage<NeverIssue>} message - Optional private trusted diagnostic text/callback.
 * @returns {NeverSchema<ErrorMessage<NeverIssue> | undefined>} Inert schema validating no runtime value; every reached execution adds a private schema issue.
 */
// @__NO_SIDE_EFFECTS__
export function never(
  message?: ErrorMessage<NeverIssue>
): NeverSchema<ErrorMessage<NeverIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'never',
    reference: never,
    expects: 'never',
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
     * @returns {FailureDataset<NeverIssue>} Declared dataset; raw diagnostics require explicit public redaction.
     */
    '~run'(dataset, config) {
      _addIssue(this, 'type', dataset, config);
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as FailureDataset<NeverIssue>;
    },
  };
}
