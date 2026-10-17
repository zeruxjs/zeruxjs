/** HTTP/3 and WebTransport require a QUIC implementation outside Node's http/http2 servers.
 * This module explicitly models externally terminated protocols; no fake native support. */
export interface Http3Terminator { enabled: true; port: number; maxAgeSeconds?: number; webTransport?: boolean }
export interface TransportCapabilities { http10: boolean; http11: boolean; http2: boolean; http3: boolean; quic: boolean; webTransport: boolean; grpcHttp2: boolean; sse: true; jsonRpc: true; connectUnary: true; trpcBridge: true; }
export function transportCapabilities(options: { tls?: boolean; terminator?: Http3Terminator } = {}): TransportCapabilities {
  const external = !!options.terminator?.enabled;
  return { http10: true, http11: true, http2: !!options.tls, http3: external, quic: external, webTransport: external && !!options.terminator?.webTransport, grpcHttp2: !!options.tls, sse: true, jsonRpc: true, connectUnary: true, trpcBridge: true };
}
export function http3AltSvc(terminator?: Http3Terminator): string | undefined {
  if (!terminator?.enabled) return undefined;
  const { port, maxAgeSeconds = 86400 } = terminator;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || !Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0 || maxAgeSeconds > 604800) throw new RangeError('Invalid HTTP/3 terminator configuration');
  return `h3=":${port}"; ma=${maxAgeSeconds}`;
}
