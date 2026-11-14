import { syncCallback } from '../utils/_run.js';
import type { BaseValidation, ErrorMessage } from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { CheckIssue } from './types/check.js';

/**
 * Check action interface.
 */
export interface CheckAction<
  TInput,
  TMessage extends ErrorMessage<CheckIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, CheckIssue<TInput>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'check';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof check;
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The validation function.
   */
  readonly requirement: (input: TInput) => boolean;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Run an explicit trusted synchronous refinement through syncCallback, rejecting native async callbacks and returned thenables. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {(input: TInput) => boolean} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @returns {CheckAction<TInput, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function check<TInput>(
  requirement: (input: TInput) => boolean
): CheckAction<TInput, undefined>;

/** Run an explicit trusted synchronous refinement through syncCallback, rejecting native async callbacks and returned thenables. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {(input: TInput) => boolean} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {CheckAction<TInput, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function check<
  TInput,
  const TMessage extends ErrorMessage<CheckIssue<TInput>> | undefined,
>(
  requirement: (input: TInput) => boolean,
  message: TMessage
): CheckAction<TInput, TMessage>;

/** Run an explicit trusted synchronous refinement through syncCallback, rejecting native async callbacks and returned thenables. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {(input: unknown) => boolean} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @param {ErrorMessage<CheckIssue<unknown>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {CheckAction<unknown, ErrorMessage<CheckIssue<unknown>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function check(
  requirement: (input: unknown) => boolean,
  message?: ErrorMessage<CheckIssue<unknown>>
): CheckAction<unknown, ErrorMessage<CheckIssue<unknown>> | undefined> {
  return {
    kind: 'validation',
    type: 'check',
    reference: check,
    async: false,
    expects: null,
    requirement,
    message,
    /** Run an explicit trusted synchronous refinement through syncCallback, rejecting native async callbacks and returned thenables. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      if (dataset.typed && !syncCallback(this.requirement, dataset.value)) {
        _addIssue(this, 'input', dataset, config);
      }
      return dataset;
    },
  };
}
