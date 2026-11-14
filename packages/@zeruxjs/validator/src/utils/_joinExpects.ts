/** Deduplicate diagnostic expectations in first-occurrence order and join them with explicit union/intersection notation.
 * @param {string[]} values - Borrowed private diagnostic strings; duplicates are compared by exact string equality.
 * @param {'&' | '|'} separator - Explicit supported type-expression separator, not arbitrary source syntax.
 * @returns {string} Private unescaped diagnostic expression; empty input retains the legacy never label.
 * @internal
 */
// @__NO_SIDE_EFFECTS__
export function _joinExpects(values: string[], separator: '&' | '|'): string {
  // Create list without duplicates
  /** Fresh first-occurrence expectation list, preserving exact diagnostic string identity. */
  const list = [...new Set(values)];

  // If list has more than one item, join them
  if (list.length > 1) {
    return `(${list.join(` ${separator} `)})`;
  }

  // Otherwise, return first item or "never"
  return list[0] ?? 'never';
}
