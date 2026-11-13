/* eslint-disable no-control-regex -- Control-character validation and glob sentinels are intentional. */
import http from 'node:http';
import type { Socket } from 'node:net';
import type { TestExecutionContext } from '../types/test.js';
export interface HttpChunk {
  data: string | Uint8Array;
  delayMs?: number;
}
export interface HttpReply {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  chunks?: readonly HttpChunk[];
  delayMs?: number;
  failure?: 'network' | 'timeout';
  failAfterChunks?: number;
}
export interface HttpRoute {
  method?: string;
  path: string;
  responses: readonly HttpReply[];
  expectedCalls?: number;
}
export interface HttpFakeOptions {
  routes: readonly HttpRoute[];
  origin?: string;
  maxBodyBytes?: number;
  maxResponseBytes?: number;
  maxConcurrent?: number;
  timeoutMs?: number;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
  scope?: Pick<TestExecutionContext, 'onCleanup'>;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Trusted explicit external transport; no global fallback or redirect following. */
  network?: { origins: readonly string[]; transport: typeof fetch };
}
export class HttpFakeError extends Error {
  constructor(readonly code: string) {
    super(`HTTP fake failed (${code})`);
    this.name = 'HttpFakeError';
  }
}
function integer(value: number, min: number, max: number, label: string) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError(`Invalid ${label}`);
  return value;
}
function canonical(value: string): string {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== value ||
      url.username ||
      url.password
    )
      throw Error();
    return value;
  } catch {
    throw new TypeError('Invalid fake origin');
  }
}
function bytes(value: unknown): Uint8Array {
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > 16777216)
      throw new RangeError('Fake body byte limit');
    return new TextEncoder().encode(value);
  }
  if (value instanceof Uint8Array) {
    if (value.length > 16777216) throw new RangeError('Fake body byte limit');
    return new Uint8Array(value);
  }
  throw new TypeError('Invalid fake body');
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}
/** No global interception. Exact fixture routes, bounded scripts and metadata-only calls. */
export function createHttpFake(options: HttpFakeOptions) {
  if (
    !options ||
    typeof options !== 'object' ||
    !Array.isArray(options.routes) ||
    options.routes.length > 128
  )
    throw new TypeError('Invalid HTTP fake options');
  const origin = canonical(options.origin ?? 'https://fake.test');
  const maxBody = integer(
      options.maxBodyBytes ?? 65536,
      1,
      16777216,
      'maxBodyBytes'
    ),
    maxResponse = integer(
      options.maxResponseBytes ?? 1048576,
      1,
      16777216,
      'maxResponseBytes'
    );
  const maxConcurrent = integer(
      options.maxConcurrent ?? 32,
      1,
      128,
      'maxConcurrent'
    ),
    timeout = integer(options.timeoutMs ?? 5000, 1, 600000, 'timeoutMs'),
    requestTimeout = integer(
      options.requestTimeoutMs ?? 1000,
      1,
      600000,
      'requestTimeoutMs'
    );
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    throw new TypeError('Invalid fake signal');
  for (const key of ['now', 'random', 'sleep'] as const)
    if (options[key] !== undefined && typeof options[key] !== 'function')
      throw new TypeError('Invalid deterministic input');
  if (options.scope && typeof options.scope.onCleanup !== 'function')
    throw new TypeError('Invalid fixture scope');
  const externalSignal = options.signal;
  const sleep = options.sleep ?? delay,
    now = options.now ?? (() => 0),
    random = options.random ?? (() => 0.5);
  const keys = new Set<string>();
  let totalBytes = 0;
  const routes = options.routes.map((route: HttpRoute, index: number) => {
    const method = route.method ?? 'GET';
    if (
      !/^[A-Z]{1,16}$/.test(method) ||
      typeof route.path !== 'string' ||
      route.path.length > 2048 ||
      !route.path.startsWith('/') ||
      /[\x00-\x20\x7f#]/.test(route.path) ||
      new URL(route.path, origin).origin !== origin ||
      new URL(route.path, origin).pathname +
        new URL(route.path, origin).search !==
        route.path ||
      !Array.isArray(route.responses) ||
      !route.responses.length ||
      route.responses.length > 128
    )
      throw new TypeError('Invalid fake route');
    const key = method + ' ' + route.path;
    if (keys.has(key)) throw new TypeError('Duplicate fake route');
    keys.add(key);
    const expected = integer(
      route.expectedCalls ?? route.responses.length,
      0,
      128,
      'expectedCalls'
    );
    const replies = route.responses.map((reply: HttpReply) => {
      if (!reply || typeof reply !== 'object')
        throw new TypeError('Invalid fake reply');
      const status = integer(reply.status ?? 200, 200, 599, 'status');
      if (
        reply.headers !== undefined &&
        (!reply.headers ||
          typeof reply.headers !== 'object' ||
          Array.isArray(reply.headers) ||
          Object.keys(reply.headers).length > 64 ||
          Object.entries(reply.headers).some(
            ([key, value]) =>
              key.length > 128 ||
              typeof value !== 'string' ||
              value.length > 8192
          ))
      )
        throw new TypeError('Invalid fake headers');
      const headers = new Headers(reply.headers);
      for (const key of [
        'connection',
        'transfer-encoding',
        'content-length',
        'upgrade',
        'set-cookie',
      ])
        if (headers.has(key))
          throw new TypeError('Unsupported fake response header');
      const location = headers.get('location');
      if (
        location !== null &&
        (!location.startsWith('/') ||
          location.startsWith('//') ||
          new URL(location, origin).origin !== origin)
      )
        throw new TypeError('Only local relative fake redirects are supported');
      const latency = integer(reply.delayMs ?? 0, 0, 600000, 'delayMs');
      if (reply.body !== undefined && reply.chunks !== undefined)
        throw new TypeError('Choose body or chunks');
      if (
        reply.chunks !== undefined &&
        (!Array.isArray(reply.chunks) || reply.chunks.length > 1024)
      )
        throw new TypeError('Invalid fake chunks');
      const chunks = (
        reply.chunks ?? (reply.body === undefined ? [] : [{ data: reply.body }])
      ).map((chunk: HttpChunk) => ({
        data: bytes(chunk.data),
        delayMs: integer(chunk.delayMs ?? 0, 0, 600000, 'chunk delay'),
      }));
      const size = chunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
      totalBytes += size;
      if (size > maxResponse || totalBytes > 16777216)
        throw new RangeError('Fake response byte limit');
      if ([204, 205, 304].includes(status) && chunks.length)
        throw new TypeError('Body prohibited for status');
      if (
        reply.failure !== undefined &&
        !['network', 'timeout'].includes(reply.failure)
      )
        throw new TypeError('Invalid fake failure');
      const failAfter =
        reply.failAfterChunks === undefined
          ? undefined
          : integer(reply.failAfterChunks, 0, chunks.length, 'failAfterChunks');
      return {
        status,
        headers,
        chunks,
        latency,
        failure: reply.failure,
        failAfter,
      };
    });
    return { index, key, expected, replies, calls: 0 };
  });
  const allowed = options.network;
  if (
    allowed &&
    (!Array.isArray(allowed.origins) ||
      allowed.origins.length > 32 ||
      typeof allowed.transport !== 'function')
  )
    throw new TypeError('Invalid fixture network allowance');
  const origins = new Set(allowed?.origins.map(canonical));
  const transport = allowed?.transport;
  const lifetime = new AbortController();
  const sleeps = new Set<Promise<void>>();
  const requests = new Set<AbortController>();
  const sockets = new Set<Socket>();
  let closeFailure: unknown;
  let closed = false,
    unexpected = 0,
    completed = 0,
    cancelled = 0,
    streams = 0,
    waiting = 0;
  let server: http.Server | undefined,
    listenPromise: Promise<string> | undefined,
    closing: Promise<void> | undefined;
  const calls: { route: number; method: string; at: number }[] = [];
  // eslint-disable-next-line prefer-const -- Callbacks observe this lifetime handle before its deferred initialization.
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const abort = () => {
    void close().catch((error) => {
      closeFailure = error;
    });
  };
  async function close(): Promise<void> {
    if (closing) return closing;
    closed = true;
    lifetime.abort(new HttpFakeError('FIXTURE_CLOSED'));
    if (deadline) clearTimeout(deadline);
    externalSignal?.removeEventListener('abort', abort);
    for (const controller of requests) controller.abort(lifetime.signal.reason);
    const socketClosures = [...sockets].map(
      (socket) =>
        new Promise<void>((resolve) => {
          socket.once('close', () => resolve());
          socket.destroy();
        })
    );
    closing = (async () => {
      if (server) {
        try {
          await listenPromise;
        } catch {
          /* Best-effort cleanup/discovery may already be unavailable; the owning operation handles its outcome. */
        }
        await new Promise<void>((resolve, reject) =>
          server!.close((error) =>
            error &&
            (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING'
              ? reject(error)
              : resolve()
          )
        );
      }
      await Promise.all(socketClosures);
      await Promise.allSettled([...sleeps]);
    })();
    return closing;
  }
  options.scope?.onCleanup(close);
  externalSignal?.addEventListener('abort', abort, { once: true });
  deadline = setTimeout(abort, timeout);
  if (externalSignal?.aborted) abort();
  function inputs() {
    const at = now(),
      value = random();
    if (
      !Number.isFinite(at) ||
      !Number.isFinite(value) ||
      value < 0 ||
      value >= 1
    )
      throw new HttpFakeError('INVALID_DETERMINISTIC_INPUT');
    return { at, random: value };
  }
  async function readBody(
    request: Request,
    signal: AbortSignal,
    retain = false
  ): Promise<Uint8Array | undefined> {
    if (!request.body) return undefined;
    const reader = request.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    const cancel = () => {
      void reader.cancel(signal.reason).catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > maxBody) throw new HttpFakeError('REQUEST_BODY_LIMIT');
        if (retain) chunks.push(new Uint8Array(chunk.value));
      }
    } catch (error) {
      void reader.cancel(error).catch(() => {});
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
    return retain ? Buffer.concat(chunks, size) : undefined;
  }
  const fakeFetch: typeof fetch = async (input, init) => {
    if (closed) throw new HttpFakeError('FIXTURE_CLOSED');
    if (requests.size >= maxConcurrent)
      throw new HttpFakeError('CONCURRENCY_LIMIT');
    const request = new Request(input, init);
    const url = new URL(request.url);
    const controller = new AbortController();
    requests.add(controller);
    const forward = () => controller.abort(request.signal.reason);
    request.signal.addEventListener('abort', forward, { once: true });
    if (request.signal.aborted) forward();
    const timer = setTimeout(
      () => controller.abort(new HttpFakeError('REQUEST_TIMEOUT')),
      requestTimeout
    );
    let finalized = false;
    const finish = () => {
      if (finalized) return;
      finalized = true;
      clearTimeout(timer);
      request.signal.removeEventListener('abort', forward);
      requests.delete(controller);
      completed++;
    };
    const pause = async (ms: number) => {
      waiting++;
      let pending: Promise<void> | undefined;
      try {
        controller.signal.throwIfAborted();
        pending = Promise.resolve(sleep(ms, controller.signal));
        sleeps.add(pending);
        await pending;
        controller.signal.throwIfAborted();
      } finally {
        if (pending) sleeps.delete(pending);
        waiting--;
      }
    };
    try {
      controller.signal.throwIfAborted();
      if (url.origin !== origin) {
        if (!origins.has(url.origin) || !transport) {
          unexpected++;
          throw new HttpFakeError('UNHANDLED_REQUEST');
        }
        // External delegation remains explicit and cannot silently follow redirects.
        const data = await readBody(request, controller.signal, true);
        const outgoing = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          ...(data ? { body: data as BodyInit } : {}),
          signal: controller.signal,
          redirect: 'error',
        });
        const response = await transport(outgoing, {
          signal: controller.signal,
          redirect: 'error',
        });
        controller.signal.throwIfAborted();
        if (!response.body) {
          finish();
          return response;
        }
        const reader = response.body.getReader();
        let ended = false,
          size = 0;
        streams++;
        let output: ReadableStreamDefaultController<Uint8Array>;
        const end = () => {
          if (ended) return;
          ended = true;
          streams--;
          controller.signal.removeEventListener('abort', abortExternal);
          finish();
        };
        const abortExternal = () => {
          if (ended) return;
          cancelled++;
          output.error(controller.signal.reason);
          void reader.cancel(controller.signal.reason).catch(() => {});
          end();
        };
        const stream = new ReadableStream<Uint8Array>(
          {
            start(value) {
              output = value;
              controller.signal.addEventListener('abort', abortExternal, {
                once: true,
              });
            },
            async pull(value) {
              try {
                controller.signal.throwIfAborted();
                const chunk = await reader.read();
                if (ended) return;
                if (chunk.done) {
                  value.close();
                  reader.releaseLock();
                  end();
                  return;
                }
                size += chunk.value.length;
                if (size > maxResponse)
                  throw new HttpFakeError('RESPONSE_BODY_LIMIT');
                value.enqueue(chunk.value);
              } catch (error) {
                if (!ended) {
                  value.error(error);
                  void reader.cancel(error).catch(() => {});
                  end();
                }
              }
            },
            async cancel() {
              if (!ended) {
                cancelled++;
                end();
                controller.abort();
                await reader.cancel();
                reader.releaseLock();
              }
            },
          },
          { highWaterMark: 0 }
        );
        return new Response(stream, {
          status: response.status,
          headers: response.headers,
        });
      }
      const route = routes.find(
        (route) =>
          route.key === request.method + ' ' + url.pathname + url.search
      );
      if (!route || route.calls >= route.replies.length) {
        unexpected++;
        throw new HttpFakeError('UNHANDLED_REQUEST');
      }
      await readBody(request, controller.signal);
      const reply = route.replies[route.calls++];
      if (!reply) throw new HttpFakeError('UNHANDLED_REQUEST');
      const values = inputs();
      if (calls.length >= 4096) throw new HttpFakeError('CALL_RECORD_LIMIT');
      calls.push({ route: route.index, method: request.method, at: values.at });
      if (reply.latency) await pause(reply.latency);
      if (reply.failure === 'network')
        throw new HttpFakeError('SCRIPTED_NETWORK_FAILURE');
      if (reply.failure === 'timeout') await pause(600000);
      controller.signal.throwIfAborted();
      if (!reply.chunks.length && reply.failAfter === undefined) {
        finish();
        return new Response(null, {
          status: reply.status,
          headers: reply.headers,
        });
      }
      streams++;
      let index = 0,
        ended = false;
      let bodyController: ReadableStreamDefaultController<Uint8Array>;
      const end = () => {
        if (ended) return;
        ended = true;
        streams--;
        controller.signal.removeEventListener('abort', abortBody);
        finish();
      };
      const abortBody = () => {
        if (ended) return;
        cancelled++;
        bodyController.error(controller.signal.reason);
        end();
      };
      const body = new ReadableStream<Uint8Array>(
        {
          start(value) {
            bodyController = value;
            controller.signal.addEventListener('abort', abortBody, {
              once: true,
            });
          },
          async pull(value) {
            try {
              controller.signal.throwIfAborted();
              if (reply.failAfter === index)
                throw new HttpFakeError('SCRIPTED_STREAM_FAILURE');
              if (index === reply.chunks.length) {
                value.close();
                end();
                return;
              }
              const chunk = reply.chunks[index++];
              if (!chunk) throw new HttpFakeError('SCRIPTED_STREAM_FAILURE');
              if (chunk.delayMs) await pause(chunk.delayMs);
              controller.signal.throwIfAborted();
              value.enqueue(new Uint8Array(chunk.data));
            } catch (error) {
              if (!ended) {
                value.error(error);
                end();
              }
            }
          },
          cancel() {
            if (!ended) {
              cancelled++;
              end();
              controller.abort(new HttpFakeError('READER_CANCELLED'));
            }
          },
        },
        { highWaterMark: 0 }
      );
      return new Response(body, {
        status: reply.status,
        headers: reply.headers,
      });
    } catch (error) {
      finish();
      throw error;
    }
  };
  async function listen(): Promise<string> {
    if (closed) throw new HttpFakeError('FIXTURE_CLOSED');
    if (listenPromise) return listenPromise;
    server = http.createServer(
      { maxHeaderSize: 16384, requestTimeout, headersTimeout: requestTimeout },
      (req, res) => {
        void (async () => {
          const controller = new AbortController();
          const disconnected = () =>
            controller.abort(new HttpFakeError('CLIENT_DISCONNECTED'));
          req.once('aborted', disconnected);
          res.once('close', disconnected);
          const deadline = setTimeout(() => {
            controller.abort(new HttpFakeError('REQUEST_TIMEOUT'));
            req.destroy();
            res.destroy();
          }, requestTimeout);
          try {
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of req) {
              size += chunk.length;
              if (size > maxBody) {
                res.writeHead(413);
                res.end('HTTP fake request rejected');
                return;
              }
              chunks.push(Buffer.from(chunk));
            }
            const method = req.method ?? 'GET';
            const body = Buffer.concat(chunks);
            const response = await fakeFetch(
              new Request(origin + (req.url ?? '/'), {
                method,
                ...(!['GET', 'HEAD'].includes(method) && body.length
                  ? { body }
                  : {}),
                signal: controller.signal,
              })
            );
            res.writeHead(
              response.status,
              Object.fromEntries(response.headers)
            );
            if (response.body) {
              const reader = response.body.getReader();
              try {
                while (true) {
                  const chunk = await reader.read();
                  if (chunk.done) break;
                  if (!res.write(chunk.value))
                    await new Promise<void>((resolve) => {
                      const done = () => {
                        res.off('drain', done);
                        res.off('close', done);
                        resolve();
                      };
                      res.once('drain', done);
                      res.once('close', done);
                    });
                }
              } finally {
                await reader.cancel().catch(() => {});
                reader.releaseLock();
              }
            }
            res.end();
          } catch {
            if (res.headersSent) res.destroy();
            else {
              res.writeHead(500);
              res.end('HTTP fake request failed');
            }
          } finally {
            clearTimeout(deadline);
            req.off('aborted', disconnected);
            res.off('close', disconnected);
          }
        })();
      }
    );
    server.maxConnections = maxConcurrent;
    server.maxHeadersCount = 64;
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    listenPromise = new Promise<string>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', () => {
        server!.off('error', reject);
        const address = server!.address();
        if (!address || typeof address === 'string') {
          reject(new HttpFakeError('LISTEN_FAILED'));
          return;
        }
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    return listenPromise;
  }
  return {
    fetch: fakeFetch,
    listen,
    close,
    signal: lifetime.signal,
    inputs,
    calls: () => Object.freeze(calls.map((call) => Object.freeze({ ...call }))),
    assertDone() {
      if (closeFailure !== undefined)
        throw new Error('HTTP fake cleanup failed', { cause: closeFailure });
      if (unexpected || routes.some((route) => route.calls !== route.expected))
        throw new HttpFakeError('EXPECTATION_FAILED');
    },
    diagnostics: () =>
      Object.freeze({
        closed,
        activeRequests: requests.size,
        activeStreams: streams,
        waiting,
        sockets: sockets.size,
        listening: server?.listening ?? false,
        completed,
        cancelled,
        unexpected,
      }),
  };
}
export type HttpFake = ReturnType<typeof createHttpFake>;
/** Always assert expectations and close, including callback rejection/fixture deadline. */
export async function withHttpFake<T>(
  options: HttpFakeOptions,
  run: (fake: HttpFake) => Promise<T> | T
): Promise<T> {
  const fake = createHttpFake(options);
  let failure: unknown;
  let failed = false;
  let value: T | undefined;
  const aborted = new Promise<never>((_, reject) => {
    const abort = () => reject(fake.signal.reason);
    if (fake.signal.aborted) abort();
    else fake.signal.addEventListener('abort', abort, { once: true });
  });
  try {
    value = await Promise.race([
      Promise.resolve().then(() => run(fake)),
      aborted,
    ]);
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    fake.assertDone();
  } catch (error) {
    failure = failed
      ? new AggregateError(
          [failure, error],
          'HTTP fake test and expectations failed'
        )
      : error;
    failed = true;
  }
  try {
    await fake.close();
  } catch (error) {
    failure = failed
      ? new AggregateError(
          [failure, error],
          'HTTP fake test and cleanup failed'
        )
      : error;
    failed = true;
  }
  if (failed) throw failure;
  return value as T;
}
