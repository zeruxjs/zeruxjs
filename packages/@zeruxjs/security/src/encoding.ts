/** Encode HTML text without accepting markup, JavaScript, CSS or URL policy. String coercion remains trusted application code.
 * @param {unknown} value - Text/coercible value; null and undefined preserve legacy empty-string behavior.
 * @returns {string} HTML-text encoding of ampersands, angle brackets and quotes.
 */
export function escapeHtmlText(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!
  );
}
/** Encode one fixed quoted inert HTML attribute. Event handlers, style/srcdoc and URL policy require their own boundaries.
 * @param {unknown} value - Literal/coercible attribute text; URL values must be validated separately.
 * @returns {string} HTML encoding with controls/backticks additionally numeric-encoded.
 */
export function escapeHtmlAttribute(value: unknown): string {
  return escapeHtmlText(value).replace(
    // eslint-disable-next-line no-control-regex -- Reject control characters; this existing validation range is intentional.
    /[\x00-\x1f\x7f`]/g,
    (char) => `&#x${char.charCodeAt(0).toString(16)};`
  );
}
/** Serialize a JSON-compatible host value with generic errors; getters/toJSON remain trusted executable application code.
 * @param {unknown} value - Host value passed to native JSON.stringify.
 * @returns {string} Native JSON text or a generic TypeError for unsupported/throwing serialization.
 */
function jsonText(value: unknown): string {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new TypeError('Value is not JSON serializable');
  }
  if (json === undefined) {
    throw new TypeError('Value is not JSON serializable');
  }
  return json;
}
/** Escape JSON text against HTML script termination and JavaScript line separators. This does not authorize arbitrary script.
 * @param {string} json - Previously serialized JSON text, not an untrusted executable expression.
 * @returns {string} Text with HTML/script-sensitive code points represented as JavaScript escapes.
 */
function scriptText(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
/** Produce one JSON.parse expression preserving own-property semantics, including __proto__. Never splice it into an existing JS string/template/event attribute.
 * @param {unknown} value - JSON-compatible host value; serialization callbacks remain trusted.
 * @returns {string} One script-safe JavaScript value expression requiring the normal JSON intrinsic.
 */
export function serializeJavaScriptValue(value: unknown): string {
  return `JSON.parse(${scriptText(JSON.stringify(jsonText(value)))})`;
}
/** Preserve the legacy raw escaped JSON representation; null/undefined become an empty object. Prefer serializeJavaScriptValue for JS assignments.
 * @param {unknown} value - JSON-compatible host value; serialization callbacks remain trusted.
 * @returns {string} Escaped raw JSON text; object-literal prototype semantics are not rewritten.
 */
export function serializeJsonForScript(value: unknown): string {
  return scriptText(jsonText(value ?? {}));
}
export interface NavigationUrlOptions {
  /** Explicit trusted absolute HTTP(S) base required for relative navigation references. */
  baseUrl?: string;
  /** At most64 exact canonical HTTP(S) origins; omission does not add an egress policy. */
  allowedOrigins?: readonly string[];
}
/** Validate and normalize navigation HTTP(S) URLs. This is not outbound SSRF, DNS, redirect or authorization policy; attribute-encode at an HTML sink.
 * @param {string} value - Nonempty bounded URL reference without controls, whitespace, backslashes or protocol-relative syntax.
 * @param {NavigationUrlOptions} options - Optional explicit trusted base and exact canonical origin allowlist.
 * @returns {string} Absolute validated HTTP(S) URL; malformed/denied candidates throw.
 */
export function validateNavigationUrl(
  value: string,
  options: NavigationUrlOptions = {}
): string {
  if (
    typeof value !== 'string' ||
    value.length > 8192 ||
    !value ||
    // eslint-disable-next-line no-control-regex -- Reject control characters; this existing validation range is intentional.
    /[\x00-\x20\x7f\\]/.test(value) ||
    value.startsWith('//')
  ) {
    throw new TypeError('Invalid navigation URL');
  }
  if (!options || typeof options !== 'object') {
    throw new TypeError('Invalid navigation URL options');
  }
  /** Parse a navigation URL and reject unsupported schemes or embedded credentials with a generic error.
   * @param {string} text - Candidate absolute URL text.
   * @returns {URL} Validated native URL; no network fetch occurs.
   */
  function parse(text: string): URL {
    try {
      /** Parsed candidate allowed only for HTTP(S) navigation without embedded credentials. */
      const url = new URL(text);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      ) {
        throw new Error();
      }
      return url;
    } catch {
      throw new TypeError('Invalid navigation URL');
    }
  }
  /** Explicit trusted base URL for relative references; omission never trusts the request Host. */
  const base =
    options.baseUrl === undefined ? undefined : parse(options.baseUrl);
  let url: URL;
  try {
    url = parse(new URL(value, base).href);
  } catch {
    throw new TypeError('Invalid navigation URL');
  }
  if (options.allowedOrigins !== undefined) {
    if (
      !Array.isArray(options.allowedOrigins) ||
      options.allowedOrigins.length > 64
    ) {
      throw new TypeError('Invalid navigation origin policy');
    }
    // Validate each configured canonical origin before applying the exact allowlist.
    for (const origin of options.allowedOrigins) {
      if (typeof origin !== 'string' || parse(origin).origin !== origin) {
        throw new TypeError('Invalid navigation origin policy');
      }
    }
    if (!options.allowedOrigins.includes(url.origin)) {
      throw new TypeError('Navigation origin denied');
    }
  }
  return url.href;
}
/** Encode one quoted CSS string token for a fixed inert string property. Does not sanitize stylesheets, selectors, property names, URL tokens or HTML attributes.
 * @param {string} value - Literal text capped at 65536 UTF-16 code units.
 * @returns {string} Quoted CSS token with nonalphanumeric code points hex-escaped; NUL becomes replacement character.
 */
export function serializeCssString(value: string): string {
  if (typeof value !== 'string' || value.length > 65536) {
    throw new TypeError('Invalid CSS string');
  }
  return (
    '"' +
    Array.from(value, (char) =>
      /[a-zA-Z0-9]/.test(char)
        ? char
        : `\\${(char.codePointAt(0) || 0xfffd).toString(16)} `
    ).join('') +
    '"'
  );
}
