import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RequestCorrelation {
  /** Opaque or approved fixed application correlation label. */
  readonly applicationId: string;
  /** Opaque runtime generation identifier. */
  readonly generationId: string;
  /** Fresh opaque per-request identifier. */
  readonly requestId: string;
  /** Random or explicitly trusted validated remote trace identifier. */
  readonly traceId: string;
  /** Fresh opaque local span identifier. */
  readonly spanId: string;
  /** Validated remote parent only under explicit host propagation trust. */
  readonly parentSpanId?: string;
  /** Whether this request was selected for operational tracing. */
  readonly sampled: boolean;
}
export interface RequestSpan extends RequestCorrelation {
  /** Wall-clock request start in Unix milliseconds. */
  readonly startedAt: number;
  /** Nonnegative monotonic elapsed duration. */
  readonly durationMs: number;
  /** Native completion status or synthetic disconnect status 499. */
  readonly status: number;
  /** Fixed completed/disconnected/error classification without raw causes. */
  readonly outcome: 'completed' | 'disconnected' | 'error';
}
/** Adapter owns its exporter. Callbacks must not block; async export/shutdown receive cancellation. */
export interface TracingAdapter {
  /** Notify the adapter that one sampled request started; keep callbacks nonblocking.
   * @param {Readonly<RequestCorrelation>} context - Immutable operational correlation fields.
   * @returns {void} Synchronous notification completion.
   */
  start?(context: Readonly<RequestCorrelation>): void;
  /** Notify the adapter that one sampled response reached a terminal state.
   * @param {Readonly<RequestSpan>} span - Immutable redacted terminal request sample.
   * @returns {void} Synchronous notification completion.
   */
  end?(span: Readonly<RequestSpan>): void;
  /** Export one operational span using explicit cooperative cancellation.
   * @param {Readonly<RequestSpan>} span - Immutable redacted terminal request sample.
   * @param {AbortSignal} signal - Combined observer shutdown and export deadline signal.
   * @returns {void | Promise<void>} Actual exporter settlement; ignoring cancellation retains the single exporter slot.
   */
  export(
    span: Readonly<RequestSpan>,
    signal: AbortSignal
  ): void | Promise<void>;
  /** Release exporter-owned resources under cooperative cancellation.
   * @param {AbortSignal} signal - Observer close deadline signal.
   * @returns {void | Promise<void>} Adapter shutdown settlement when asynchronous.
   */
  shutdown?(signal: AbortSignal): void | Promise<void>;
}
export interface ObservabilityOptions {
  /** Opaque or approved fixed application correlation label. */
  applicationId?: string;
  /** Opaque runtime generation identifier. */
  generationId?: string;
  /** Explicit exporter owned according to the host integration contract. */
  adapter?: TracingAdapter;
  /** Fresh generation-owned adapter for reloadable hosts. Mutually exclusive with adapter. */
  createAdapter?: () => TracingAdapter;
  /** Probability from zero through one; not a complete traffic count. */
  sampleRate?: number;
  /** Bounded queued/in-flight and active span capacity. */
  maxQueue?: number;
  /** Cooperative per-export deadline in milliseconds. */
  exportTimeoutMs?: number;
  /** Maximum close wait before returning despite noncooperative adapter work. */
  shutdownTimeoutMs?: number;
  /** Explicit trust boundary; syntactically valid remote parents are otherwise ignored. */
  trustTraceParent?: boolean;
  /** Trusted private sink receives raw causes. Never serialize these into public output. */
  onError?: (
    error: unknown,
    context: Readonly<RequestCorrelation> | undefined
  ) => void;
}
/** Async-local correlation only; no request bodies, header bags or marketing identity are retained. */
const contextStorage = new AsyncLocalStorage<Readonly<RequestCorrelation>>();
/** Read current async-local request correlation without creating a request scope.
 * @returns {Readonly<RequestCorrelation> | undefined} Current immutable correlation projection.
 */
export const getRequestCorrelation = () => contextStorage.getStore();
/** Generate an opaque cryptographically random hexadecimal identifier.
 * @param {number} bytes - Internal fixed random-byte count.
 * @returns {string} Hexadecimal identifier unrelated to personal traits.
 */
const id = (bytes: number) => randomBytes(bytes).toString('hex');
/** Parse only strict version-00 traceparent identifiers; parsing alone never establishes remote trust.
 * @param {unknown} value - Untrusted incoming traceparent value.
 * @returns {{traceId: string; parentSpanId: string} | undefined} Validated nonzero identifiers, otherwise undefined.
 */
