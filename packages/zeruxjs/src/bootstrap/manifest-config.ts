/**
 * Public build/runtime manifests contain diagnostics, never credentials.
 * This is an allowlist-by-structure redaction, not a replacement for private state permissions.
 */
const SENSITIVE =
  /(?:^|[_-])(password|passwd|secret|token|credential|authorization|private|api[-_]?key|apiKeys|salts|keys)(?:$|[_-])/i;
/** Legacy folded sensitive-key aliases omitted from diagnostic config projections. */
const EXACT = new Set([
  'password',
  'pass',
  'auth',
  'apikey',
  'apikeys',
  'clientsecret',
  'accesstoken',
  'refreshtoken',
  'privatekey',
  'connectionstring',
  'databaseurl',
  'security',
  'encryption',
  'credentials',
]);
/** Produce a bounded legacy diagnostic projection; key heuristics never authorize publication of private state.
 * @param {unknown} value - Trusted config/state candidate; ordinary property enumeration is not a sandbox.
 * @param {number} depth - Internal recursion depth, default zero.
 * @param {WeakSet<object>} seen - Visited references; repeated references receive a redaction marker.
 * @returns {unknown} Bounded redacted projection; executable/non-JSON primitives are omitted.
 */
export function redactManifestConfig(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): unknown {
  if (depth > 16) {
    return '[REDACTED:depth]';
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value !== 'object') {
    return undefined;
  }
  if (seen.has(value)) {
    return '[REDACTED:circular]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, 1024)
      .map((item) => redactManifestConfig(item, depth + 1, seen));
  }
  /** Fresh null-prototype diagnostic record with bounded property traversal. */
  const mapped: Record<string, unknown> = Object.create(null);
  for (const [key, val] of Object.entries(value).slice(0, 2048)) {
    /** Lowercase alphabetic key used only for the explicit legacy sensitive-name set. */
    const folded = key.toLowerCase().replace(/[^a-z]/g, '');
    mapped[key] =
      SENSITIVE.test(key) || EXACT.has(folded)
        ? '[REDACTED]'
        : redactManifestConfig(val, depth + 1, seen);
  }
  return mapped;
}
