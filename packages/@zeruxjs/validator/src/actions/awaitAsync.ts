import type {
  BaseTransformationAsync,
  SuccessDataset,
} from '../types/index.js';

/**
 * Await action async interface.
 */
export interface AwaitActionAsync<
  TInput extends Promise<unknown>,
> extends BaseTransformationAsync<TInput, Awaited<TInput>, never> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'await';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof awaitAsync;
}

/** Await the caller-owned promise and replace its value without owning cancellation of the original asynchronous producer. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @returns {AwaitActionAsync<TInput>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function awaitAsync<
  TInput extends Promise<unknown>,
>(): AwaitActionAsync<TInput> {
  return {
    kind: 'transformation',
    type: 'await',
    reference: awaitAsync,
    async: true,
    /** Await the caller-owned promise and replace its value without owning cancellation of the original asynchronous producer. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @returns {Promise<import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    async '~run'(dataset) {
      dataset.value = await dataset.value;
      return dataset as SuccessDataset<Awaited<TInput>>;
    },
  };
}
