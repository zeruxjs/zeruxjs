import type { BaseTransformation, SuccessDataset } from '../types/index.js';
import type { ArrayInput } from './types.js';

/**
 * Array requirement type.
 */
type ArrayRequirement<
  TInput extends ArrayInput,
  TOuput extends TInput[number],
> =
  | ((item: TInput[number], index: number, array: TInput) => item is TOuput)
  | ((item: TInput[number], index: number, array: TInput) => boolean);

/**
 * Find item action interface.
 */
export interface FindItemAction<
  TInput extends ArrayInput,
  TOuput extends TInput[number],
> extends BaseTransformation<TInput, TOuput | undefined, never> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'find_item';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof findItem;
  /**
   * The find item operation.
   */
  readonly operation: ArrayRequirement<TInput, TOuput>;
}

/** Use native synchronous find, returning the borrowed first matching item or undefined; sparse holes follow native find semantics. Construction captures trusted policy without evaluating candidate data.
 * @param {ArrayRequirement<TInput, TOuput>} operation - Borrowed trusted synchronous callback; native array semantics apply and arbitrary asynchronous work is not awaited.
 * @returns {FindItemAction<TInput, TOuput>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function findItem<
  TInput extends ArrayInput,
  TOuput extends TInput[number],
>(operation: ArrayRequirement<TInput, TOuput>): FindItemAction<TInput, TOuput>;

/** Use native synchronous find, returning the borrowed first matching item or undefined; sparse holes follow native find semantics. Construction captures trusted policy without evaluating candidate data.
 * @param {ArrayRequirement<unknown[], unknown>} operation - Borrowed trusted synchronous callback; native array semantics apply and arbitrary asynchronous work is not awaited.
 * @returns {FindItemAction<unknown[], unknown>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function findItem(
  operation: ArrayRequirement<unknown[], unknown>
): FindItemAction<unknown[], unknown> {
  return {
    kind: 'transformation',
    type: 'find_item',
    reference: findItem,
    async: false,
    operation,
    /** Use native synchronous find, returning the borrowed first matching item or undefined; sparse holes follow native find semantics. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset) {
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      dataset.value = dataset.value.find(this.operation);
      return dataset as SuccessDataset<unknown | undefined>;
    },
  };
}
