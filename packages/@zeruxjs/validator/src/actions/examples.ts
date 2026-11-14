import type { BaseMetadata } from '../types/index.js';

/**
 * Examples action interface.
 */
export interface ExamplesAction<
  TInput,
  TExamples extends readonly TInput[],
> extends BaseMetadata<TInput> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'examples';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof examples;
  /**
   * The examples.
   */
  readonly examples: TExamples;
}

/** Capture borrowed example metadata without validating, executing, cloning or redacting its values. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TExamples} examples_ - Borrowed readonly example list; metadata readers still need output-context escaping and secret policy.
 * @returns {ExamplesAction<TInput, TExamples>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
// @__NO_SIDE_EFFECTS__
export function examples<TInput, const TExamples extends readonly TInput[]>(
  examples_: TExamples
): ExamplesAction<TInput, TExamples> {
  return {
    kind: 'metadata',
    type: 'examples',
    reference: examples,
    examples: examples_,
  };
}
