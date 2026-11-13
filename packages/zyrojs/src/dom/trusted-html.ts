import { HydrationError } from './hydration-protocol.js';
/** Stores the approved value used by this module. */
const approved = new WeakMap<object, string>();
/** Stores the brand value used by this module. */
const brand: unique symbol = Symbol('ZyroJS trusted HTML');
export interface TrustedHTMLFragment {
  /** Opaque brand preventing ordinary strings from entering raw HTML paths. */
  readonly [brand]: true;
}
/** Explicit host sanitizer boundary, not a built-in sanitizer. Tokens never serialize as public props. */
/**
 * trustedHTML.
 * @param {string} input - Input value for this operation.
 * @param {{ sanitize: (input: string) => string }} policy - Host sanitizer policy.
 * @param {(input: string) => string} policy.sanitize - Canonicalize the trusted fragment.
 * @returns {TrustedHTMLFragment} Result produced by this operation.
 */
export function trustedHTML(
  input: string,
  policy: { sanitize: (input: string) => string }
): TrustedHTMLFragment {
  if (
    typeof input !== 'string' ||
    input.length > 65536 ||
    typeof policy?.sanitize !== 'function'
  ) {
    throw new TypeError(
      'ZyroJS: trustedHTML requires bounded input and an explicit sanitizer'
    );
  }
  /** Stores the html value used by this module. */
  const html = policy.sanitize(input);
  if (
    typeof html !== 'string' ||
    new TextEncoder().encode(html).length > 65536 ||
    /<!--|<!doctype|<\/?(?:script|style|iframe|object|embed|base|meta|link|template)(?:\s|>|\/)/i.test(
      html
    )
  ) {
    throw new HydrationError(
      'INVALID_TRUSTED_HTML',
      'ZyroJS: opaque HTML exceeds limits or contains reserved markup'
    );
  }
  /** Stores the token value used by this module. */
  const token = Object.freeze({ [brand]: true as const });
  approved.set(token, html);
  return token;
}
/**
 * trustedHTMLValue.
 * @param {Record<string, unknown>} props - Input value for this operation.
 * @param {boolean} hasChildren - Input value for this operation.
 * @returns {string | undefined} Result produced by this operation.
 */
export function trustedHTMLValue(
  props: Record<string, unknown>,
  hasChildren: boolean
): string | undefined {
  if (!Object.hasOwn(props, 'trustedHTML')) {
    return undefined;
  }
  /** Stores the token value used by this module. */
  const token = props.trustedHTML;
  /** Stores the html value used by this module. */
  const html =
    token && typeof token === 'object' ? approved.get(token) : undefined;
  if (html === undefined || hasChildren) {
    throw new HydrationError(
      'INVALID_TRUSTED_HTML',
      'ZyroJS: trustedHTML requires an approved token and no managed children'
    );
  }
  return html;
}
