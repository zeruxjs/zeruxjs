import type { BaseTransformation, SuccessDataset } from '../types/index.js';
import type { ArrayInput } from './types.js';

/**
 * Array action type.
 */
type ArrayAction<TInput extends ArrayInput, TOutput> = (
  output: TOutput,
  item: TInput[number],
  index: number,
  array: TInput
) => TOutput;

/**
 * Reduce items action interface.
 */
export interface ReduceItemsAction<
  TInput extends ArrayInput,
  TOutput,
> extends BaseTransformation<TInput, TOutput, never> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'reduce_items';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof reduceItems;
  /**
   * The reduce items operation.
   */
  readonly operation: ArrayAction<TInput, TOutput>;
  /**
   * The initial value.
   */
  readonly initial: TOutput;
}

/** Use native synchronous reduce with the explicit borrowed initial value; callback effects and accumulator mutation remain host-owned. Construction captures trusted policy without evaluating candidate data.
 * @param {ArrayAction<TInput, TOutput>} operation - Borrowed trusted synchronous callback; native array semantics apply and arbitrary asynchronous work is not awaited.
 * @param {TOutput} initial - Explicit borrowed initial accumulator; no defensive cloning or callback sandbox is introduced.
 * @returns {ReduceItemsAction<TInput, TOutput>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function reduceItems<TInput extends ArrayInput, TOutput>(
  operation: ArrayAction<TInput, TOutput>,
  initial: TOutput
): ReduceItemsAction<TInput, TOutput>;

/** Use native synchronous reduce with the explicit borrowed initial value; callback effects and accumulator mutation remain host-owned. Construction captures trusted policy without evaluating candidate data.
 * @param {ArrayAction<unknown[], unknown>} operation - Borrowed trusted synchronous callback; native array semantics apply and arbitrary asynchronous work is not awaited.
 * @param {unknown} initial - Explicit borrowed initial accumulator; no defensive cloning or callback sandbox is introduced.
 * @returns {ReduceItemsAction<unknown[], unknown>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function reduceItems(
  operation: ArrayAction<unknown[], unknown>,
  initial: unknown
): ReduceItemsAction<unknown[], unknown> {
  return {
    kind: 'transformation',
    type: 'reduce_items',
    reference: reduceItems,
    async: false,
    operation,
    initial,
    /** Use native synchronous reduce with the explicit borrowed initial value; callback effects and accumulator mutation remain host-owned. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset) {
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      dataset.value = dataset.value.reduce(this.operation, this.initial);
      return dataset as SuccessDataset<unknown>;
    },
  };
}
