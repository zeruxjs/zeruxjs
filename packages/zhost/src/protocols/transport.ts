/** HTTP/3 and WebTransport require a QUIC implementation outside Node's http/http2 servers.
 * This module explicitly models externally terminated protocols; no fake native support. */
export interface Http3Terminator {
  /** Explicit external termination declaration; it does not install a QUIC implementation. */
  enabled: true;
  /** Validated external HTTP/3 port advertised to clients. */
  port: number;
  /** Advertisement lifetime, from zero to seven days; defaults to one day. */
  maxAgeSeconds?: number;
  /** Explicitly declared external WebTransport support, never inferred from Node HTTP/2. */
  webTransport?: boolean;
}
export interface TransportCapabilities {
  /** Compatibility flag for the proxy’s HTTP/1.0 response path. */
  http10: boolean;
  /** Compatibility flag for the proxy’s HTTP/1.1 response path. */
  http11: boolean;
  /** Whether TLS-backed HTTP/2 was declared for this proxy. */
  http2: boolean;
  /** Whether an external HTTP/3 terminator was declared. */
  http3: boolean;
  /** External terminator declaration; not native Node QUIC service ownership. */
  quic: boolean;
  /** Explicitly declared external WebTransport support, never inferred from Node HTTP/2. */
  webTransport: boolean;
  /** HTTP/2 forwarding compatibility, not native gRPC handler registration. */
  grpcHttp2: boolean;
  /** Built-in SSE helper availability, independent of a configured endpoint. */
  sse: true;
  /** Built-in JSON-RPC helper availability, independent of registered methods. */
  jsonRpc: true;
  /** Connect unary JSON subset availability; not protobuf support. */
  connectUnary: true;
  /** Narrow JSON procedure bridge availability; not full tRPC compatibility. */
  trpcBridge: true;
}
/** Project host-declared TLS/external-terminator settings into compatibility flags without creating or probing transports.
 * @param {{tls?: boolean; terminator?: Http3Terminator}} options - Explicit host declarations; terminator fields are validated separately by http3AltSvc.
 * @param {boolean | undefined} options.tls - Host-declared TLS setting; no listener is created.
 * @param {Http3Terminator | undefined} options.terminator - Host-owned external termination declaration.
 * @returns {TransportCapabilities} Configuration flags, not proof of native QUIC, gRPC service registration or live readiness.
 */
export function transportCapabilities(
  options: {
    /** Explicit host TLS setting used to project HTTP/2 compatibility. */
    tls?: boolean;
    /** Explicit host-owned external termination settings. */
    terminator?: Http3Terminator;
  } = {}
): TransportCapabilities {
  /** Whether the host explicitly declared external termination; no runtime probe is performed. */
  const external = !!options.terminator?.enabled;
  return {
    http10: true,
    http11: true,
    http2: !!options.tls,
    http3: external,
    quic: external,
    webTransport: external && !!options.terminator?.webTransport,
    grpcHttp2: !!options.tls,
    sse: true,
    jsonRpc: true,
    connectUnary: true,
    trpcBridge: true,
  };
}
/** Validate an explicitly enabled external HTTP/3 terminator and format its advertisement without starting QUIC.
 * @param {Http3Terminator} terminator - Optional host-owned external endpoint declaration; absent/disabled returns undefined.
 * @returns {string | undefined} Bounded h3 Alt-Svc value, or undefined when no terminator is declared.
 */
export function http3AltSvc(terminator?: Http3Terminator): string | undefined {
  if (!terminator?.enabled) {
    return undefined;
  }
  /** Explicit external port and advertisement lifetime validated before header serialization. */
  const { port, maxAgeSeconds = 86400 } = terminator;
  if (
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !Number.isSafeInteger(maxAgeSeconds) ||
    maxAgeSeconds < 0 ||
    maxAgeSeconds > 604800
  ) {
    throw new RangeError('Invalid HTTP/3 terminator configuration');
  }
  return `h3=":${port}"; ma=${maxAgeSeconds}`;
}

export interface TransportCapability {
  /** Whether the feature is native, a deliberate subset, forwarding-only or externally supplied. */
  readonly implementation: 'native' | 'subset' | 'forwarding' | 'external';
  /** Whether this implementation supports a request/reply interaction. */
  readonly request: boolean;
  /** Whether the implementation can deliver a server stream. */
  readonly serverStream: boolean;
  /** Whether this implementation supports a bidirectional interaction. */
  readonly bidirectional: boolean;
  /** Descriptive host authentication responsibility; not an installed access policy. */
  readonly authentication: string;
}
/** Implementation inventory, independent of whether a host has configured a listener. */
export const transportCapabilityMatrix: Readonly<
  Record<string, Readonly<TransportCapability>>
> = Object.freeze(
  Object.fromEntries(
    Object.entries({
      http: {
        implementation: 'native',
        request: true,
        serverStream: true,
        bidirectional: false,
        authentication:
          'Explicit HTTP adapter authorization plus gateway endpoint policy',
      },
      ws: {
        implementation: 'native',
        request: false,
        serverStream: true,
        bidirectional: true,
        authentication:
          'Explicit upgrade authorization; application owns message authorization',
      },
      sse: {
        implementation: 'native',
        request: false,
        serverStream: true,
        bidirectional: false,
        authentication: 'Gateway endpoint authorization',
      },
      'json-rpc': {
        implementation: 'native',
        request: true,
        serverStream: false,
        bidirectional: false,
        authentication:
          'Gateway endpoint authorization; application owns method permissions',
      },
      mcp: {
        implementation: 'subset',
        request: true,
        serverStream: false,
        bidirectional: false,
        authentication:
          'Stateless JSON POST subset; gateway endpoint authorization',
      },
      connect: {
        implementation: 'subset',
        request: true,
        serverStream: true,
        bidirectional: true,
        authentication:
          'JSON unary/framed subset; gateway endpoint authorization',
      },
      trpc: {
        implementation: 'subset',
        request: true,
        serverStream: false,
        bidirectional: false,
        authentication: 'JSON bridge only; gateway endpoint authorization',
      },
      grpc: {
        implementation: 'forwarding',
        request: true,
        serverStream: true,
        bidirectional: true,
        authentication:
          'Proxy upstream/host policy; no native service registration',
      },
      webtransport: {
        implementation: 'external',
        request: false,
        serverStream: true,
        bidirectional: true,
        authentication: 'Host-supplied QUIC session handoff',
      },
      http3: {
        implementation: 'external',
        request: true,
        serverStream: true,
        bidirectional: false,
        authentication: 'External terminator owns TLS and ingress policy',
      },
    } satisfies Record<string, TransportCapability>).map(([key, value]) => [
      key,
      Object.freeze(value),
    ])
  )
);
