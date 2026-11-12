import type { BaseTransformation, SuccessDataset } from '../types/index.js';

/**
 * To boolean action interface.
 */
export interface ToBooleanAction<TInput> extends BaseTransformation<
  TInput,
  boolean,
  never
> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'to_boolean';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof toBoolean;
}

/** Apply native Boolean truthiness; nonempty strings such as false remain true and no string-token parser is implied. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @returns {ToBooleanAction<TInput>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
// @__NO_SIDE_EFFECTS__
export function toBoolean<TInput>(): ToBooleanAction<TInput> {
  return {
    kind: 'transformation',
    type: 'to_boolean',
    reference: toBoolean,
    async: false,
    /** Apply native Boolean truthiness; nonempty strings such as false remain true and no string-token parser is implied. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset) {
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      dataset.value = Boolean(dataset.value);
      return dataset as SuccessDataset<boolean>;
    },
  };
}
