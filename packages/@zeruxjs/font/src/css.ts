import { validateFace } from './face-validation.js';
import type { FontDefinition, FontFaceOptions } from './types.js';
import {
  cssToken,
  fontUrl,
  fontFamily,
  fontFormat,
  escapeHtml,
} from './validate.js';
/** Adapt the compatible single-source input to validated multi-source font-face generation.
 * @param {FontFaceOptions} options - Trusted authored descriptors and one URL; no binary is acquired.
 * @returns {string} Deterministic @font-face CSS, not a downloaded or licensed font.
 */
export function fontFace(options: FontFaceOptions): string {
  return defineFont({
    ...options,
    sources: [{ url: options.src, format: options.format }],
  });
}
/** Validate bounded descriptors and serialize one fixed @font-face rule without fetching its sources.
 * @param {FontDefinition} options - Trusted descriptors and 1–16 explicit sources, independently URL/format validated.
 * @returns {string} CSS declaration rule; the host owns external stylesheet/CSP and actual font availability.
 */
export function defineFont(options: FontDefinition): string {
  validateFace(options);
  if (
    !Array.isArray(options.sources) ||
    options.sources.length > 16 ||
    !options.sources.length
  ) {
    throw new TypeError('Font requires at least one source');
  }
  /** Validated source list serialized in authored order, without fetching binaries. */
  const src = options.sources
    .map(
      (s) =>
        `url("${fontUrl(s.url)}")${s.format ? ` format("${fontFormat(s.format)}")` : ''}`
    )
    .join(',');
  /** Fixed font-face property list; optional descriptors append in the documented order. */
  const declarations = [
    `font-family:${fontFamily(options.family)}`,
    `src:${src}`,
    `font-style:${cssToken(options.style ?? 'normal')}`,
    `font-weight:${cssToken(String(options.weight ?? 400))}`,
    `font-display:${options.display ?? 'swap'}`,
  ];
  // Keep optional descriptors in a stable authored property order for deterministic CSS.
  for (const [k, v] of [
    ['unicode-range', options.unicodeRange],
    ['font-stretch', options.stretch],
    ['font-feature-settings', options.featureSettings],
    ['font-variation-settings', options.variationSettings],
  ] as const) {
    if (v) {
      declarations.push(`${k}:${cssToken(v)}`);
    }
  }
  return `@font-face{${declarations.join(';')}}`;
}
/** Quote non-generic family names while preserving recognized CSS generic families.
 * @param {...string} families - Ordered authored family names; no metric matching or layout-shift guarantee.
 * @returns {string} Comma-separated CSS fallback stack.
 */
export function fontStack(...families: string[]): string {
  return families
    .map((s) =>
      /^(?:serif|sans-serif|monospace|system-ui|cursive|fantasy|ui-serif|ui-sans-serif|ui-monospace|emoji|math|fangsong)$/i.test(
        s
      )
        ? s
        : fontFamily(s)
    )
    .join(', ');
}
/** Serialize a validated font preload link with HTML-attribute encoding; no request is made here.
 * @param {string} src - Validated source URL under host asset/consent policy.
 * @param {string} type - Explicit font MIME, default font/woff2.
 * @returns {string} Fixed link markup with crossorigin; host decides whether it belongs in the page.
 */
export function fontPreload(src: string, type = 'font/woff2'): string {
  fontUrl(src);
  if (!/^font\/[a-z0-9.+-]+$/i.test(type)) {
    throw new TypeError('Invalid font MIME type');
  }
  return `<link rel="preload" href="${escapeHtml(src)}" as="font" type="${escapeHtml(type)}" crossorigin>`;
}
/** Serialize a validated stylesheet URL as a fixed HTML link, without injecting it into a document.
 * @param {string} src - Host-selected URL validated against the limited source grammar.
 * @returns {string} Attribute-encoded stylesheet link markup.
 */
export function fontStylesheetLink(src: string): string {
  fontUrl(src);
  return `<link rel="stylesheet" href="${escapeHtml(src)}">`;
}
