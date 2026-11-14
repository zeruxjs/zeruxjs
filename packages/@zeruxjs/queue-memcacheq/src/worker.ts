import { setMaxListeners } from 'node:events';
import { validateKey } from '@zeruxjs/cache-memcache/protocol';
import {
  createMemcacheQ,
  type MemcacheQOptions,
  type MemcacheQMessage,
} from './client.js';
import { integer, invalid, optionKeys, MemcacheQError } from './envelope.js';
export interface MemcacheQWorkerJob extends MemcacheQMessage {
  /** Cooperative cancellation signal; does not force-cancel JavaScript or restore a popped record. */
  readonly signal: AbortSignal;
}
export interface MemcacheQWorkerErrorNotice {
  /** Fixed redacted library failure category; no payload/server reply. */
  readonly code: string;
  /** Poll, handler or processing-timeout phase; no queue/user label. */
  readonly phase: 'poll' | 'handler' | 'timeout';
  /** True when destructive read/processing may have lost a job; no retry promise. */
  readonly mayHaveLostMessage: boolean;
}
export interface MemcacheQWorkerOptions {
  /** Explicit text transport policy; serverMaxBytes is required and host-qualified. */
  connection: MemcacheQOptions & {
    /** Host-declared actual server record ceiling, at most65500; not remotely discovered. */
    serverMaxBytes: number;
  };
  /** One to32 unique trusted queue/handler pairs; tenant authorization remains host-owned. */
  queues: readonly {
    /** Validated full prefixed printable queue name; not a permission grant. */
    name: string;
    /** Explicit trusted application callback; receives inert data, never executable source. */
    handler: (job: MemcacheQWorkerJob) => void | Promise<void>;
  }[];
  /** Default4, allowed1–64 lanes; each slot remains held through actual handler settlement. */
  concurrency?: number;
  /** Default30000, allowed1–300000; timeout aborts only cooperative work. */
  processingMs?: number;
  /** Default30000, allowed1–300000; bounded close grace, not forced termination. */
  drainMs?: number;
  /** Finite per-lane exponential backoff with clamped jitter for empty/failing reads. */
  idle?: {
    /** Default25, allowed1–30000; lower idle clamp. */
    minMs?: number;
    /** Default1000, no lower than minMs and at most30000. */
    maxMs?: number;
    /** Default2, finite1–8 exponential multiplier. */
    factor?: number;
    /** Default0.2, finite0–1 proportional variation. */
    jitter?: number;
  };
  /** Optional deterministic [0,1] random source; throwing/invalid output fails safely. */
  random?: () => number;
  /** Cooperative cancellation signal; does not force-cancel JavaScript or restore a popped record. */
  signal?: AbortSignal;
  /** Optional trusted redacted notice callback; at most one async callback is pending. */
  onError?: (notice: MemcacheQWorkerErrorNotice) => void | Promise<void>;
}
export interface MemcacheQWorkerStatus {
  /** Running/closing/incomplete/closed or fatal failed; no durable crash recovery implied. */
  state: 'running' | 'closing' | 'incomplete' | 'closed' | 'failed';
  /** Actually outstanding destructive socket reads. */
  pendingReads: number;
  /** Actually unsettled trusted handlers, including timed-out work. */
  activeHandlers: number;
  /** Shared text transport socket count through actual close. */
  activeSockets: number;
  /** Owned idle/processing/drain timers still registered. */
  pendingTimers: number;
  /** At most one unsettled trusted async notice callback. */
  pendingErrorHooks: number;
  /** Observed successful empty reads; failed reads count separately. */
  emptyPolls: number;
  /** Handlers settled successfully before processing deadline; no ack is sent. */
  completed: number;
  /** Rejected handlers before timeout; never automatically reinserted. */
  handlerFailures: number;
  /** Failed destructive reads; outcome can be unknown. */
  pollFailures: number;
  /** Processing deadlines reached, even if handler later settles. */
  timeouts: number;
  /** Synchronous/async trusted notice failures isolated from processing. */
  hookFailures: number;
  /** Notices discarded while the one async callback slot is occupied. */
  droppedNotices: number;
  /** Last selected clamped idle delay, not a per-route/tenant label. */
  lastIdleMs: number;
}
/** Start explicitly registered destructive FIFO polling lanes. A failed/timed-out handler is never reinserted; cancellation cannot recover a popped message.
 * @param {MemcacheQWorkerOptions} options - Explicit connection sizing, trusted handlers, finite polling/drain budgets and optional cancellation.
 * @returns {object} Explicit worker/control receipt; successful close alone does not imply actual handler settlement.
 */
