import * as http from "node:http";
import * as http2 from "node:http2";
import * as net from "node:net";
import { trackConnections, type ConnectionTracker } from "./drain.js";
import type { ProxyServerOptions } from "./types.js";
import { BackendPool } from "./backend-pool.js";
import { BackendConnections } from "./backend-connections.js";
import { escapeHtml, formatUrl } from "./utils.js";
import { ARROW_SVG, renderPage } from "./pages.js";
import { parseAuthority, readHopCount, createForwardedHeaders, matchProxyRoute } from "./request-security.js";
import { filterProxyHeaders } from "./proxy-headers.js";
import { ProxyResponseCache, cachedReadable } from './proxy-cache.js';
import { ProxyAdmission } from './proxy-admission.js';
import { ProxyTelemetry } from './proxy-telemetry.js';
import { http3AltSvc, transportCapabilities } from '../protocols/transport.js';
import { forwardGrpc } from './grpc-forward.js';
import { ApplicationLoadMonitor } from './application-load.js';
import { forwardCompressedResponse, validateCompressionOptions } from './proxy-compression.js';
import type { ProtocolGateway } from '../protocols/gateway.js';

/** Finish long-lived protocol streams before waiting for close callbacks.
 * HTTP server.close() otherwise waits forever for an SSE client to disconnect.
 */
function closeProtocolStreams(server: net.Server, gateway?: ProtocolGateway): void {
  if (!gateway) return;
  const close = server.close.bind(server);
  server.close = ((callback?: (error?: Error) => void) => { gateway.close(); return close(callback); }) as typeof server.close;
}

/** Response header used to identify a portless proxy (for health checks). */
export const PORTLESS_HEADER = "X-Portless";

/**
 * Get the effective host value from a request.
 * HTTP/2 uses the :authority pseudo-header; HTTP/1.1 uses Host.
 */
function getRequestHost(req: http.IncomingMessage): string {
  // HTTP/2 :authority pseudo-header (available via compatibility API)
  const authority = req.headers[":authority"];
  if (typeof authority === "string" && authority) return authority;
  return req.headers.host || "";
}

/**
 * Build X-Forwarded-* headers for a proxied request.
 */
function buildForwardedHeaders(req: http.IncomingMessage, tls: boolean): Record<string, string> {
  return createForwardedHeaders(getRequestHost(req), req.socket.remoteAddress, tls);
}

/**
 * Request header tracking how many times a request has passed through a
 * portless proxy. Used to detect forwarding loops (e.g. a frontend dev
 * server proxying back through portless without rewriting the Host header).
 */
const PORTLESS_HOPS_HEADER = "x-portless-hops";

/**
 * Maximum number of times a request may pass through the portless proxy
 * before it is rejected as a loop. Two hops is normal when a frontend
 * proxies API calls to a separate portless-managed backend; five gives
 * comfortable headroom for multi-tier setups while catching loops quickly.
 */
const MAX_PROXY_HOPS = 5;

/**
 * Find the route matching a given host. Matches exact hostname first, then
 * falls back to wildcard subdomain matching (e.g. tenant.myapp.localhost
 * matches a route registered for myapp.localhost).
 */
function findRoute(routes: { hostname: string; port: number }[], host: string) {
  return matchProxyRoute(routes, host);
}

/** Server type returned by createProxyServer (plain HTTP/1.1 or net.Server TLS wrapper). */
export type ProxyServer = (http.Server | net.Server) & { connectionTracker: ConnectionTracker; backendPool: BackendPool; backendConnections: BackendConnections; responseCache: ProxyResponseCache; telemetry: ProxyTelemetry; getLoadStatus: (windowMs?: number) => import("./proxy-telemetry.js").ProxyLoadStatus; getApplicationLoad: (hostname: string, windowMs?: number) => import("./proxy-telemetry.js").RouteLoadStatus; getApplicationUsage: (hostname: string, pids?: readonly number[], windowMs?: number) => Promise<import("./application-load.js").ApplicationUsage>; capabilities: import("../protocols/transport.js").TransportCapabilities };

/**
 * Create an HTTP proxy server that routes requests based on the Host header.
 *
 * Uses Node's built-in http module for proxying (no external dependencies).
 * The `getRoutes` callback is invoked on every request so callers can provide
 * either a static list or a live-updating one.
 *
 * When `tls` is provided, creates an HTTP/2 secure server with HTTP/1.1
 * fallback (`allowHTTP1: true`). This enables HTTP/2 multiplexing for
 * browsers while keeping WebSocket upgrades working over HTTP/1.1.
 */
