import { _asyncCallback } from '../utils/_run.js';
import type { BaseValidationAsync, ErrorMessage } from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { ArrayInput, ArrayRequirementAsync } from './types.js';
import type { CheckItemsIssue } from './types/checkItems.js';

/**
 * Check items action async interface.
 */
export interface CheckItemsActionAsync<
  TInput extends ArrayInput,
  TMessage extends ErrorMessage<CheckItemsIssue<TInput>> | undefined,
> extends BaseValidationAsync<TInput, TInput, CheckItemsIssue<TInput>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'check_items';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof checkItemsAsync;
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The validation function.
   */
  readonly requirement: ArrayRequirementAsync<TInput>;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Schedule mapped item predicates through the shared root limiter and collect results in index order; sparse holes retain legacy missing-result behavior. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {ArrayRequirementAsync<TInput>} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @returns {CheckItemsActionAsync<TInput, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function checkItemsAsync<TInput extends ArrayInput>(
  requirement: ArrayRequirementAsync<TInput>
): CheckItemsActionAsync<TInput, undefined>;

/** Schedule mapped item predicates through the shared root limiter and collect results in index order; sparse holes retain legacy missing-result behavior. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {ArrayRequirementAsync<TInput>} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {CheckItemsActionAsync<TInput, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function checkItemsAsync<
  TInput extends ArrayInput,
  const TMessage extends ErrorMessage<CheckItemsIssue<TInput>> | undefined,
>(
  requirement: ArrayRequirementAsync<TInput>,
  message: TMessage
): CheckItemsActionAsync<TInput, TMessage>;

/** Schedule mapped item predicates through the shared root limiter and collect results in index order; sparse holes retain legacy missing-result behavior. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {ArrayRequirementAsync<unknown[]>} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @param {ErrorMessage<CheckItemsIssue<unknown[]>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {CheckItemsActionAsync<unknown[], ErrorMessage<CheckItemsIssue<unknown[]>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function checkItemsAsync(
  requirement: ArrayRequirementAsync<unknown[]>,
  message?: ErrorMessage<CheckItemsIssue<unknown[]>>
): CheckItemsActionAsync<
  unknown[],
  ErrorMessage<CheckItemsIssue<unknown[]>> | undefined
> {
  return {
    kind: 'validation',
    type: 'check_items',
    reference: checkItemsAsync,
    async: true,
    expects: null,
    requirement,
    message,
    /** Schedule mapped item predicates through the shared root limiter and collect results in index order; sparse holes retain legacy missing-result behavior. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {Promise<import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    async '~run'(dataset, config) {
      if (dataset.typed) {
        /** Mapped predicate results under the shared root scheduler; issue accumulation uses the original index order. */
        const requirementResults = await Promise.all(
          dataset.value.map((value, index, array) =>
            _asyncCallback(config, () =>
              this.requirement(value, index, array, { signal: config.signal })
            )
          )
        );
        for (let index = 0; index < dataset.value.length; index++) {
          if (!requirementResults[index]) {
            /** Original private item at this array index; issue paths retain this value until explicitly sanitized. */
            const item = dataset.value[index];
            _addIssue(this, 'item', dataset, config, {
              input: item,
              path: [
                {
                  type: 'array',
                  origin: 'value',
                  input: dataset.value,
                  key: index,
                  value: item,
                },
              ],
            });
          }
        }
      }
      return dataset;
    },
  };
}