export function parseTraceParent(value: unknown):
  | {
      /** Random or explicitly trusted validated remote trace identifier. */
      traceId: string; /** Validated remote parent only under explicit host propagation trust. */
      parentSpanId: string;
    }
  | undefined {
  if (
    typeof value !== 'string' ||
    !/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(value)
  ) {
    return;
  }
  // The validated version-00 grammar guarantees all four nonempty components.
  /** Validated version-00 identifiers; zero-only values still reject below. */
  const [, traceId, parentSpanId] = value.split('-') as [
    string,
    string,
    string,
    string,
  ];
  if (/^0+$/.test(traceId) || /^0+$/.test(parentSpanId)) {
    return;
  }
  return { traceId, parentSpanId };
}
/** Reject unknown settings, invalid budgets and conflicting adapter ownership before preparing telemetry.
 * @param {ObservabilityOptions} options - Explicit host-owned tracing settings.
 * @returns {void} Configuration validation completion.
 */
export function validateObservability(
  options: ObservabilityOptions = {}
): void {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Invalid observability options');
  }
  /** Exact supported observability option names; unknown configuration fails before adapter startup. */
  const allowed = [
    'applicationId',
    'generationId',
    'adapter',
    'createAdapter',
    'sampleRate',
    'maxQueue',
    'exportTimeoutMs',
    'shutdownTimeoutMs',
    'trustTraceParent',
    'onError',
  ];
  if (Object.keys(options).some((key) => !allowed.includes(key))) {
    throw new TypeError('Unknown observability option');
  }
  for (const value of [options.applicationId, options.generationId]) {
    if (
      value !== undefined &&
      (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value))
    ) {
      throw new TypeError('Invalid correlation ID');
    }
  }
  if (
    options.sampleRate !== undefined &&
    (typeof options.sampleRate !== 'number' ||
      !Number.isFinite(options.sampleRate) ||
      options.sampleRate < 0 ||
      options.sampleRate > 1)
  ) {
    throw new TypeError('Invalid sampling rate');
  }
  for (const [key, max] of [
    ['maxQueue', 4096],
    ['exportTimeoutMs', 60000],
    ['shutdownTimeoutMs', 60000],
  ] as const) {
    if (
      options[key] !== undefined &&
      (!Number.isSafeInteger(options[key]) ||
        options[key]! < 1 ||
        options[key]! > max)
    ) {
      throw new TypeError('Invalid telemetry budget');
    }
  }
  if (
    options.trustTraceParent !== undefined &&
    typeof options.trustTraceParent !== 'boolean'
  ) {
    throw new TypeError('Invalid propagation policy');
  }
  if (options.onError !== undefined && typeof options.onError !== 'function') {
    throw new TypeError('Invalid private error sink');
  }
  if (
    options.createAdapter !== undefined &&
    (typeof options.createAdapter !== 'function' ||
      options.adapter !== undefined)
  ) {
    throw new TypeError('Invalid adapter ownership');
  }
  if (options.adapter !== undefined) {
    if (!options.adapter || typeof options.adapter.export !== 'function') {
      throw new TypeError('Invalid tracing adapter');
    }
    for (const key of ['start', 'end', 'shutdown'] as const) {
      if (
        options.adapter[key] !== undefined &&
        typeof options.adapter[key] !== 'function'
      ) {
        throw new TypeError('Invalid tracing callback');
      }
    }
  }
}
/** Create an application-owned bounded single-exporter queue; no exporter starts merely by importing the module.
 * @param {ObservabilityOptions} options - Explicit adapter, sampling, propagation and queue settings.
 * @returns {object} Owned observer; close before releasing adapter dependencies.
 */
