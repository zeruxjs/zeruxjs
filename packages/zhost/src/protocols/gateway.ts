import { isIP } from 'node:net';
import { sanitizeForwardedRequestHeaders } from '../portless/proxy-headers.js';
import type { TransportLimits } from './lifecycle.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServer } from './mcp/protocol.js';
import { JsonRpcRouter } from './json-rpc.js';
import { ConnectRouter, TrpcRouter } from './connect.js';
import { SseHub } from './sse.js';
import { WebTransportRouter } from './webtransport.js';
import {
  ConnectStreamRouter,
  readConnectEnvelopes,
  encodeConnectEnvelope,
} from './connect-stream.js';
export interface ProtocolEndpoint {
  /** Explicit registered protocol subset selected for this endpoint. */
  readonly kind:
    | 'mcp'
    | 'json-rpc'
    | 'sse'
    | 'connect-json'
    | 'connect-stream-json'
    | 'trpc-json';
  /** Exact registered path, excluding request query text. */
  readonly path: string;
}
export interface ProtocolGatewayOptions {
  /** Optional fresh host endpoint permission check, applied after general admission. */
  authorizeEndpoint?: (
    req: IncomingMessage,
    endpoint: Readonly<ProtocolEndpoint>,
    context: {
      signal: AbortSignal;
      remoteAddress: string | undefined;
      trustedProxy: boolean;
    }
  ) => boolean | Promise<boolean>;
  /** At most 64 exact direct-peer IP literals whose forwarding metadata the host explicitly trusts. */
  trustedProxies?: readonly string[];
  /** Request lease ceiling, 1–1024; defaults to 32 and retains unsettled cancelled work. */
  maxConcurrentRequests?: number;
  /** Cooperative request deadline, 10–120000 ms; defaults to 30000. */
  requestTimeoutMs?: number;
  /** Optional synchronous private host cause sink; hosts must handle their own asynchronous sink failures. */
  onError?: (error: unknown, endpoint: Readonly<ProtocolEndpoint>) => void;
  /** MCP handler (registered before listen) or attached later using .mcp. */
  mcp?: McpServer;
  /** Explicit JSON-RPC registry, or an app-local default. */
  rpc?: JsonRpcRouter;
  /** Explicit Connect unary JSON registry, or an app-local default. */
  connect?: ConnectRouter;
  /** Explicit bounded Connect JSON stream registry, or an app-local default. */
  connectStream?: ConnectStreamRouter;
  /** Explicit narrow JSON procedure registry, or an app-local default. */
  trpc?: TrpcRouter;
  /** SSE hub closed by gateway teardown, including an explicitly supplied hub. */
  events?: SseHub;
  /** External-session registry only; HTTP gateway dispatch does not install native QUIC. */
  webTransport?: WebTransportRouter;
  /** Defaults to localhost only. External requests require authorization callback. */
  authorize?: (req: IncomingMessage) => boolean | Promise<boolean>;
  /** Complete JSON body/output ceiling, 1 byte to 16 MiB; defaults to 1 MiB. */
  maxBodyBytes?: number;
  /** Explicit allowed browser origins. Browser origins not in this list are rejected. */
  allowedOrigins?: string[];
}
/** Recognize only explicit loopback peer literals for the legacy standalone fallback, never forwarded client claims.
 * @param {string | undefined} address - Direct socket peer address, or undefined.
 * @returns {boolean} Whether the literal is an allowed loopback representation.
 */
function local(address: string | undefined): boolean {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  );
}
/** Serialize a bounded no-store JSON response before commit; a committed failed response is destroyed rather than rewritten.
 * @param {ServerResponse} res - Borrowed native response.
 * @param {number} code - Host-selected HTTP status.
 * @param {unknown} data - Trusted handler result or fixed public error object; must be JSON-serializable.
 * @param {number} limit - Normal response byte ceiling; fixed errors retain a minimum 1024-byte allowance.
 * @returns {void} Commits one JSON response or throws on serialization/budget failure.
 */
