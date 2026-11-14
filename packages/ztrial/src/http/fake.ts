/* eslint-disable no-control-regex -- Control-character validation and glob sentinels are intentional. */
import http from 'node:http';
import type { Socket } from 'node:net';
import type { TestExecutionContext } from '../types/test.js';
/** Inert bounded producer chunk with explicit optional fixture latency. */
export interface HttpChunk {
  /** Inert synthetic body/chunk bytes; never executed as source or trusted HTML. */
  data: string | Uint8Array;
  /** Bounded synthetic latency in milliseconds, independent of real safety deadlines. */
  delayMs?: number;
}
/** One inert finite scripted reply/failure step; no supplied source is executed. */
export interface HttpReply {
  /** Explicit native response status, supported range200through599. */
  status?: number;
  /** Bounded inert response headers excluding hop fields, Set-Cookie and nonlocal redirects. */
  headers?: Record<string, string>;
  /** Explicit bounded synthetic bytes; mutually exclusive with chunks. */
  body?: string | Uint8Array;
  /** Bounded scripted producer chunks, not guaranteed native TCP packet boundaries. */
  chunks?: readonly HttpChunk[];
  /** Bounded synthetic latency in milliseconds, independent of real safety deadlines. */
  delayMs?: number;
  /** Explicit scripted pre-response network/timeout failure, never vendor acceptance. */
  failure?: 'network' | 'timeout';
  /** Optional exact produced-chunk count before a scripted stream failure. */
  failAfterChunks?: number;
}
/** Exact method/path/query fixture mapping with a finite one-use response sequence. */
export interface HttpRoute {
  /** Exact uppercase supported fixture HTTP method, defaultGET. */
  method?: string;
  /** Exact canonical same-origin pathname plus serialized query; no glob or source evaluation. */
  path: string;
  /** Nonempty bounded ordered one-use response sequence; exhaustion rejects. */
  responses: readonly HttpReply[];
  /** Exact desired matched call count, default response-step count. */
  expectedCalls?: number;
}
/** Explicit per-owner fixture/network/byte/time policy with no global interception. */
export interface HttpFakeOptions {
  /** Bounded explicit trusted route definitions; no production traffic interception. */
  routes: readonly HttpRoute[];
  /** Exact canonical fixture origin, default https://fake.test; no DNS is required for injected calls. */
  origin?: string;
  /** Positive request body cap, default64KiB and at most16MiB. */
  maxBodyBytes?: number;
  /** Positive per-response cap, default1MiB and at most16MiB; total scripts also at most16MiB. */
  maxResponseBytes?: number;
  /** Active injected operation/native connection cap from1through128, default32. */
  maxConcurrent?: number;
  /** Fixture lifetime milliseconds from1through600000, default5000. */
  timeoutMs?: number;
  /** Real per-request/body/stream deadline from1through600000, default1000. */
  requestTimeoutMs?: number;
  /** Optional parent cooperative cancellation; never a global shutdown signal. */
  signal?: AbortSignal;
  /** Optional invocation owner registering close immediately; expectations remain explicit. */
  scope?: Pick<TestExecutionContext, 'onCleanup'>;
  /** Trusted deterministic fixture clock, default constant zero; global Date remains untouched. */
  now?: () => number;
  /** Trusted deterministic fixture source, default0.5; never cryptographic entropy. */
  random?: () => number;
  /** Trusted cancellation-cooperative delay injection; native safety deadlines remain active. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Trusted explicit external transport; no global fallback or redirect following. */
  network?: {
    /** Exact bounded external origin allowlist; no implicit global-fetch fallback. */
    /** Exact bounded external origin allowlist; no implicit global-fetch fallback. */
    origins: readonly string[];
    /** Explicit trusted Fetch-compatible delegate required with allowlisted origins. */
    /** Explicit trusted Fetch-compatible delegate required with allowlisted origins. */
    transport: typeof fetch;
  };
}
/** Fixed fixture classification without bodies, credentials or transport cause disclosure. */
export class HttpFakeError extends Error {
  /** Create a fixed HTTP-fixture failure code without exposing scripted bodies or private transport causes.
   * @param {string} code - Fixed internal fixture outcome classification.
   */
  constructor(readonly code: string) {
    super(`HTTP fake failed (${code})`);
    this.name = 'HttpFakeError';
  }
}
/** Validate inclusive finite safe-integer fixture budgets before native work.
 * @param {number} value - Explicit/default fixture setting.
 * @param {number} min - Inclusive supported lower bound.
 * @param {number} max - Inclusive supported upper bound.
 * @param {string} label - Fixed nonsecret option label.
 * @returns {number} Validated integer without coercion.
 */
