import * as http from 'node:http';
import * as http2 from 'node:http2';
import * as net from 'node:net';
import { trackConnections, type ConnectionTracker } from './drain.js';
import type { ProxyServerOptions } from './types.js';
import { BackendPool } from './backend-pool.js';
import { BackendConnections } from './backend-connections.js';
import { escapeHtml, formatUrl } from './utils.js';
import { ARROW_SVG, renderPage } from './pages.js';
import {
  parseAuthority,
  readHopCount,
  createForwardedHeaders,
  matchProxyRoute,
} from './request-security.js';
import {
  filterProxyHeaders,
  sanitizeForwardedRequestHeaders,
} from './proxy-headers.js';
import { ProxyResponseCache, cachedReadable } from './proxy-cache.js';
import { ProxyAdmission } from './proxy-admission.js';
import { ProxyTelemetry } from './proxy-telemetry.js';
import { http3AltSvc, transportCapabilities } from '../protocols/transport.js';
import { forwardGrpc } from './grpc-forward.js';
import { ApplicationLoadMonitor } from './application-load.js';
import {
  forwardCompressedResponse,
  validateCompressionOptions,
} from './proxy-compression.js';
import type { ProtocolGateway } from '../protocols/gateway.js';

/** Close the explicitly supplied protocol gateway before native listener shutdown so open SSE subscriptions cannot indefinitely retain the listener.
 * @param {net.Server} server - Owned native proxy listener whose close method is wrapped.
 * @param {ProtocolGateway} gateway - Optional explicitly configured gateway; this proxy assumes its close ownership.
 * @returns {void} Installs a close wrapper; await actual listener and gateway settlement separately where required.
 */
function closeProtocolStreams(
  server: net.Server,
  gateway?: ProtocolGateway
): void {
  if (!gateway) {
    return;
  }
  /** Borrowed native close method retained before gateway-close wrapping. */
  const close = server.close.bind(server);
  server.close = ((callback?: (error?: Error) => void) => {
    gateway.close();
    return close(callback);
  }) as typeof server.close;
}

/** Response header used to identify a portless proxy (for health checks). */
export const PORTLESS_HEADER = 'X-Portless';

/** Read native HTTP/2 authority preferentially, otherwise HTTP/1 Host; validate the result before routing.
 * @param {http.IncomingMessage} req - Borrowed native incoming request.
 * @returns {string} Untrusted raw authority or an empty string, never an authorization principal.
 */
function getRequestHost(req: http.IncomingMessage): string {
  // HTTP/2 :authority pseudo-header (available via compatibility API)
  /** Native raw or parsed request authority; parsed host validation precedes routing. */
  const authority = req.headers[':authority'];
  if (typeof authority === 'string' && authority) {
    return authority;
  }
  return req.headers.host || '';
}

/** Construct new peer forwarding metadata from this actual native connection, independently of any client-provided chains.
 * @param {http.IncomingMessage} req - Native incoming request whose authority is separately validated.
 * @param {boolean} tls - Whether the serving proxy listener was configured with TLS.
 * @returns {Record<string, string>} Fresh forwarding fields; caller removes untrusted aliases before merging.
 */
function buildForwardedHeaders(
  req: http.IncomingMessage,
  tls: boolean
): Record<string, string> {
  return createForwardedHeaders(
    getRequestHost(req),
    req.socket.remoteAddress,
    tls
  );
}

/**
 * Request header tracking how many times a request has passed through a
 * portless proxy. Used to detect forwarding loops (e.g. a frontend dev
 * server proxying back through portless without rewriting the Host header).
 */
const PORTLESS_HOPS_HEADER = 'x-portless-hops';

/**
 * Maximum number of times a request may pass through the portless proxy
 * before it is rejected as a loop. Two hops is normal when a frontend
 * proxies API calls to a separate portless-managed backend; five gives
 * comfortable headroom for multi-tier setups while catching loops quickly.
 */
const MAX_PROXY_HOPS = 5;

/** Match exact normalized hostname first, then the longest parent-domain route from the trusted registry.
 * @param {{ hostname: string; port: number }[]} routes - Borrowed host-owned operational route records.
 * @param {string} host - Previously parsed normalized request hostname.
 * @returns {{ hostname: string; port: number } | undefined} Borrowed selected route; wildcard routing does not authenticate a tenant.
 */
