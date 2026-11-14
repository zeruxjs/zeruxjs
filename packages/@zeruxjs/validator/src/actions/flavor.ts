import type { BaseTransformation, SuccessDataset } from '../types/index.js';

/**
 * Declaration-only nominal key for TypeScript inference; no runtime symbol value is allocated or exported by this action implementation.
 *
 * @beta
 */
export declare const FlavorSymbol: unique symbol;

/**
 * Flavor name type.
 *
 * @beta
 */
export type FlavorName = string | number | symbol;

/**
 * Flavor interface.
 *
 * @beta
 */
export interface Flavor<TName extends FlavorName> {
  /** Type-only nominal property; action execution does not write this field to the candidate value. */
  [FlavorSymbol]?: { [TValue in TName]: TValue };
}

/**
 * Flavor action interface.
 *
 * @beta
 */
export interface FlavorAction<
  TInput,
  TName extends FlavorName,
> extends BaseTransformation<TInput, TInput & Flavor<TName>, never> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'flavor';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof flavor;
  /**
   * The flavor name.
   */
  readonly name: TName;
}

/** Attach optional nominal typing only; runtime value identity and mutability remain unchanged. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TName} name - Nominal type label only; never proof of tenant identity, validation or permission.
 * @returns {FlavorAction<TInput, TName>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 * @beta
 */
// @__NO_SIDE_EFFECTS__
export function flavor<TInput, TName extends FlavorName>(
  name: TName
): FlavorAction<TInput, TName> {
  return {
    kind: 'transformation',
    type: 'flavor',
    reference: flavor,
    async: false,
    name,
    /** Attach optional nominal typing only; runtime value identity and mutability remain unchanged. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset) {
      return dataset as SuccessDataset<TInput & Flavor<TName>>;
    },
  };
}
