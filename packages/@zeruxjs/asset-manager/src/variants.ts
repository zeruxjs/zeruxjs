import type { Asset, AssetVariant } from './types.js';
import { validateAsset } from './validation.js';

/** Merge an explicitly registered variant onto a validated copied base.
 * @param {Asset} asset - Untrusted asset metadata validated before resolution.
 * @param {string} variant - Optional exact registered variant name; omission returns the base.
 * @returns {Asset & {selectedVariant?: string}} Detached resolved values; missing/invalid names reject.
 */
export function resolveAssetVariant(
  asset: Asset,
  variant?: string
): Asset & { selectedVariant?: string } {
  /** Detached validated base asset used for safe variant resolution. */
  const original = validateAsset(asset);
  if (!variant) {
    return original;
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(variant)) {
    throw new TypeError('Invalid variant name');
  }
  /** Explicit registered override; unknown variant names reject rather than silently falling back. */
  const selected = original.variants?.[variant];
  if (!selected) {
    throw new Error(`Unknown asset variant: ${variant}`);
  }
  return {
    ...original,
    ...structuredClone(selected),
    selectedVariant: variant,
  };
}

/** List validated explicit variant names deterministically.
 * @param {Asset} asset - Asset candidate validated before enumeration.
 * @returns {string[]} Sorted registered names; no variants are inferred.
 */
export function listAssetVariants(asset: Asset): string[] {
  return Object.keys(validateAsset(asset).variants ?? {}).sort();
}
export type { AssetVariant };
