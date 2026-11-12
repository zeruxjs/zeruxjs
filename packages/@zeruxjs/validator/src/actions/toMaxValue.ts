import type { BaseTransformation } from '../types/index.js';
import type { ValueInput } from './types.js';

/**
 * To max value action interface.
 */
export interface ToMaxValueAction<
  TInput extends ValueInput,
  TRequirement extends TInput,
> extends BaseTransformation<TInput, TInput, never> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'to_max_value';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof toMaxValue;
  /**
   * The maximum value.
   */
  readonly requirement: TRequirement;
}

/** Substitute the borrowed requirement when the native > comparison holds; this clamps rather than rejects and does not clone Date values. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TRequirement} requirement - Borrowed native comparison bound; applying a clamp does not validate or authorize the resulting value.
 * @returns {ToMaxValueAction<TInput, TRequirement>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function toMaxValue<
  TInput extends ValueInput,
  const TRequirement extends TInput,
>(requirement: TRequirement): ToMaxValueAction<TInput, TRequirement> {
  return {
    kind: 'transformation',
    type: 'to_max_value',
    reference: toMaxValue,
    async: false,
    requirement,
    /** Substitute the borrowed requirement when the native > comparison holds; this clamps rather than rejects and does not clone Date values. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset) {
      dataset.value =
        dataset.value > this.requirement ? this.requirement : dataset.value;
      return dataset;
    },
  };
}
