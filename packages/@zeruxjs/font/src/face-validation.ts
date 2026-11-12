import type { FontDefinition } from './types.js';
/** Validate the deliberately bounded CSS Fonts descriptor grammar, including ordered weights/angles and unique feature/axis settings.
 * @param {FontDefinition} face - Trusted authored definition; source URL validation is separate.
 * @returns {void} Invalid/over-budget descriptors reject without executing or acquiring a font.
 */
export function validateFace(face: FontDefinition): void {
  if (
    !face ||
    typeof face.family !== 'string' ||
    !face.family.trim() ||
    face.family.length > 128 ||
    // eslint-disable-next-line no-control-regex -- Intentionally reject control characters in validated font input.
    /[\x00-\x1f\x7f<>;{}\\]/.test(face.family)
  ) {
    throw new TypeError('Invalid font family');
  }
  /** Normalized weight descriptor, default 400; range order/bounds are validated next. */
  const weight = String(face.weight ?? 400);
  if (!['normal', 'bold'].includes(weight)) {
    /** Numeric/range descriptor components checked before CSS serialization. */
    const values = weight.split(' ');
    if (
      values.length > 2 ||
      values.some(
        (v) =>
          !/^(?:\d+(?:\.\d+)?)$/.test(v) || Number(v) < 1 || Number(v) > 1000
      ) ||
      (values.length === 2 && Number(values[0]) > Number(values[1]))
    ) {
      throw new TypeError('Invalid font weight');
    }
  }
  /** Explicit style descriptor, default normal; oblique angles are separately bounded. */
  const style = face.style ?? 'normal';
  if (!['normal', 'italic', 'oblique'].includes(style)) {
    /** Bounded descriptor syntax match, never a client-supplied executable regex. */
    const match =
      /^oblique (-?\d+(?:\.\d+)?)deg(?: (-?\d+(?:\.\d+)?)deg)?$/.exec(style);
    if (
      !match ||
      Math.abs(Number(match[1])) > 90 ||
      (match[2] !== undefined &&
        (Math.abs(Number(match[2])) > 90 ||
          Number(match[2]) < Number(match[1])))
    ) {
      throw new TypeError('Invalid font style');
    }
  }
  if (
    !['auto', 'block', 'swap', 'fallback', 'optional'].includes(
      face.display ?? 'swap'
    )
  ) {
    throw new TypeError('Invalid font display');
  }
  if (
    face.stretch !== undefined &&
    ![
      'ultra-condensed',
      'extra-condensed',
      'condensed',
      'semi-condensed',
      'normal',
      'semi-expanded',
      'expanded',
      'extra-expanded',
      'ultra-expanded',
    ].includes(face.stretch)
  ) {
    /** Numeric/range descriptor components checked before CSS serialization. */
    const values = face.stretch.split(' ');
    if (
      values.length > 2 ||
      values.some(
        (v) =>
          !/^\d+(?:\.\d+)?%$/.test(v) ||
          Number(v.slice(0, -1)) < 1 ||
          Number(v.slice(0, -1)) > 1000
      ) ||
      (values.length === 2 && parseFloat(values[0]) > parseFloat(values[1]))
    ) {
      throw new TypeError('Invalid font stretch');
    }
  }
  if (face.unicodeRange !== undefined) {
    if (
      typeof face.unicodeRange !== 'string' ||
      face.unicodeRange.length > 2048
    ) {
      throw new TypeError('Invalid unicode range');
    }
    /** At most 128 Unicode range components, within the Unicode scalar ceiling. */
    const ranges = face.unicodeRange.split(',');
    if (
      ranges.length > 128 ||
      ranges.some((raw) => {
        /** One trimmed Unicode range component, validated before use. */
        const value = raw.trim();
        /** Bounded descriptor syntax match, never a client-supplied executable regex. */
        const match = /^U\+([a-fA-F0-9]{1,6})(?:-([a-fA-F0-9]{1,6}))?$/.exec(
          value
        );
        if (match) {
          return (
            parseInt(match[1], 16) > 0x10ffff ||
            (match[2] !== undefined &&
              (parseInt(match[2], 16) > 0x10ffff ||
                parseInt(match[1], 16) > parseInt(match[2], 16)))
          );
        }
        /** Bounded U+ wildcard syntax; expanded maximum must fit Unicode. */
        const wildcard = /^U\+([a-fA-F0-9]{0,5})(\?{1,6})$/.exec(value);
        return (
          !wildcard ||
          wildcard[1].length + wildcard[2].length > 6 ||
          parseInt((wildcard[1] + wildcard[2]).replaceAll('?', 'F'), 16) >
            0x10ffff
        );
      })
    ) {
      throw new TypeError('Invalid unicode range');
    }
  }
  // Validate each settings grammar separately; variation numbers and feature switches differ.
  for (const [kind, raw] of [
    ['feature', face.featureSettings],
    ['variation', face.variationSettings],
  ] as const) {
    if (raw === undefined || raw === 'normal') {
      continue;
    }
    if (typeof raw !== 'string' || raw.length > 2048) {
      throw new TypeError('Invalid font settings');
    }
    /** At most 32 authored settings, validated independently by feature/variation kind. */
    const entries = raw.split(',');
    /** Four-character tags already accepted in this one settings list; duplicates reject. */
    const seen = new Set<string>();
    if (entries.length > 32) {
      throw new TypeError('Font settings limit');
    }
    // Reject duplicate four-character tags before any descriptor is serialized.
    for (const entry of entries) {
      /** Bounded descriptor syntax match, never a client-supplied executable regex. */
      const match =
        /^\s*"([A-Za-z0-9]{4})"\s+(-?\d+(?:\.\d+)?|on|off)\s*$/.exec(entry);
      if (
        !match ||
        seen.has(match[1]) ||
        (kind === 'feature' && !/^(?:on|off|\d+)$/.test(match[2])) ||
        (kind === 'feature' && Number(match[2]) > 65535) ||
        (kind === 'variation' &&
          (!Number.isFinite(Number(match[2])) ||
            Math.abs(Number(match[2])) > 1000000))
      ) {
        throw new TypeError('Invalid/duplicate font setting');
      }
      seen.add(match[1]);
    }
  }
}