function integer(value: number, min: number, max: number, label: string) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`Invalid ${label}`);
  }
  return value;
}
/** Require one exact canonical HTTP(S) origin without user credentials, paths or queries; parsing never performs DNS/fetch.
 * @param {string} value - Explicit fixture origin or delegated allowlist origin.
 * @returns {string} Unchanged validated origin; this is not a process-wide egress firewall.
 */
function canonical(value: string): string {
  try {
    /** Inert parsed request/configuration URL checked before any explicit delegate call. */
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== value ||
      url.username ||
      url.password
    ) {
      throw Error();
    }
    return value;
  } catch {
    throw new TypeError('Invalid fake origin');
  }
}
/** Copy a bounded inert scripted body from supported text/bytes without interpreting source or markup.
 * @param {unknown} value - Explicit synthetic string or Uint8Array fixture data.
 * @returns {Uint8Array} Detached byte copy, at most16MiB before tighter per-reply/aggregate budgets.
 */
function bytes(value: unknown): Uint8Array {
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > 16777216) {
      throw new RangeError('Fake body byte limit');
    }
    return new TextEncoder().encode(value);
  }
  if (value instanceof Uint8Array) {
    if (value.length > 16777216) {
      throw new RangeError('Fake body byte limit');
    }
    return new Uint8Array(value);
  }
  throw new TypeError('Invalid fake body');
}
/** Wait on one native timer tied only to this fixture operation’s cooperative cancellation.
 * @param {number} ms - Validated bounded scripted latency.
 * @param {AbortSignal} signal - Owned operation cancellation signal.
 * @returns {Promise<void>} Timer settlement or explicit cancellation rejection with listener/timer cleanup.
 */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    /** Owned bounded native wait/request timer, cleared on its actual terminal local outcome. */
    const timer = setTimeout(done, ms);
    /** Detach this native latency wait’s abort listener before resolving.
     * @returns {void} Settles only this owned wait.
     */
    function done() {
      signal.removeEventListener('abort', abort);
      resolve();
    }
    /** Cancel an owned native wait or request fixture close, depending on its enclosing lifetime; no unrelated global interception occurs.
     * @returns {void} Requests only this scope’s cooperative cancellation/cleanup.
     */
    function abort() {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}
/** Acquire an explicitly scripted bounded fixture with its own lifetime timer, exact routes and optional allowlisted injected delegation; no global Fetch/native HTTP API is patched.
 * @param {HttpFakeOptions} options - Trusted explicit fixture scripts/budgets; bodies remain inert data and custom transports are trusted executable host code.
 * @returns {HttpFake} Owned timer/streams/socket fixture; call assertDone explicitly and await close in finally unless using withHttpFake.
 */
