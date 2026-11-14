/* eslint-disable no-control-regex -- Control-character validation and glob sentinels are intentional. */
/** Normalize separators and one leading dot slash for trusted discovery labels; this does not enforce filesystem containment.
 * @param {string} path - Host-selected discovery-relative path.
 * @returns {string} Normalized label; traversal/symlink policy remains with the file discovery owner.
 */
export function normalizedRelativePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}
/** Translate the package’s limited trusted discovery glob syntax to an anchored matcher; this is not unrestricted client regular-expression execution.
 * @param {string} glob - Validated bounded host configuration glob.
 * @returns {RegExp} Fresh compiled limited-glob matcher used only for test discovery.
 */
export function globRegex(glob: string): RegExp {
  /** Regex-escaped literal glob text with controlled internal double-star sentinels, never arbitrary regex input. */
  const escaped = glob
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?')
    .replace(/\u0001/g, '.*');
  return new RegExp(`^${escaped}$`);
}