function json(
  res: ServerResponse,
  code: number,
  data: unknown,
  limit = 16 * 1024 * 1024
): void {
  if (res.writableEnded || res.destroyed) {
    return;
  }
  if (res.headersSent) {
    res.destroy();
    return;
  }
  /** Serialized response or parsed request value; only the owning bounded transport consumes it. */
  const body = JSON.stringify(data);
  if (Buffer.byteLength(body) > (code >= 400 ? Math.max(1024, limit) : limit)) {
    throw new BodyError(500, 'Response too large');
  }
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}
/** Fixed public transport/body failure; native handler exceptions are reported separately. */
class BodyError extends Error {
  /**
   * Carry a known public transport failure status and safe message.
   * @param {number} status - Explicit HTTP body/transport failure status.
   * @param {string} message - Safe public error text, excluding private native causes.
   */
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
/** Own bounded native body listeners until validated UTF-8 JSON, disconnect, cancellation or overflow; always release those listeners.
 * @param {IncomingMessage} req - Borrowed request; an oversized body is paused before failing.
 * @param {number} limit - Validated complete body byte ceiling.
 * @param {AbortSignal} signal - Cooperative request cancellation, checked immediately after listener registration.
 * @returns {Promise<unknown>} Inert parsed data; no modules, code, URLs or commands are evaluated.
 */
async function readJson(
  req: IncomingMessage,
  limit: number,
  signal: AbortSignal
): Promise<unknown> {
  if (
    !/^application\/(?:json|[^;]+\+json)(?:\s*;|\s*$)/i.test(
      String(req.headers['content-type'] ?? '')
    )
  ) {
    throw new BodyError(415, 'JSON Content-Type required');
  }
  /** Optional Content-Length text rejected before body listeners if it exceeds the validated limit. */
  const declared = req.headers['content-length'];
  if (
    declared !== undefined &&
    (!/^\d+$/.test(String(declared)) ||
      BigInt(String(declared)) > BigInt(limit))
  ) {
    throw new BodyError(413, 'Request body too large');
  }
  return new Promise((resolve, reject) => {
    /** Bounded request chunks released with this reader’s terminal closure. */
    const chunks: Buffer[] = [];
    let size = 0,
      done = false;
    /** Remove only this body reader’s native listeners and signal subscription.
     * @returns {void} Does not dispose a borrowed request or host signal.
     */
    const cleanup = () => {
      req.off('data', data);
      req.off('end', end);
      req.off('error', error);
      req.off('aborted', abort);
      signal.removeEventListener('abort', abort);
    };
    /** Reject the body reader once after removing all owned listeners.
     * @param {unknown} cause - Private native or fixed public transport failure.
     * @returns {void} Ignores duplicate terminal events.
     */
    const fail = (cause: unknown) => {
      if (done) {
        return;
      }
      done = true;
      cleanup();
      reject(cause);
    };
    /** Reject a cooperative body cancellation with a fixed public status.
     * @returns {void} Releases reader listeners through the shared terminal path.
     */
    const abort = () => fail(new BodyError(408, 'Request cancelled'));
    /** Reject a disconnected body without exposing native causes.
     * @returns {void} Releases owned reader listeners.
     */
    const error = () => fail(new BodyError(400, 'Request disconnected'));
    /** Count native body bytes before retaining a chunk.
     * @param {Buffer | string} value - Native request chunk.
     * @returns {void} Pauses and rejects overflow rather than accumulating it.
     */
    const data = (value: Buffer | string) => {
      /** Native chunk normalized to bytes before budget accounting. */
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      size += chunk.length;
      if (size > limit) {
        req.pause();
        fail(new BodyError(413, 'Request body too large'));
      } else {
        chunks.push(chunk);
      }
    };
    /** Decode strict UTF-8 JSON only after the bounded body completes.
     * @returns {void} Resolves inert data or rejects malformed bytes/JSON after cleanup.
     */
    const end = () => {
      if (done) {
        return;
      }
      done = true;
      cleanup();
      try {
        resolve(
          JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(
              Buffer.concat(chunks, size)
            )
          )
        );
      } catch {
        reject(new BodyError(400, 'Malformed JSON'));
      }
    };
    req.on('data', data);
    req.once('end', end);
    req.once('error', error);
    req.once('aborted', abort);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted || req.aborted) {
      abort();
    }
  });
}
/** Build a fixed public JSON-RPC error without leaking native causes.
 * @param {number} code - Protocol error code.
 * @param {string} message - Safe public text.
 * @returns {object} JSON-RPC error envelope.
 */
