import type { BaseTransformation } from '../types/index.js';

/**
 * Trim start action interface.
 */
export interface TrimStartAction extends BaseTransformation<
  string,
  string,
  never
> {
  /**
   * Stable transformation discriminator; this action emits no validation issue itself.
   */
  readonly type: 'trim_start';
  /**
   * Authored constructor identity; no source text is evaluated.
   */
  readonly reference: typeof trimStart;
}

/**
 * Remove native ECMAScript whitespace from the start only. Creates a trim start transformation action.
 *
 * @returns {TrimStartAction} An inert trim start action.
 */
// @__NO_SIDE_EFFECTS__
export function trimStart(): TrimStartAction {
  return {
    kind: 'transformation',
    type: 'trim_start',
    reference: trimStart,
    async: false,
    /** Apply the explicit string transformation after the pipeline establishes a typed string.
     * @param {import('../types/index.js').SuccessDataset<string>} dataset - Private typed string dataset; this is not an arbitrary unknown-input parser.
     * @returns {import('../types/index.js').SuccessDataset<string>} Same dataset with transformed text; no HTML escaping, authorization or deep copying is implied.
     */
    '~run'(dataset) {
      dataset.value = dataset.value.trimStart();
      return dataset;
    },
  };
}
