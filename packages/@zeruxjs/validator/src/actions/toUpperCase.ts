import type { BaseTransformation } from '../types/index.js';

/**
 * To upper case action interface.
 */
export interface ToUpperCaseAction extends BaseTransformation<
  string,
  string,
  never
> {
  /**
   * Stable transformation discriminator; this action emits no validation issue itself.
   */
  readonly type: 'to_upper_case';
  /**
   * Authored constructor identity; no source text is evaluated.
   */
  readonly reference: typeof toUpperCase;
}

/**
 * Apply native locale-independent Unicode uppercase mapping; output length may change. Creates a to upper case transformation action.
 *
 * @returns {ToUpperCaseAction} An inert to upper case action.
 */
// @__NO_SIDE_EFFECTS__
export function toUpperCase(): ToUpperCaseAction {
  return {
    kind: 'transformation',
    type: 'to_upper_case',
    reference: toUpperCase,
    async: false,
    /** Apply the explicit string transformation after the pipeline establishes a typed string.
     * @param {import('../types/index.js').SuccessDataset<string>} dataset - Private typed string dataset; this is not an arbitrary unknown-input parser.
     * @returns {import('../types/index.js').SuccessDataset<string>} Same dataset with transformed text; no HTML escaping, authorization or deep copying is implied.
     */
    '~run'(dataset) {
      dataset.value = dataset.value.toUpperCase();
      return dataset;
    },
  };
}