export function createMemcacheQWorker(options: MemcacheQWorkerOptions) {
  optionKeys(options, [
    'connection',
    'queues',
    'concurrency',
    'processingMs',
    'drainMs',
    'idle',
    'random',
    'signal',
    'onError',
  ]);
  if (
    !options.connection ||
    options.connection.serverMaxBytes === undefined ||
    !Array.isArray(options.queues) ||
    !options.queues.length ||
    options.queues.length > 32
  ) {
    throw invalid('MEMCACHEQ_INVALID_OPTIONS');
  }
  /** Validated fixed lane count, default4; no replacement lane on handler timeout. */
  const concurrency = integer(options.concurrency ?? 4, 1, 64);
  /** Validated cooperative processing deadline, default30000ms. */
  const processingMs = integer(options.processingMs ?? 30000, 1, 300000);
  /** Validated bounded close grace, default30000ms. */
  const drainMs = integer(options.drainMs ?? 30000, 1, 300000);
  if (options.idle !== undefined) {
    optionKeys(options.idle, ['minMs', 'maxMs', 'factor', 'jitter']);
  }
  /** Validated per-lane idle floor, default25ms. */
  const min = integer(options.idle?.minMs ?? 25, 1, 30000);
  /** Validated idle ceiling, default1000ms. */
  const max = integer(options.idle?.maxMs ?? 1000, min, 30000);
  /** Validated exponential multiplier, default2. */
  const factor = options.idle?.factor ?? 2;
  /** Validated proportional jitter, default0.2. */
  const jitter = options.idle?.jitter ?? 0.2;
  if (
    typeof factor !== 'number' ||
    !Number.isFinite(factor) ||
    factor < 1 ||
    factor > 8 ||
    typeof jitter !== 'number' ||
    !Number.isFinite(jitter) ||
    jitter < 0 ||
    jitter > 1 ||
    (options.random !== undefined && typeof options.random !== 'function') ||
    (options.onError !== undefined && typeof options.onError !== 'function') ||
    (options.signal !== undefined && !(options.signal instanceof AbortSignal))
  ) {
    throw invalid('MEMCACHEQ_INVALID_OPTIONS');
  }
  /** Trusted injectable finite [0,1] source; invalid output triggers safe shutdown. */
  const random = options.random ?? Math.random;
  /** Borrowed trusted redacted notice callback; never execute incoming payload code. */
  const onError = options.onError;
  /** Borrowed host cancellation signal; remove its listener on close. */
  const externalSignal = options.signal;
  /** Snapshot of explicit unique registered handlers; no dynamic imports or arbitrary destinations. */
  const definitions = options.queues.map((q) => {
    optionKeys(q, ['name', 'handler']);
    validateKey(q.name);
    validateKey(`${options.connection.prefix ?? 'zerux'}:${q.name}`);
    if (typeof q.handler !== 'function') {
      throw invalid('MEMCACHEQ_INVALID_OPTIONS');
    }
    return { name: q.name, handler: q.handler };
  });
  if (new Set(definitions.map((q) => q.name)).size !== definitions.length) {
    throw invalid('MEMCACHEQ_INVALID_OPTIONS');
  }
  if (
    options.connection.maxConcurrent !== undefined &&
    options.connection.maxConcurrent < concurrency
  ) {
    throw invalid('MEMCACHEQ_INVALID_OPTIONS');
  }
  // No sockets are opened until polling starts. Worker defaults to explicit V1 envelopes.
  /** Owned destructive FIFO client with worker-default V1-only envelopes. */
  const client = createMemcacheQ({
    ...options.connection,
    acceptLegacy: options.connection.acceptLegacy ?? false,
    maxConcurrent: options.connection.maxConcurrent ?? concurrency,
  });
  /** Owned shared read/idle cancellation; does not pretend a pop can be rolled back. */
  const polling = new AbortController();
  setMaxListeners(concurrency + 4, polling.signal);
  /** Actually running handler cancellation owners, retained until real settlement. */
  const controllers = new Set<AbortController>();
  /** Owned live idle/processing/drain timers for disposal and fixed counters. */
  const timers = new Set<ReturnType<typeof setTimeout>>();
  /** At most one actual async error callback; a stalled hook delays closed. */
  const hooks = new Set<Promise<void>>();
  let stopping = false,
    settled = false,
    closeReturned = false,
    fatal = false,
    closing: Promise<void> | undefined,
    cursor = 0,
    reads = 0,
    active = 0,
    emptyPolls = 0,
    completed = 0,
    handlerFailures = 0,
    pollFailures = 0,
    timeouts = 0,
    hookFailures = 0,
    droppedNotices = 0,
    lastIdleMs = 0;
  /** Isolate trusted error callbacks and retain at most one async notice. A stalled callback occupies the closed barrier without growing an unbounded notice queue.
   * @param {MemcacheQWorkerErrorNotice} notice - Fixed-code redacted error category; never include job data, queue names or native causes.
   * @returns {void} Explicit worker/control receipt; successful close alone does not imply actual handler settlement.
   */
  function report(notice: MemcacheQWorkerErrorNotice) {
    if (!onError) {
      return;
    }
    if (hooks.size) {
      droppedNotices++;
      return;
    }
    let hook: Promise<void>;
    try {
      hook = Promise.resolve(onError(Object.freeze(notice)))
        .catch(() => {
          hookFailures++;
        })
        .finally(() => hooks.delete(hook));
      hooks.add(hook);
    } catch {
      hookFailures++;
    }
  }
  /** Wait a finite clamped jittered delay, releasing its timer/listener on cancellation. Invalid random input terminates the worker rather than spinning.
   * @param {number} base - Current finite lane backoff before clamped jitter.
   * @returns {Promise<void>} Explicit worker/control receipt; successful close alone does not imply actual handler settlement.
   */
  function pause(base: number): Promise<void> {
    /** One random sample validated before calculating jitter. */
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw invalid('MEMCACHEQ_INVALID_RANDOM');
    }
    /** Finite clamped rounded lane delay; never grows beyond the configured ceiling. */
    const delay = Math.max(
      min,
      Math.min(max, Math.round(base * (1 - jitter + 2 * jitter * value)))
    );
    lastIdleMs = delay;
    if (stopping) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      /** Release the idle timer/listener and resolve the one lane wait.
       * @returns {void} No pending idle resources remain for this wait.
       */
      const done = () => {
        clearTimeout(timer);
        timers.delete(timer);
        polling.signal.removeEventListener('abort', done);
        resolve();
      };
      /** Owned bounded timer removed on actual completion/abort/close. */
      const timer = setTimeout(done, delay);
      timers.add(timer);
      polling.signal.addEventListener('abort', done, { once: true });
      if (polling.signal.aborted) {
        done();
      }
    });
  }
  /** Run one trusted handler with a cooperative deadline, retaining its lane until actual promise settlement. Timeout aborts its signal but never force-cancels JavaScript or reinserts the message.
   * @param {(typeof definitions)[number]} definition - One registered trusted queue/handler pair; no handler source is accepted from popped data.
   * @param {MemcacheQMessage} message - Already validated inert popped message; destructive read cannot be undone.
   * @returns {Promise<void>} Explicit worker/control receipt; successful close alone does not imply actual handler settlement.
   */
  async function process(
    definition: (typeof definitions)[number],
    message: MemcacheQMessage
  ) {
    /** One handler cooperative cancellation owner, retained through actual settlement. */
    const controller = new AbortController();
    controllers.add(controller);
    active++;
    let timedOut = false;
    /** Release the processing timer on cancellation/final settlement.
     * @returns {void} Timer ownership is released; handler settlement is separate.
     */
    const clear = () => {
      clearTimeout(timer);
      timers.delete(timer);
    };
    /** Owned bounded timer removed on actual completion/abort/close. */
    const timer = setTimeout(() => {
      timers.delete(timer);
      timedOut = true;
      timeouts++;
      controller.abort();
      report({
        code: 'MEMCACHEQ_PROCESSING_TIMEOUT',
        phase: 'timeout',
        mayHaveLostMessage: true,
      });
    }, processingMs);
    timers.add(timer);
    controller.signal.addEventListener('abort', clear, { once: true });
    try {
      await definition.handler({ ...message, signal: controller.signal });
      if (!timedOut) {
        completed++;
      }
    } catch {
      if (!timedOut) {
        handlerFailures++;
        report({
          code: 'MEMCACHEQ_HANDLER_FAILED',
          phase: 'handler',
          mayHaveLostMessage: true,
        });
      }
    } finally {
      clear();
      controller.signal.removeEventListener('abort', clear);
      controllers.delete(controller);
      active--;
    }
  }
  /** Rotate across the finite registered queue allowlist. Reset backoff only after a received job; later failed-read polls are new destructive reads, never replay of the failed request.
   * @returns {Promise<void>} Explicit worker/control receipt; successful close alone does not imply actual handler settlement.
   */
  async function lane() {
    let idle = min;
    try {
      // Keep work within the fixed lane/controller set; stop admission before waiting for settlement.
      while (!stopping) {
        /** Round-robin trusted registration; incoming data never selects executable code. */
        const definition = definitions[cursor++ % definitions.length];
        if (!definition) {
          throw new Error('Queue worker definition is missing');
        }
        let message: MemcacheQMessage | undefined,
          failedRead = false;
        reads++;
        try {
          message = await client.take(definition.name, {
            signal: polling.signal,
          });
        } catch (error) {
          if (stopping) {
            return;
          }
          failedRead = true;
          pollFailures++;
          report({
            code:
              error instanceof MemcacheQError
                ? error.code
                : 'MEMCACHEQ_POP_UNKNOWN',
            phase: 'poll',
            mayHaveLostMessage: true,
          });
        } finally {
          reads--;
        }
        if (stopping) {
          return;
        }
        if (message) {
          idle = min;
          await process(definition, message);
        } else {
          if (!failedRead) {
            emptyPolls++;
          }
          await pause(idle);
          idle = Math.min(max, idle * factor);
        }
      }
    } catch {
      fatal = true;
      report({
        code: 'MEMCACHEQ_WORKER_FAILED',
        phase: 'poll',
        mayHaveLostMessage: false,
      });
      void close();
    }
  }
  /** Fixed actual lane promises; count stays bounded until handlers settle. */
  const lanes = Array.from({ length: concurrency }, () =>
    Promise.resolve().then(lane)
  );
  /** Actual-settlement barrier across lanes, native sockets and outstanding notice callback. */
  const closed = Promise.allSettled(lanes).then(async () => {
    await client.whenClosed();
    await Promise.allSettled([...hooks]);
    settled = true;
  });
  /** Idempotently stop pops/cancel sockets, then wait up to the drain grace before aborting handler signals. Await closed separately for actual settlement; a noncooperating handler can keep it pending.
   * @returns {Promise<void>} Explicit worker/control receipt; successful close alone does not imply actual handler settlement.
   */
  async function close(): Promise<void> {
    if (closing) {
      return closing;
    }
    stopping = true;
    polling.abort();
    client.close();
    externalSignal?.removeEventListener('abort', abort);
    closing = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          closed,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, drainMs);
            timers.add(timer);
          }),
        ]);
      } finally {
        if (timer) {
          clearTimeout(timer);
          timers.delete(timer);
        }
        // Keep work within the fixed lane/controller set; stop admission before waiting for settlement.
        for (const controller of controllers) {
          controller.abort();
        }
        closeReturned = true;
      }
    })();
    return closing;
  }
  /** Host signal callback requests bounded close without owning the host signal.
   * @returns {void} Close is requested; callers observe the explicit close/closed barriers.
   */
  const abort = () => {
    void close();
  };
  externalSignal?.addEventListener('abort', abort, { once: true });
  if (externalSignal?.aborted) {
    void close();
  }
  return {
    capabilities: Object.freeze({
      acknowledgement: false,
      retry: false,
      delay: false,
      priority: false,
      destructiveRead: true,
      push: true,
    }),
    close,
    closed,
    /** Return fixed-label counters without queue names, payloads or secrets. Incomplete means resources remain after bounded close, not forced termination.
     * @returns {MemcacheQWorkerStatus} Explicit worker/control receipt; successful close alone does not imply actual handler settlement.
     */
    status(): MemcacheQWorkerStatus {
      return {
        state: (() => {
          if (!stopping) {
            return 'running';
          }
          if (settled) {
            return fatal ? 'failed' : 'closed';
          }
          return closeReturned ? 'incomplete' : 'closing';
        })(),
        pendingReads: reads,
        activeHandlers: active,
        activeSockets: client.activeSocketCount,
        pendingTimers: timers.size,
        pendingErrorHooks: hooks.size,
        emptyPolls,
        completed,
        handlerFailures,
        pollFailures,
        timeouts,
        hookFailures,
        droppedNotices,
        lastIdleMs,
      };
    },
  };
}
