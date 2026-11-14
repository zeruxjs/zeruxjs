/**
 * Snapshot host-owned relative directories into a subscriber-local watch predicate.
 * Matching includes the directory itself and descendants, but never sibling prefixes.
 *
 * @param {unknown} input - At most 128 relative directory paths; defaults to no exclusions.
 * @returns {(relative: string) => boolean} Predicate for watcher-relative paths, without shared mutable state.
 * @throws {TypeError} When an exclusion is absolute, traversing, malformed or exceeds its budget.
 */
export function createDevelopmentWatchIgnore(
  input: unknown = []
): (relative: string) => boolean {
  if (!Array.isArray(input) || input.length > 128) {
    throw new TypeError('Invalid development watch exclusions');
  }
  /** Validated copy prevents later host array edits from changing an active subscriber. */
  const paths = input.map((value) => {
    if (
      typeof value !== 'string' ||
      !value ||
      value.length > 256 ||
      !/^[A-Za-z0-9._/-]+$/.test(value) ||
      value.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      throw new TypeError(
        'Development watch exclusions must be relative directory paths'
      );
    }
    return value;
  });
  return (relative) =>
    typeof relative === 'string' &&
    paths.some((path) => relative === path || relative.startsWith(path + '/'));
}
