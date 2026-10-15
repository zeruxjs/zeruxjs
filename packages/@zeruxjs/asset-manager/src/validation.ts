import type { Asset, AssetVariant } from './types.js';
function safeObject(value: unknown, label: string, max: number, maxValue = 10000): Record<string,string> {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > max) throw new TypeError(`Invalid ${label}`);
 const result = Object.create(null) as Record<string,string>;
 for (const [key, item] of Object.entries(value)) {
   if (!/^[\w.:-]{1,100}$/.test(key) || ['__proto__','prototype','constructor'].includes(key) || typeof item !== 'string' || item.length > maxValue) throw new TypeError(`Invalid ${label} entry`);
   result[key] = item;
 }
 return result;
}
function validateUrl(url: string): void {
 if (typeof url !== 'string') throw new TypeError('Invalid URL');
 let u: URL;
 try { u = new URL(url); } catch { throw new TypeError('Invalid URL'); }
 if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw new TypeError('Unsafe asset URL');
}
function validateVariant(variant: AssetVariant): AssetVariant {
 if (!variant || typeof variant !== 'object' || Array.isArray(variant)) throw new TypeError('Invalid asset variant');
 const result: AssetVariant = {};
 if (variant.url !== undefined) { validateUrl(variant.url); result.url = variant.url; }
 if (variant.value !== undefined) { if (typeof variant.value !== 'string' || variant.value.length > 100000) throw new TypeError('Invalid asset variant value'); result.value = variant.value; }
 if (variant.metadata !== undefined) result.metadata = safeObject(variant.metadata,'variant metadata',100);
 if (!result.url && result.value === undefined) throw new TypeError('Variant requires URL or value');
 return result;
}
export function validateAsset(input: Asset): Asset {
 if (!input || typeof input !== 'object' || typeof input.id !== 'string' || !/^[\w.:/-]{1,128}$/.test(input.id) || ['__proto__','constructor','prototype'].includes(input.id)) throw new TypeError('Invalid asset id');
 if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 255) throw new TypeError('Invalid asset name');
 if (!['image','video','font','color','document','other'].includes(input.type)) throw new TypeError('Invalid asset type');
 if (input.url !== undefined) validateUrl(input.url);
 if (input.value !== undefined && (typeof input.value !== 'string' || input.value.length > 100000)) throw new TypeError('Invalid asset value');
 if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.length > 100 || input.tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 100))) throw new TypeError('Invalid asset tags');
 const result: Asset = { id: input.id, name: input.name, type: input.type };
 if (input.url !== undefined) result.url = input.url;
 if (input.value !== undefined) result.value = input.value;
 if (input.tags !== undefined) result.tags = [...input.tags];
 if (input.metadata !== undefined) result.metadata = safeObject(input.metadata,'metadata',100);
 if (input.variants !== undefined) {
   if (!input.variants || typeof input.variants !== 'object' || Array.isArray(input.variants) || Object.keys(input.variants).length > 100) throw new TypeError('Invalid variants');
   const variants = Object.create(null) as Record<string, AssetVariant>;
   for (const [name, variant] of Object.entries(input.variants)) {
     if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name) || ['__proto__','constructor','prototype'].includes(name)) throw new TypeError('Invalid variant name');
     variants[name] = validateVariant(variant);
   }
   result.variants = variants;
 }
 return result;
}
