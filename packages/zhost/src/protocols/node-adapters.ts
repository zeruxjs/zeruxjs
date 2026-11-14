import { createServer, type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import type { ProtocolGateway } from './gateway.js';
import type { TransportAdapter, TransportStartContext } from './lifecycle.js';
/** Native execution context for explicit host authorization; no caller role/group claims are trusted. */
export interface TransportAuthorizationContext {
  /** Execution cancellation signal; registered handlers must cooperate. */
  readonly signal: AbortSignal;
  /** Actual native direct peer address, never an untrusted forwarding header. */
  readonly remoteAddress: string | undefined;
}
/** Mandatory host permission decision; an abort signal is cancellation, not authentication. */
export type TransportAuthorization = (
  request: IncomingMessage,
  context: TransportAuthorizationContext
) => boolean | Promise<boolean>;
/** Create an inert HTTP server/socket tracker; bind only on explicit start and destroy retained sockets on owned close.
 * @returns {object} Local listener owner with address/listen/close operations; no process supervision.
 */
function listener() {
  /** Native accepted TCP sockets tracked only until close. */
  const sockets = new Set<Socket>();
  /** Inert owned HTTP server, listening only after explicit start. */
  const server = createServer();
  let closed: Promise<void> | undefined;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  return {
    server,
    /** Read the actual bound native address without starting or resolving any listener.
     * @returns {{ host: string; port: number } | null} Native address after bind or null while not listening.
     */
    address() {
      /** Current native address, possibly absent or a non-IP address form. */
      const a = server.address();
      return a && typeof a !== 'string'
        ? { host: a.address, port: a.port }
        : null;
    },
    /** Bind the explicit IP/port after installing finite native HTTP budgets and cooperative startup cancellation.
     * @param {TransportStartContext} context - Frozen registry-owned bind/limits plus cancellation and cleanup registration.
     * @returns {Promise<void>} Actual listening settlement, or explicit native/cancellation rejection.
     */
    async listen(context: TransportStartContext) {
      if (context.signal.aborted) {
        throw new Error('Transport cancelled');
      }
      server.maxConnections = context.limits.maxConcurrent;
      server.requestTimeout = context.limits.timeoutMs;
      server.headersTimeout = context.limits.timeoutMs;
      await new Promise<void>((resolve, reject) => {
        /** Settle one bind attempt and remove its temporary error/listening/abort hooks.
         * @param {Error | undefined} error Optional native bind or cancellation failure.
         * @returns {void} Resolves or rejects once after listener cleanup. */
        const finish = (error?: Error) => {
          server.off('error', failed);
          server.off('listening', ready);
          context.signal.removeEventListener('abort', abort);
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        };
        /** Forward one native bind failure into the common listener cleanup.
         * @param {Error} e Native private listener error.
         * @returns {void} Rejects the bind attempt after removing temporary listeners. */
        const failed = (e: Error) => finish(e);
        /** Settle successful native listening.
         * @returns {void} Resolves the bind promise after removing startup hooks. */
        const ready = () => finish();
        /** Propagate parent/peer cancellation into this owned listener or execution scope.
         * @returns {void} Cancels cooperatively; arbitrary host callbacks still require settlement. */
        const abort = () => {
          server.close();
          finish(new Error('Transport cancelled'));
        };
        server.once('error', failed);
        server.once('listening', ready);
        context.signal.addEventListener('abort', abort, { once: true });
        server.listen(context.bind.port, context.bind.host);
      });
    },
    /** Destroy retained native sockets and await server close once.
     * @returns {Promise<void>} Shared actual native close, tolerating only already-not-running state.
     */
    close() {
      return (closed ??= new Promise<void>((resolve, reject) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close((error) =>
          error &&
          (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING'
            ? reject(error)
            : resolve()
        );
      }));
    },
  };
}
/** Create an inert adapter owning the supplied gateway; explicit host authorization precedes every gateway dispatch, even on loopback.
 * @param {{
  gateway: ProtocolGateway;
  authorize: TransportAuthorization;
}} options - Trusted fixed gateway and authorization callback; never browser-supplied handlers.
 * @param {ProtocolGateway} options.gateway - Explicit gateway whose cleanup ownership transfers to this adapter.
 * @param {TransportAuthorization} options.authorize - Trusted host authorization callback required for every request.
 * @returns {TransportAdapter & { address(): { host: string; port: number } | null }} Explicit start/health/stop adapter; stop cancels and drains actual jobs and gateway settlement.
 */
export function createHttpTransportAdapter(options: {
  gateway: ProtocolGateway;
  /** Explicit trusted authorization callback required on every request/upgrade. */
  authorize: TransportAuthorization;
}): TransportAdapter & {
  /** Read the actual bound native address without starting or resolving any listener.
   * @returns {{ host: string; port: number } | null} Native address after bind or null while not listening.
   */
  address(): { host: string; port: number } | null;
} {
  if (
    !options ||
    typeof options.authorize !== 'function' ||
    typeof options.gateway?.handle !== 'function'
  ) {
    throw new TypeError('Invalid HTTP adapter');
  }
  /** Per-adapter inert native listener/socket owner. */
  const owned = listener();
  /** Actual pending authorization/message jobs retained until settlement, including cancelled work. */
  const jobs = new Set<Promise<unknown>>();
  /** Owned cooperative execution controllers retained through actual job settlement. */
  const controllers = new Set<AbortController>();
  let context: TransportStartContext | undefined,
    closing: Promise<void> | undefined;
  /** Fence/cancel active scopes, close owned native endpoints and drain actual registered jobs.
   * @returns {Promise<void>} Shared actual shutdown; does not force-cancel arbitrary JavaScript. */
  const stop = () =>
    (closing ??= (async () => {
      for (const c of controllers) {
        c.abort();
      }
      options.gateway.close();
      await owned.close();
      await Promise.allSettled([...jobs]);
      await options.gateway.whenClosed();
    })());
  owned.server.on('request', (req, res) => {
    if (
      !context ||
      context.signal.aborted ||
      jobs.size >= context.limits.maxConcurrent
    ) {
      res.writeHead(503).end();
      return;
    }
    /** Owned request/upgrade cancellation scope tied to the actual peer. */
    const controller = new AbortController();
    controllers.add(controller);
    /** Propagate parent/peer cancellation into this owned listener or execution scope.
     * @returns {void} Cancels cooperatively; arbitrary host callbacks still require settlement. */
    const abort = () => controller.abort();
    res.once('close', abort);
    /** Finite authorization/execution timer cleared when this phase settles. */
    const timer = setTimeout(() => {
      controller.abort();
      if (!res.destroyed && !res.writableEnded) {
        res.writeHead(504).end();
      }
    }, context.limits.timeoutMs);
    /** Actual authorization/dispatch promise; capacity is retained through its settlement. */
    const job = (async () => {
      try {
        if (
          (await options.authorize(req, {
            signal: controller.signal,
            remoteAddress: req.socket.remoteAddress,
          })) !== true
        ) {
          if (!res.writableEnded) {
            res.writeHead(403).end();
          }
          return;
        }
        if (controller.signal.aborted) {
          return;
        }
        clearTimeout(timer);
        if (!(await options.gateway.handle(req, res)) && !res.writableEnded) {
          res.writeHead(404).end();
        }
      } catch {
        if (!res.destroyed && !res.writableEnded) {
          if (res.headersSent) {
            res.destroy();
          } else {
            res.writeHead(500).end();
          }
        }
      }
    })();
    jobs.add(job);
    void job.finally(() => {
      clearTimeout(timer);
      res.off('close', abort);
      controllers.delete(controller);
      jobs.delete(job);
    });
  });
  return {
    address: owned.address,
    /** Acquire the native listener once and register cleanup before binding so partial startup remains owned.
     * @param {TransportStartContext} value - Registry-owned immutable bind/limits, signal and immediate cleanup registrar.
     * @returns {Promise<void>} Actual native listening settlement; subsequent start calls reject.
     */
    async start(value) {
      if (context) {
        throw new Error('Already started');
      }
      context = value;
      value.onDispose(stop);
      options.gateway.constrain(value.limits);
      options.gateway.validateBindings();
      await owned.listen(value);
    },
    health: () => ({ ready: owned.server.listening && !closing }),
    stop,
  };
}
/** One authorized message execution; send shares the same deadline and cancellation scope. */
export interface WebSocketMessageContext extends TransportAuthorizationContext {
  /** Epoch-millisecond cooperative execution deadline. */
  readonly deadline: number;
  /** Whether the native message was flagged binary. */
  readonly binary: boolean;
  /** Send one bounded message only while this execution is live and the socket’s buffered-byte budget permits it.
   * @param {string | Uint8Array} message - Inert application result bytes, never interpreted as executable server code.
   * @returns {Promise<void>} Native ws send-callback settlement; failure never automatically replays the message.
   */
  send(message: string | Uint8Array): Promise<void>;
}
/** Trusted server-only WebSocket registration; all received values remain inert application data. */
export interface WebSocketTransportOptions {
  /** Exact bounded upgrade path; query suffixes are not silently accepted. */
  path: string;
  /** Explicit trusted authorization callback required on every request/upgrade. */
  authorize: TransportAuthorization;
  /** Optional exact canonical origins; a present unlisted Origin is denied. */
  allowedOrigins?: readonly string[];
  /** Handle inert bytes only through an explicitly registered trusted application callback under host authorization.
   * @param {Uint8Array} message - Bounded raw message bytes; parse/validate application schemas independently.
   * @param {WebSocketMessageContext} context - Execution deadline/cancellation and bounded send capability tied to the initiating direct peer.
   * @returns {void | Promise<void>} Actual callback settlement; abort does not force arbitrary JavaScript to stop.
   */
  onMessage(
    message: Uint8Array,
    context: WebSocketMessageContext
  ): void | Promise<void>;
  /** Observe private native failures without owning cleanup or exposing payloads to public telemetry.
   * @param {unknown} error - Unknown private cause; host diagnostics must redact secrets.
   * @returns {void} Diagnostic callback exceptions are isolated from cleanup.
   */
  onError?(error: unknown): void;
}
/** Create an inert native WebSocket adapter with exact path/origin policy, mandatory host authorization and bounded fragmented messages; compression stays disabled.
 * @param {WebSocketTransportOptions} options - Explicit trusted callback/path/origin policy; an absent Origin is still subject to authorization.
 * @returns {TransportAdapter & { address(): { host: string; port: number } | null }} Explicit listener owner; stop terminates sockets and awaits actual message-job settlement.
 */
export function createWebSocketTransportAdapter(
  options: WebSocketTransportOptions
): TransportAdapter & {
  /** Read the actual bound native address without starting or resolving any listener.
   * @returns {{ host: string; port: number } | null} Native address after bind or null while not listening.
   */
  address(): { host: string; port: number } | null;
} {
  if (
    !options ||
    !/^\/[A-Za-z0-9/_-]{0,127}$/.test(options.path) ||
    typeof options.authorize !== 'function' ||
    typeof options.onMessage !== 'function' ||
    (options.onError !== undefined && typeof options.onError !== 'function')
  ) {
    throw new TypeError('Invalid WebSocket adapter');
  }
  /** Detached explicit exact origin allowlist, bounded and validated before any bind. */
  const origins = options.allowedOrigins ? [...options.allowedOrigins] : [];
  if (
    origins.length > 64 ||
    origins.some((v) => {
      try {
        return new URL(v).origin !== v;
      } catch {
        return true;
      }
    })
  ) {
    throw new TypeError('Invalid origins');
  }
  /** Per-adapter inert native listener/socket owner. */
  const owned = listener();
  /** Actual pending authorization/message jobs retained until settlement, including cancelled work. */
  const jobs = new Set<Promise<unknown>>();
  /** Owned cooperative execution controllers retained through actual job settlement. */
  const controllers = new Set<AbortController>();
  let context: TransportStartContext | undefined,
    wss: WebSocketServer | undefined,
    closing: Promise<void> | undefined;
  /** Observe a private native error through trusted host diagnostics without letting observer failure interrupt cleanup.
   * @param {unknown} e Private native cause; never default-log message payloads.
   * @returns {void} Isolates synchronous observer exceptions. */
  const report = (e: unknown) => {
    try {
      options.onError?.(e);
    } catch {
      /* Diagnostics never own cleanup. */
    }
  };
  /** Fence/cancel active scopes, close owned native endpoints and drain actual registered jobs.
   * @returns {Promise<void>} Shared actual shutdown; does not force-cancel arbitrary JavaScript. */
  const stop = () =>
    (closing ??= (async () => {
      for (const c of controllers) {
        c.abort();
      }
      for (const ws of wss?.clients ?? []) {
        ws.terminate();
      }
      /** Actual owned WebSocket-server close promise, or immediate completion before acquisition. */
      const drained = wss
        ? new Promise<void>((resolve) => wss!.close(() => resolve()))
        : Promise.resolve();
      await owned.close();
      await drained;
      await Promise.allSettled([...jobs]);
    })());
  owned.server.on('request', (_req, res) => res.writeHead(404).end());
  owned.server.on('upgrade', (req, socket, head) => {
    if (
      !context ||
      context.signal.aborted ||
      jobs.size >= context.limits.maxConcurrent ||
      (wss?.clients.size ?? 0) >= context.limits.maxConcurrent
    ) {
      socket.destroy();
      return;
    }
    /** Validated immutable work bounds captured for this upgrade scope. */
    const limits = context.limits;
    /** Owned request/upgrade cancellation scope tied to the actual peer. */
    const controller = new AbortController();
    controllers.add(controller);
    /** Propagate parent/peer cancellation into this owned listener or execution scope.
     * @returns {void} Cancels cooperatively; arbitrary host callbacks still require settlement. */
    const abort = () => controller.abort();
    socket.once('close', abort);
    /** Finite authorization/execution timer cleared when this phase settles. */
    const timer = setTimeout(() => {
      controller.abort();
      socket.destroy();
    }, limits.timeoutMs);
    /** Actual authorization/dispatch promise; capacity is retained through its settlement. */
    const job = (async () => {
      try {
        if (
          req.url !== options.path ||
          (req.headers.origin !== undefined &&
            !origins.includes(String(req.headers.origin))) ||
          (await options.authorize(req, {
            signal: controller.signal,
            remoteAddress: req.socket.remoteAddress,
          })) !== true
        ) {
          socket.end(
            'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
            () => socket.destroy()
          );
          return;
        }
        if (controller.signal.aborted || socket.destroyed) {
          return;
        }
        wss!.handleUpgrade(req, socket, head, (ws) => {
          let busy = false;
          ws.on('error', report);
          ws.once('close', () => controller.abort());
          ws.on('message', (data, binary) => {
            if (busy || jobs.size >= limits.maxConcurrent) {
              ws.close(1013, 'Busy');
              return;
            }
            busy = true;
            /** Owned individual message execution controller; parent cancellation propagates into it. */
            const c = new AbortController();
            controllers.add(c);
            /** Propagate upgrade-lifetime cancellation into this individual message execution.
             * @returns {void} Aborts cooperatively without releasing its job early. */
            const cancel = () => c.abort();
            controller.signal.addEventListener('abort', cancel, { once: true });
            if (controller.signal.aborted) {
              cancel();
            }
            /** Declared epoch-millisecond message deadline exposed to trusted handlers. */
            const expiresAt = Date.now() + limits.timeoutMs;
            /** Owned finite message timeout, cleared after actual handler settlement. */
            const deadline = setTimeout(() => {
              c.abort();
              ws.terminate();
            }, limits.timeoutMs);
            /** Actual message handler/send promise; busy/capacity release waits for its finally cleanup. */
            const task = (async () => {
              try {
                /** Bounded raw native bytes passed inert to the explicit trusted message handler. */
                const message = Array.isArray(data)
                  ? Buffer.concat(data)
                  : Buffer.from(data as ArrayBuffer);
                await options.onMessage(message, {
                  binary,
                  deadline: expiresAt,
                  signal: c.signal,
                  remoteAddress: req.socket.remoteAddress,
                  /** Send one bounded message only while this execution is live and the socket’s buffered-byte budget permits it.
                   * @param {string | Uint8Array} value - Inert application result bytes, never interpreted as executable server code.
                   * @returns {Promise<void>} Native ws send-callback settlement; failure never automatically replays the message.
                   */
                  async send(value) {
                    /** UTF-8 or binary send-byte count checked together with current native bufferedAmount. */
                    const size =
                      typeof value === 'string'
                        ? Buffer.byteLength(value)
                        : value.byteLength;
                    if (
                      c.signal.aborted ||
                      size > limits.maxMessageBytes ||
                      ws.bufferedAmount + size > limits.maxMessageBytes ||
                      ws.readyState !== WebSocket.OPEN
                    ) {
                      throw new Error('Send unavailable');
                    }
                    await new Promise<void>((resolve, reject) =>
                      ws.send(value, (error) =>
                        error ? reject(error) : resolve()
                      )
                    );
                  },
                });
              } catch (e) {
                report(e);
                ws.terminate();
              } finally {
                clearTimeout(deadline);
                controller.signal.removeEventListener('abort', cancel);
                controllers.delete(c);
                busy = false;
              }
            })();
            jobs.add(task);
            void task.finally(() => jobs.delete(task));
          });
        });
      } catch (e) {
        report(e);
        socket.destroy();
      }
    })();
    jobs.add(job);
    void job.finally(() => {
      clearTimeout(timer);
      socket.off('close', abort);
      controllers.delete(controller);
      jobs.delete(job);
    });
  });
  return {
    address: owned.address,
    /** Acquire the native listener once and register cleanup before binding so partial startup remains owned.
     * @param {TransportStartContext} value - Registry-owned immutable bind/limits, signal and immediate cleanup registrar.
     * @returns {Promise<void>} Actual native listening settlement; subsequent start calls reject.
     */
    async start(value) {
      if (context) {
        throw new Error('Already started');
      }
      context = value;
      value.onDispose(stop);
      wss = new WebSocketServer({
        noServer: true,
        maxPayload: value.limits.maxMessageBytes,
        perMessageDeflate: false,
      });
      await owned.listen(value);
    },
    health: () => ({ ready: owned.server.listening && !closing }),
    stop,
  };
}