export function createRequestObserver(options: ObservabilityOptions = {}) {
  validateObservability(options);
  /** Explicit host application label or opaque generated identifier. */
  const applicationId = options.applicationId ?? id(12);
  /** Explicit generation label or opaque generated identifier. */
  const generationId = options.generationId ?? id(12);
  /** Explicitly injected or factory-created exporter; no remote integration is auto-discovered. */
  const adapter = options.createAdapter
    ? options.createAdapter()
    : options.adapter;
  if (options.createAdapter && !adapter) {
    throw new TypeError('Invalid tracing adapter factory result');
  }
  if (adapter) {
    validateObservability({ adapter });
  }
  /** Bound for both retained active spans and queued/in-flight export work. */
  const max = options.maxQueue ?? 128;
  /** Bounded in-memory span queue; saturation drops telemetry rather than requests. */
  const queue: RequestSpan[] = [];
  /** Observer shutdown signal combined with each export attempt’s deadline. */
  const controller = new AbortController();
  let running: Promise<void> | undefined,
    closed = false,
    closing: Promise<void> | undefined;
  let dropped = 0,
    failures = 0,
    exported = 0,
    exportTimeouts = 0;
  /** Retained terminal callbacks for sampled native responses within the active-span ceiling. */
  const active = new Set<() => void>();
  /** Isolate the private host error sink and count sink failures without exposing causes publicly.
   * @param {unknown} error - Private transport/handler/observer cause.
   * @param {Readonly<RequestCorrelation> | undefined} context - Optional safe correlation fields.
   * @returns {void} Sink invocation scheduling completion.
   */
  const report = (error: unknown, context = getRequestCorrelation()) => {
    try {
      Promise.resolve(options.onError?.(error, context)).catch(() => {
        failures++;
      });
    } catch {
      failures++;
    }
  };
  /** Isolate optional synchronous adapter notifications and count rejected callbacks.
   * @param {Function | undefined} callback - Trusted notification callback.
   * @returns {void} Callback scheduling completion, not exporter drain.
   */
  const invoke = (callback: (() => void) | undefined) => {
    try {
      Promise.resolve(callback?.()).catch(() => {
        failures++;
      });
    } catch {
      failures++;
    }
  };
  /** Run a single exporter until the bounded queue empties or shutdown begins.
   * @returns {void} Export-loop scheduling completion; ignored cancellation retains the exporter slot.
   */
  const pump = () => {
    if (running || closed || !queue.length || !adapter) {
      return;
    }
    running = (async () => {
      while (queue.length && !closed) {
        /** Immutable terminal response sample containing only approved operational fields. */
        const span = queue.shift()!;
        /** Per-export cooperative cancellation owner; cancellation does not force adapter settlement. */
        const timeout = new AbortController();
        /** Owned deadline timer cleared after exporter or shutdown waiting settles. */
        const timer = setTimeout(() => {
          exportTimeouts++;
          timeout.abort();
        }, options.exportTimeoutMs ?? 5000);
        timer.unref?.();
        /** Combined observer-close and export-deadline cancellation signal. */
        const signal = AbortSignal.any([controller.signal, timeout.signal]);
        // Do not launch another exporter if this exporter ignores cancellation.
        try {
          await adapter.export(span, signal);
          exported++;
        } catch {
          failures++;
        } finally {
          clearTimeout(timer);
        }
      }
    })().finally(() => {
      running = undefined;
      if (!closed) {
        pump();
      }
    });
  };
  return {
    applicationId,
    generationId,
    report,
    status: () => ({
      applicationId,
      generationId,
      active: active.size,
      queued: queue.length,
      exported,
      dropped,
      failures,
      exportTimeouts,
      closed,
    }),
    /** Bind correlation and sampled response observation to a native request handler.
     * @param {( req: IncomingMessage, res: ServerResponse ) => Promise<void> | void} handler - Trusted native handler; exceptions remain observable to its caller.
     * @returns {Function} Native handler wrapper without request-body retention.
     */
    wrap(
      handler: (
        req: IncomingMessage,
        res: ServerResponse
      ) => Promise<void> | void
    ) {
      return (req: IncomingMessage, res: ServerResponse) => {
        /** Parsed remote parent only when the host explicitly trusts incoming traceparent. */
        const parent = options.trustTraceParent
          ? parseTraceParent(req.headers.traceparent)
          : undefined;
        /** Explicit exporter presence, active observer state and configured probabilistic sample decision. */
        const sampled =
          !!adapter &&
          !closed &&
          randomBytes(4).readUInt32BE() / 0x100000000 <
            (options.sampleRate ?? 1);
        /** Immutable operational identifiers; never request URL, body or private user traits. */
        const context: Readonly<RequestCorrelation> = Object.freeze({
          applicationId,
          generationId,
          requestId: id(16),
          traceId: parent?.traceId ?? id(16),
          spanId: id(8),
          ...(parent ? { parentSpanId: parent.parentSpanId } : {}),
          sampled,
        });
        if (!res.headersSent) {
          res.setHeader('x-request-id', context.requestId);
        }
        /** Wall-clock request start retained for trace timing. */
        const startedAt = Date.now();
        /** Monotonic start used to measure elapsed duration independently of clock changes. */
        const begin = performance.now();
        let ended = false,
          failed = false;
        // Bound span ownership too; saturation drops telemetry, never application requests.
        /** Sampling plus bounded active capacity; overload never rejects application traffic. */
        const tracked = sampled && active.size < max;
        if (sampled && !tracked) {
          dropped++;
        }
        /** Detach native listeners and enqueue at most one terminal span for the tracked response.
         * @returns {void} Terminal sample scheduling completion.
         */
        const finish = () => {
          if (ended) {
            return;
          }
          ended = true;
          res.off('finish', finish);
          res.off('close', finish);
          active.delete(finish);
          if (!tracked) {
            return;
          }
          // Preserve the existing priority: handler/server errors outrank disconnects.
          let outcome: RequestSpan['outcome'];
          if (failed || res.statusCode >= 500) {
            outcome = 'error';
          } else if (res.writableFinished) {
            outcome = 'completed';
          } else {
            outcome = 'disconnected';
          }
          /** Immutable terminal response sample containing only approved operational fields. */
          const span: RequestSpan = Object.freeze({
            ...context,
            startedAt,
            durationMs: Math.max(0, performance.now() - begin),
            status: res.writableFinished ? res.statusCode : 499,
            outcome,
          });
          invoke(() => adapter?.end?.(span));
          if (closed || queue.length + (running ? 1 : 0) >= max) {
            dropped++;
          } else {
            queue.push(span);
            pump();
          }
        };
        if (tracked) {
          active.add(finish);
          invoke(() => adapter?.start?.(context));
          res.once('finish', finish);
          res.once('close', finish);
        }
        return contextStorage.run(context, async () => {
          try {
            await handler(req, res);
          } catch (error) {
            failed = true;
            report(error, context);
            finish();
            throw error;
          }
        });
      };
    },
    /** Stop new export work, discard queued samples and request adapter shutdown within the declared wait deadline.
     * @returns {Promise<void>} Bounded shutdown wait; noncooperative adapter work can outlive this promise.
     */
    close() {
      return (closing ??= (async () => {
        closed = true;
        for (const finish of [...active]) {
          finish();
        }
        dropped += queue.length;
        queue.length = 0;
        controller.abort();
        /** Cooperative adapter shutdown signal, aborted at the bounded close deadline. */
        const shutdown = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        /** Bounded close wait; expiry does not prove a noncooperative exporter has stopped. */
        const deadline = new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            shutdown.abort();
            resolve();
          }, options.shutdownTimeoutMs ?? 5000);
        });
        try {
          await Promise.race([
            (async () => {
              await Promise.allSettled([
                running,
                Promise.resolve()
                  .then(() => adapter?.shutdown?.(shutdown.signal))
                  .catch(() => {
                    failures++;
                  }),
              ]);
            })(),
            deadline,
          ]);
        } finally {
          if (timer) {
            clearTimeout(timer);
          }
        }
      })());
    },
  };
}

