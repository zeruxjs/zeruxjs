import { validateNavigationUrl } from '@zeruxjs/security/encoding';
import { HydrationError } from './hydration-protocol.js';
export const hydrationTag = (tag: unknown): tag is string => typeof tag === 'string' && /^[a-z][a-z0-9-]*$/.test(tag) && !/^(?:script|style|textarea|title|iframe|object|embed|base|meta|link|noscript|plaintext|xmp|noembed|noframes|template|svg|math)$/.test(tag);
const urlAttribute = /^(?:href|src|action|poster|cite|background|xlink:href|formaction|data|manifest|codebase|longdesc|ping|profile|usemap)$/i;
/** V1 is HTML only; executable/raw-text/foreign-content trees require a future explicit protocol. */
export function hydrationAttributes(props: Record<string, unknown>): Record<string, string> {
  const attrs: Record<string, string> = Object.create(null);
  if (['password', 'file'].includes(String(props.type).toLowerCase()) && ('value' in props || 'bind:value' in props)) throw new HydrationError('PRIVATE_FORM_VALUE', 'ZyroJS: password/file values cannot be server-rendered');
  const names = Object.keys(props);
  if (names.length > 1024) throw new HydrationError('RENDER_LIMIT', 'ZyroJS: attribute count exceeds limit');
  for (const name of names.sort()) {
    if (name === 'key' || name === 'ref' || name === 'children' || name === 'trustedHTML') continue;
    if (/^on[A-Z]/.test(name) && typeof props[name] === 'function') continue;
    if (/^on/i.test(name) || /^(?:innerHTML|outerHTML|srcdoc|srcset|style|textContent)$/i.test(name)) throw new HydrationError('UNSAFE_ATTRIBUTE', 'ZyroJS: unsafe attribute in hydratable HTML');
    let field = name;
    let value = props[name];
    if (name.startsWith('bind:')) {
      if (!['bind:value', 'bind:checked'].includes(name) || !value || typeof value !== 'object' || !('value' in value)) throw new HydrationError('INVALID_BINDING', 'ZyroJS: invalid hydration binding');
      field = name.slice(5); value = (value as {value: unknown}).value;
    } else if (typeof value === 'function') value = (value as () => unknown)();
    if (field === 'className') field = 'class';
    field = field.toLowerCase();
    if (!/^[a-zA-Z_:][\w:.-]*$/.test(field) || /^data-zyro-/i.test(field)) throw new HydrationError('UNSAFE_ATTRIBUTE', 'ZyroJS: reserved or invalid hydration attribute');
    if (typeof value === 'string' && value.length > 1024 * 1024) throw new HydrationError('RENDER_LIMIT', 'ZyroJS: attribute value exceeds limit');
    if (value !== undefined && value !== null) {
      if (field === 'value' && !['string', 'number'].includes(typeof value)) throw new HydrationError('INVALID_BINDING', 'ZyroJS: form values must be strings or numbers');
      if (['checked', 'selected'].includes(field) && typeof value !== 'boolean') throw new HydrationError('INVALID_BINDING', 'ZyroJS: checked/selected must be boolean');
    }
    if (value === undefined || value === null || value === false) continue;
    if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) throw new HydrationError('INVALID_ATTRIBUTE', 'ZyroJS: non-scalar hydration attribute');
    if (urlAttribute.test(field)) {
      try { validateNavigationUrl(String(value), {baseUrl: 'https://zyro.invalid'}); }
      catch { throw new HydrationError('UNSAFE_URL', 'ZyroJS: unsafe hydration URL'); }
    }
    if (field in attrs) throw new HydrationError('INVALID_ATTRIBUTE', 'ZyroJS: conflicting hydration attributes');
    if (String(value).includes('\0')) throw new HydrationError('INVALID_ATTRIBUTE', 'ZyroJS: NUL attribute values are unsupported');
    attrs[field] = value === true ? '' : String(value);
  }
  if (['password', 'file'].includes(attrs.type) && 'value' in attrs) throw new HydrationError('PRIVATE_FORM_VALUE', 'ZyroJS: password/file values cannot be server-rendered');
  return attrs;
}
