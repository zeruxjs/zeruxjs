import type { ValidationContext } from '../types/runtime.js';
import type {
  BaseTransformationAsync,
  SuccessDataset,
} from '../types/index.js';

/**
 * Transform action async interface.
 */
export interface TransformActionAsync<TInput, TOutput>
  extends BaseTransformationAsync<TInput, TOutput, never> {
  /**
   * The action type.
   */
  readonly type: 'transform';
  /**
   * The action reference.
   */
  readonly reference: typeof transformAsync;
  /**
   * The transformation operation.
   */
  readonly operation: (input: TInput, context: ValidationContext) => Promise<TOutput>;
}

/**
 * Creates a custom transformation action.
 *
 * @param operation The transformation operation.
 *
 * @returns A transform action.
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
    async '~run'(dataset, config) {
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      dataset.value = await this.operation(dataset.value, { signal: config.signal });
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as SuccessDataset<TOutput>;
    },
  };
}
