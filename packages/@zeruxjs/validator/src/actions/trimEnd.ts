import type { BaseTransformation } from '../types/index.js';

/**
 * Trim end action interface.
 */
export interface TrimEndAction extends BaseTransformation<
  string,
  string,
  never
> {
  /**
   * Stable transformation discriminator; this action emits no validation issue itself.
   */
  readonly type: 'trim_end';
  /**
   * Authored constructor identity; no source text is evaluated.
   */
  readonly reference: typeof trimEnd;
}

/**
 * Remove native ECMAScript whitespace from the end only. Creates a trim end transformation action.
 *
 * @returns {TrimEndAction} An inert trim end action.
 */
// @__NO_SIDE_EFFECTS__
export function trimEnd(): TrimEndAction {
  return {
    kind: 'transformation',
    type: 'trim_end',
    reference: trimEnd,
    async: false,
    /** Apply the explicit string transformation after the pipeline establishes a typed string.
     * @param {import('../types/index.js').SuccessDataset<string>} dataset - Private typed string dataset; this is not an arbitrary unknown-input parser.
     * @returns {import('../types/index.js').SuccessDataset<string>} Same dataset with transformed text; no HTML escaping, authorization or deep copying is implied.
     */
    '~run'(dataset) {
      dataset.value = dataset.value.trimEnd();
      return dataset;
    },
  };
}
