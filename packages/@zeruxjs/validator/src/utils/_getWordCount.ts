/** Legacy process-global cache keyed by exact locale value/array identity; hosts must bound their locale configuration. */
let store: Map<Intl.LocalesArgument, Intl.Segmenter>;

/** Count native word-like segments using an exact locale-key cache. The legacy module cache is unbounded and array keys use identity.
 * @param {Intl.LocalesArgument} locales - Trusted bounded locale configuration; invalid or unsupported locales may throw and are not normalized here.
 * @param {string} input - Candidate Unicode string; only native isWordLike segments contribute.
 * @returns {number} Native locale-sensitive word count; ICU data and locale choice affect results.
 * @internal
 */
// @__NO_SIDE_EFFECTS__
export function _getWordCount(
  locales: Intl.LocalesArgument,
  input: string
): number {
  if (!store) {
    store = new Map();
  }
  if (!store.get(locales)) {
    store.set(locales, new Intl.Segmenter(locales, { granularity: 'word' }));
  }
  /** Native segmentation iterator over the current string; input text is not retained in the cache. */
  const segments = store.get(locales)!.segment(input);
  let count = 0;
  // Ignore punctuation/spacing segments and count only native word-like records.
  for (const segment of segments) {
    if (segment.isWordLike) {
      count++;
    }
  }
  return count;
}
