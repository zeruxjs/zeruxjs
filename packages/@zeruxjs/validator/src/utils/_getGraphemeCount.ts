/** Lazily shared default-locale segmenter; importing the module does not require Intl construction. */
let segmenter: Intl.Segmenter;

/** Count native Intl.Segmenter grapheme segments using the runtime default locale; segmentation depends on its ICU data.
 * @param {string} input - Candidate Unicode string; no normalization or mutation is performed.
 * @returns {number} Native grapheme count; unavailable Intl support throws only when called.
 * @internal
 */
// @__NO_SIDE_EFFECTS__
export function _getGraphemeCount(input: string): number {
  if (!segmenter) {
    segmenter = new Intl.Segmenter();
  }
  /** Native segmentation iterator over the current string; input text is not retained in the cache. */
  const segments = segmenter.segment(input);
  let count = 0;

  // Count every native grapheme segment; its text is never retained by this helper.
  for (const _ of segments) {
    count++;
  }
  return count;
}
