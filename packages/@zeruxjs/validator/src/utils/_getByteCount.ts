/** Lazily shared native encoder; it owns no timer, socket or explicit disposal handle. */
let textEncoder: TextEncoder;

/** Count UTF-8 bytes with a lazily shared TextEncoder; encoding allocates bytes and is not a streaming body limit.
 * @param {string} input - Candidate string; no remote fetch, HTML parsing or source execution occurs.
 * @returns {number} UTF-8 encoded length, not JavaScript code units or a transport admission guarantee.
 * @internal
 */
// @__NO_SIDE_EFFECTS__
export function _getByteCount(input: string): number {
  if (!textEncoder) {
    textEncoder = new TextEncoder();
  }
  return textEncoder.encode(input).length;
}
