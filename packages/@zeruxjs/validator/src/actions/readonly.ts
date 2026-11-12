import type { BaseTransformation, SuccessDataset } from '../types/index.js';

/**
 * Readonly output type.
 */
type ReadonlyOutput<TInput> =
  TInput extends Map<infer TKey, infer TValue>
    ? ReadonlyMap<TKey, TValue>
    : TInput extends Set<infer TValue>
      ? ReadonlySet<TValue>
      : Readonly<TInput>;

/**
 * Readonly action interface.
 */
export interface ReadonlyAction<TInput> extends BaseTransformation<
  TInput,
  ReadonlyOutput<TInput>,
  never
> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'readonly';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof readonly;
}

/** Expose readonly output typing only; no Object.freeze, deep copying or runtime write protection is performed. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @returns {ReadonlyAction<TInput>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function readonly<TInput>(): ReadonlyAction<TInput>;

/** Expose readonly output typing only; no Object.freeze, deep copying or runtime write protection is performed. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @returns {ReadonlyAction<unknown>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function readonly(): ReadonlyAction<unknown> {
  return {
    kind: 'transformation',
    type: 'readonly',
    reference: readonly,
    async: false,
    /** Expose readonly output typing only; no Object.freeze, deep copying or runtime write protection is performed. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset) {
      return dataset as SuccessDataset<Readonly<unknown>>;
    },
  };
}
