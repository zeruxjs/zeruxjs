import type { CacheOptions } from './types.js';
/** Validate/floor finite nonnegative cache-duration seconds.
 * @param {number} n - Finite nonnegative duration seconds.
 * @returns {number} Floored integer duration.
 */
const seconds = (n: number): number => {
  if (!Number.isFinite(n) || n < 0) {
    throw new RangeError('Cache duration must be non-negative and finite');
  }
  return Math.floor(n);
};
/** Build explicit cache directives; the legacy default is public, max-age=0 and must not classify authenticated responses automatically.
 * @param {CacheOptions} options - Host-selected durations and privacy/no-store policy.
 * @returns {Record<string,string>} Cache-Control header only; no cache or response owner is created.
 */
export function createCacheHeaders(
  options: CacheOptions = {}
): Record<string, string> {
  if (options.noStore) {
    return { 'Cache-Control': 'no-store' };
  }
  /** Ordered explicit Cache-Control components; no runtime cache is allocated. */
  const directives = [
    options.private ? 'private' : 'public',
    `max-age=${seconds(options.maxAge ?? 0)}`,
  ];
  if (options.sMaxAge !== undefined) {
    directives.push(`s-maxage=${seconds(options.sMaxAge)}`);
  }
  if (options.immutable) {
    directives.push('immutable');
  }
  if (options.mustRevalidate) {
    directives.push('must-revalidate');
  }
  if (options.staleWhileRevalidate !== undefined) {
    directives.push(
      `stale-while-revalidate=${seconds(options.staleWhileRevalidate)}`
    );
  }
  if (options.staleIfError !== undefined) {
    directives.push(`stale-if-error=${seconds(options.staleIfError)}`);
  }
  return { 'Cache-Control': directives.join(', ') };
}
/** Compute the compatible weak length/FNV-1a cache validator; it is not a cryptographic integrity digest.
 * @param {string | Uint8Array} content - Explicit representation text or bytes.
 * @returns {string} Deterministic weak representation tag; never reuse as a strong write precondition.
 */
export function createETag(content: string | Uint8Array): string {
  let hash = 2166136261;
  /** Exact UTF-8 or supplied representation bytes used for the weak validator. */
  const bytes =
    typeof content === 'string' ? new TextEncoder().encode(content) : content;
  // Process only the explicit representation bytes, native entries or fixed report fields for this call.
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `W/"${bytes.length.toString(16)}-${(hash >>> 0).toString(16)}"`;
}
/** Apply weak matching for If-None-Match with wildcard support; not a strong mutation precondition.
 * @param {string | null | undefined} header - Incoming comma-separated validator header, or missing.
 * @param {string} etag - Current quoted representation validator.
 * @returns {boolean} Whether wildcard or weak-normalized candidate matches.
 */
export function matchesETag(
  header: string | null | undefined,
  etag: string
): boolean {
  if (!header) {
    return false;
  }
  /** Normalize only weak prefix/whitespace for the compatible cache comparison.
   * @param {string} tag - Quoted candidate validator with optional weak prefix.
   * @returns {string} Trimmed weak-normalized validator.
   */
  const normalize = (tag: string) => tag.trim().replace(/^W\//, '');
  return (
    header.trim() === '*' ||
    header.split(',').some((tag) => normalize(tag) === normalize(etag))
  );
}
/** Match only a strong current representation validator, preserving wildcard support under the existing contract.
 * @param {string | null | undefined} header - Incoming conditional header or missing.
 * @param {string} etag - Current representation validator; weak current tags never satisfy this helper.
 * @returns {boolean} Whether a strong current tag matches; this does not authorize a mutation.
 */
export function matchesStrongETag(
  header: string | null | undefined,
  etag: string
): boolean {
  if (!header || etag.startsWith('W/')) {
    return false;
  }
  return (
    header.trim() === '*' ||
    header.split(',').some((tag) => tag.trim() === etag)
  );
}
