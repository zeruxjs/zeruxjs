import type {
  BaseIssue,
  BaseTransformationAsync,
  MaybePromise,
  OutputDataset,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type {
  RawTransformContext,
  RawTransformIssue,
} from './types/rawTransform.js';

/**
 * Raw transform action async interface.
 */
export interface RawTransformActionAsync<
  TInput,
  TOutput,
> extends BaseTransformationAsync<TInput, TOutput, RawTransformIssue<TInput>> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'raw_transform';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof rawTransformAsync;
}

/** Await a trusted raw operation; existing/added issues invalidate typing and discard its returned output without undoing callback side effects. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {(context: RawTransformContext<TInput>) => MaybePromise<TOutput>} action - Explicit trusted raw callback with private parse context; do not retain its context or invoke addIssue after settlement.
 * @returns {RawTransformActionAsync<TInput, TOutput>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function rawTransformAsync<TInput, TOutput>(
  action: (context: RawTransformContext<TInput>) => MaybePromise<TOutput>
): RawTransformActionAsync<TInput, TOutput> {
  return {
    kind: 'transformation',
    type: 'raw_transform',
    reference: rawTransformAsync,
    async: true,
    /** Await a trusted raw operation; existing/added issues invalidate typing and discard its returned output without undoing callback side effects. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {Promise<import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    async '~run'(dataset, config) {
      // Execute action and get its output
      /** Trusted callback result captured once; raw transform commits it only when the dataset has no issues. */
      const output = await action({
        dataset,
        config,
        addIssue: (info) =>
          _addIssue(this, info?.label ?? 'input', dataset, config, info),
        NEVER: null as never,
      });

      // Update dataset depending on issues
      if (dataset.issues) {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = false;
      } else {
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.value = output;
      }

      // Return output dataset
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<
        TOutput,
        BaseIssue<unknown> | RawTransformIssue<TInput>
      >;
    },
  };
}
