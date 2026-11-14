import type { BaseTransformation } from '../types/index.js';
import type { ArrayInput } from './types.js';

/**
 * Array action type.
 */
type ArrayAction<TInput extends ArrayInput> = (
  itemA: TInput[number],
  itemB: TInput[number]
) => number;

/**
 * Sort items action interface.
 */
export interface SortItemsAction<
  TInput extends ArrayInput,
> extends BaseTransformation<TInput, TInput, never> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'sort_items';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof sortItems;
  /**
   * The sort items operation.
   */
  readonly operation: ArrayAction<TInput> | undefined;
}

/** Sort the existing array in place with an optional native comparator; omission uses native string ordering, not numeric order. Construction captures trusted policy without evaluating candidate data.
 * @param {ArrayAction<TInput>} operation - Borrowed trusted synchronous callback; native array semantics apply and arbitrary asynchronous work is not awaited.
 * @returns {SortItemsAction<TInput>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function sortItems<TInput extends ArrayInput>(
  operation?: ArrayAction<TInput>
): SortItemsAction<TInput>;

/** Sort the existing array in place with an optional native comparator; omission uses native string ordering, not numeric order. Construction captures trusted policy without evaluating candidate data.
 * @param {ArrayAction<unknown[]>} operation - Borrowed trusted synchronous callback; native array semantics apply and arbitrary asynchronous work is not awaited.
 * @returns {SortItemsAction<unknown[]>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function sortItems(
  operation?: ArrayAction<unknown[]>
): SortItemsAction<unknown[]> {
  return {
    kind: 'transformation',
    type: 'sort_items',
    reference: sortItems,
    async: false,
    operation,
    /** Sort the existing array in place with an optional native comparator; omission uses native string ordering, not numeric order. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset) {
      dataset.value = dataset.value.sort(this.operation);
      return dataset;
    },
  };
}