export function createProxyServer(options: ProxyServerOptions): ProxyServer {
  const {
    getRoutes,
    proxyPort,
    tld = "localhost",
    onError = (msg: string) => console.error(msg),
    tls,
    allowPlainHttp = false,
    backendHealth,
    limits,
    protocols,
    http3Terminator,
    compression,
    cache,
  } = options;
  const tldSuffix = `.${tld}`;

  const isTls = !!tls;
  const backendPool = new BackendPool(getRoutes, backendHealth);
  const backendConnections = new BackendConnections();
  const admission = new ProxyAdmission(limits);
  const responseCache = new ProxyResponseCache(cache);
  const telemetry = new ProxyTelemetry();
  const loadMonitor = new ApplicationLoadMonitor(telemetry, backendConnections);
  const altSvc = http3AltSvc(http3Terminator);
  const compressionConfig = validateCompressionOptions(compression);
  const capabilities = transportCapabilities({ tls: !!tls, terminator: http3Terminator });
  const metrics = { responseCache, telemetry, getLoadStatus: (windowMs?: number) => telemetry.snapshot(windowMs), getApplicationLoad: (hostname: string, windowMs?: number) => telemetry.application(hostname, windowMs),
    getApplicationUsage: (hostname: string, pids?: readonly number[], windowMs?: number) => {
      const route = getRoutes().find(item => item.hostname === hostname);
      const ports = route?.backends?.length ? route.backends.map(item => item.port) : route ? [route.port] : [];
      return loadMonitor.usage(hostname, ports, pids, windowMs);
    }, capabilities };

  const handleRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    res.setHeader(PORTLESS_HEADER, "1");
    if (altSvc && isTls) res.setHeader("Alt-Svc", altSvc);

    const routes = getRoutes();
    backendPool.sync(routes);
    const authority = parseAuthority(getRequestHost(req));
    const host = authority?.hostname || "";
    telemetry.observe(req, res, () => findRoute(routes, host)?.hostname);

    if (!host) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing Host header");
      return;
    }

    const hops = readHopCount(req.headers[PORTLESS_HOPS_HEADER]);
    if (hops === null) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Invalid proxy hop count");
      return;
    }
    if (hops >= MAX_PROXY_HOPS) {
      onError(
        `Loop detected for ${host}: request has passed through portless ${hops} times. ` +
          `This usually means a backend is proxying back through portless without rewriting ` +
          `the Host header. If you use Vite/webpack proxy, set changeOrigin: true.`
      );
      res.writeHead(508, { "Content-Type": "text/html" });
      res.end(
        renderPage(
          508,
          "Loop Detected",
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

    const permit = admission.acquire(req.socket.remoteAddress);
    if (!permit.allowed) {
      res.writeHead(permit.status, { 'Content-Type': 'text/plain', 'Retry-After': '1' });
      res.end(permit.status === 429 ? 'Request rate limit exceeded' : 'Too many active requests');
      return;
    }
    res.once('close', permit.release);
    res.once('finish', permit.release);

    const route = findRoute(routes, host);

    // Reserved application protocol endpoints take precedence over proxy routes.
    if (protocols) {
      const path = req.url?.split("?")[0] ?? "/";
      if (path === "/mcp" || path === "/rpc" || path === "/events" || path.startsWith("/trpc/") || protocols.connect.has(path) || protocols.connectStream.has(path)) {
        void protocols.handle(req, res).then(handled => { if (!handled && !res.headersSent) { res.writeHead(404); res.end(); } }).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
        return;
      }
    }

    if (!route) {
      const safeHost = escapeHtml(host);
      const strippedHost = host.endsWith(tldSuffix) ? host.slice(0, -tldSuffix.length) : host;
      const safeSuggestion = escapeHtml(strippedHost);
      const routesList =
        routes.length > 0
          ? `<div class="section"><p class="label">Active apps</p><ul class="card">${routes.map((r) => `<li><a href="${escapeHtml(formatUrl(r.hostname, proxyPort, isTls))}" class="card-link"><span class="name">${escapeHtml(r.hostname)}</span><span class="meta"><code class="port">127.0.0.1:${escapeHtml(String(r.port))}</code><span class="arrow">${ARROW_SVG}</span></span></a></li>`).join("")}</ul></div>`
          : '<p class="empty">No apps running.</p>';
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end(
        renderPage(
          404,
          "Not Found",
          `<div class="content"><p class="desc">No app registered for <strong>${safeHost}</strong></p>${routesList}<div class="section"><div class="terminal"><span class="prompt">$ </span>portless ${safeSuggestion} your-command</div></div></div>`
        )
      );
      return;
    }

    const maxBody = admission.maxBodyBytes;
    const declaredLength = req.headers['content-length'];
    if (maxBody !== null && declaredLength !== undefined &&
      (typeof declaredLength !== 'string' || !/^\d+$/.test(declaredLength) ||
       BigInt(declaredLength) > BigInt(maxBody))) {
      res.writeHead(413, { 'Content-Type': 'text/plain', 'Connection': 'close' });
      res.end('Request body too large');
      req.resume();
      return;
    }
    const cacheEnabledForRequest = responseCache.requestEligible(req);
    const cacheSignature = backendPool.signature(route);
    const cacheKey = responseCache.key(route.hostname, cacheSignature, req.url ?? '/');
    if (cacheEnabledForRequest) {
      const hit = responseCache.get(cacheKey);
      if (hit) { forwardCompressedResponse(req, cachedReadable(hit), res, compressionConfig); return; }
    }
    const target = backendPool.select(route);
    if (!target) {
      res.writeHead(503, { "Content-Type": "text/plain", "Retry-After": "1" });
      res.end("No healthy application instances");
      return;
    }
    const routeSignature = backendPool.signature(route);
    const releaseBackend = backendConnections.track(route.hostname, target.port);
    const startedAt = process.hrtime.bigint();
    let recorded = false;
    const finishHttp = (aborted: boolean) => {
      if (recorded) return;
      recorded = true;
      releaseBackend();
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      backendConnections.recordHttp(route.hostname, target.port, Math.min(elapsedMs, 86_400_000),
        aborted ? 502 : res.statusCode);
    };
    res.once('finish', () => finishHttp(false));
    res.once('close', () => finishHttp(!res.writableFinished));
    const forwardedHeaders = buildForwardedHeaders(req, isTls);
    const proxyReqHeaders = filterProxyHeaders(req.headers);
    delete proxyReqHeaders["forwarded"];
    for (const [key, value] of Object.entries(forwardedHeaders)) {
      proxyReqHeaders[key] = value;
    }
    proxyReqHeaders[PORTLESS_HOPS_HEADER] = String(hops + 1);
    // Remove HTTP/2 pseudo-headers before forwarding to HTTP/1.1 backend
    for (const key of Object.keys(proxyReqHeaders)) {
      if (key.startsWith(":")) {
        delete proxyReqHeaders[key];
      }
    }

    if (/^application\/grpc(?:\+|;|$)/i.test(String(req.headers["content-type"] ?? ""))) {
      forwardGrpc(req, res, target.port, proxyReqHeaders as Record<string, string>);
      return;
    }
    let clientAborted = false;
    const proxyReq = http.request(
      {
        hostname: "127.0.0.1",
        port: target.port,
        path: req.url,
        method: req.method,
        headers: proxyReqHeaders,
      },
      (proxyRes) => {
        backendPool.markSuccess(route.hostname, target.port, routeSignature);
        const responseHeaders = filterProxyHeaders(proxyRes.headers);
        proxyRes.on("error", () => {
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "text/plain" });
          }
          res.end();
        });
        const upstream = Object.assign(proxyRes, { headers: responseHeaders });
        const representation = cacheEnabledForRequest && !res.destroyed
          ? responseCache.capture(upstream, cacheKey, route.hostname, req.url ?? '/')
          : upstream;
        forwardCompressedResponse(req, representation, res, compressionConfig);
      }
    );

    proxyReq.setTimeout(30_000, () => proxyReq.destroy(new Error("Upstream timeout")));
    proxyReq.on("error", (err) => {
      if (!clientAborted) backendPool.markFailure(route.hostname, target.port, routeSignature);
      if (!clientAborted) onError(`Proxy error for ${getRequestHost(req)}: ${err.message}`);
      if (!res.headersSent) {
        const errWithCode = err as NodeJS.ErrnoException;
        const detail =
          errWithCode.code === "ECONNREFUSED"
            ? "The target app is not responding. It may have crashed."
            : "The target app may not be running.";
        res.writeHead(502, { "Content-Type": "text/html" });
        res.end(
          renderPage(
            502,
            "Bad Gateway",
            `<div class="content"><p class="desc">${escapeHtml(detail)}</p></div>`
          )
        );
      } else {
        res.destroy(err);
      }
    });

    // Abort the outgoing request if the client disconnects
    res.on("close", () => {
      if (!proxyReq.destroyed) {
        clientAborted = true;
        proxyReq.destroy();
      }
    });

    req.on("error", () => {
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
          res.writeHead(413, { 'Content-Type': 'text/plain', 'Connection': 'close' });
          res.end('Request body too large');
          req.resume();
        }
      });
    }
    req.pipe(proxyReq);
  };

  const handleUpgrade = (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    socket.on("error", () => socket.destroy());

    const hops = readHopCount(req.headers[PORTLESS_HOPS_HEADER]);
    if (hops === null || !parseAuthority(getRequestHost(req))) {
      socket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    if (hops >= MAX_PROXY_HOPS) {
      const host = parseAuthority(getRequestHost(req))?.hostname || "";
      onError(
        `WebSocket loop detected for ${host}: request has passed through portless ${hops} times. ` +
          `Set changeOrigin: true in your proxy config.`
      );
      socket.end(
        "HTTP/1.1 508 Loop Detected\r\n" +
          "Content-Type: text/plain\r\n" +
          "\r\n" +
          "Loop Detected: request has passed through portless too many times.\n" +
          "Add changeOrigin: true to your dev server proxy config.\n"
      );
      return;
    }

    const routes = getRoutes();
    backendPool.sync(routes);
    const host = parseAuthority(getRequestHost(req))?.hostname || "";
    const route = findRoute(routes, host);

    if (!route) {
      socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      return;
    }
    const upgradePermit = admission.acquire(socket.remoteAddress);
    if (!upgradePermit.allowed) {
      socket.end(`HTTP/1.1 ${upgradePermit.status} ${upgradePermit.status === 429 ? 'Too Many Requests' : 'Service Unavailable'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    socket.once('close', upgradePermit.release);
    const target = backendPool.select(route);
    if (!target) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nRetry-After: 1\r\nConnection: close\r\n\r\n");
      return;
    }

    const routeSignature = backendPool.signature(route);
    const releaseBackend = backendConnections.track(route.hostname, target.port);
    socket.once("close", releaseBackend);

    const forwardedHeaders = buildForwardedHeaders(req, isTls);
    const proxyReqHeaders = filterProxyHeaders(req.headers, { preserveUpgrade: true });
    delete proxyReqHeaders["forwarded"];
    for (const [key, value] of Object.entries(forwardedHeaders)) {
      proxyReqHeaders[key] = value;
    }
    proxyReqHeaders[PORTLESS_HOPS_HEADER] = String(hops + 1);
    // Remove HTTP/2 pseudo-headers before forwarding to HTTP/1.1 backend
    for (const key of Object.keys(proxyReqHeaders)) {
      if (key.startsWith(":")) {
        delete proxyReqHeaders[key];
      }
    }

    // Upgrade head bytes belong to the tunneled protocol, not to the
    // HTTP request body. Preserve them until the upstream acknowledges 101.
    const proxyReq = http.request({
      hostname: "127.0.0.1",
      port: target.port,
      path: req.url,
      method: req.method,
      headers: proxyReqHeaders,
    });
    let upstreamSocket: net.Socket | undefined;
    let established = false;
    const closeBoth = () => {
      upstreamSocket?.destroy();
      socket.destroy();
      if (!proxyReq.destroyed) proxyReq.destroy();
    };
    // A half-closed upgraded TCP stream cannot serve another WebSocket frame.
    // Destroy its peer promptly; waiting for both close events can stall drains.
    socket.once("end", closeBoth);
    socket.once("close", () => {
      upstreamSocket?.destroy();
      if (!proxyReq.destroyed) proxyReq.destroy();
    });

    proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
      // Forward the backend's actual 101 response including Sec-WebSocket-Accept,
      // subprotocol negotiation, and extension headers.
      let response = `HTTP/1.1 101 Switching Protocols\r\n`;
      const safeUpgrade = filterProxyHeaders(proxyRes.headers, { preserveUpgrade: true });
      for (const [name, value] of Object.entries(safeUpgrade)) {
        if (value !== undefined) response += `${name}: ${String(value)}\r\n`;
      }
      response += "\r\n";
      established = true;
      backendPool.markSuccess(route.hostname, target.port, routeSignature);
      upstreamSocket = proxySocket;
      // Any data read ahead from either side must be delivered before piping.
      socket.write(response);
      if (proxyHead.length) socket.write(proxyHead);
      if (head.length) proxySocket.write(head);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
      proxySocket.once("close", () => socket.destroy());
      proxySocket.once("end", closeBoth);
      proxySocket.once("error", closeBoth);
      socket.once("error", closeBoth);
    });

    // Timeout applies to the handshake; idle upgraded connections may live indefinitely.
    proxyReq.setTimeout(30_000, () => proxyReq.destroy(new Error("Upstream handshake timeout")));
    proxyReq.on("error", (err) => {
      if (!established) {
        backendPool.markFailure(route.hostname, target.port, routeSignature);
        onError(`WebSocket proxy error for ${getRequestHost(req)}: ${err.message}`);
      }
      closeBoth();
    });

    proxyReq.on("response", (res) => {
      backendPool.markSuccess(route.hostname, target.port, routeSignature);
      // The backend responded with a normal HTTP response instead of upgrading.
      // Forward the rejection to the client.
      if (!socket.destroyed) {
        let response = `HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n`;
        const safeResponse = filterProxyHeaders(res.headers);
        for (const [name, value] of Object.entries(safeResponse)) {
          if (value !== undefined) response += `${name}: ${String(value)}\r\n`;
        }
        response += "\r\n";
        socket.write(response);
        res.on("error", () => socket.destroy());
        res.pipe(socket);
        res.once("end", () => socket.end());
      }
    });

    proxyReq.end();
  };

  if (tls) {
    const h2Server = http2.createSecureServer({
      cert: tls.cert,
      key: tls.key,
      allowHTTP1: true,
      minVersion: 'TLSv1.2',
      ...(tls.SNICallback ? { SNICallback: tls.SNICallback } : {}),
    });
    // With allowHTTP1, the 'request' event receives objects compatible with
    // http.IncomingMessage / http.ServerResponse. Cast explicitly to satisfy TypeScript.
    h2Server.on("request", (req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) => {
      handleRequest(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);
    });
    // WebSocket upgrades arrive over HTTP/1.1 connections (allowHTTP1)
    h2Server.on("upgrade", (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
      handleUpgrade(req, socket, head);
    });

    // Plain HTTP server using the same proxy handlers (no TLS, no redirect)
    const plainServer = http.createServer(handleRequest);
    plainServer.on("upgrade", handleUpgrade);

    // Wrap both in a net.Server that peeks at the first byte to decide
    // whether the connection is TLS (0x16 = ClientHello) or plain HTTP.
    const wrapper = net.createServer((socket) => {
      // A peer that connects without sending protocol bytes must not hold a slot forever.
      socket.setTimeout(10_000, () => socket.destroy());
      socket.once("readable", () => {
        socket.setTimeout(0);
        const buf: Buffer | null = socket.read(1);
        if (!buf) {
          socket.destroy();
          return;
        }
        socket.unshift(buf);
        if (buf[0] === 0x16) {
          // TLS handshake -> HTTP/2 secure server
          h2Server.emit("connection", socket);
        } else if (allowPlainHttp) {
          // Compatibility-only: mixed plaintext/TLS on the same port.
          plainServer.emit("connection", socket);
        } else {
          socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        }
      });
    });

    // The wrapper owns the listening socket and tracks even TLS/HTTP2 tunnels.
    // Inner servers never listen directly, so calling close() on them throws.
    wrapper.once('close', () => { backendPool.close(); protocols?.close(); });
    closeProtocolStreams(wrapper, protocols);
    return Object.assign(wrapper, { connectionTracker: trackConnections(wrapper), backendPool, backendConnections, ...metrics });
  }

  const httpServer = http.createServer(handleRequest);
  httpServer.on("upgrade", handleUpgrade);

  httpServer.once('close', () => { backendPool.close(); protocols?.close(); });
  closeProtocolStreams(httpServer, protocols);
  return Object.assign(httpServer, { connectionTracker: trackConnections(httpServer), backendPool, backendConnections, ...metrics });
}
