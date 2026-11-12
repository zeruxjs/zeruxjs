import type { ValidationContext } from '../types/runtime.js';
import type {
  BaseValidationAsync,
  ErrorMessage,
  MaybePromise,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { CheckIssue } from './types/check.js';

/**
 * Check action async interface.
 */
export interface CheckActionAsync<
  TInput,
  TMessage extends ErrorMessage<CheckIssue<TInput>> | undefined,
> extends BaseValidationAsync<TInput, TInput, CheckIssue<TInput>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'check';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof checkAsync;
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The validation function.
   */
  readonly requirement: (
    input: TInput,
    context: ValidationContext
  ) => MaybePromise<boolean>;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Await an explicit trusted refinement with the root cooperative signal; operational rejection is not an ordinary false result. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {(input: TInput, context: ValidationContext) => MaybePromise<boolean>} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @returns {CheckActionAsync<TInput, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function checkAsync<TInput>(
  requirement: (
    input: TInput,
    context: ValidationContext
  ) => MaybePromise<boolean>
): CheckActionAsync<TInput, undefined>;

/** Await an explicit trusted refinement with the root cooperative signal; operational rejection is not an ordinary false result. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {(input: TInput, context: ValidationContext) => MaybePromise<boolean>} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {CheckActionAsync<TInput, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function checkAsync<
  TInput,
  const TMessage extends ErrorMessage<CheckIssue<TInput>> | undefined,
>(
  requirement: (
    input: TInput,
    context: ValidationContext
  ) => MaybePromise<boolean>,
  message: TMessage
): CheckActionAsync<TInput, TMessage>;

/** Await an explicit trusted refinement with the root cooperative signal; operational rejection is not an ordinary false result. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {(input: unknown, context: ValidationContext) => MaybePromise<boolean>} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @param {ErrorMessage<CheckIssue<unknown>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {CheckActionAsync<unknown, ErrorMessage<CheckIssue<unknown>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function checkAsync(
  requirement: (
    input: unknown,
    context: ValidationContext
  ) => MaybePromise<boolean>,
  message?: ErrorMessage<CheckIssue<unknown>>
): CheckActionAsync<unknown, ErrorMessage<CheckIssue<unknown>> | undefined> {
  return {
    kind: 'validation',
    type: 'check',
    reference: checkAsync,
    async: true,
    expects: null,
    requirement,
    message,
    /** Await an explicit trusted refinement with the root cooperative signal; operational rejection is not an ordinary false result. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {Promise<import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    async '~run'(dataset, config) {
      if (
        dataset.typed &&
        !(await this.requirement(dataset.value, { signal: config.signal }))
      ) {
        _addIssue(this, 'input', dataset, config);
      }
      return dataset;
    },
  };
}
