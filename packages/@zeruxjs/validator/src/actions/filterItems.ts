import type { BaseTransformation } from '../types/index.js';
import type { ArrayInput, ArrayRequirement } from './types.js';

/**
 * Filter items action interface.
 */
export interface FilterItemsAction<
  TInput extends ArrayInput,
> extends BaseTransformation<TInput, TInput, never> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'filter_items';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof filterItems;
  /**
   * The filter items operation.
   */
  readonly operation: ArrayRequirement<TInput>;
}

/** Use native synchronous filter to create a shallow result array; callbacks are trusted and are not awaited. Construction captures trusted policy without evaluating candidate data.
 * @param {ArrayRequirement<TInput>} operation - Borrowed trusted synchronous callback; native array semantics apply and arbitrary asynchronous work is not awaited.
 * @returns {FilterItemsAction<TInput>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function filterItems<TInput extends ArrayInput>(
  operation: ArrayRequirement<TInput>
): FilterItemsAction<TInput>;

/** Use native synchronous filter to create a shallow result array; callbacks are trusted and are not awaited. Construction captures trusted policy without evaluating candidate data.
 * @param {ArrayRequirement<unknown[]>} operation - Borrowed trusted synchronous callback; native array semantics apply and arbitrary asynchronous work is not awaited.
 * @returns {FilterItemsAction<unknown[]>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function filterItems(
  operation: ArrayRequirement<unknown[]>
): FilterItemsAction<unknown[]> {
  return {
    kind: 'transformation',
    type: 'filter_items',
    reference: filterItems,
    async: false,
    operation,
    /** Use native synchronous filter to create a shallow result array; callbacks are trusted and are not awaited. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset) {
      dataset.value = dataset.value.filter(this.operation);
      return dataset;
    },
  };
}