function findRoute(routes: { hostname: string; port: number }[], host: string) {
  return matchProxyRoute(routes, host);
}

/** Server type returned by createProxyServer (plain HTTP/1.1 or net.Server TLS wrapper). */
export type ProxyServer = (http.Server | net.Server) & {
  /** Owned accepted-TCP tracker; await drain for actual socket shutdown. */
  connectionTracker: ConnectionTracker;
  /** Owned bounded health/selection state; native server close clears its timers. */
  backendPool: BackendPool;
  /** Actual accepted upstream-session tracker used for generation drains. */
  backendConnections: BackendConnections;
  /** Owned process-local explicitly public identity-response cache, never durable storage. */
  responseCache: ProxyResponseCache;
  /** Bounded fixed-coverage operational observations, separate from marketing analytics. */
  telemetry: ProxyTelemetry;
  /** Host-only aggregate proxy-load reader; no private path or peer labels are returned. */
  getLoadStatus: (
    windowMs?: number
  ) => import('./proxy-telemetry.js').ProxyLoadStatus;
  /** Host-authorized route aggregate reader; labels are not authentication. */
  getApplicationLoad: (
    hostname: string,
    windowMs?: number
  ) => import('./proxy-telemetry.js').RouteLoadStatus;
  /** Explicit host-authorized PID/resource observation reader; no worker identity is inferred from routes. */
  getApplicationUsage: (
    hostname: string,
    pids?: readonly number[],
    windowMs?: number
  ) => Promise<import('./application-load.js').ApplicationUsage>;
  /** Fixed-label process-local capacity and denial counters. */
  getAdmissionStatus: () => ReturnType<ProxyAdmission['stats']>;
  /** Actual transport/terminator capability metadata; declaration is not implementation parity. */
  capabilities: import('../protocols/transport.js').TransportCapabilities;
};

/** Acquire a native HTTP/TLS proxy object with bounded health/admission/cache owners; the host explicitly binds it and owns close/drain. Requests use fresh trusted routes, loopback upstreams and never replay partial writes.
 * @param {ProxyServerOptions} options - Trusted explicit route/transport/TLS/budget configuration; protocol handlers retain their own authorization boundaries.
 * @returns {ProxyServer} Owned server with actual TCP drain tracking and fixed aggregate diagnostics; close dependent gateway/backend health owners before releasing host state.
 */
