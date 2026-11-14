import type { BaseTransformation } from '../types/index.js';

/**
 * To lower case action interface.
 */
export interface ToLowerCaseAction extends BaseTransformation<
  string,
  string,
  never
> {
  /**
   * Stable transformation discriminator; this action emits no validation issue itself.
   */
  readonly type: 'to_lower_case';
  /**
   * Authored constructor identity; no source text is evaluated.
   */
  readonly reference: typeof toLowerCase;
}

/**
 * Apply native locale-independent Unicode lowercase mapping; output length may change. Creates a to lower case transformation action.
 *
 * @returns {ToLowerCaseAction} An inert to lower case action.
 */
// @__NO_SIDE_EFFECTS__
export function toLowerCase(): ToLowerCaseAction {
  return {
    kind: 'transformation',
    type: 'to_lower_case',
    reference: toLowerCase,
    async: false,
    /** Apply the explicit string transformation after the pipeline establishes a typed string.
     * @param {import('../types/index.js').SuccessDataset<string>} dataset - Private typed string dataset; this is not an arbitrary unknown-input parser.
     * @returns {import('../types/index.js').SuccessDataset<string>} Same dataset with transformed text; no HTML escaping, authorization or deep copying is implied.
     */
    '~run'(dataset) {
      dataset.value = dataset.value.toLowerCase();
      return dataset;
    },
  };
}
