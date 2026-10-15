import type { Asset, AssetVariant } from './types.js';
import { validateAsset } from './validation.js';

export function resolveAssetVariant(asset: Asset, variant?: string): Asset & { selectedVariant?: string } {
  const original = validateAsset(asset);
  if (!variant) return original;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(variant)) throw new TypeError('Invalid variant name');
  const selected = original.variants?.[variant];
  if (!selected) throw new Error(`Unknown asset variant: ${variant}`);
  return { ...original, ...structuredClone(selected), selectedVariant: variant };
}

export function listAssetVariants(asset: Asset): string[] {
  return Object.keys(validateAsset(asset).variants ?? {}).sort();
}
export type { AssetVariant };
