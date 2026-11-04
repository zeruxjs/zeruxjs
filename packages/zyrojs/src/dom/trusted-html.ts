import { HydrationError } from './hydration-protocol.js';
const approved = new WeakMap<object, string>();
const brand: unique symbol = Symbol('ZyroJS trusted HTML');
export interface TrustedHTMLFragment { readonly [brand]: true }
/** Explicit host sanitizer boundary, not a built-in sanitizer. Tokens never serialize as public props. */
export function trustedHTML(input: string, policy: {sanitize: (input: string) => string}): TrustedHTMLFragment {
  if (typeof input !== 'string' || input.length > 65536 || typeof policy?.sanitize !== 'function') throw new TypeError('ZyroJS: trustedHTML requires bounded input and an explicit sanitizer');
  const html = policy.sanitize(input);
  if (typeof html !== 'string' || new TextEncoder().encode(html).length > 65536 || /<!--|<!doctype|<\/?(?:script|style|iframe|object|embed|base|meta|link|template)(?:\s|>|\/)/i.test(html)) throw new HydrationError('INVALID_TRUSTED_HTML', 'ZyroJS: opaque HTML exceeds limits or contains reserved markup');
  const token = Object.freeze({[brand]: true as const});
  approved.set(token, html);
  return token;
}
export function trustedHTMLValue(props: Record<string, unknown>, hasChildren: boolean): string | undefined {
  if (!Object.hasOwn(props, 'trustedHTML')) return undefined;
  const token = props.trustedHTML;
  const html = token && typeof token === 'object' ? approved.get(token) : undefined;
  if (html === undefined || hasChildren) throw new HydrationError('INVALID_TRUSTED_HTML', 'ZyroJS: trustedHTML requires an approved token and no managed children');
  return html;
}