export function createProxyServer(options: ProxyServerOptions): ProxyServer {
  /** Explicit trusted proxy configuration separated once before acquiring its owned native/helper resources. */
  const {
    getRoutes,
    proxyPort,
    tld = 'localhost',
    onError = (msg: string) => console.error(JSON.stringify(msg)),
    tls,
    allowPlainHttp = false,
    backendHealth,
    limits,
    protocols,
    http3Terminator,
    compression,
    cache,
  } = options;
  /** Trusted configured suffix used only in escaped status-page suggestions. */
  const tldSuffix = `.${tld}`;

  /** Listener configuration TLS flag; mixed plaintext support remains an explicit legacy policy. */
  const isTls = !!tls;
  /** Owned bounded backend health/selection owner, closed by native server shutdown. */
  const backendPool = new BackendPool(getRoutes, backendHealth);
  /** Owned actual upstream accepted-session tracker; drains observe this shared owner. */
  const backendConnections = new BackendConnections();
  /** Owned bounded process-local direct-peer request/stream accounting. */
  const admission = new ProxyAdmission(limits);
  /** Owned opt-in explicitly public identity-response cache; encoded bytes are not stored. */
  const responseCache = new ProxyResponseCache(cache);
  /** Owned bounded operational response observations, excluding private request bodies. */
  const telemetry = new ProxyTelemetry();
  /** Aggregate reader borrowing the actual proxy telemetry/session owners. */
  const loadMonitor = new ApplicationLoadMonitor(telemetry, backendConnections);
  /** Optional validated external HTTP/3 handoff advertisement, not native QUIC support. */
  const altSvc = http3AltSvc(http3Terminator);
  /** Validated single-layer response compression/representation policy. */
  const compressionConfig = validateCompressionOptions(compression);
  /** Explicit actual runtime forwarding/terminator capability receipt. */
  const capabilities = transportCapabilities({
    tls: !!tls,
    terminator: http3Terminator,
  });
  /** Host-only reader methods over the actual serving proxy owners; not browser authorization endpoints. */
  const metrics = {
    responseCache,
    telemetry,
    getLoadStatus: (windowMs?: number) => telemetry.snapshot(windowMs),
    getApplicationLoad: (hostname: string, windowMs?: number) =>
      telemetry.application(hostname, windowMs),
    getApplicationUsage: (
      hostname: string,
      pids?: readonly number[],
      windowMs?: number
    ) => {
      /** Trusted matching registry record selected from the currently supplied route inventory. */
      const route = getRoutes().find((item) => item.hostname === hostname);
      /** Current validated backend inventory or the legacy single-port route; empty when not registered. */
      let ports: number[];
      if (route?.backends?.length) {
        ports = route.backends.map((item) => item.port);
      } else if (route) {
        ports = [route.port];
      } else {
        ports = [];
      }
      return loadMonitor.usage(hostname, ports, pids, windowMs);
    },
    capabilities,
  };

  /** Handle one native request with authority/hop/admission validation before selecting a loopback upstream.
   * @param {http.IncomingMessage} req Borrowed incoming request with untrusted headers/body.
   * @param {http.ServerResponse} res Borrowed native response whose actual finish/close releases accepted work.
   * @returns {void} Starts bounded forwarding; partial upstream writes are never automatically replayed. */
  const handleRequest = (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) => {
    res.setHeader(PORTLESS_HEADER, '1');
    if (altSvc && isTls) {
      res.setHeader('Alt-Svc', altSvc);
    }

    /** Fresh host-owned route inventory; request metadata cannot add or replace entries. */
    const routes = getRoutes();
    backendPool.sync(routes);
    /** Native raw or parsed request authority; parsed host validation precedes routing. */
    const authority = parseAuthority(getRequestHost(req));
    /** Parsed normalized authority hostname used for routing, never verified tenant identity. */
    const host = authority?.hostname || '';
    telemetry.observe(req, res, () => findRoute(routes, host)?.hostname);

    if (!host) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing Host header');
      return;
    }

    /** Validated bounded internal proxy traversal counter. */
    const hops = readHopCount(req.headers[PORTLESS_HOPS_HEADER]);
    if (hops === null) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid proxy hop count');
      return;
    }
    if (hops >= MAX_PROXY_HOPS) {
      onError(
        `Loop detected for ${host}: request has passed through portless ${hops} times. ` +
          `This usually means a backend is proxying back through portless without rewriting ` +
          `the Host header. If you use Vite/webpack proxy, set changeOrigin: true.`
      );
      res.writeHead(508, { 'Content-Type': 'text/html' });
      res.end(
        renderPage(
          508,
          'Loop Detected',
          `<div class="content"><p class="desc">This request has passed through portless ${hops} times. This usually means a dev server (Vite, webpack, etc.) is proxying requests back through portless without rewriting the Host header.</p><div class="section"><p class="label">Fix: add changeOrigin to your proxy config</p><pre class="terminal">proxy: {
  "/api": {
    target: "http://&lt;backend&gt;${escapeHtml(tldSuffix)}:&lt;port&gt;",
    changeOrigin: true,
  },
}</pre></div></div>`
        )
      );
      return;
    }

    /** Owned request-capacity receipt released once on actual response finish/close. */
    const permit = admission.acquire(req.socket.remoteAddress);
    if (!permit.allowed) {
      res.writeHead(permit.status, {
        'Content-Type': 'text/plain',
        'Retry-After': '1',
      });
      res.end(
        permit.status === 429
          ? 'Request rate limit exceeded'
          : 'Too many active requests'
      );
      return;
    }
    res.once('close', permit.release);
    res.once('finish', permit.release);

    /** Trusted matching registry record selected from the currently supplied route inventory. */
    const route = findRoute(routes, host);

    // Reserved application protocol endpoints take precedence over proxy routes.
    if (protocols) {
      /** Parsed request path used only to select explicitly configured protocol handlers. */
      const path = req.url?.split('?')[0] ?? '/';
      if (
        path === '/mcp' ||
        path === '/rpc' ||
        path === '/events' ||
        path.startsWith('/trpc/') ||
        protocols.connect.has(path) ||
        protocols.connectStream.has(path)
      ) {
        void protocols
          .handle(req, res)
          .then((handled) => {
            if (!handled && !res.headersSent) {
              res.writeHead(404);
              res.end();
            }
          })
          .catch(() => {
            if (!res.headersSent) {
              res.writeHead(500);
            }
            res.end();
          });
        return;
      }
    }

    if (!route) {
      /** HTML-text-escaped request hostname used only in the fixed status template. */
      const safeHost = escapeHtml(host);
      /** Normalized host with the configured suffix removed for a command suggestion. */
      const strippedHost = host.endsWith(tldSuffix)
        ? host.slice(0, -tldSuffix.length)
        : host;
      /** Escaped inert suggestion text; it is never executed as a shell command. */
      const safeSuggestion = escapeHtml(strippedHost);
      /** Authored status-page markup with every dynamic route/link value escaped at insertion. */
      const routesList =
        routes.length > 0
          ? `<div class="section"><p class="label">Active apps</p><ul class="card">${routes.map((r) => `<li><a href="${escapeHtml(formatUrl(r.hostname, proxyPort, isTls))}" class="card-link"><span class="name">${escapeHtml(r.hostname)}</span><span class="meta"><code class="port">127.0.0.1:${escapeHtml(String(r.port))}</code><span class="arrow">${ARROW_SVG}</span></span></a></li>`).join('')}</ul></div>`
          : '<p class="empty">No apps running.</p>';
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(
        renderPage(
          404,
          'Not Found',
          `<div class="content"><p class="desc">No app registered for <strong>${safeHost}</strong></p>${routesList}<div class="section"><div class="terminal"><span class="prompt">$ </span>portless ${safeSuggestion} your-command</div></div></div>`
        )
      );
      return;
    }

    /** Optional validated native request byte ceiling enforced before and during streaming. */
    const maxBody = admission.maxBodyBytes;
    /** Untrusted Content-Length string checked against the configured byte ceiling. */
    const declaredLength = req.headers['content-length'];
    if (
      maxBody !== null &&
      declaredLength !== undefined &&
      (typeof declaredLength !== 'string' ||
        !/^\d+$/.test(declaredLength) ||
        BigInt(declaredLength) > BigInt(maxBody))
    ) {
      res.writeHead(413, { 'Content-Type': 'text/plain', Connection: 'close' });
      res.end('Request body too large');
      req.resume();
      return;
    }
    /** Whether this uncredentialed bodyless GET may consult public identity storage. */
    const cacheEnabledForRequest = responseCache.requestEligible(req);
    /** Current route/backend signature partitioning cached public representations. */
    const cacheSignature = backendPool.signature(route);
    /** Exact host/backend/request-URL key, including query bytes. */
    const cacheKey = responseCache.key(
      route.hostname,
      cacheSignature,
      req.url ?? '/'
    );
    if (cacheEnabledForRequest) {
      /** Fresh retained public identity bytes, recompressed only by the serving representation owner. */
      const hit = responseCache.get(cacheKey);
      if (hit) {
        forwardCompressedResponse(
          req,
          cachedReadable(hit),
          res,
          compressionConfig
        );
        return;
      }
    }
    /** Selected currently healthy loopback backend; absence returns explicit service unavailability. */
    const target = backendPool.select(route);
    if (!target) {
      res.writeHead(503, { 'Content-Type': 'text/plain', 'Retry-After': '1' });
      res.end('No healthy application instances');
      return;
    }
    /** Captured route-generation signature fencing later circuit feedback. */
    const routeSignature = backendPool.signature(route);
    /** Owned actual upstream-session release callback, called once at terminal settlement. */
    const releaseBackend = backendConnections.track(
      route.hostname,
      target.port
    );
    /** Monotonic accepted-upstream timestamp for bounded operational latency. */
    const startedAt = process.hrtime.bigint();
    let recorded = false;
    /** Release one accepted backend session and record its actual response/abort observation once.
     * @param {boolean} aborted Whether native response completion was interrupted.
     * @returns {void} Records bounded latency/status without private payload or request labels. */
    const finishHttp = (aborted: boolean) => {
      if (recorded) {
        return;
      }
      recorded = true;
      releaseBackend();
      /** Monotonic observed response duration, capped before aggregate storage. */
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      backendConnections.recordHttp(
        route.hostname,
        target.port,
        Math.min(elapsedMs, 86_400_000),
        aborted ? 502 : res.statusCode
      );
    };
    res.once('finish', () => finishHttp(false));
    res.once('close', () => finishHttp(!res.writableFinished));
    /** Fresh serving-connection peer identity, never copied from untrusted forwarding chains. */
    const forwardedHeaders = buildForwardedHeaders(req, isTls);
    /** Detached end-to-end request metadata stripped of hop and spoofed peer fields. */
    const proxyReqHeaders = sanitizeForwardedRequestHeaders(
      filterProxyHeaders(req.headers)
    );
    for (const [key, value] of Object.entries(forwardedHeaders)) {
      proxyReqHeaders[key] = value;
    }
    proxyReqHeaders[PORTLESS_HOPS_HEADER] = String(hops + 1);
    // Remove HTTP/2 pseudo-headers before forwarding to HTTP/1.1 backend
    for (const key of Object.keys(proxyReqHeaders)) {
      if (key.startsWith(':')) {
        delete proxyReqHeaders[key];
      }
    }

    if (
      /^application\/grpc(?:\+|;|$)/i.test(
        String(req.headers['content-type'] ?? '')
      )
    ) {
      forwardGrpc(
        req,
        res,
        target.port,
        proxyReqHeaders as Record<string, string>,
        {
          success: () =>
            backendPool.markSuccess(
              route.hostname,
              target.port,
              routeSignature
            ),
          failure: () =>
            backendPool.markFailure(
              route.hostname,
              target.port,
              routeSignature
            ),
        }
      );
      return;
    }
    let clientAborted = false;
    /** Owned one-request loopback HTTP client; abort/peer close destroys it without replay. */
    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: target.port,
        path: req.url,
        method: req.method,
        headers: proxyReqHeaders,
      },
      (proxyRes) => {
        backendPool.markSuccess(route.hostname, target.port, routeSignature);
        /** Detached permitted upstream response metadata before serving-layer encoding. */
        const responseHeaders = filterProxyHeaders(proxyRes.headers);
        proxyRes.on('error', () => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
          }
          res.end();
        });
        /** Native upstream readable paired with filtered identity metadata. */
        const upstream = Object.assign(proxyRes, { headers: responseHeaders });
        /** Identity source or bounded public capture relay before one compression owner runs. */
        const representation =
          cacheEnabledForRequest && !res.destroyed
            ? responseCache.capture(
                upstream,
                cacheKey,
                route.hostname,
                req.url ?? '/'
              )
            : upstream;
        forwardCompressedResponse(req, representation, res, compressionConfig);
      }
    );

    proxyReq.setTimeout(30_000, () =>
      proxyReq.destroy(new Error('Upstream timeout'))
    );
    proxyReq.on('error', (err) => {
      if (!clientAborted) {
        backendPool.markFailure(route.hostname, target.port, routeSignature);
      }
      if (!clientAborted) {
        onError(`Proxy error for ${getRequestHost(req)}: ${err.message}`);
      }
      if (!res.headersSent) {
        /** Native private upstream failure used only to choose a fixed safe status explanation. */
        const errWithCode = err as NodeJS.ErrnoException;
        /** Fixed authored safe failure explanation; raw causes are not inserted into page markup. */
        const detail =
          errWithCode.code === 'ECONNREFUSED'
            ? 'The target app is not responding. It may have crashed.'
            : 'The target app may not be running.';
        res.writeHead(502, { 'Content-Type': 'text/html' });
        res.end(
          renderPage(
            502,
            'Bad Gateway',
            `<div class="content"><p class="desc">${escapeHtml(detail)}</p></div>`
          )
        );
      } else {
        res.destroy(err);
      }
    });

    // Abort the outgoing request if the client disconnects
    res.on('close', () => {
      if (!proxyReq.destroyed) {
        clientAborted = true;
        proxyReq.destroy();
      }
    });

    req.on('error', () => {
      if (!proxyReq.destroyed) {
        clientAborted = true;
        proxyReq.destroy();
      }
    });

    if (maxBody !== null) {
      let received = 0;
      req.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > maxBody && !res.writableEnded) {
          clientAborted = true;
          req.unpipe(proxyReq);
          proxyReq.destroy();
          // The upstream might already have started a response. HTTP forbids
          // sending a second status line after headers; abort the partial
          // response instead of writing an invalid 413 into a live stream.
          if (res.headersSent) {
            res.destroy();
          } else {
            res.writeHead(413, {
              'Content-Type': 'text/plain',
              Connection: 'close',
            });
            res.end('Request body too large');
          }
          req.resume();
        }
      });
    }
    req.pipe(proxyReq);
  };

  /** Validate one native WebSocket handshake before reserving stream/backend capacity and tunnelling actual bytes.
   * @param {http.IncomingMessage} req Borrowed untrusted HTTP upgrade request.
   * @param {net.Socket} socket Borrowed accepted client socket, retained through tunnel cleanup.
   * @param {Buffer} head Already-read client bytes preserved until upstream 101 succeeds.
   * @returns {void} Opens at most one loopback upstream; handshake failure is never replayed. */
  const handleUpgrade = (
    req: http.IncomingMessage,
    socket: net.Socket,
    head: Buffer
  ) => {
    socket.on('error', () => socket.destroy());
    // Only a WebSocket GET handshake may open an indefinite tunnel. Reject
    // malformed/unknown upgrade protocols before reserving backend capacity.
    /** Untrusted native Upgrade header requiring the exact supported protocol. */
    const upgrade = req.headers.upgrade;
    /** Untrusted WebSocket nonce or cache-field name; each owning loop validates its own context. */
    const key = req.headers['sec-websocket-key'];
    /** Native Connection header requiring an explicit upgrade token. */
    const connection = req.headers.connection;
    /** Strict standard WebSocket nonce syntax and decoded byte-length validation. */
    const validKey =
      typeof key === 'string' &&
      /^[a-zA-Z0-9+/]{22}==$/.test(key) &&
      Buffer.from(key, 'base64').length === 16;
    if (
      req.method !== 'GET' ||
      typeof upgrade !== 'string' ||
      upgrade.toLowerCase() !== 'websocket' ||
      typeof connection !== 'string' ||
      !connection
        .split(',')
        .some((token) => token.trim().toLowerCase() === 'upgrade') ||
      req.headers['sec-websocket-version'] !== '13' ||
      !validKey
    ) {
      socket.end(
        'HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
      );
      return;
    }

    /** Validated bounded internal proxy traversal counter. */
    const hops = readHopCount(req.headers[PORTLESS_HOPS_HEADER]);
    if (hops === null || !parseAuthority(getRequestHost(req))) {
      socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (hops >= MAX_PROXY_HOPS) {
      /** Parsed normalized authority hostname used for routing, never verified tenant identity. */
      const host = parseAuthority(getRequestHost(req))?.hostname || '';
      onError(
        `WebSocket loop detected for ${host}: request has passed through portless ${hops} times. ` +
          `Set changeOrigin: true in your proxy config.`
      );
      socket.end(
        'HTTP/1.1 508 Loop Detected\r\n' +
          'Content-Type: text/plain\r\n' +
          '\r\n' +
          'Loop Detected: request has passed through portless too many times.\n' +
          'Add changeOrigin: true to your dev server proxy config.\n'
      );
      return;
    }

    /** Fresh host-owned route inventory; request metadata cannot add or replace entries. */
    const routes = getRoutes();
    backendPool.sync(routes);
    /** Parsed normalized authority hostname used for routing, never verified tenant identity. */
    const host = parseAuthority(getRequestHost(req))?.hostname || '';
    /** Trusted matching registry record selected from the currently supplied route inventory. */
    const route = findRoute(routes, host);

    if (!route) {
      socket.end(
        'HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'
      );
      return;
    }
    /** Owned stream reservation within the global request budget, held until native socket close. */
    const upgradePermit = admission.acquire(socket.remoteAddress, 'stream');
    if (!upgradePermit.allowed) {
      socket.end(
        `HTTP/1.1 ${upgradePermit.status} ${upgradePermit.status === 429 ? 'Too Many Requests' : 'Service Unavailable'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
      );
      return;
    }
    socket.once('close', upgradePermit.release);
    /** Selected currently healthy loopback backend; absence returns explicit service unavailability. */
    const target = backendPool.select(route);
    if (!target) {
      socket.end(
        'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nRetry-After: 1\r\nConnection: close\r\n\r\n'
      );
      return;
    }

    /** Captured route-generation signature fencing later circuit feedback. */
    const routeSignature = backendPool.signature(route);
    /** Owned actual upstream-session release callback, called once at terminal settlement. */
    const releaseBackend = backendConnections.track(
      route.hostname,
      target.port
    );
    socket.once('close', releaseBackend);

    /** Fresh serving-connection peer identity, never copied from untrusted forwarding chains. */
    const forwardedHeaders = buildForwardedHeaders(req, isTls);
    /** Detached end-to-end request metadata stripped of hop and spoofed peer fields. */
    const proxyReqHeaders = sanitizeForwardedRequestHeaders(
      filterProxyHeaders(req.headers, { preserveUpgrade: true })
    );
    for (const [key, value] of Object.entries(forwardedHeaders)) {
      proxyReqHeaders[key] = value;
    }
    proxyReqHeaders[PORTLESS_HOPS_HEADER] = String(hops + 1);
    // Remove HTTP/2 pseudo-headers before forwarding to HTTP/1.1 backend
    for (const key of Object.keys(proxyReqHeaders)) {
      if (key.startsWith(':')) {
        delete proxyReqHeaders[key];
      }
    }

    // Upgrade head bytes belong to the tunneled protocol, not to the
    // HTTP request body. Preserve them until the upstream acknowledges 101.
    /** Owned one-request loopback HTTP client; abort/peer close destroys it without replay. */
    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: target.port,
      path: req.url,
      method: req.method,
      headers: proxyReqHeaders,
    });
    let upstreamSocket: net.Socket | undefined;
    let established = false;
    /** Destroy both tunnel peers and any pending handshake once a side closes/errors.
     * @returns {void} Cancels native transport; no application message is reinserted or retried. */
    const closeBoth = () => {
      upstreamSocket?.destroy();
      socket.destroy();
      if (!proxyReq.destroyed) {
        proxyReq.destroy();
      }
    };
    // A half-closed upgraded TCP stream cannot serve another WebSocket frame.
    // Destroy its peer promptly; waiting for both close events can stall drains.
    socket.once('end', closeBoth);
    socket.once('close', () => {
      upstreamSocket?.destroy();
      if (!proxyReq.destroyed) {
        proxyReq.destroy();
      }
    });

    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      // Forward the backend's actual 101 response including Sec-WebSocket-Accept,
      // subprotocol negotiation, and extension headers.
      let response = `HTTP/1.1 101 Switching Protocols\r\n`;
      /** Filtered actual upstream 101 fields, retaining only explicit upgrade semantics. */
      const safeUpgrade = filterProxyHeaders(proxyRes.headers, {
        preserveUpgrade: true,
      });
      for (const [name, value] of Object.entries(safeUpgrade)) {
        if (value !== undefined) {
          response += `${name}: ${String(value)}\r\n`;
        }
      }
      response += '\r\n';
      established = true;
      backendPool.markSuccess(route.hostname, target.port, routeSignature);
      upstreamSocket = proxySocket;
      // Any data read ahead from either side must be delivered before piping.
      socket.write(response);
      if (proxyHead.length) {
        socket.write(proxyHead);
      }
      if (head.length) {
        proxySocket.write(head);
      }
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
      proxySocket.once('close', () => socket.destroy());
      proxySocket.once('end', closeBoth);
      proxySocket.once('error', closeBoth);
      socket.once('error', closeBoth);
    });

    // Timeout applies to the handshake; idle upgraded connections may live indefinitely.
    proxyReq.setTimeout(30_000, () =>
      proxyReq.destroy(new Error('Upstream handshake timeout'))
    );
    proxyReq.on('error', (err) => {
      if (!established) {
        backendPool.markFailure(route.hostname, target.port, routeSignature);
        onError(
          `WebSocket proxy error for ${getRequestHost(req)}: ${err.message}`
        );
      }
      closeBoth();
    });

    proxyReq.on('response', (res) => {
      backendPool.markSuccess(route.hostname, target.port, routeSignature);
      // The backend responded with a normal HTTP response instead of upgrading.
      // Forward the rejection to the client.
      if (!socket.destroyed) {
        let response = `HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n`;
        /** Filtered actual upstream non-upgrade rejection fields. */
        const safeResponse = filterProxyHeaders(res.headers);
        for (const [name, value] of Object.entries(safeResponse)) {
          if (value !== undefined) {
            response += `${name}: ${String(value)}\r\n`;
          }
        }
        response += '\r\n';
        socket.write(response);
        res.on('error', () => socket.destroy());
        res.pipe(socket);
        res.once('end', () => socket.end());
      }
    });

    proxyReq.end();
  };

  if (tls) {
    /** Owned non-listening native secure HTTP/2/HTTP1 server fed only by the outer wrapper. */
    const h2Server = http2.createSecureServer({
      cert: tls.cert,
      key: tls.key,
      allowHTTP1: true,
      minVersion: 'TLSv1.2',
      ...(tls.SNICallback ? { SNICallback: tls.SNICallback } : {}),
    });
    // With allowHTTP1, the 'request' event receives objects compatible with
    // http.IncomingMessage / http.ServerResponse. Cast explicitly to satisfy TypeScript.
    h2Server.on(
      'request',
      (req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) => {
        handleRequest(
          req as unknown as http.IncomingMessage,
          res as unknown as http.ServerResponse
        );
      }
    );
    // WebSocket upgrades arrive over HTTP/1.1 connections (allowHTTP1)
    h2Server.on(
      'upgrade',
      (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
        handleUpgrade(req, socket, head);
      }
    );

    // Plain HTTP server using the same proxy handlers (no TLS, no redirect)
    /** Owned non-listening compatibility HTTP handler, enabled only by explicit mixed-port policy. */
    const plainServer = http.createServer(handleRequest);
    plainServer.on('upgrade', handleUpgrade);

    // Wrap both in a net.Server that peeks at the first byte to decide
    // whether the connection is TLS (0x16 = ClientHello) or plain HTTP.
    /** Owned native listener peeking one protocol byte before forwarding to a non-listening internal server. */
    const wrapper = net.createServer((socket) => {
      // A peer that connects without sending protocol bytes must not hold a slot forever.
      socket.setTimeout(10_000, () => socket.destroy());
      socket.once('readable', () => {
        socket.setTimeout(0);
        /** One peeked native protocol byte restored before TLS/plaintext dispatch. */
        const buf: Buffer | null = socket.read(1);
        if (!buf) {
          socket.destroy();
          return;
        }
        socket.unshift(buf);
        if (buf[0] === 0x16) {
          // TLS handshake -> HTTP/2 secure server
          h2Server.emit('connection', socket);
        } else if (allowPlainHttp) {
          // Compatibility-only: mixed plaintext/TLS on the same port.
          plainServer.emit('connection', socket);
        } else {
          socket.end(
            'HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
          );
        }
      });
    });

    // The wrapper owns the listening socket and tracks even TLS/HTTP2 tunnels.
    // Inner servers never listen directly, so calling close() on them throws.
    if (admission.maxConnections !== undefined) {
      wrapper.maxConnections = admission.maxConnections;
    }
    wrapper.once('close', () => {
      backendPool.close();
      protocols?.close();
    });
    closeProtocolStreams(wrapper, protocols);
    return Object.assign(wrapper, {
      getAdmissionStatus: () => admission.stats(),
      connectionTracker: trackConnections(wrapper),
      backendPool,
      backendConnections,
      ...metrics,
    });
  }

  /** Owned native HTTP1 listener returned for explicit host bind/close. */
  const httpServer = http.createServer(handleRequest);
  httpServer.on('upgrade', handleUpgrade);
  if (admission.maxConnections !== undefined) {
    httpServer.maxConnections = admission.maxConnections;
  }

  httpServer.once('close', () => {
    backendPool.close();
    protocols?.close();
  });
  closeProtocolStreams(httpServer, protocols);
  return Object.assign(httpServer, {
    getAdmissionStatus: () => admission.stats(),
    connectionTracker: trackConnections(httpServer),
    backendPool,
    backendConnections,
    ...metrics,
  });
}
