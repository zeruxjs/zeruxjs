import type { BaseValidation, ErrorMessage } from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type { ArrayInput, ArrayRequirement } from './types.js';
import type { CheckItemsIssue } from './types/checkItems.js';

/**
 * Check items action interface.
 */
export interface CheckItemsAction<
  TInput extends ArrayInput,
  TMessage extends ErrorMessage<CheckItemsIssue<TInput>> | undefined,
> extends BaseValidation<TInput, TInput, CheckItemsIssue<TInput>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'check_items';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof checkItems;
  /**
   * Private diagnostic expectation; not escaped client feedback.
   */
  readonly expects: null;
  /**
   * The validation function.
   */
  readonly requirement: ArrayRequirement<TInput>;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Visit every array position with the retained synchronous callback contract, collecting item issues in order; callbacks are not awaited. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {ArrayRequirement<TInput>} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @returns {CheckItemsAction<TInput, undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function checkItems<TInput extends ArrayInput>(
  requirement: ArrayRequirement<TInput>
): CheckItemsAction<TInput, undefined>;

/** Visit every array position with the retained synchronous callback contract, collecting item issues in order; callbacks are not awaited. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {ArrayRequirement<TInput>} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {CheckItemsAction<TInput, TMessage>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function checkItems<
  TInput extends ArrayInput,
  const TMessage extends ErrorMessage<CheckItemsIssue<TInput>> | undefined,
>(
  requirement: ArrayRequirement<TInput>,
  message: TMessage
): CheckItemsAction<TInput, TMessage>;

/** Visit every array position with the retained synchronous callback contract, collecting item issues in order; callbacks are not awaited. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {ArrayRequirement<unknown[]>} requirement - Borrowed explicitly registered predicate; only async variants await results and no source string is evaluated.
 * @param {ErrorMessage<CheckItemsIssue<unknown[]>>} message - Optional trusted private diagnostic text/callback; raw issues retain rejected values.
 * @returns {CheckItemsAction<unknown[], ErrorMessage<CheckItemsIssue<unknown[]>> | undefined>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function checkItems(
  requirement: ArrayRequirement<unknown[]>,
  message?: ErrorMessage<CheckItemsIssue<unknown[]>>
): CheckItemsAction<
  unknown[],
  ErrorMessage<CheckItemsIssue<unknown[]>> | undefined
> {
  return {
    kind: 'validation',
    type: 'check_items',
    reference: checkItems,
    async: false,
    expects: null,
    requirement,
    message,
    /** Visit every array position with the retained synchronous callback contract, collecting item issues in order; callbacks are not awaited. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      if (dataset.typed) {
        for (let index = 0; index < dataset.value.length; index++) {
          /** Original private item at this array index; issue paths retain this value until explicitly sanitized. */
          const item = dataset.value[index];
          if (!this.requirement(item, index, dataset.value)) {
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
