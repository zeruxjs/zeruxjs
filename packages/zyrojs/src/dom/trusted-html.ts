import { HydrationError } from './hydration-protocol.js';
/** Private token-to-fragment registry; matching a public symbol/property cannot forge approval. */
const approved = new WeakMap<object, string>();
/** Compile-time opaque token brand; runtime approval additionally requires exact weak-map identity. */
const brand: unique symbol = Symbol('ZyroJS trusted HTML');
export interface TrustedHTMLFragment {
  /** Opaque brand preventing ordinary strings from entering raw HTML paths. */
  readonly [brand]: true;
}
/** Explicit host sanitizer boundary, not a built-in sanitizer. Tokens never serialize as public props. */
/**
 * Apply the explicit host sanitizer and register an opaque bounded fragment; no sanitizer is bundled.
 * @param {string} input - Untrusted fragment text, initially bounded in JavaScript code units.
 * @param {{ sanitize: (input: string) => string }} policy - Host sanitizer policy.
 * @param {(input: string) => string} policy.sanitize - Trusted host sanitizer returning canonical fragment HTML; identity sanitizers are unsafe for untrusted input.
 * @returns {TrustedHTMLFragment} Frozen identity token, not serializable permission or ordinary HTML text.
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
  /** Sanitized fragment; output is bounded in UTF-8 bytes and rejects reserved active/range markup. */
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
  /** Opaque token identity retained weakly while a caller owns it. */
  const token = Object.freeze({ [brand]: true as const });
  approved.set(token, html);
  return token;
}
/**
 * Resolve only locally approved opaque leaves, rejecting children managed by the reconciler.
 * @param {Record<string, unknown>} props - Authored props; only an own trustedHTML property requests an opaque leaf.
 * @param {boolean} hasChildren - Whether managed children would conflict with opaque fragment ownership.
 * @returns {string | undefined} Approved fragment, or undefined when no opaque leaf was requested.
 */
export function trustedHTMLValue(
  props: Record<string, unknown>,
  hasChildren: boolean
): string | undefined {
  if (!Object.hasOwn(props, 'trustedHTML')) {
    return undefined;
  }
  /** Candidate token must match an exact identity approved by this module. */
  const token = props.trustedHTML;
  /** Only fragments registered through the sanitizer boundary can be resolved. */
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
