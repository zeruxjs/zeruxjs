import type { BaseTransformation } from '../types/index.js';

/**
 * Normalize form type.
 */
export type NormalizeForm = 'NFC' | 'NFD' | 'NFKC' | 'NFKD';

/**
 * Normalize action interface.
 */
export interface NormalizeAction<
  TForm extends NormalizeForm | undefined,
> extends BaseTransformation<string, string, never> {
  /**
   * Stable Unicode-normalization transformation discriminator.
   */
  readonly type: 'normalize';
  /**
   * Authored constructor identity; no source text is evaluated.
   */
  readonly reference: typeof normalize;
  /**
   * Explicit native Unicode form; undefined uses the native NFC default.
   */
  readonly form: TForm;
}

/**
 * Creates a normalize transformation action.
 *
 * @returns {NormalizeAction<undefined>} Inert action using native NFC at parse time.
 */
export function normalize(): NormalizeAction<undefined>;

/**
 * Creates a normalize transformation action.
 *
 * @param {TForm} form - Explicit supported native normalization form; undefined delegates to NFC.
 *
 * @returns {NormalizeAction<TForm>} Inert action capturing the explicit native form.
 */
export function normalize<TForm extends NormalizeForm | undefined>(
  form: TForm
): NormalizeAction<TForm>;

/** Capture an explicit native Unicode normalization policy; no input is normalized during construction.
 * @param {NormalizeForm} form - Optional NFC/NFD/NFKC/NFKD selection; undefined delegates to native NFC.
 * @returns {NormalizeAction<NormalizeForm | undefined>} Inert action; invalid untyped form values retain native RangeError behavior.
 */
// @__NO_SIDE_EFFECTS__
export function normalize(
  form?: NormalizeForm
): NormalizeAction<NormalizeForm | undefined> {
  return {
    kind: 'transformation',
    type: 'normalize',
    reference: normalize,
    async: false,
    form,
    /** Normalize a typed string using the configured native Unicode form, without evaluating its contents.
     * @param {import('../types/index.js').SuccessDataset<string>} dataset - Current private typed string; normalization is not confusable detection, escaping or authorization.
     * @returns {import('../types/index.js').SuccessDataset<string>} Same dataset holding native normalized text; errors propagate without a fabricated validation issue.
     */
    '~run'(dataset) {
      dataset.value = dataset.value.normalize(this.form);
      return dataset;
    },
  };
}
