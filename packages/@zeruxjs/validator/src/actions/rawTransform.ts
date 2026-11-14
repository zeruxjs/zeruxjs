import { syncCallback } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseTransformation,
  OutputDataset,
} from '../types/index.js';
import { _addIssue } from '../utils/index.js';
import type {
  RawTransformContext,
  RawTransformIssue,
} from './types/rawTransform.js';

/**
 * Raw transform action interface.
 */
export interface RawTransformAction<TInput, TOutput> extends BaseTransformation<
  TInput,
  TOutput,
  RawTransformIssue<TInput>
> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'raw_transform';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof rawTransform;
}

/** Run a trusted synchronous raw operation; existing/added issues invalidate typing and discard its returned output. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {(context: RawTransformContext<TInput>) => TOutput} action - Explicit trusted raw callback with private parse context; do not retain its context or invoke addIssue after settlement.
 * @returns {RawTransformAction<TInput, TOutput>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function rawTransform<TInput, TOutput>(
  action: (context: RawTransformContext<TInput>) => TOutput
): RawTransformAction<TInput, TOutput> {
  return {
    kind: 'transformation',
    type: 'raw_transform',
    reference: rawTransform,
    async: false,
    /** Run a trusted synchronous raw operation; existing/added issues invalidate typing and discard its returned output. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      // Execute action and get its output
      /** Trusted callback result captured once; raw transform commits it only when the dataset has no issues. */
      const output = syncCallback(action, {
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