export interface HealthSnapshot {
  /** Host liveness assessment; not inferred from optional provider checks. */
  live: boolean;
  /** Host readiness assessment for accepting work. */
  ready: boolean;
}
/** Create explicitly mounted health responses; diagnostics require a fresh affirmative host authorizer.
 * @param {() => HealthSnapshot} snapshot - Trusted host liveness/readiness reader.
 * @param {object} options - Optional private diagnostics projection and request authorizer.
 * @param {Function} options.diagnostics - Optional private approved diagnostic projection.
 * @param {Function} options.authorize - Request authorizer; only true admits diagnostics.
 * @returns {Function} Fetch handler for explicit liveness/readiness/diagnostics selection.
 */
export function createHealthHandler(
  snapshot: () => HealthSnapshot,
  options: {
    /** Private host-approved diagnostics projection. */
    diagnostics?: () => unknown;
    /** Fresh request authorizer required before diagnostic values are returned. */
    authorize?: (request: Request) => boolean | Promise<boolean>;
  } = {}
) {
  return async (
    request: Request,
    kind: 'liveness' | 'readiness' | 'diagnostics'
  ): Promise<Response> => {
    if (!['liveness', 'readiness', 'diagnostics'].includes(kind)) {
      return new Response(null, { status: 404 });
    }
    /** Fixed private health-response headers; no diagnostics response is publicly cacheable. */
    const headers = {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    };
    if (kind === 'diagnostics') {
      let allowed = false;
      try {
        allowed = (await options.authorize?.(request)) === true;
      } catch {
        /* deny */
      }
      if (!allowed) {
        return new Response(
          JSON.stringify({
            error: { code: 'FORBIDDEN', message: 'Forbidden' },
          }),
          { status: 403, headers }
        );
      }
      return new Response(JSON.stringify(options.diagnostics?.() ?? {}), {
        headers,
      });
    }
    /** Host-owned current liveness/readiness snapshot. */
    const health = snapshot();
    /** Selected host health flag; no external provider probe is invented. */
    const ok = kind === 'liveness' ? health.live : health.ready;
    return new Response(JSON.stringify({ status: ok ? 'ok' : 'unavailable' }), {
      status: ok ? 200 : 503,
      headers,
    });
  };
}
