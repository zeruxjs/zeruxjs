import { syncCallback } from '../utils/_run.js';
import type { BaseTransformation, SuccessDataset } from '../types/index.js';

/**
 * Transform action interface.
 */
export interface TransformAction<TInput, TOutput> extends BaseTransformation<
  TInput,
  TOutput,
  never
> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'transform';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof transform;
  /**
   * The transformation operation.
   */
  readonly operation: (input: TInput) => TOutput;
}

/** Run a trusted synchronous operation through syncCallback and replace the typed value; returned thenables/native async callbacks reject. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {(input: TInput) => TOutput} operation - Explicit trusted transformation callback; only the async API awaits its result, and candidate strings are never evaluated.
 * @returns {TransformAction<TInput, TOutput>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function transform<TInput, TOutput>(
  operation: (input: TInput) => TOutput
): TransformAction<TInput, TOutput> {
  return {
    kind: 'transformation',
    type: 'transform',
    reference: transform,
    async: false,
    operation,
    /** Run a trusted synchronous operation through syncCallback and replace the typed value; returned thenables/native async callbacks reject. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset) {
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      dataset.value = syncCallback(this.operation, dataset.value);
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as SuccessDataset<TOutput>;
    },
  };
}
