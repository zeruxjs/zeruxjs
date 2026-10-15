/**
 * Public build/runtime manifests contain diagnostics, never credentials.
 * This is an allowlist-by-structure redaction, not a replacement for private state permissions.
 */
const SENSITIVE = /(?:^|[_-])(password|passwd|secret|token|credential|authorization|private|api[-_]?key|apiKeys|salts|keys)(?:$|[_-])/i;
const EXACT = new Set(['password', 'pass', 'auth', 'apikey', 'apikeys', 'clientsecret', 'accesstoken', 'refreshtoken', 'privatekey', 'connectionstring', 'databaseurl', 'security', 'encryption', 'credentials']);
export function redactManifestConfig(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 16) return '[REDACTED:depth]';
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return '[REDACTED:circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 1024).map(item => redactManifestConfig(item, depth + 1, seen));
  const mapped: Record<string, unknown> = Object.create(null);
  for (const [key, val] of Object.entries(value).slice(0, 2048)) {
    const folded = key.toLowerCase().replace(/[^a-z]/g, '');
    mapped[key] = SENSITIVE.test(key) || EXACT.has(folded) ? '[REDACTED]' : redactManifestConfig(val, depth + 1, seen);
  }
  return mapped;
}
