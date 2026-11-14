import type { BaseTransformation } from '../types/index.js';
import type { ArrayInput } from './types.js';

/**
 * Array action type.
 */
type ArrayAction<TInput extends ArrayInput, TOutput> = (
  item: TInput[number],
  index: number,
  array: TInput
) => TOutput;

/**
 * Map items action interface.
 */
export interface MapItemsAction<
  TInput extends ArrayInput,
  TOutput,
> extends BaseTransformation<TInput, TOutput[], never> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'map_items';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof mapItems;
  /**
   * The map items operation.
   */
  readonly operation: ArrayAction<TInput, TOutput>;
}

/** Use native synchronous map to create a result array, preserving holes and whatever values the trusted callback returns. Construction captures trusted policy without evaluating candidate data.
 * @param {ArrayAction<TInput, TOutput>} operation - Borrowed trusted synchronous callback; native array semantics apply and arbitrary asynchronous work is not awaited.
 * @returns {MapItemsAction<TInput, TOutput>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function mapItems<TInput extends ArrayInput, TOutput>(
  operation: ArrayAction<TInput, TOutput>
): MapItemsAction<TInput, TOutput>;

/** Use native synchronous map to create a result array, preserving holes and whatever values the trusted callback returns. Construction captures trusted policy without evaluating candidate data.
 * @param {ArrayAction<unknown[], unknown>} operation - Borrowed trusted synchronous callback; native array semantics apply and arbitrary asynchronous work is not awaited.
 * @returns {MapItemsAction<unknown[], unknown>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function mapItems(
  operation: ArrayAction<unknown[], unknown>
): MapItemsAction<unknown[], unknown> {
  return {
    kind: 'transformation',
    type: 'map_items',
    reference: mapItems,
    async: false,
    operation,
    /** Use native synchronous map to create a result array, preserving holes and whatever values the trusted callback returns. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset) {
      dataset.value = dataset.value.map(this.operation);
      return dataset;
    },
  };
}
