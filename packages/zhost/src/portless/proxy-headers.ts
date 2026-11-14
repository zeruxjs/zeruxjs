import type * as http from 'node:http';
import { isIP } from 'node:net';

/** RFC 9110 section 7.6.1: hop-by-hop fields must not cross a proxy boundary.
 * Connection may nominate additional fields. HTTP/2 forbids those fields even
 * when the backend happens to send them. WebSocket upgrades are handled apart.
 */
const HOP_FIELDS = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Copy end-to-end HTTP fields while removing fixed and Connection-nominated hop fields; WebSocket upgrade preservation is an explicit caller decision.
 * @param {http.IncomingHttpHeaders | http.OutgoingHttpHeaders} headers - Borrowed native HTTP header record.
 * @param {{ preserveUpgrade?: boolean }} options - Trusted forwarding policy for a separately validated upgrade path.
 * @param {boolean | undefined} options.preserveUpgrade - Preserve only the explicitly validated WebSocket upgrade semantics.
 * @returns {http.OutgoingHttpHeaders} Detached lower-case headers without pseudo-fields or prototype-sensitive keys.
 */
export function filterProxyHeaders(
  headers: http.IncomingHttpHeaders | http.OutgoingHttpHeaders,
  options: { preserveUpgrade?: boolean } = {}
): http.OutgoingHttpHeaders {
  /** Per-call copy of fixed hop fields, extended only by Connection nominations. */
  const forbidden = new Set(HOP_FIELDS);
  /** Native Connection value, possibly repeated. */
  const connection = headers.connection;
  /** Joined native Connection tokens before bounded header parsing by Node. */
  const nominated = Array.isArray(connection)
    ? connection.join(',')
    : connection;
  if (typeof nominated === 'string') {
    for (const field of nominated.split(',')) {
      /** Trimmed lower-case nominated field name. */
      const token = field.trim().toLowerCase();
      if (token) {
        forbidden.add(token);
      }
    }
  }
  if (options.preserveUpgrade) {
    forbidden.delete('upgrade');
  }
  /** Detached permitted fields keyed without prototype mutation. */
  const result = new Map<string, string | number | string[]>();
  for (const [name, value] of Object.entries(headers)) {
    /** Lower-case native field name used for fixed protocol exclusion checks. */
    const lower = name.toLowerCase();
    if (
      !lower.startsWith(':') &&
      !forbidden.has(lower) &&
      value !== undefined
    ) {
      if (!['__proto__', 'constructor', 'prototype'].includes(lower)) {
        result.set(lower, value);
      }
    }
  }
  if (options.preserveUpgrade) {
    result.set('connection', 'Upgrade');
  }
  return Object.fromEntries(result);
}

/** Strip client-supplied forwarding identity aliases before the serving proxy reconstructs them from its direct peer.
 * @param {http.OutgoingHttpHeaders} headers - Borrowed outgoing fields already filtered for hop-by-hop semantics.
 * @returns {http.OutgoingHttpHeaders} Copied fields excluding untrusted peer-chain metadata.
 */
export function sanitizeForwardedRequestHeaders(
  headers: http.OutgoingHttpHeaders
): http.OutgoingHttpHeaders {
  /** Detached permitted fields keyed without prototype mutation. */
  const result = { ...headers };
  for (const name of Object.keys(result)) {
    if (
      /^(?:forwarded|x-forwarded-.*|x-real-ip|x-client-ip|true-client-ip|cf-connecting-ip|fastly-client-ip|x-original-forwarded-for)$/i.test(
        name
      )
    ) {
      delete result[name];
    }
  }
  return result;
}

/** Accept only an IP literal or map localhost to IPv4 loopback; never perform implicit DNS for the management bind.
 * @param {string} value - Explicit trusted listener setting.
 * @returns {string} Validated bind literal; remote binds still need separate authorization policy.
 */
export function validateProxyBindAddress(value: string): string {
  if (value === 'localhost') {
    return '127.0.0.1';
  }
  if (isIP(value) !== 0) {
    return value;
  }
  throw new TypeError('Proxy bind address must be an IP literal or localhost');
}
