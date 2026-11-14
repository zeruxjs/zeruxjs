/** Normalize only supported named/printf placeholder identities and types without interpreting translation text.
 * @param {string} text - Bounded inert source/translation text.
 * @returns {string} Deterministic sorted signature; precision/reordering are allowed, identity/type changes reject.
 */
function signature(text: string): string {
  /** Supported placeholder identity/type signature independent of translated values. */
  const fields = new Map<string, string>();
  let sequence = 0,
    mode: string | undefined;
  for (const match of text.matchAll(
    /%%|%\{([^{}]+)\}|%(?:([1-9]\d{0,3})\$)?(?:\.\d{1,2})?([sdf])/g
  )) {
    if (match[0] === '%%') {
      continue;
    }
    /** Positional/sequential mode for this printf placeholder; named placeholders do not select it. */
    let next;
    if (match[1]) {
      next = undefined;
    } else if (match[2]) {
      next = 'position';
    } else {
      next = 'sequence';
    }
    if (next && mode && mode !== next) {
      throw new TypeError('zlocale: mixed placeholder positions');
    }
    if (next) {
      mode = next;
    }
    /** Normalized named/argument identity; no dynamic source expression is evaluated. */
    const key = match[1] ? `name:${match[1]}` : `arg:${match[2] ?? ++sequence}`;
    /** Required scalar/printf type; conflicting uses reject rather than coerce. */
    const type = match[1] ? 'scalar' : match[3]!;
    if (fields.has(key) && fields.get(key) !== type) {
      throw new TypeError('zlocale: conflicting placeholder types');
    }
    fields.set(key, type);
  }
  return JSON.stringify(
    [...fields].sort(([a], [b]) => {
      if (a < b) {
        return -1;
      }
      if (a > b) {
        return 1;
      }
      return 0;
    })
  );
}
/** Reject missing, extra or type-changed supported placeholders without embedding translation values in diagnostics.
 * @param {string} source - Bounded inert source key without context prefix.
 * @param {string} translation - Bounded inert candidate translation form.
 * @returns {void} Returns after signature equality or throws before registry mutation.
 */
export function validateMessagePlaceholders(
  source: string,
  translation: string
): void {
  if (
    typeof source !== 'string' ||
    typeof translation !== 'string' ||
    source.length > 1_000_000 ||
    translation.length > 1_000_000
  ) {
    throw new TypeError('zlocale: invalid placeholder input');
  }
  if (signature(source) !== signature(translation)) {
    throw new TypeError('zlocale: translation placeholder mismatch');
  }
}