export function createHttpFake(options: HttpFakeOptions) {
  if (
    !options ||
    typeof options !== 'object' ||
    !Array.isArray(options.routes) ||
    options.routes.length > 128
  ) {
    throw new TypeError('Invalid HTTP fake options');
  }
  /** Validated exact scripted fixture origin; injected requests require no DNS/network. */
  const origin = canonical(options.origin ?? 'https://fake.test');
  /** Validated finite byte ceiling for every incoming body. */
  const maxBody = integer(
    options.maxBodyBytes ?? 65536,
    1,
    16777216,
    'maxBodyBytes'
  );
  /** Validated finite per-response body cap. */
  const maxResponse = integer(
    options.maxResponseBytes ?? 1048576,
    1,
    16777216,
    'maxResponseBytes'
  );
  /** Validated finite injected-operation/native TCP capacity. */
  const maxConcurrent = integer(
    options.maxConcurrent ?? 32,
    1,
    128,
    'maxConcurrent'
  );
  /** Validated real fixture lifetime budget. */
  const timeout = integer(options.timeoutMs ?? 5000, 1, 600000, 'timeoutMs');
  /** Validated real request/body/stream safety deadline. */
  const requestTimeout = integer(
    options.requestTimeoutMs ?? 1000,
    1,
    600000,
    'requestTimeoutMs'
  );
  if (
    options.signal !== undefined &&
    !(options.signal instanceof AbortSignal)
  ) {
    throw new TypeError('Invalid fake signal');
  }
  for (const key of ['now', 'random', 'sleep'] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'function') {
      throw new TypeError('Invalid deterministic input');
    }
  }
  if (options.scope && typeof options.scope.onCleanup !== 'function') {
    throw new TypeError('Invalid fixture scope');
  }
  /** Borrowed parent signal whose fixture-owned abort listener is removed on close. */
  const externalSignal = options.signal;
  /** Trusted injected latency callback or owned native timer helper; not a global timer patch. */
  const sleep = options.sleep ?? delay;
  /**
   * Trusted deterministic fixture clock or constant default.
   * @returns {number} The default returns zero without reading global Date.
   */
  const now = options.now ?? (() => 0);
  /**
   * Trusted deterministic fixture source or constant default; never security entropy.
   * @returns {number} The default returns0.5 without consuming global randomness.
   */
  const random = options.random ?? (() => 0.5);
  /** Bounded route uniqueness keys; duplicate method/path/query definitions reject. */
  const keys = new Set<string>();
  let totalBytes = 0;
  /** Detached validated bounded route/script records, excluding caller mutable byte buffers. */
  const routes = options.routes.map((route: HttpRoute, index: number) => {
    /** Exact declared or native method; native bridge never forwards authorization credentials. */
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
    ) {
      throw new TypeError('Invalid fake route');
    }
    /** Canonical exact method plus serialized request pathname/query identity. */
    const key = method + ' ' + route.path;
    if (keys.has(key)) {
      throw new TypeError('Duplicate fake route');
    }
    keys.add(key);
    /** Validated exact matched call count for this route. */
    const expected = integer(
      route.expectedCalls ?? route.responses.length,
      0,
      128,
      'expectedCalls'
    );
    /** Detached validated one-use response steps for this route. */
    const replies = route.responses.map((reply: HttpReply) => {
      if (!reply || typeof reply !== 'object') {
        throw new TypeError('Invalid fake reply');
      }
      /** Validated explicit native response status for this step. */
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
      ) {
        throw new TypeError('Invalid fake headers');
      }
      /** Detached validated native response Headers; unsupported/private hop fields reject. */
      const headers = new Headers(reply.headers);
      for (const key of [
        'connection',
        'transfer-encoding',
        'content-length',
        'upgrade',
        'set-cookie',
      ]) {
        if (headers.has(key)) {
          throw new TypeError('Unsupported fake response header');
        }
      }
      /** Optional inert Location requiring a local relative destination. */
      const location = headers.get('location');
      if (
        location !== null &&
        (!location.startsWith('/') ||
          location.startsWith('//') ||
          new URL(location, origin).origin !== origin)
      ) {
        throw new TypeError('Only local relative fake redirects are supported');
      }
      /** Validated scripted step latency, separate from real safety timeouts. */
      const latency = integer(reply.delayMs ?? 0, 0, 600000, 'delayMs');
      if (reply.body !== undefined && reply.chunks !== undefined) {
        throw new TypeError('Choose body or chunks');
      }
      if (
        reply.chunks !== undefined &&
        (!Array.isArray(reply.chunks) || reply.chunks.length > 1024)
      ) {
        throw new TypeError('Invalid fake chunks');
      }
      /** Bounded copied scripted/request chunks retained only by their owning fixture operation. */
      const chunks = (
        reply.chunks ?? (reply.body === undefined ? [] : [{ data: reply.body }])
      ).map((chunk: HttpChunk) => ({
        data: bytes(chunk.data),
        delayMs: integer(chunk.delayMs ?? 0, 0, 600000, 'chunk delay'),
      }));
      /** Actual byte count or configured script-byte sum used for the corresponding declared cap. */
      const size = chunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
      totalBytes += size;
      if (size > maxResponse || totalBytes > 16777216) {
        throw new RangeError('Fake response byte limit');
      }
      if ([204, 205, 304].includes(status) && chunks.length) {
        throw new TypeError('Body prohibited for status');
      }
      if (
        reply.failure !== undefined &&
        !['network', 'timeout'].includes(reply.failure)
      ) {
        throw new TypeError('Invalid fake failure');
      }
      /** Optional validated produced-chunk boundary for explicit stream failure. */
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
  /** Borrowed explicit delegation configuration; no destination or transport is guessed. */
  const allowed = options.network;
  if (
    allowed &&
    (!Array.isArray(allowed.origins) ||
      allowed.origins.length > 32 ||
      typeof allowed.transport !== 'function')
  ) {
    throw new TypeError('Invalid fixture network allowance');
  }
  /** Validated exact external origin allowlist. */
  const origins = new Set(allowed?.origins.map(canonical));
  /** Borrowed explicitly trusted external transport; must honor redirect/cancellation policy. */
  const transport = allowed?.transport;
  /** Owned fixture cancellation controller, aborted only for this fixture close/deadline. */
  const lifetime = new AbortController();
  /** Actual injected/native sleep promises retained until their own settlement. */
  const sleeps = new Set<Promise<void>>();
  /** Owned active injected request controllers; completed bodies release their reservations. */
  const requests = new Set<AbortController>();
  /** Owned accepted bridge sockets, retained only until native close. */
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
  /** Bounded metadata-only observations: route index, method and injected time, never headers/bodies/URLs. */
  const calls: {
    route: number;
    /** Exact uppercase supported fixture HTTP method, defaultGET. */
    /** Exact uppercase supported fixture HTTP method, defaultGET. */
    method: string;
    at: number;
  }[] = [];
  // eslint-disable-next-line prefer-const -- Callbacks observe this lifetime handle before its deferred initialization.
  let deadline: ReturnType<typeof setTimeout> | undefined;
  /** Request only this fixture’s close or its lifetime rejection; no global state is intercepted.
   * @returns {void} Propagates owned fixture cancellation without forcing arbitrary callbacks to finish. */
  const abort = () => {
    void close().catch((error) => {
      closeFailure = error;
    });
  };
  /** Fence new requests, abort owned request/stream scopes, destroy owned native sockets and await native server/socket plus tracked sleep settlement.
   * @returns {Promise<void>} Idempotent owned cleanup; noncooperative borrowed external transports are not force-cancelled or fully drained.
   */
  async function close(): Promise<void> {
    if (closing) {
      return closing;
    }
    closed = true;
    lifetime.abort(new HttpFakeError('FIXTURE_CLOSED'));
    if (deadline) {
      clearTimeout(deadline);
    }
    externalSignal?.removeEventListener('abort', abort);
    for (const controller of requests) {
      controller.abort(lifetime.signal.reason);
    }
    /** Actual native owned-socket close receipts requested before awaiting listener cleanup. */
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
  if (externalSignal?.aborted) {
    abort();
  }
  /** Read/validate only the injected fixture clock/random sources without touching global time or entropy.
   * @returns {{ at: number; random: number }} Finite explicit fixture inputs; never suitable for authentication or cryptographic tokens.
   */
  function inputs() {
    /** Actual injected clock reading validated as finite. */
    const at = now();
    /** Actual injected deterministic random reading validated in the half-open zero-to-one range. */
    const value = random();
    if (
      !Number.isFinite(at) ||
      !Number.isFinite(value) ||
      value < 0 ||
      value >= 1
    ) {
      throw new HttpFakeError('INVALID_DETERMINISTIC_INPUT');
    }
    return { at, random: value };
  }
  /** Read/cancel one request stream under the declared byte cap, optionally retaining bounded copies only for explicit allowed delegation.
   * @param {Request} request - Owned Request constructed for this injected operation.
   * @param {AbortSignal} signal - Owned cooperative operation signal.
   * @param {boolean} retain - False discards bytes after validation; true retains bounded bytes for the declared transport.
   * @returns {Promise<Uint8Array | undefined>} Optional bounded copied body; reader lock/listener cleanup occurs on every outcome.
   */
  async function readBody(
    request: Request,
    signal: AbortSignal,
    retain = false
  ): Promise<Uint8Array | undefined> {
    if (!request.body) {
      return undefined;
    }
    /** Owned stream reader; lock/listener cleanup belongs to this request or delegated response lifetime. */
    const reader = request.body.getReader();
    let size = 0;
    /** Bounded copied scripted/request chunks retained only by their owning fixture operation. */
    const chunks: Uint8Array[] = [];
    /** Cancel only this owned body reader on operation abort.
     * @returns {void} Observes cancel rejection privately; the surrounding read operation releases its lock. */
    const cancel = () => {
      void reader.cancel(signal.reason).catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        /** Actual one-read or one-scripted-chunk receipt; no later chunk is exposed after observed cancellation. */
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) {
          break;
        }
        size += chunk.value.length;
        if (size > maxBody) {
          throw new HttpFakeError('REQUEST_BODY_LIMIT');
        }
        if (retain) {
          chunks.push(new Uint8Array(chunk.value));
        }
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
  /** Execute one bounded injected fixture request without patching globalFetch or retrying exhausted/partially emitted scripts.
   * @param {RequestInfo | URL} input Explicit request value for this fixture transport.
   * @param {RequestInit | undefined} init Explicit per-call native Fetch options.
   * @returns {Promise<Response>} Actual scripted/delegated bounded response whose body must be consumed or cancelled. */
  const fakeFetch: typeof fetch = async (input, init) => {
    if (closed) {
      throw new HttpFakeError('FIXTURE_CLOSED');
    }
    if (requests.size >= maxConcurrent) {
      throw new HttpFakeError('CONCURRENCY_LIMIT');
    }
    /** Owned Request instance for this one injected operation. */
    const request = new Request(input, init);
    /** Inert parsed request/configuration URL checked before any explicit delegate call. */
    const url = new URL(request.url);
    /** Owned request/bridge cancellation scope, never a tenant identity. */
    const controller = new AbortController();
    requests.add(controller);
    /** Propagate only this request’s caller cancellation into its owned operation scope.
     * @returns {void} Cooperative abort; no unrelated requests are cancelled. */
    const forward = () => controller.abort(request.signal.reason);
    request.signal.addEventListener('abort', forward, { once: true });
    if (request.signal.aborted) {
      forward();
    }
    /** Owned bounded native wait/request timer, cleared on its actual terminal local outcome. */
    const timer = setTimeout(
      () => controller.abort(new HttpFakeError('REQUEST_TIMEOUT')),
      requestTimeout
    );
    let finalized = false;
    /** Release this local request reservation once and remove its deadline/caller-abort listener.
     * @returns {void} Counts local completion, not successful external delivery. */
    const finish = () => {
      if (finalized) {
        return;
      }
      finalized = true;
      clearTimeout(timer);
      request.signal.removeEventListener('abort', forward);
      requests.delete(controller);
      completed++;
    };
    /** Wait for one explicit scripted latency while retaining the actual injected sleep until settlement.
     * @param {number} ms Validated bounded fixture delay.
     * @returns {Promise<void>} Actual sleep outcome with waiting/pending accounting cleanup. */
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
        if (pending) {
          sleeps.delete(pending);
        }
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
        /** Bounded copied outgoing body used only for explicitly allowlisted delegation. */
        const data = await readBody(request, controller.signal, true);
        /** Owned delegated Request with redirect error and cooperative signal; custom transport remains trusted. */
        const outgoing = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          ...(data ? { body: data as BodyInit } : {}),
          signal: controller.signal,
          redirect: 'error',
        });
        /** Actual bounded delegated/scripted response, not a claim of live-provider correctness. */
        const response = await transport(outgoing, {
          signal: controller.signal,
          redirect: 'error',
        });
        controller.signal.throwIfAborted();
        if (!response.body) {
          finish();
          return response;
        }
        /** Owned stream reader; lock/listener cleanup belongs to this request or delegated response lifetime. */
        const reader = response.body.getReader();
        let ended = false,
          size = 0;
        streams++;
        let output: ReadableStreamDefaultController<Uint8Array>;
        /** Release this response’s local stream/request accounting once.
         * @returns {void} Detaches this stream’s abort listener without replaying bytes. */
        const end = () => {
          if (ended) {
            return;
          }
          ended = true;
          streams--;
          controller.signal.removeEventListener('abort', abortExternal);
          finish();
        };
        /** Fail the owned delegated response stream and request its reader cancellation.
         * @returns {void} Does not force-cancel arbitrary borrowed transport JavaScript. */
        const abortExternal = () => {
          if (ended) {
            return;
          }
          cancelled++;
          output.error(controller.signal.reason);
          void reader.cancel(controller.signal.reason).catch(() => {});
          end();
        };
        /** Owned pull-driven delegated response wrapper with zero prefetch/high-watermark. */
        const stream = new ReadableStream<Uint8Array>(
          {
            /** Bind this owned pull-driven byte stream controller to its operation’s abort signal.
             * @param {ReadableStreamDefaultController<Uint8Array>} value - Native stream controller for this one owned injected response.
             * @returns {void} Registers only this stream’s cooperative abort hook.
             */
            start(value) {
              output = value;
              controller.signal.addEventListener('abort', abortExternal, {
                once: true,
              });
            },
            /** Produce one bounded scripted/native chunk only when requested, observing operation cancellation before exposing further bytes.
             * @param {ReadableStreamDefaultController<Uint8Array>} value - Native owned response-stream controller.
             * @returns {Promise<void>} Actual one-pull settlement; scripted failures do not replay already exposed bytes.
             */
            async pull(value) {
              try {
                controller.signal.throwIfAborted();
                /** Actual one-read or one-scripted-chunk receipt; no later chunk is exposed after observed cancellation. */
                const chunk = await reader.read();
                if (ended) {
                  return;
                }
                if (chunk.done) {
                  value.close();
                  reader.releaseLock();
                  end();
                  return;
                }
                size += chunk.value.length;
                if (size > maxResponse) {
                  throw new HttpFakeError('RESPONSE_BODY_LIMIT');
                }
                value.enqueue(chunk.value);
              } catch (error) {
                if (!ended) {
                  value.error(error);
                  void reader.cancel(error).catch(() => {});
                  end();
                }
              }
            },
            /** End only this owned response stream and propagate cancellation to its owned request/delegated reader.
             * @returns {void | Promise<void>} Releases local stream/request accounting; borrowed transport work still must cooperate.
             */
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
      /** Exact matched detached fixture route; caller query text cannot add a new route. */
      const route = routes.find(
        (route) =>
          route.key === request.method + ' ' + url.pathname + url.search
      );
      if (!route || route.calls >= route.replies.length) {
        unexpected++;
        throw new HttpFakeError('UNHANDLED_REQUEST');
      }
      await readBody(request, controller.signal);
      /** Next one-use matched scripted step; exhausted scripts reject explicitly. */
      const reply = route.replies[route.calls++];
      if (!reply) {
        throw new HttpFakeError('UNHANDLED_REQUEST');
      }
      /** Validated injected time/random values, recorded only through allowed metadata fields. */
      const values = inputs();
      if (calls.length >= 4096) {
        throw new HttpFakeError('CALL_RECORD_LIMIT');
      }
      calls.push({ route: route.index, method: request.method, at: values.at });
      if (reply.latency) {
        await pause(reply.latency);
      }
      if (reply.failure === 'network') {
        throw new HttpFakeError('SCRIPTED_NETWORK_FAILURE');
      }
      if (reply.failure === 'timeout') {
        await pause(600000);
      }
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
      /** Release this response’s local stream/request accounting once.
       * @returns {void} Detaches this stream’s abort listener without replaying bytes. */
      const end = () => {
        if (ended) {
          return;
        }
        ended = true;
        streams--;
        controller.signal.removeEventListener('abort', abortBody);
        finish();
      };
      /** Fail only this owned scripted body stream on operation abort.
       * @returns {void} Releases local response accounting once. */
      const abortBody = () => {
        if (ended) {
          return;
        }
        cancelled++;
        bodyController.error(controller.signal.reason);
        end();
      };
      /** Owned bounded native-request bytes or scripted pull stream, according to its enclosing stage. */
      const body = new ReadableStream<Uint8Array>(
        {
          /** Bind this owned pull-driven byte stream controller to its operation’s abort signal.
           * @param {ReadableStreamDefaultController<Uint8Array>} value - Native stream controller for this one owned injected response.
           * @returns {void} Registers only this stream’s cooperative abort hook.
           */
          start(value) {
            bodyController = value;
            controller.signal.addEventListener('abort', abortBody, {
              once: true,
            });
          },
          /** Produce one bounded scripted/native chunk only when requested, observing operation cancellation before exposing further bytes.
           * @param {ReadableStreamDefaultController<Uint8Array>} value - Native owned response-stream controller.
           * @returns {Promise<void>} Actual one-pull settlement; scripted failures do not replay already exposed bytes.
           */
          async pull(value) {
            try {
              controller.signal.throwIfAborted();
              if (reply.failAfter === index) {
                throw new HttpFakeError('SCRIPTED_STREAM_FAILURE');
              }
              if (index === reply.chunks.length) {
                value.close();
                end();
                return;
              }
              /** Actual one-read or one-scripted-chunk receipt; no later chunk is exposed after observed cancellation. */
              const chunk = reply.chunks[index++];
              if (!chunk) {
                throw new HttpFakeError('SCRIPTED_STREAM_FAILURE');
              }
              if (chunk.delayMs) {
                await pause(chunk.delayMs);
              }
              controller.signal.throwIfAborted();
              value.enqueue(new Uint8Array(chunk.data));
            } catch (error) {
              if (!ended) {
                value.error(error);
                end();
              }
            }
          },
          /** End only this owned response stream and propagate cancellation to its owned request/delegated reader.
           * @returns {void | Promise<void>} Releases local stream/request accounting; borrowed transport work still must cooperate.
           */
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
  /** Explicitly acquire one ephemeral IPv4-loopback HTTP bridge using the same scripts and bounded bodies; incoming authorization/cookie headers are not forwarded.
   * @returns {Promise<string>} Shared actual fixture address; close owns its sockets/listener, never an operator app.
   */
  async function listen(): Promise<string> {
    if (closed) {
      throw new HttpFakeError('FIXTURE_CLOSED');
    }
    if (listenPromise) {
      return listenPromise;
    }
    server = http.createServer(
      { maxHeaderSize: 16384, requestTimeout, headersTimeout: requestTimeout },
      (req, res) => {
        void (async () => {
          /** Owned request/bridge cancellation scope, never a tenant identity. */
          const controller = new AbortController();
          /** Propagate native bridge peer close into this operation’s cooperative signal.
           * @returns {void} Cancels only the owned synthetic request. */
          const disconnected = () =>
            controller.abort(new HttpFakeError('CLIENT_DISCONNECTED'));
          req.once('aborted', disconnected);
          res.once('close', disconnected);
          /** Owned native bridge request deadline cleared on every terminal handler outcome. */
          const deadline = setTimeout(() => {
            controller.abort(new HttpFakeError('REQUEST_TIMEOUT'));
            req.destroy();
            res.destroy();
          }, requestTimeout);
          try {
            /** Bounded copied scripted/request chunks retained only by their owning fixture operation. */
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
            /** Exact declared or native method; native bridge never forwards authorization credentials. */
            const method = req.method ?? 'GET';
            /** Owned bounded native-request bytes or scripted pull stream, according to its enclosing stage. */
            const body = Buffer.concat(chunks);
            /** Actual bounded delegated/scripted response, not a claim of live-provider correctness. */
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
              /** Owned stream reader; lock/listener cleanup belongs to this request or delegated response lifetime. */
              const reader = response.body.getReader();
              try {
                while (true) {
                  /** Actual one-read or one-scripted-chunk receipt; no later chunk is exposed after observed cancellation. */
                  const chunk = await reader.read();
                  if (chunk.done) {
                    break;
                  }
                  if (!res.write(chunk.value)) {
                    await new Promise<void>((resolve) => {
                      /** Release this bridge response’s drain/close wait listeners once backpressure ends.
                       * @returns {void} Settles only the owned native backpressure wait. */
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
              } finally {
                await reader.cancel().catch(() => {});
                reader.releaseLock();
              }
            }
            res.end();
          } catch {
            if (res.headersSent) {
              res.destroy();
            } else {
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
        /** Actual ephemeral IPv4-loopback listener address checked after successful bind. */
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
    /** Require exact declared route call counts and no unexpected request or retained cleanup failure, including caught failures.
     * @returns {void} Throws explicit expectation/cleanup failure; direct fixture users must invoke this method.
     */
    assertDone() {
      if (closeFailure !== undefined) {
        throw new Error('HTTP fake cleanup failed', { cause: closeFailure });
      }
      if (
        unexpected ||
        routes.some((route) => route.calls !== route.expected)
      ) {
        throw new HttpFakeError('EXPECTATION_FAILED');
      }
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
/** Owned timer/stream/socket fixture contract; direct users explicitly assert expectations and close. */
export type HttpFake = ReturnType<typeof createHttpFake>;
/** Run one explicit trusted callback with a scoped fixture, always check expectations and close after callback/deadline failure while preserving all causes.
 * @param {HttpFakeOptions} options - Trusted explicit bounded fixture configuration.
 * @param {(fake: HttpFake) => Promise<T> | T} run - Trusted callback consuming this fixture; no callback source is loaded from data.
 * @returns {Promise<T>} Callback value only after expectations/cleanup succeed; timeout cannot force-cancel arbitrary callback JavaScript.
 */
export async function withHttpFake<T>(
  options: HttpFakeOptions,
  run: (fake: HttpFake) => Promise<T> | T
): Promise<T> {
  /** Owned scoped fixture, always checked and closed by withHttpFake. */
  const fake = createHttpFake(options);
  let failure: unknown;
  let failed = false;
  let value: T | undefined;
  /** Observed fixture-lifetime rejection racing the trusted callback without force-cancelling it. */
  const aborted = new Promise<never>((_, reject) => {
    /** Request only this fixture’s close or its lifetime rejection; no global state is intercepted.
     * @returns {void} Propagates owned fixture cancellation without forcing arbitrary callbacks to finish. */
    const abort = () => reject(fake.signal.reason);
    if (fake.signal.aborted) {
      abort();
    } else {
      fake.signal.addEventListener('abort', abort, { once: true });
    }
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
  if (failed) {
    throw failure;
  }
  return value as T;
}
