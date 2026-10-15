/** A local loopback backend. Higher weights receive proportionally more new requests. */
export interface RouteBackend { port: number; weight?: number; }

/** Route info used by the proxy server to map hostnames to ports. */
export interface RouteInfo {
  hostname: string;
  port: number;
  /** Optional traffic pool; single-port routes remain supported. */
  backends?: RouteBackend[];
  /** Registration identity for isolating circuit-breaker history across route takeovers. */
  leaseId?: string;
  pid?: number;
}

export interface ProxyServerOptions {
  /** Opt-in reverse-proxy cache; caches only explicit public GET representations. */
  cache?: import("./proxy-cache.js").ProxyCacheOptions;
  /** Enable transparent streaming compression of eligible unencoded upstream responses. */
  compression?: import("./proxy-compression.js").ProxyCompressionOptions;
  /** Optional application protocols registered at startup. */
  protocols?: import("../protocols/gateway.js").ProtocolGateway;
  /** Advertise external HTTP/3+QUIC termination only if actually configured. */
  http3Terminator?: import("../protocols/transport.js").Http3Terminator;

  /** Optional admission limits for HTTP forwarding (WebSocket upgrades are separate). */
  limits?: import('./proxy-admission.js').ProxyAdmissionOptions;
  /** Called on each request to get the current route table. */
  getRoutes: () => RouteInfo[];
  /** Optional active checks and passive failure isolation for backend pools. */
  backendHealth?: import("./backend-pool.js").BackendHealthOptions;
  /** The port the proxy is listening on (used to build correct URLs). */
  proxyPort: number;
  /** TLD suffix used for hostnames (default: "localhost"). */
  tld?: string;
  /** Optional error logger; defaults to console.error. */
  onError?: (message: string) => void;
  /** Explicit compatibility switch for mixed HTTP/TLS on the same port.
   * Disabled by default to prevent accidental plaintext transport. */
  allowPlainHttp?: boolean;
  /** When provided, enables HTTP/2 over TLS (HTTPS). */
  tls?: {
    cert: Buffer;
    key: Buffer;
    /** SNI callback for per-hostname certificate selection. */
    SNICallback?: (
      servername: string,
      cb: (err: Error | null, ctx?: import("node:tls").SecureContext) => void
    ) => void;
  };
}
