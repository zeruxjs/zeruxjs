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

export interface TransportCapability {
  readonly implementation: 'native'|'subset'|'forwarding'|'external';
  readonly request: boolean; readonly serverStream: boolean; readonly bidirectional: boolean;
  readonly authentication: string;
}
/** Implementation inventory, independent of whether a host has configured a listener. */
export const transportCapabilityMatrix: Readonly<Record<string, Readonly<TransportCapability>>> = Object.freeze(Object.fromEntries(Object.entries({
  http: {implementation:'native',request:true,serverStream:true,bidirectional:false,authentication:'Explicit HTTP adapter authorization plus gateway endpoint policy'},
  ws: {implementation:'native',request:false,serverStream:true,bidirectional:true,authentication:'Explicit upgrade authorization; application owns message authorization'},
  sse: {implementation:'native',request:false,serverStream:true,bidirectional:false,authentication:'Gateway endpoint authorization'},
  'json-rpc': {implementation:'native',request:true,serverStream:false,bidirectional:false,authentication:'Gateway endpoint authorization; application owns method permissions'},
  mcp: {implementation:'subset',request:true,serverStream:false,bidirectional:false,authentication:'Stateless JSON POST subset; gateway endpoint authorization'},
  connect: {implementation:'subset',request:true,serverStream:true,bidirectional:true,authentication:'JSON unary/framed subset; gateway endpoint authorization'},
  trpc: {implementation:'subset',request:true,serverStream:false,bidirectional:false,authentication:'JSON bridge only; gateway endpoint authorization'},
  grpc: {implementation:'forwarding',request:true,serverStream:true,bidirectional:true,authentication:'Proxy upstream/host policy; no native service registration'},
  webtransport: {implementation:'external',request:false,serverStream:true,bidirectional:true,authentication:'Host-supplied QUIC session handoff'},
  http3: {implementation:'external',request:true,serverStream:true,bidirectional:false,authentication:'External terminator owns TLS and ingress policy'}
} satisfies Record<string,TransportCapability>).map(([key,value])=>[key,Object.freeze(value)])));
