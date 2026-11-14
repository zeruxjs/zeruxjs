import { escapeHtml, fontFamily } from './validate.js';
/** Bounded inert geometry schema; excludes arbitrary XML, HTML and event/URL attributes. */
export interface SvgIcon {
  /** Four finite bounded SVG coordinates; width/height must be positive. */
  viewBox: readonly [number, number, number, number];
  /** 1–128 copied structured paths; no external references or raw markup. */
  paths: readonly {
    /** Bounded allowlisted path text; safe rendering grammar, not full geometric validation. */
    d: string;
    /** None/currentColor or bounded six/eight-digit hex; URL fills reject. */
    fill?: 'none' | 'currentColor' | string;
  }[];
}
/** Validate structured geometry and return a copied safe rendering projection; this is not arbitrary SVG/XML parsing or full geometry conformance.
 * @param {SvgIcon} input - Bounded viewBox and paths; attributes/URLs outside the explicit schema reject.
 * @returns {SvgIcon} Copied viewBox/path records; no user HTML, event handlers or remote references.
 */
export function validateSvgIcon(input: SvgIcon): SvgIcon {
  if (
    !input ||
    Object.keys(input).some((key) => !['viewBox', 'paths'].includes(key)) ||
    !Array.isArray(input.viewBox) ||
    input.viewBox.length !== 4 ||
    input.viewBox.some((v) => !Number.isFinite(v) || Math.abs(v) > 100000) ||
    input.viewBox[2] <= 0 ||
    input.viewBox[3] <= 0 ||
    !Array.isArray(input.paths) ||
    !input.paths.length ||
    input.paths.length > 128
  ) {
    throw new TypeError('Invalid structured SVG icon');
  }

  return {
    viewBox: [...input.viewBox] as [number, number, number, number],
    paths: input.paths.map((path) => {
      if (
        !path ||
        Object.keys(path).some((key) => !['d', 'fill'].includes(key)) ||
        typeof path.d !== 'string' ||
        !path.d ||
        path.d.length > 8192 ||
        !/^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$/.test(path.d) ||
        // eslint-disable-next-line no-control-regex -- Intentionally reject control characters in validated font input.
        /[\x00-\x1f\x7f]/.test(path.d) ||
        (path.fill !== undefined &&
          !/^(?:none|currentColor|#[a-fA-F0-9]{6}|#[a-fA-F0-9]{8})$/.test(
            path.fill
          ))
      ) {
        throw new TypeError('Unsafe SVG path');
      }
      return { d: path.d, ...(path.fill ? { fill: path.fill } : {}) };
    }),
  };
}
/** Serialize fixed SVG elements from validated geometry; meaningful icons require an explicitly authored label.
 * @param {SvgIcon} input - Structured inert geometry, never an HTML string.
 * @param {object} options - Decorative policy and explicit label; no label is invented from arbitrary content.
 * @param {boolean} [options.decorative] - Defaults true; meaningful icons require false plus a label.
 * @param {string} [options.label] - Explicit nonblank accessible label, at most 256 code units.
 * @returns {string} Fixed SVG markup with attribute encoding; host owns placement and accessibility context.
 */
export function svgIconMarkup(
  input: SvgIcon,
  options: {
    /** Default true; false requires an explicit nonblank label. */
    decorative?: boolean;
    /** Explicit meaningful label, at most 256 UTF-16 code units; attribute encoded. */
    label?: string;
  } = {}
): string {
  /** Copied validated geometry used only to emit the fixed SVG element schema. */
  const icon = validateSvgIcon(input);
  /** Explicit authored semantics, default decorative rather than inventing a label. */
  const decorative = options.decorative ?? true;
  if (
    typeof decorative !== 'boolean' ||
    (!decorative &&
      (typeof options.label !== 'string' ||
        !options.label.trim() ||
        options.label.length > 256))
  ) {
    throw new TypeError('Meaningful icon requires a label');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox.join(' ')}" focusable="false" ${decorative ? 'aria-hidden="true"' : `role="img" aria-label="${escapeHtml(options.label!)}"`}>${icon.paths.map((path) => `<path d="${escapeHtml(path.d)}" fill="${path.fill ?? 'currentColor'}"/>`).join('')}</svg>`;
}
/** Return plain glyph text and validated family, not arbitrary HTML or an automatically accessible label.
 * @param {number} codePoint - Unicode scalar at least U+0020, excluding DEL and surrogates.
 * @param {string} family - Authored icon font family under CSS token policy.
 * @returns {object} Text plus family string; caller uses textContent and authored label/decorative semantics.
 */
export function fontIcon(
  codePoint: number,
  family: string
): {
  /** Plain Unicode glyph text intended for textContent, never raw HTML. */
  text: string; /** Validated quoted CSS family; caller owns styling and accessible semantics. */
  fontFamily: string;
} {
  if (
    !Number.isSafeInteger(codePoint) ||
    codePoint < 0x20 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
    codePoint === 0x7f
  ) {
    throw new TypeError('Invalid icon code point');
  }
  return {
    text: String.fromCodePoint(codePoint),
    fontFamily: fontFamily(family),
  };
}