const invalidRpc = (code: number, message: string) => ({
  jsonrpc: '2.0',
  id: null,
  error: { code, message },
});
/** Application-local protocol dispatch; invoke from ZHOST via ProxyServerOptions.protocols.
 * A gateway never handles unregistered paths, allowing normal HTTP/WebSocket proxying. */
export class ProtocolGateway {
  mcp?: McpServer;
  readonly rpc: JsonRpcRouter;
  readonly connect: ConnectRouter;
  readonly connectStream: ConnectStreamRouter;
  readonly trpc: TrpcRouter;
  readonly events: SseHub;
  readonly webTransport: WebTransportRouter;
  private readonly options: ProtocolGatewayOptions;
  private limit: number;
  private concurrency: number;
  private timeout: number;
  private closed = false;
  private readonly active = new Set<{ cancel(): void }>();
  private readonly pending = new Set<Promise<unknown>>();
  /** Configure inert app-local dispatch with copied origin/proxy lists; no listener starts. Gateway teardown closes its SSE hub even when supplied by the host.
   * @param {ProtocolGatewayOptions} options - Explicit trusted registrations, host authorization and bounded request policy.
   */
  constructor(options: ProtocolGatewayOptions = {}) {
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      (options.authorize !== undefined &&
        typeof options.authorize !== 'function') ||
      (options.authorizeEndpoint !== undefined &&
        typeof options.authorizeEndpoint !== 'function') ||
      (options.onError !== undefined && typeof options.onError !== 'function')
    ) {
      throw new TypeError('Invalid gateway options');
    }
    if (
      options.trustedProxies !== undefined &&
      (!Array.isArray(options.trustedProxies) ||
        options.trustedProxies.length > 64 ||
        options.trustedProxies.some(
          (value) => typeof value !== 'string' || !isIP(value)
        ))
    ) {
      throw new TypeError('Invalid trusted proxy list');
    }
    if (
      options.allowedOrigins !== undefined &&
      (!Array.isArray(options.allowedOrigins) ||
        options.allowedOrigins.length > 64 ||
        options.allowedOrigins.some((value) => {
          try {
            return new URL(value).origin !== value;
          } catch {
            return true;
          }
        }))
    ) {
      throw new TypeError('Invalid allowed origins');
    }
    this.concurrency = options.maxConcurrentRequests ?? 32;
    this.timeout = options.requestTimeoutMs ?? 30000;
    if (
      !Number.isSafeInteger(this.concurrency) ||
      this.concurrency < 1 ||
      this.concurrency > 1024 ||
      !Number.isSafeInteger(this.timeout) ||
      this.timeout < 10 ||
      this.timeout > 120000
    ) {
      throw new RangeError('Invalid gateway limits');
    }
    this.options = {
      ...options,
      allowedOrigins: options.allowedOrigins
        ? [...options.allowedOrigins]
        : undefined,
      trustedProxies: options.trustedProxies
        ? [...options.trustedProxies]
        : undefined,
    };
    this.mcp = options.mcp;
    this.rpc = options.rpc ?? new JsonRpcRouter();
    this.connect = options.connect ?? new ConnectRouter();
    this.connectStream = options.connectStream ?? new ConnectStreamRouter();
    this.trpc = options.trpc ?? new TrpcRouter();
    this.events = options.events ?? new SseHub();
    this.webTransport = options.webTransport ?? new WebTransportRouter();
    this.limit = options.maxBodyBytes ?? 1024 * 1024;
    if (
      !Number.isSafeInteger(this.limit) ||
      this.limit < 1 ||
      this.limit > 16 * 1024 * 1024
    ) {
      throw new RangeError('Invalid protocol request limit');
    }
  }
  /** Tighten byte/concurrency/deadline policy before admission without ever widening the host’s existing limits.
   * @param {TransportLimits} limits - Transport-owned validated ceilings.
   * @returns {void} Rejects invalid policy, active requests or an already closed gateway.
   */
  constrain(limits: TransportLimits): void {
    if (
      !limits ||
      !Number.isSafeInteger(limits.maxMessageBytes) ||
      limits.maxMessageBytes < 1 ||
      limits.maxMessageBytes > 16 * 1024 * 1024 ||
      !Number.isSafeInteger(limits.maxConcurrent) ||
      limits.maxConcurrent < 1 ||
      limits.maxConcurrent > 1024 ||
      !Number.isSafeInteger(limits.timeoutMs) ||
      limits.timeoutMs < 10 ||
      limits.timeoutMs > 120000
    ) {
      throw new RangeError('Invalid transport limits');
    }
    if (this.active.size || this.closed) {
      throw new Error('Gateway is active/closed');
    }
    this.limit = Math.min(this.limit, limits.maxMessageBytes);
    this.concurrency = Math.min(this.concurrency, limits.maxConcurrent);
    this.timeout = Math.min(this.timeout, limits.timeoutMs);
  }
  /** Reject collisions among reserved and explicitly registered protocol paths before invocation.
   * @returns {void} Does not install a listener or grant access.
   */
  validateBindings(): void {
    /** Reserved plus explicit registry paths checked for exact binding collisions. */
    const paths = [
      '/rpc',
      '/events',
      ...(this.mcp ? ['/mcp'] : []),
      ...this.connect.paths(),
      ...this.connectStream.paths(),
      ...this.trpc.paths(),
    ];
    if (new Set(paths).size !== paths.length) {
      throw new Error('Protocol endpoint bind conflict');
    }
  }
  /** Copy fixed path-free lifecycle counters for host operational inspection.
   * @returns {{closed: boolean; active: number; pending: number}} Admission/I/O leases and unsettled handler work, without headers, routes or private causes.
   */
  getDiagnostics() {
    return {
      closed: this.closed,
      active: this.active.size,
      pending: this.pending.size,
    };
  }
  /** Await currently pending handler settlement; call close first to fence future admission.
   * @returns {Promise<void>} Drains handler promises, not proof that every native socket or SSE response has closed.
   */
  async whenClosed(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }
  /** Delegate fixed response policy through the bounded JSON serializer.
   * @param {ServerResponse} res - Borrowed uncommitted response.
   * @param {number} code - Known public HTTP status.
   * @param {unknown} data - JSON-serializable response data or fixed public error.
   * @returns {void} Commits or safely terminates through the shared response path.
   */
  private send(res: ServerResponse, code: number, data: unknown) {
    json(res, code, data, this.limit);
  }
  /** Admit only registered paths under bounded capacity/deadlines, retaining a lease until both I/O and handler work terminate.
   * @param {IncomingMessage} req - Borrowed native request; forwarded headers never grant authorization.
   * @param {ServerResponse} res - Borrowed response whose finish/close drives I/O cancellation.
   * @returns {Promise<boolean>} False for an unregistered path, true after protocol dispatch; cancellation cannot force-stop handler JavaScript.
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    /** First query-free request segment; split always supplies an element. */
    const path = (req.url ?? '/').split('?')[0]!;
    if (
      !(
        (path === '/mcp' && this.mcp) ||
        path === '/rpc' ||
        path === '/events' ||
        this.connect.has(path) ||
        this.connectStream.has(path) ||
        (path.startsWith('/trpc/') && this.trpc.has(path.slice(6)))
      )
    ) {
      return false;
    }
    if (this.closed || this.active.size >= this.concurrency) {
      this.send(res, 503, { error: 'Protocol unavailable' });
      return true;
    }
    /** Optional request deadline that may only shorten the host timeout, never extend it. */
    const supplied = req.headers['x-zerux-deadline'];
    if (
      supplied !== undefined &&
      (typeof supplied !== 'string' ||
        !/^\d{1,16}$/.test(supplied) ||
        !Number.isSafeInteger(Number(supplied)))
    ) {
      this.send(res, 400, { error: 'Invalid request deadline' });
      return true;
    }
    /** Effective absolute deadline bounded by the host request timeout. */
    const deadline = Math.min(
      Date.now() + this.timeout,
      supplied === undefined ? Infinity : Number(supplied)
    );
    if (deadline <= Date.now()) {
      this.send(res, 408, { error: 'Request deadline exceeded' });
      return true;
    }
    /** Owned cooperative request signal, aborted by response termination, timeout or gateway close. */
    const controller = new AbortController();
    let ioDone = false,
      workDone = false;
    /** Retire admission only after actual I/O and handler completion.
     * @returns {void} Keeps cancelled-but-unsettled work charged.
     */
    const release = () => {
      if (ioDone && workDone) {
        this.active.delete(lease);
      }
    };
    /** Record I/O termination once, detach response/request listeners and request cooperative cancellation.
     * @returns {void} Does not assume handler settlement.
     */
    const finish = () => {
      if (ioDone) {
        return;
      }
      ioDone = true;
      controller.abort();
      res.off('finish', finish);
      res.off('close', finish);
      req.off('aborted', finish);
      release();
    };
    /** Owned request cancellation handle retained until both lifecycle halves complete. */
    const lease = {
      cancel: () => {
        controller.abort();
        if (!res.destroyed && !res.writableEnded) {
          if (!res.headersSent) {
            this.send(res, 503, { error: 'Protocol unavailable' });
          } else {
            res.end();
          }
        }
      },
    };
    this.active.add(lease);
    res.once('finish', finish);
    res.once('close', finish);
    req.once('aborted', finish);
    /** Owned deadline timer, cleared when handler dispatch settles. */
    const timer = setTimeout(
      () => {
        controller.abort();
        if (!res.destroyed && !res.writableEnded) {
          if (!res.headersSent) {
            this.send(res, 504, { error: 'Protocol deadline exceeded' });
          } else {
            res.destroy();
          }
        }
      },
      Math.max(1, deadline - Date.now())
    );
    /** Actual handler-dispatch promise retained for bounded cleanup and whenClosed. */
    const work = this.execute(req, res, controller.signal, deadline);
    this.pending.add(work);
    try {
      return await work;
    } finally {
      clearTimeout(timer);
      workDone = true;
      this.pending.delete(work);
      if (res.destroyed || res.writableFinished) {
        finish();
      }
      release();
    }
  }
  /** Authorize origin, direct-peer policy and endpoint permission before bounded protocol dispatch; callbacks are trusted host code.
   * @param {IncomingMessage} req - Borrowed native request containing inert body data.
   * @param {ServerResponse} res - Borrowed response whose commit state must be respected.
   * @param {AbortSignal} signal - Request cancellation propagated to cooperative handlers.
   * @param {number} deadline - Absolute effective request deadline supplied as context metadata.
   * @returns {Promise<boolean>} Whether a protocol path was handled; unknown native causes are kept in the optional private host sink.
   */
  private async execute(
    req: IncomingMessage,
    res: ServerResponse,
    signal: AbortSignal,
    deadline: number
  ): Promise<boolean> {
    /** Query-free exact endpoint path; no decoding or model-provided destination resolution occurs. */
    const rawPath = (req.url ?? '/').split('?')[0]!;
    /** Whether the exact MCP path has a configured explicit server. */
    const mcp = rawPath === '/mcp' && !!this.mcp;
    /** Whether this request targets the fixed JSON-RPC endpoint. */
    const rpc = rawPath === '/rpc';
    /** Whether this request targets the fixed event-stream endpoint. */
    const sse = rawPath === '/events';
    /** Whether the prefixed procedure is explicitly registered. */
    const trpc =
      rawPath.startsWith('/trpc/') && this.trpc.has(rawPath.slice(6));
    /** Whether the exact path belongs to the framed JSON registry. */
    const stream = this.connectStream.has(rawPath);
    /** Whether the exact path belongs to the unary JSON registry. */
    const connect = this.connect.has(rawPath);
    if (!mcp && !rpc && !sse && !trpc && !connect && !stream) {
      return false;
    }
    /** Immutable registered endpoint descriptor supplied to host authorization and private diagnostics. */
    const endpoint: Readonly<ProtocolEndpoint> = Object.freeze({
      path: rawPath,
      kind: ((): ProtocolEndpoint['kind'] => {
        if (mcp) {
          return 'mcp';
        }
        if (rpc) {
          return 'json-rpc';
        }
        if (sse) {
          return 'sse';
        }
        if (stream) {
          return 'connect-stream-json';
        }
        if (connect) {
          return 'connect-json';
        }
        return 'trpc-json';
      })(),
    });
    /** Exact direct-peer match against the copied host-approved proxy list. */
    const trustedProxy =
      this.options.trustedProxies?.includes(req.socket.remoteAddress ?? '') ===
      true;
    /** Borrowed verified peer/deadline context; forwarding metadata is sanitized outside the explicit trusted-proxy boundary. */
    const context = {
      signal,
      deadline,
      remoteAddress: req.socket.remoteAddress,
      trustedProxy,
      headers: trustedProxy
        ? { ...req.headers }
        : (sanitizeForwardedRequestHeaders(
            req.headers
          ) as IncomingMessage['headers']),
    };
    /** Browser-supplied Origin, validated against canonical HTTP(S) origin or exact same-origin policy. */
    const origin = req.headers.origin;
    if (origin) {
      let valid = false;
      try {
        /** Parsed Origin used only for comparison, never fetched or executed. */
        const parsed = new URL(origin);
        valid =
          parsed.origin === origin &&
          (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
          (this.options.allowedOrigins?.includes(parsed.origin) ?? false);
        // Same-origin requests remain allowed, but compare host and origin authority exactly.
        valid ||=
          parsed.origin === origin &&
          parsed.host === req.headers.host &&
          ((req.socket as typeof req.socket & { encrypted?: boolean }).encrypted
            ? parsed.protocol === 'https:'
            : parsed.protocol === 'http:');
      } catch {
        /* reject invalid Origin */
      }
      if (!valid) {
        this.send(res, 403, { error: 'Origin not allowed' });
        return true;
      }
    }
    try {
      // Local reverse proxies may forward untrusted internet traffic over loopback.
      // Require explicit authorization when forwarding metadata is present.
      /** Presence of forwarding claims disables the unauthenticated legacy loopback fallback. */
      const proxied = !!(
        req.headers['x-forwarded-for'] ||
        req.headers.forwarded ||
        req.headers['x-real-ip']
      );
      /** General host authorization or the restricted legacy direct-loopback fallback. */
      const allowed = this.options.authorize
        ? (await this.options.authorize(req)) === true
        : local(req.socket.remoteAddress) && !proxied;
      /** Fresh endpoint authorization after general admission; a schema never grants permission. */
      const endpointAllowed =
        allowed &&
        (!this.options.authorizeEndpoint ||
          (await this.options.authorizeEndpoint(req, endpoint, {
            signal,
            remoteAddress: context.remoteAddress,
            trustedProxy,
          })) === true);
      if (signal.aborted) {
        throw new BodyError(408, 'Request cancelled');
      }
      this.validateBindings();
      if (!endpointAllowed) {
        this.send(res, 403, { error: 'Forbidden' });
        return true;
      }
      if (sse) {
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET');
          this.send(res, 405, { error: 'Method not allowed' });
          return true;
        }
        this.events.subscribe(
          res,
          typeof req.headers['last-event-id'] === 'string'
            ? req.headers['last-event-id']
            : undefined
        );
        return true;
      }
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        this.send(res, 405, { error: 'Method not allowed' });
        return true;
      }
      if (mcp) {
        /** MCP negotiation header checked before processing its inert JSON body. */
        const accept = String(req.headers.accept ?? '');
        if (
          !accept.includes('application/json') ||
          !accept.includes('text/event-stream')
        ) {
          this.send(res, 406, {
            error:
              'MCP Accept must include application/json and text/event-stream',
          });
          return true;
        }
        /** Declared MCP protocol version compared only against the configured server. */
        const version = req.headers['mcp-protocol-version'];
        if (version && version !== this.mcp!.protocolVersion) {
          this.send(
            res,
            400,
            invalidRpc(-32600, 'Unsupported MCP protocol version')
          );
          return true;
        }
      }
      if (stream) {
        if (
          !/^application\/connect\+json(?:\s*;|\s*$)/i.test(
            String(req.headers['content-type'] ?? '')
          )
        ) {
          this.send(res, 415, { error: 'Connect JSON content type required' });
          return true;
        }
        // Must remain streaming end-to-end. Envelopes are bounded independently.
        /** Trusted handler stream consumed under independent output-count/byte limits. */
        const output = await this.connectStream.call(
          rawPath,
          readConnectEnvelopes(req, {
            maxMessageBytes: this.limit,
            maxTotalBytes: Math.min(16 * 1024 * 1024, this.limit * 16),
            signal,
          }),
          context
        );
        res.writeHead(200, {
          'Content-Type': 'application/connect+json',
          'Cache-Control': 'no-store, no-transform',
        });
        let outputCount = 0,
          outputBytes = 0;
        for await (const message of output) {
          signal.throwIfAborted();
          /** Owned bounded encoded JSON envelope, never executable data. */
          const frame = encodeConnectEnvelope(message);
          outputBytes += frame.length;
          if (
            ++outputCount > 256 ||
            frame.length > this.limit + 5 ||
            outputBytes > 16 * 1024 * 1024
          ) {
            throw new RangeError('Connect output limit');
          }
          if (res.destroyed || res.writableEnded) {
            break;
          }
          if (!res.write(frame)) {
            await new Promise<void>((resolve) => {
              /** Release only this backpressure wait’s drain/close listeners.
               * @returns {void} Resolves on either native readiness or downstream close.
               */
              const done = () => {
                res.off('drain', done);
                res.off('close', done);
                resolve();
              };
              res.once('drain', done);
              res.once('close', done);
            });
          }
        }
        if (!res.destroyed) {
          res.end(encodeConnectEnvelope({}, true));
        }
        return true;
      }
      /** Serialized response or parsed request value; only the owning bounded transport consumes it. */
      const body = await readJson(req, this.limit, signal);
      if (mcp) {
        /** Actual trusted protocol handler outcome; notifications emit their format-specific empty status. */
        const response = await this.mcp!.handle(body, context);
        if (response === null) {
          res.writeHead(202);
          res.end();
        } else {
          this.send(res, 200, response);
        }
      } else if (rpc) {
        /** Actual trusted protocol handler outcome; notifications emit their format-specific empty status. */
        const response = await this.rpc.dispatch(body, context);
        if (response === null) {
          res.writeHead(204);
          res.end();
        } else {
          this.send(res, 200, response);
        }
      } else if (connect) {
        try {
          this.send(res, 200, await this.connect.call(rawPath, body, context));
        } catch {
          this.send(res, 500, {
            code: 'internal',
            message: 'Connect procedure failed',
          });
        }
      } else if (trpc) {
        try {
          this.send(res, 200, {
            result: {
              data: await this.trpc.call(rawPath.slice(6), body, context),
            },
          });
        } catch {
          this.send(res, 500, {
            error: { message: 'Procedure failed', code: -32603 },
          });
        }
      }
    } catch (err) {
      try {
        this.options.onError?.(err, endpoint);
      } catch {
        /* private diagnostics cannot affect cleanup */
      }
      /** Known body failure status or fixed internal-error status; native causes remain private. */
      const status = err instanceof BodyError ? err.status : 500;
      if (mcp || rpc) {
        this.send(
          res,
          status,
          invalidRpc(
            status === 400 ? -32700 : -32600,
            (() => {
              if (status === 500) {
                return 'Internal error';
              }
              if (err instanceof Error) {
                return err.message;
              }
              return 'Invalid request';
            })()
          )
        );
      } else {
        this.send(res, status, {
          error: (() => {
            if (status === 500) {
              return 'Internal error';
            }
            if (err instanceof Error) {
              return err.message;
            }
            return 'Invalid request';
          })(),
        });
      }
      if (!req.complete) {
        req.resume();
      }
    }
    return true;
  }
  /** Fence admission, close SSE clients and request cancellation for active work; handlers must still settle cooperatively.
   * @returns {void} Idempotent cancellation request; pair with whenClosed and the transport owner’s native teardown.
   */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.events.close();
    for (const lease of this.active) {
      lease.cancel();
    }
  }
}
/** Create an app-local protocol dispatcher without opening sockets or discovering arbitrary packages.
 * @param {ProtocolGatewayOptions} options - Explicit host authorization, registrations and limits.
 * @returns {ProtocolGateway} Gateway to close/drain when its owning proxy or transport generation unloads.
 */
export function createProtocolGateway(options?: ProtocolGatewayOptions) {
  return new ProtocolGateway(options);
}
