/** Placeholder identities/types, independent of translation values. Plain percent text is inert.
 * Supported grammar matches interpolate/sprintf; precision may change, argument types may not.
 */
function signature(text: string): string {
  const fields = new Map<string, string>();
  let sequence = 0, mode: string | undefined;
  for (const match of text.matchAll(/%%|%\{([^{}]+)\}|%(?:([1-9]\d{0,3})\$)?(?:\.\d{1,2})?([sdf])/g)) {
    if (match[0] === "%%") continue;
    const next = match[1] ? undefined : match[2] ? "position" : "sequence";
    if (next && mode && mode !== next) throw new TypeError("zlocale: mixed placeholder positions");
    if (next) mode = next;
    const key = match[1] ? `name:${match[1]}` : `arg:${match[2] ?? ++sequence}`;
    const type = match[1] ? "scalar" : match[3]!;
    if (fields.has(key) && fields.get(key) !== type) throw new TypeError("zlocale: conflicting placeholder types");
    fields.set(key, type);
  }
  return JSON.stringify([...fields].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
/** Reject missing/extra/type-changed supported placeholders without exposing message content. */
export function validateMessagePlaceholders(source: string, translation: string): void {
  if (typeof source !== "string" || typeof translation !== "string" || source.length > 1_000_000 || translation.length > 1_000_000)
    throw new TypeError("zlocale: invalid placeholder input");
  if (signature(source) !== signature(translation)) throw new TypeError("zlocale: translation placeholder mismatch");
}
