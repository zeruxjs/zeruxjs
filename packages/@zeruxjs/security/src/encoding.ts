/** Encode data for HTML text, never markup, JavaScript, CSS or URL policy. */
export function escapeHtmlText(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}
/** Encode a fixed, quoted, inert HTML attribute value. Event/style/srcdoc contexts
 * require separate policies. URL attributes require URL validation first.
 */
export function escapeHtmlAttribute(value: unknown): string {
    return escapeHtmlText(value).replace(/[\x00-\x1f\x7f`]/g, char => `&#x${char.charCodeAt(0).toString(16)};`);
}
/** Serialize a JSON-compatible value as one JavaScript value in an HTML script
 * block. Never concatenate into a quoted JS string, template or event attribute.
 * Serialization callbacks are trusted application code; failures are redacted.
 */
function jsonText(value: unknown): string {
    let json: string | undefined;
    try { json = JSON.stringify(value); } catch { throw new TypeError('Value is not JSON serializable'); }
    if (json === undefined) throw new TypeError('Value is not JSON serializable');
    return json;
}
function scriptText(json: string): string {
    return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
/** One JS expression, preserving JSON own-property semantics through JSON.parse. */
export function serializeJavaScriptValue(value: unknown): string {
    return `JSON.parse(${scriptText(JSON.stringify(jsonText(value)))})`;
}
/** Legacy raw JSON literal; null/undefined map to {}. Prefer the JS-value API
 * for JS assignments, particularly when __proto__ must remain an own data key.
 */
export function serializeJsonForScript(value: unknown): string {
    return scriptText(jsonText(value ?? {}));
}
export interface NavigationUrlOptions { baseUrl?: string; allowedOrigins?: readonly string[] }
/** Validate HTTP(S) navigation and normalize it to an absolute URL. This is not
 * an SSRF/egress/redirect authorization policy. Attribute-encode at an HTML sink.
 */
export function validateNavigationUrl(value: string, options: NavigationUrlOptions = {}): string {
    if (typeof value !== 'string' || value.length > 8192 || !value || /[\x00-\x20\x7f\\]/.test(value) || value.startsWith('//')) throw new TypeError('Invalid navigation URL');
    if (!options || typeof options !== 'object') throw new TypeError('Invalid navigation URL options');
    function parse(text: string): URL {
        try {
            const url = new URL(text);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
            return url;
        } catch { throw new TypeError('Invalid navigation URL'); }
    }
    const base = options.baseUrl === undefined ? undefined : parse(options.baseUrl);
    let url: URL;
    try { url = parse(new URL(value, base).href); } catch { throw new TypeError('Invalid navigation URL'); }
    if (options.allowedOrigins !== undefined) {
        if (!Array.isArray(options.allowedOrigins) || options.allowedOrigins.length > 64) throw new TypeError('Invalid navigation origin policy');
        for (const origin of options.allowedOrigins) if (typeof origin !== 'string' || parse(origin).origin !== origin) throw new TypeError('Invalid navigation origin policy');
        if (!options.allowedOrigins.includes(url.origin)) throw new TypeError('Navigation origin denied');
    }
    return url.href;
}
/** One quoted CSS string token, for fixed properties accepting inert strings.
 * Does not sanitize stylesheets, selectors, property names, url() or style HTML.
 */
export function serializeCssString(value: string): string {
    if (typeof value !== 'string' || value.length > 65536) throw new TypeError('Invalid CSS string');
    return '"' + Array.from(value, char => /[a-zA-Z0-9]/.test(char) ? char : `\\${(char.codePointAt(0) || 0xfffd).toString(16)} `).join('') + '"';
}
