import type { ValidationContext } from '../types/runtime.js';
import type {
  BaseTransformationAsync,
  SuccessDataset,
} from '../types/index.js';

/**
 * Transform action async interface.
 */
export interface TransformActionAsync<
  TInput,
  TOutput,
> extends BaseTransformationAsync<TInput, TOutput, never> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'transform';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof transformAsync;
  /**
   * The transformation operation.
   */
  readonly operation: (
    input: TInput,
    context: ValidationContext
  ) => Promise<TOutput>;
}

/** Await a trusted operation with the root cooperative signal and replace the typed value; external effects are host-owned and not rolled back. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {(input: TInput, context: ValidationContext) => Promise<TOutput>} operation - Explicit trusted transformation callback; only the async API awaits its result, and candidate strings are never evaluated.
 * @returns {TransformActionAsync<TInput, TOutput>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function transformAsync<TInput, TOutput>(
  operation: (input: TInput, context: ValidationContext) => Promise<TOutput>
): TransformActionAsync<TInput, TOutput> {
  return {
    kind: 'transformation',
    type: 'transform',
    reference: transformAsync,
    async: true,
    operation,
    /** Await a trusted operation with the root cooperative signal and replace the typed value; external effects are host-owned and not rolled back. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {Promise<import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    async '~run'(dataset, config) {
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      dataset.value = await this.operation(dataset.value, {
        signal: config.signal,
      });
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as SuccessDataset<TOutput>;
    },
  };
}
