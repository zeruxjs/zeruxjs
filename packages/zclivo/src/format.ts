import { stripVTControlCharacters } from 'node:util';
/** Remove terminal escape sequences and controls, retaining ordinary LF/tab layout.
 * @param {string} text - Tool display text potentially containing terminal controls.
 * @returns {string} Text without CSI/OSC and forbidden controls; no credential redaction is implied.
 */
export function stripTerminalCodes(text: string): string {
  return stripVTControlCharacters(text).replace(
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g,
    ''
  );
}
/** Format a tool failure while removing terminal control sequences.
 * @param {unknown} error - Private tool error; caller must separately redact credentials/content.
 * @returns {string} Terminal-safe display text, not a safe public error payload.
 */
export function formatError(error: unknown): string {
  return stripTerminalCodes(
    error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  );
}
/** Bounded, deterministic typo hints; never automatically execute the suggestion.
 * @param {string} value - Unknown command/flag spelling, capped at 128 code units for hints.
 * @param {readonly string[]} candidates - Trusted registered names; at most 256 unique sorted candidates are considered.
 * @returns {string} Up to three deterministic display hints, or an empty string.
 */
export function suggest(value: string, candidates: readonly string[]): string {
  if (value.length > 128) {
    return '';
  }
  /** Deterministically ranked bounded candidate set; hints never execute or select commands. */
  const scored = [...new Set(candidates)]
    .sort()
    .slice(0, 256)
    .map((candidate) => {
      let row = Array.from(
        { length: candidate.length + 1 },
        (_, index) => index
      );
      for (let i = 0; i < value.length; i++) {
        // Each previous row has candidate.length + 1 cells; this row grows one cell per column.
        /** Next edit-distance row, built left-to-right with a leading deletion cost. */
        const next = [i + 1];
        for (let j = 0; j < candidate.length; j++) {
          next.push(
            Math.min(
              next[j]! + 1,
              row[j + 1]! + 1,
              row[j]! + (value[i] === candidate[j] ? 0 : 1)
            )
          );
        }
        row = next;
      }
      return { candidate, distance: row[candidate.length]! };
    })
    .filter((item) => item.distance <= (value.length < 5 ? 1 : 2))
    .sort(
      (a, b) =>
        a.distance - b.distance || a.candidate.localeCompare(b.candidate)
    );
  return scored.length
    ? ` Did you mean ${scored
        .slice(0, 3)
        .map((item) => item.candidate)
        .join(', ')}?`
    : '';
}
