import type * as http from 'node:http';
import { isIP } from 'node:net';

/** RFC 9110 section 7.6.1: hop-by-hop fields must not cross a proxy boundary.
 * Connection may nominate additional fields. HTTP/2 forbids those fields even
 * when the backend happens to send them. WebSocket upgrades are handled apart.
 */
const HOP_FIELDS = new Set([
  'connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

export function filterProxyHeaders(
  headers: http.IncomingHttpHeaders | http.OutgoingHttpHeaders,
  options: { preserveUpgrade?: boolean } = {},
): http.OutgoingHttpHeaders {
  const forbidden = new Set(HOP_FIELDS);
  const connection = headers.connection;
  const nominated = Array.isArray(connection) ? connection.join(',') : connection;
  if (typeof nominated === 'string') {
    for (const field of nominated.split(',')) {
      const token = field.trim().toLowerCase();
      if (token) forbidden.add(token);
    }
  }
  if (options.preserveUpgrade) {
    forbidden.delete('upgrade');
  }
  const result: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!lower.startsWith(':') && !forbidden.has(lower) && value !== undefined) {
      result[lower] = value;
    }
  }
  if (options.preserveUpgrade) {
    result.connection = 'Upgrade';
  }
  return result;
}

/**
 * Rebuild peer identity at this trust boundary. Client-supplied forwarding
 * chains, vendor IP aliases and proxy identity headers must not be allowed to
 * masquerade as a trusted upstream, even when a caller provides a valid Host.
 * Deployments behind an external terminator must configure that terminator's
 * trusted-peer policy separately instead of forwarding arbitrary client data.
 */
export function sanitizeForwardedRequestHeaders(headers: http.OutgoingHttpHeaders): http.OutgoingHttpHeaders {
  const result = { ...headers };
  for (const name of Object.keys(result)) {
    if (/^(?:forwarded|x-forwarded-.*|x-real-ip|x-client-ip|true-client-ip|cf-connecting-ip|fastly-client-ip|x-original-forwarded-for)$/i.test(name)) {
      delete result[name];
    }
  }
  return result;
}

/** Only IP literals may be used as listener addresses. Never resolve a remote
 * host name for the management proxy implicitly. */
export function validateProxyBindAddress(value: string): string {
  if (value === 'localhost') return '127.0.0.1';
  if (isIP(value) !== 0) return value;
  throw new TypeError('Proxy bind address must be an IP literal or localhost');
}
