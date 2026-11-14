import type { BaseTransformation, SuccessDataset } from '../types/index.js';

/**
 * Declaration-only nominal key for TypeScript inference; no runtime symbol value is allocated or exported by this action implementation.
 */
export declare const BrandSymbol: unique symbol;

/**
 * Brand name type.
 */
export type BrandName = string | number | symbol;

/**
 * Brand interface.
 */
export interface Brand<TName extends BrandName> {
  /** Type-only nominal property; action execution does not write this field to the candidate value. */
  [BrandSymbol]: { [TValue in TName]: TValue };
}

/**
 * Brand action interface.
 */
export interface BrandAction<
  TInput,
  TName extends BrandName,
> extends BaseTransformation<TInput, TInput & Brand<TName>, never> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'brand';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof brand;
  /**
   * The brand name.
   */
  readonly name: TName;
}

/** Attach nominal typing only; retain the same runtime value without allocating a brand symbol, freezing data or proving authorization. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TName} name - Nominal type label only; never proof of tenant identity, validation or permission.
 * @returns {BrandAction<TInput, TName>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function brand<TInput, TName extends BrandName>(
  name: TName
): BrandAction<TInput, TName> {
  return {
    kind: 'transformation',
    type: 'brand',
    reference: brand,
    async: false,
    name,
    /** Attach nominal typing only; retain the same runtime value without allocating a brand symbol, freezing data or proving authorization. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset) {
      return dataset as SuccessDataset<TInput & Brand<TName>>;
    },
  };
}
