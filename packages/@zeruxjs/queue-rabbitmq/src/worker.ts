import {
  connect,
  type ChannelModel,
  type Channel,
  type ConfirmChannel,
  type ConsumeMessage,
} from 'amqplib';
import { randomUUID } from 'node:crypto';
export type RabbitMQWorkerResult = 'ack' | 'retry' | 'dead-letter';
export interface RabbitMQWorkerJob {
  /** Opaque message identity or internal generation number; never a permission grant. */
  readonly id: string;
  /** Validated registered logical queue/job name; never executable source. */
  readonly name: string;
  /** Copied inert private JSON; host owns tenant/consent/business authorization. */
  readonly data: Record<string, unknown>;
  /** Effective bounded attempt plus broker redelivery count; headers are not authentication. */
  readonly attempt: number;
  /** Broker redelivery observation, not proof a previous side effect rolled back. */
  readonly redelivered: boolean;
  /** Cooperative cancellation; actual work retains its slot until settlement. */
  readonly signal: AbortSignal;
}
export interface RabbitMQWorkerQueue {
  /** Validated registered logical queue/job name; never executable source. */
  name: string;
  /** Explicit classic/quorum topology; handler queues require qualified RabbitMQ 4.x quorum. */
  type: 'classic' | 'quorum';
  /** Workers require quorum queues and RabbitMQ 4.x delivery-limit support. */
  handler?: (
    job: RabbitMQWorkerJob
  ) => RabbitMQWorkerResult | Promise<RabbitMQWorkerResult>;
  /** Default 3, allowed 1–20 effective attempts before dead-letter disposition. */
  maxAttempts?: number;
  /** Default 1000, allowed 100–86400000; broker TTL, not process delivery timers. */
  retryDelayMs?: number;
  /** Default 10000, allowed 1–1000000 per physical queue. */
  maxLength?: number;
}
export interface RabbitMQWorkerOptions {
  /** Private AMQP/AMQPS URL; host owns trust, vhost permissions and secrets. */
  url: string;
  /** Physical namespace, default zerux; not tenant authorization. */
  prefix?: string;
  /** Explicit finite 1–32 topology definitions; no request-driven declarations. */
  queues: readonly RabbitMQWorkerQueue[];
  /** Default max(16,worker count), allowed 1–128 and at least worker count; old tasks retain slots. */
  concurrency?: number;
  /** Default 32, allowed 1–1000 pending confirmations. */
  maxPending?: number;
  /** Default 65536, allowed 1–1048576 complete serialized envelope bytes. */
  maxBytes?: number;
  /** Default 3000, allowed 1–120000 per native/startup/cleanup phase. */
  timeoutMs?: number;
  /** Default 30000, allowed 1–300000 graceful callback/confirmation drain milliseconds. */
  drainMs?: number;
  /** Default 30000, allowed 1–300000 cooperative deadline; never force-cancels JavaScript. */
  handlerTimeoutMs?: number;
  /** Opt-in finite lifetime reconnect budget, default disabled; unknown publishes never replay. */
  reconnect?: {
    /** Default 3, allowed 1–20 effective attempts before dead-letter disposition. */
    maxAttempts: number;
    /** Default 1000, allowed 1–30000 fixed reconnect pause; never delivery delay. */
    delayMs: number;
  };
  /** Cooperative cancellation; actual work retains its slot until settlement. */
  signal?: AbortSignal;
}
export type RabbitMQWorkerConnector = (
  url: string,
  options: {
    /** Finite native handshake timeout passed to the trusted connector. */
    timeout: number;
  }
) => Promise<ChannelModel>;
/** Fixed-code public error; native causes remain private and non-enumerable. */
export class RabbitMQWorkerError extends Error {
  /** Create a fixed public failure with a private optional cause.
   * @param {string} code - Fixed public error category, never credentials or incoming content.
   * @param {unknown} cause - Optional private non-enumerable native cause; host logs must redact it.
   */
  constructor(
    readonly code: string,
    cause?: unknown
  ) {
    super(`RabbitMQ worker error (${code})`);
    this.name = 'RabbitMQWorkerError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause });
    }
  }
}
/** Create a fixed public error with private non-enumerable cause.
 * @param {string} code - Fixed public error category, never credentials or incoming content.
 * @param {unknown} cause - Optional private non-enumerable native cause; host logs must redact it.
 * @returns {RabbitMQWorkerError} Validated inert result or cancellation request; actual native ownership stays explicit.
 */
const fail = (code: string, cause?: unknown) =>
  new RabbitMQWorkerError(code, cause);
/** Validate conservative opaque identifiers; permissions remain host-owned.
 * @param {unknown} value - Untrusted inert value checked without invoking accessors.
 * @returns {string} Validated inert result or cancellation request; actual native ownership stays explicit.
 */
const name = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(value)
  ) {
    throw fail('INVALID_CONFIG');
  }
  return value;
};
/** Validate safe bounded integer configuration before native acquisition.
 * @param {unknown} value - Untrusted inert value checked without invoking accessors.
 * @param {number} min - Inclusive safe integer floor.
 * @param {number} max - Inclusive safe integer ceiling.
 * @returns {number} Validated inert result or cancellation request; actual native ownership stays explicit.
 */
const integer = (value: unknown, min: number, max: number) => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw fail('INVALID_CONFIG');
  }
  return value;
};
/** Reject unknown options/accessors and nonplain objects before reading configuration values.
 * @param {unknown} value - Untrusted inert value checked without invoking accessors.
 * @param {string[]} allowed - Finite allowed own configuration fields.
 * @returns {void} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
 */
function keys(
  value: unknown,
  allowed: string[]
): asserts value is Record<string, any> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (d) => !('value' in d)
    )
  ) {
    throw fail('INVALID_CONFIG');
  }
}
/** Snapshot inert JSON under 16-level/8192-node and byte budgets; reject cycles/classes/unsafe keys without executing incoming code.
 * @param {unknown} value - Untrusted inert value checked without invoking accessors.
 * @param {number} max - Inclusive byte ceiling; final UTF-8 serialization is checked separately.
 * @returns {Record<string,unknown>} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
 */
function json(value: unknown, max: number): Record<string, unknown> {
  let nodes = 0,
    chars = 0;
  /** Active JSON ancestors; noncyclic shared subobjects remain valid. */
  const seen = new Set<object>();
  /** Bounded inert JSON traversal without getters or source evaluation.
   * @param {unknown} v - Untrusted inert JSON value.
   * @param {number} depth - Current bounded depth; maximum 16.
   * @returns {unknown} Validated inert result or cancellation request; actual native ownership stays explicit.
   */
  const copy = (v: unknown, depth: number): any => {
    if (++nodes > 8192 || depth > 16) {
      throw fail('PAYLOAD_LIMIT');
    }
    if (typeof v === 'string') {
      chars += v.length;
      if (chars > max) {
        throw fail('PAYLOAD_LIMIT');
      }
      return v;
    }
    if (
      v === null ||
      typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v))
    ) {
      return v;
    }
    if (
      !v ||
      typeof v !== 'object' ||
      seen.has(v) ||
      ![Object.prototype, null, Array.prototype].includes(
        Object.getPrototypeOf(v)
      )
    ) {
      throw fail('INVALID_PAYLOAD');
    }
    /** Own enumerable keys checked for unsafe names and sparse arrays. */
    const own = Object.keys(v);
    if (
      own.length > 8192 ||
      (Array.isArray(v) &&
        (v.length > 8192 ||
          own.length !== v.length ||
          own.some((k, i) => k !== String(i))))
    ) {
      throw fail('PAYLOAD_LIMIT');
    }
    seen.add(v);
    /** New private JSON snapshot, never a borrowed mutable payload. */
    const out: any = Array.isArray(v) ? [] : {};
    // Visit only fixed topology/recovery bounds or actual unsettled owners; never replay unknown work.
    for (const k of own) {
      /** Own descriptor inspected without invoking getters. */
      const d = Object.getOwnPropertyDescriptor(v, k)!;
      if (
        ['constructor', '__proto__', 'prototype'].includes(k) ||
        !('value' in d)
      ) {
        throw fail('INVALID_PAYLOAD');
      }
      chars += k.length;
      if (chars > max) {
        throw fail('PAYLOAD_LIMIT');
      }
      out[k] = copy(d.value, depth + 1);
    }
    seen.delete(v);
    return out;
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail('INVALID_PAYLOAD');
  }
  /** Validated copied data or explicit disposition, never a diagnostic payload. */
  const result = copy(value, 0);
  if (Buffer.byteLength(JSON.stringify(result)) > max) {
    throw fail('PAYLOAD_LIMIT');
  }
  return result;
}
interface Confirmation {
  /** Whether mandatory routing returned this exact publication before its confirmation. */
  returned: boolean;
  /** Settle this exact publication confirmation successfully; consumer processing is separate.
   * @returns {void} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  resolve(): void;
  /** Reject this exact confirmation without exposing private causes.
   * @param {Error} error - Private native/generation failure; expose only its fixed public category.
   * @returns {void} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  reject(error: Error): void;
  /** Publication confirmation barrier retained for graceful drain. */
  done: Promise<void>;
}
interface Generation {
  /** Opaque message identity or internal generation number; never a permission grant. */
  id: number;
  /** Generation fence; false forbids late handler acknowledgement. */
  valid: boolean;
  /** Whether new consumer callbacks may be accepted by this generation. */
  accepting: boolean;
  /** Observed native connection close; distinguishes proven closure from unknown cleanup. */
  connectionClosed: boolean;
  /** Unproven resource release prevents replacement. */
  cleanupFailed: boolean;
  /** Dedicated service-owned native connection, never a borrowed/shared host connection. */
  connection?: ChannelModel;
  /** Owned confirm channel for this exact generation. */
  producer?: ConfirmChannel;
  /** Owned original delivery channel that alone may acknowledge its messages. */
  consumer?: Channel;
  /** Producer buffer pressure; reset only by native drain. */
  blocked: boolean;
  /** Broker block state; producer drain cannot clear it. */
  brokerBlocked: boolean;
  /** Owned consumer registration tags cancelled before graceful drain. */
  tags: string[];
  /** Actually active handler signal owners retained through settlement. */
  controllers: Set<AbortController>;
  /** Actually unsettled generation handler/disposition promises. */
  tasks: Set<Promise<void>>;
  /** Finite private publication correlation map. */
  confirms: Map<string, Confirmation>;
  /** Actually unsettled native operations even after caller deadlines. */
  native: Set<Promise<unknown>>;
  /** Memoized exact-resource close promises preventing duplicate close. */
  releases: Map<object, Promise<unknown>>;
  /** One retirement barrier shared across repeated failures. */
  retired?: Promise<void>;
  /** Generation-loss rejection barrier used by startup phases. */
  lost: Promise<never>;
  /** Fence waiters attached to this exact lost generation.
   * @param {Error} error - Private native/generation failure; expose only its fixed public category.
   * @returns {void} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  rejectLost(error: Error): void;
}
/** Own an explicit supervised push service, separate from legacy pull clients. Handlers are trusted registered code; unknown publishes never replay and acknowledgements never move channels.
 * @param {RabbitMQWorkerOptions} options - Private destination, trusted handlers/topology and finite supervision policy.
 * @param {RabbitMQWorkerConnector} connector - Trusted connection factory, default amqplib connect; every returned connection is fresh and service-owned.
 * @returns {Promise<object>} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
 */
export async function createRabbitMQWorker(
  options: RabbitMQWorkerOptions,
  connector: RabbitMQWorkerConnector = connect
) {
  keys(options, [
    'url',
    'prefix',
    'queues',
    'concurrency',
    'maxPending',
    'maxBytes',
    'timeoutMs',
    'drainMs',
    'handlerTimeoutMs',
    'reconnect',
    'signal',
  ]);

  if (
    typeof options.url !== 'string' ||
    options.url.length > 4096 ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    /[\x00-\x1f\x7f]/.test(options.url)
  ) {
    throw fail('INVALID_CONFIG');
  }
  let target: URL;
  try {
    target = new URL(options.url);
  } catch {
    throw fail('INVALID_CONFIG');
  }
  if (!['amqp:', 'amqps:'].includes(target.protocol)) {
    throw fail('INVALID_CONFIG');
  }
  if (
    typeof connector !== 'function' ||
    (options.signal !== undefined && !(options.signal instanceof AbortSignal))
  ) {
    throw fail('INVALID_CONFIG');
  }
  /** Validated physical namespace; not authorization. */
  const prefix = name(options.prefix ?? 'zerux');
  /** Private original destination; never expose it in telemetry. */
  const url = options.url;
  /** Borrowed host signal whose listener is removed on close. */
  const externalSignal = options.signal;
  if (
    !Array.isArray(options.queues) ||
    !options.queues.length ||
    options.queues.length > 32
  ) {
    throw fail('INVALID_CONFIG');
  }
  /** Finite validated snapshot of trusted topology/handlers. */
  const definitions = options.queues.map((input) => {
    keys(input, [
      'name',
      'type',
      'handler',
      'maxAttempts',
      'retryDelayMs',
      'maxLength',
    ]);
    /** Validated topology registration or inert scalar. */
    const value = {
      name: name(input.name),
      type: input.type,
      handler: input.handler,
      maxAttempts: integer(input.maxAttempts ?? 3, 1, 20),
      retryDelayMs: integer(input.retryDelayMs ?? 1000, 100, 86400000),
      maxLength: integer(input.maxLength ?? 10000, 1, 1000000),
    };
    if (
      !['classic', 'quorum'].includes(value.type) ||
      (value.handler !== undefined &&
        (typeof value.handler !== 'function' || value.type !== 'quorum'))
    ) {
      throw fail('INVALID_CONFIG');
    }
    return value;
  });
  /** Collision set covering work/retry/dead physical names before connection. */
  const names = new Set<string>();
  // Visit only fixed topology/recovery bounds or actual unsettled owners; never replay unknown work.
  for (const definition of definitions) {
    // Visit only fixed topology/recovery bounds or actual unsettled owners; never replay unknown work.
    for (const suffix of ['', '.retry', '.dead']) {
      /** Code-owned validated physical destination. */
      const physical = `${prefix}.${definition.name}${suffix}`;
      if (names.has(physical) || Buffer.byteLength(physical) > 240) {
        throw fail('TOPOLOGY_CONFLICT');
      }
      names.add(physical);
    }
  }
  /** Only registrations with trusted handlers receive consumer credits. */
  const workers = definitions.filter((q) => q.handler);
  /** Validated global actual-handler ceiling; old work still counts. */
  const concurrency = integer(
    options.concurrency ?? Math.max(16, workers.length),
    1,
    128
  );
  if (concurrency < workers.length) {
    throw fail('INVALID_CONFIG');
  }
  /** Validated confirmation ceiling, default 32. */
  const maxPending = integer(options.maxPending ?? 32, 1, 1000);
  /** Validated complete UTF-8 envelope ceiling, default 64 KiB. */
  const maxBytes = integer(options.maxBytes ?? 65536, 1, 1048576);
  /** Validated finite I/O/startup/cleanup phase deadline. */
  const timeout = integer(options.timeoutMs ?? 3000, 1, 120000);
  /** Validated graceful callback/confirmation wait. */
  const drain = integer(options.drainMs ?? 30000, 1, 300000);
  /** Cooperative handler deadline; actual tasks retain ownership. */
  const handlerTimeout = integer(options.handlerTimeoutMs ?? 30000, 1, 300000);
  if (options.reconnect !== undefined) {
    keys(options.reconnect, ['maxAttempts', 'delayMs']);
  }
  /** Finite lifetime recovery ceiling, default zero. */
  const maxReconnect = integer(options.reconnect?.maxAttempts ?? 0, 0, 20);
  /** Finite recovery pause, not delayed delivery. */
  const reconnectDelay = integer(options.reconnect?.delayMs ?? 1000, 1, 30000);
  let state:
      | 'starting'
      | 'ready'
      | 'recovering'
      | 'failed'
      | 'closing'
      | 'closed'
      | 'incomplete' = 'starting',
    closed = false,
    generation = 0,
    reconnectAttempts = 0,
    unknownPublishes = 0,
    returnedPublishes = 0,
    deadLetters = 0,
    cleanupFailures = 0,
    drainTimeouts = 0,
    handlerDeadlines = 0;
  let current: Generation | undefined,
    closing: Promise<void> | undefined,
    recovering: Promise<void> | undefined;
  /** Owned service cancellation controller for wait/startup/reconnect scopes. */
  const lifetime = new AbortController();
  /** Actual unsettled handlers across generations, retained after timeout. */
  const allTasks = new Set<Promise<void>>();
  /** Actual unsettled native work across generations, including late acquisitions. */
  const allNative = new Set<Promise<unknown>>();
  /** Owned native/handler/reconnect/drain wait timers. */
  const timers = new Set<ReturnType<typeof setTimeout>>();
  /** Retain actual native promise ownership globally and per generation until settlement, including after caller deadlines.
   * @param {Generation} g - Exact generation owning these channels, callbacks and native promises.
   * @param {Promise<T>} promise - Already-started native work; deadlines do not prove settlement or rollback.
   * @returns {Promise<T>} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  function tracked<T>(g: Generation, promise: Promise<T>): Promise<T> {
    g.native.add(promise);
    allNative.add(promise);
    promise.then(
      () => {
        g.native.delete(promise);
        allNative.delete(promise);
      },
      () => {
        g.native.delete(promise);
        allNative.delete(promise);
      }
    );
    return promise;
  }
  /** Bound caller waiting with timer/listener cleanup. Timeout/abort does not cancel arbitrary native work or prove mutation failure.
   * @param {Promise<T>} promise - Already-started native work; deadlines do not prove settlement or rollback.
   * @param {number} ms - Finite wait deadline milliseconds, never a delayed-delivery timer.
   * @param {string} code - Fixed public error category, never credentials or incoming content.
   * @param {AbortSignal} signal - Optional cooperative cancellation; native work remains owned after abort.
   * @returns {Promise<T>} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  async function bounded<T>(
    promise: Promise<T>,
    ms: number,
    code: string,
    signal?: AbortSignal
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined,
      abort: (() => void) | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(fail(code)), ms);
          timers.add(timer);
          abort = () => reject(fail('CANCELLED'));
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) {
            abort();
          }
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
        timers.delete(timer);
      }
      if (abort) {
        signal?.removeEventListener('abort', abort);
      }
    }
  }
  /** Fence this generation before aborting handlers/rejecting unresolved confirmations. Returned publications stay unroutable; other unresolved confirmations become unknown.
   * @param {Generation} g - Exact generation owning these channels, callbacks and native promises.
   * @returns {void} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  function invalidate(g: Generation) {
    if (!g.valid) {
      return;
    }
    g.valid = false;
    g.accepting = false;
    g.rejectLost(fail('GENERATION_LOST'));
    // Visit only fixed topology/recovery bounds or actual unsettled owners; never replay unknown work.
    for (const controller of g.controllers) {
      controller.abort();
    }
    // Visit only fixed topology/recovery bounds or actual unsettled owners; never replay unknown work.
    for (const confirmation of g.confirms.values()) {
      if (confirmation.returned) {
        returnedPublishes++;
        confirmation.reject(fail('UNROUTABLE'));
      } else {
        unknownPublishes++;
        confirmation.reject(fail('PUBLISH_OUTCOME_UNKNOWN'));
      }
    }
    g.confirms.clear();
  }
  /** Race tracked native work against generation loss and a finite lifetime deadline without releasing actual native ownership.
   * @param {Generation} g - Exact generation owning these channels, callbacks and native promises.
   * @param {Promise<T>} promise - Already-started native work; deadlines do not prove settlement or rollback.
   * @returns {Promise<T>} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  async function phase<T>(g: Generation, promise: Promise<T>): Promise<T> {
    return bounded(
      Promise.race([tracked(g, promise), g.lost]),
      timeout,
      'PHASE_DEADLINE',
      lifetime.signal
    );
  }
  /** Memoize one close per exact resource/generation and retain native settlement. Unproven release prevents safe reconnect; do not use private socket internals.
   * @param {Generation} g - Exact generation owning these channels, callbacks and native promises.
   * @param {{ close(): Promise<unknown> }} resource - Native resource whose close is memoized per generation.
   * @param {function} resource.close - Native release operation; actual settlement remains tracked.
   * @returns {Promise<unknown>} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  function releaseResource(
    g: Generation,
    resource: {
      /** Request bounded service shutdown or fulfill the native close primitive of an owned resource. Actual callbacks/native work may outlive caller waiting; inspect status for incomplete settlement.
       * @returns {Promise<void>} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
       */
      close(): Promise<unknown>;
    }
  ): Promise<unknown> {
    /** Memoized resource-close promise prevents duplicate release. */
    const previous = g.releases.get(resource);
    if (previous) {
      return previous;
    }
    /** Tracked native acquisition/close; races never cancel ownership. */
    const pending = tracked(
      g,
      Promise.resolve()
        .then(() => resource.close())
        .catch((error) => {
          if (g.connectionClosed) {
            return;
          }
          g.cleanupFailed = true;
          cleanupFailures++;
          throw error;
        })
    );
    g.releases.set(resource, pending);
    return pending;
  }
  /** Close late-acquired channels when their generation is invalid/closed; never adopt them into replacement generations.
   * @param {Generation} g - Exact generation owning these channels, callbacks and native promises.
   * @param {Promise<T>} pending - Pending channel acquisition; late resources remain owned for cleanup.
   * @returns {Promise<T>} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  function acquireChannel<T extends Channel | ConfirmChannel>(
    g: Generation,
    pending: Promise<T>
  ): Promise<T> {
    void pending
      .then(
        (resource) => {
          if (closed || !g.valid) {
            void releaseResource(g, resource).catch(() => {});
          }
        },
        () => {}
      )
      .catch(() => {
        cleanupFailures++;
      });
    return phase(g, pending);
  }
  /** Close consumer, producer then connection with finite phase waits; unresolved native work remains owned and unproven cleanup stops recovery.
   * @param {Generation} g - Exact generation owning these channels, callbacks and native promises.
   * @returns {Promise<void>} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  async function cleanup(g: Generation) {
    // Visit only fixed topology/recovery bounds or actual unsettled owners; never replay unknown work.
    for (const resource of [g.consumer, g.producer, g.connection]) {
      if (resource && !g.connectionClosed) {
        try {
          await bounded(
            releaseResource(g, resource),
            timeout,
            'CLOSE_DEADLINE'
          );
        } catch (error) {
          if (
            error instanceof RabbitMQWorkerError &&
            error.code === 'CLOSE_DEADLINE'
          ) {
            g.cleanupFailed = true;
            cleanupFailures++;
          }
        }
      }
    }
  }
  /** Stop admission, optionally cancel/drain, fence callbacks and release native owners. Wait for actual old tasks/native settlement before replacement; noncooperating work can stall it.
   * @param {Generation} g - Exact generation owning these channels, callbacks and native promises.
   * @param {boolean} graceful - Default false; true cancels consumers and allows bounded drain before fencing.
   * @returns {Promise<void>} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  function retire(g: Generation, graceful = false): Promise<void> {
    if (g.retired) {
      return g.retired;
    }
    g.accepting = false;
    g.retired = (async () => {
      if (graceful && g.valid) {
        await Promise.all(
          g.tags.map(async (tag) => {
            try {
              await bounded(
                tracked(
                  g,
                  Promise.resolve().then(() => g.consumer!.cancel(tag))
                ),
                timeout,
                'CANCEL_DEADLINE'
              );
            } catch {
              cleanupFailures++;
            }
          })
        );
        try {
          await bounded(
            Promise.allSettled([
              ...g.tasks,
              ...[...g.confirms.values()].map((c) => c.done),
            ]),
            drain,
            'DRAIN_DEADLINE'
          );
        } catch {
          drainTimeouts++;
        }
      }
      invalidate(g);
      await cleanup(g);
      // A replacement must not overlap old callbacks, native operations, or channel-bound ack work.
      // Visit only fixed topology/recovery bounds or actual unsettled owners; never replay unknown work.
      while (g.tasks.size || g.native.size) {
        await Promise.allSettled([...g.tasks, ...g.native]);
      }
    })();
    return g.retired;
  }
  /** Use the finite lifetime reconnect budget after actual retirement. Never replay unknown publishes or overlap old channel-bound ack work.
   * @param {Generation} g - Exact generation owning these channels, callbacks and native promises.
   * @returns {Promise<void>} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  async function recover(g: Generation) {
    if (recovering || closed) {
      return;
    }
    state = 'recovering';
    recovering = (async () => {
      await retire(g);
      if (g.cleanupFailed) {
        if (!closed) {
          state = 'failed';
        }
        return;
      }
      // Visit only fixed topology/recovery bounds or actual unsettled owners; never replay unknown work.
      while (!closed && reconnectAttempts < maxReconnect) {
        reconnectAttempts++;
        try {
          await new Promise<void>((resolve, reject) => {
            /** Scoped cancellation listener/host close request removed after its owned scope.
             * @returns {void} Validated inert result or cancellation request; actual native ownership stays explicit.
             */
            const abort = () => {
              clearTimeout(timer);
              timers.delete(timer);
              lifetime.signal.removeEventListener('abort', abort);
              reject(fail('CANCELLED'));
            };
            /** Owned finite timer released on normal and cancellation paths. */
            const timer = setTimeout(() => {
              timers.delete(timer);
              lifetime.signal.removeEventListener('abort', abort);
              resolve();
            }, reconnectDelay);
            timers.add(timer);
            lifetime.signal.addEventListener('abort', abort, { once: true });
            if (lifetime.signal.aborted) {
              abort();
            }
          });
        } catch {
          break;
        }
        if (closed) {
          break;
        }
        try {
          /** New generation adopted only while service remains active. */
          const next = await openGeneration();
          if (closed) {
            await retire(next);
            break;
          }
          current = next;
          state = 'ready';
          return;
        } catch {
          if (current) {
            await retire(current);
            if (current.cleanupFailed) {
              break;
            }
          }
        }
      }
      if (!closed) {
        state = 'failed';
      }
    })().finally(() => {
      recovering = undefined;
    });
  }
  /** Fence this exact generation and request recovery only from ready state; repeated native failures do not create parallel recovery loops.
   * @param {Generation} g - Exact generation owning these channels, callbacks and native promises.
   * @returns {void} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  function lost(g: Generation) {
    if (!g.valid) {
      return;
    }
    invalidate(g);
    if (state === 'ready') {
      void recover(g);
    }
  }
  /** Validate the job name and copy inert data before bounding the complete UTF-8 envelope.
   * @param {string} jobName - Validated inert job name, never executable source.
   * @param {Record<string, unknown>} data - Plain JSON object snapshotted under depth/node/byte budgets.
   * @returns {Buffer} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  function encode(jobName: string, data: Record<string, unknown>) {
    name(jobName);
    /** Bounded inert envelope bytes; prefer reference-only jobs for private side effects. */
    const body = Buffer.from(
      JSON.stringify({ name: jobName, data: json(data, maxBytes) })
    );
    if (body.length > maxBytes) {
      throw fail('PAYLOAD_LIMIT');
    }
    return body;
  }
  /** Publish mandatory persistent bytes with a private correlation ID. Return/nack remain explicit; unknown confirmation retires the generation without automatic replay.
   * @param {Generation} g - Exact generation owning these channels, callbacks and native promises.
   * @param {string} destination - Validated code-owned physical work/retry queue, never an arbitrary request destination.
   * @param {Buffer} body - Already bounded serialized inert envelope.
   * @param {string} id - Stable opaque message identity retained across explicit retries.
   * @param {number} attempt - Positive finite effective attempt; producer headers are not authentication.
   * @returns {Promise<void>} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  async function publish(
    g: Generation,
    destination: string,
    body: Buffer,
    id: string,
    attempt: number
  ): Promise<void> {
    if (!g.valid || !g.producer) {
      throw fail('UNAVAILABLE');
    }
    if (g.blocked || g.brokerBlocked || g.confirms.size >= maxPending) {
      throw fail('PUBLISH_BACKPRESSURE');
    }
    /** Fresh private publication correlation ID; not recipient identity. */
    const key = randomUUID();
    let resolve!: () => void, reject!: (error: Error) => void;
    /** Observed confirmation promise whose native callback remains owned. */
    const done = new Promise<void>((ok, no) => {
      resolve = ok;
      reject = no;
    });
    void done.catch(() => {});
    /** Exact mandatory publication receipt, separate from consumer completion. */
    const confirmation: Confirmation = {
      returned: false,
      resolve,
      reject,
      done,
    };
    g.confirms.set(key, confirmation);
    try {
      /** Native buffer acceptance; false stops new publishing until drain. */
      const writable = g.producer.sendToQueue(
        destination,
        body,
        {
          persistent: true,
          mandatory: true,
          contentType: 'application/json',
          messageId: id,
          headers: { 'x-zerux-attempt': attempt, 'x-zerux-publication': key },
        },
        (error) => {
          if (!g.confirms.has(key)) {
            return;
          }
          if (confirmation.returned) {
            returnedPublishes++;
            reject(fail('UNROUTABLE'));
          } else if (error) {
            if (error.message === 'message nacked') {
              reject(fail('PUBLISH_NACK', error));
            } else {
              reject(fail('PUBLISH_OUTCOME_UNKNOWN', error));
              lost(g);
            }
          } else {
            resolve();
          }
        }
      );
      if (!writable) {
        g.blocked = true;
      }
      await bounded(done, timeout, 'PUBLISH_OUTCOME_UNKNOWN');
    } catch (error) {
      if (
        error instanceof RabbitMQWorkerError &&
        ['UNROUTABLE', 'PUBLISH_NACK'].includes(error.code)
      ) {
        throw error;
      }
      if (g.valid) {
        lost(g);
      }
      throw fail('PUBLISH_OUTCOME_UNKNOWN', error);
    } finally {
      g.confirms.delete(key);
    }
  }
  /** Validate the original-channel message and run only its registered handler. Bound attempts, confirm retry publication before original ack and fence all dispositions on generation loss.
   * @param {Generation} g - Exact generation owning these channels, callbacks and native promises.
   * @param {(typeof definitions)[number]} definition - Explicit trusted queue/topology/handler snapshot.
   * @param {ConsumeMessage | null} message - Original-channel delivery, or null consumer-cancellation notification.
   * @returns {void} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  function receive(
    g: Generation,
    definition: (typeof definitions)[number],
    message: ConsumeMessage | null
  ) {
    if (!message) {
      lost(g);
      return;
    }
    if (!g.valid || !g.accepting) {
      return;
    }
    if (allTasks.size >= concurrency) {
      lost(g);
      return;
    }
    /** One callback signal owner retained until actual settlement. */
    const controller = new AbortController();
    g.controllers.add(controller);
    /** Actual handler/disposition promise; old completion cannot ack a replacement channel. */
    const work = (async () => {
      let envelope: {
          /** Validated registered logical queue/job name; never executable source. */
          name: string;
          /** Copied inert private JSON; host owns tenant/consent/business authorization. */
          data: Record<string, unknown>;
        },
        attempt: number,
        id: string;
      try {
        if (
          message.content.length > maxBytes ||
          message.properties.contentType !== 'application/json'
        ) {
          throw fail('INVALID_PAYLOAD');
        }
        /** Private parsed envelope/URL; never executable source. */
        const parsed = JSON.parse(message.content.toString('utf8'));
        keys(parsed, ['name', 'data']);
        envelope = {
          name: name(parsed.name),
          data: json(parsed.data, maxBytes),
        };
        /** Private native attempt/redelivery metadata; not authentication. */
        const headers = message.properties.headers ?? {};
        /** Producer attempt header validated before use. */
        const a = Object.hasOwn(headers, 'x-zerux-attempt')
          ? headers['x-zerux-attempt']
          : undefined;
        /** Broker redelivery count included in effective finite attempts. */
        const count = Object.hasOwn(headers, 'x-delivery-count')
          ? headers['x-delivery-count']
          : 0;
        attempt = integer(a, 1, 20) + integer(count, 0, 1000000);
        id = name(message.properties.messageId);
      } catch {
        if (g.valid) {
          deadLetters++;
          g.consumer!.nack(message, false, false);
        }
        return;
      }
      if (attempt > definition.maxAttempts) {
        if (g.valid) {
          deadLetters++;
          g.consumer!.nack(message, false, false);
        }
        return;
      }
      let result: RabbitMQWorkerResult;
      /** Owned handler deadline; generation loss fences late acknowledgements. */
      const taskTimer = setTimeout(() => {
        timers.delete(taskTimer);
        handlerDeadlines++;
        lost(g);
      }, handlerTimeout);
      timers.add(taskTimer);
      /** Release handler timer without freeing actual unsettled handler ownership.
       * @returns {void} Validated inert result or cancellation request; actual native ownership stays explicit.
       */
      const stopTimer = () => {
        clearTimeout(taskTimer);
        timers.delete(taskTimer);
      };
      controller.signal.addEventListener('abort', stopTimer, { once: true });
      try {
        result = await definition.handler!({
          id,
          name: envelope.name,
          data: envelope.data,
          attempt,
          redelivered: message.fields.redelivered,
          signal: controller.signal,
        });
      } catch {
        result = 'retry';
      } finally {
        stopTimer();
        controller.signal.removeEventListener('abort', stopTimer);
      }
      if (!g.valid || controller.signal.aborted) {
        return;
      }
      if (result === 'ack') {
        g.consumer!.ack(message);
        return;
      }
      if (result === 'retry' && attempt < definition.maxAttempts) {
        try {
          await publish(
            g,
            `${prefix}.${definition.name}.retry`,
            encode(envelope.name, envelope.data),
            id,
            attempt + 1
          );
          if (g.valid) {
            g.consumer!.ack(message);
          }
        } catch (error) {
          if (
            error instanceof RabbitMQWorkerError &&
            ['PUBLISH_BACKPRESSURE', 'UNROUTABLE', 'PUBLISH_NACK'].includes(
              error.code
            )
          ) {
            if (g.valid) {
              deadLetters++;
              g.consumer!.nack(message, false, false);
            }
          } else {
            lost(g);
          }
        }
        return;
      }
      deadLetters++;
      g.consumer!.nack(message, false, false);
    })()
      .catch(() => {
        lost(g);
      })
      .finally(() => {
        g.controllers.delete(controller);
        g.tasks.delete(work);
        allTasks.delete(work);
      });
    g.tasks.add(work);
    allTasks.add(work);
  }
  /** Acquire fresh owned channels, qualify quorum broker advertisements, declare finite topology and consumer credits. Failed/late acquisitions remain owned for cleanup.
   * @returns {Promise<Generation>} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  async function openGeneration(): Promise<Generation> {
    let rejectLost!: (error: Error) => void;
    /** Observed generation-loss barrier shared by startup phases. */
    const lostPromise = new Promise<never>(
      (_, reject) => (rejectLost = reject)
    );
    void lostPromise.catch(() => {});
    /** Fresh exact generation owning its connections/channels/callbacks. */
    const g: Generation = {
      id: ++generation,
      valid: true,
      accepting: false,
      connectionClosed: false,
      cleanupFailed: false,
      blocked: false,
      brokerBlocked: false,
      tags: [],
      controllers: new Set(),
      tasks: new Set(),
      confirms: new Map(),
      native: new Set(),
      releases: new Map(),
      lost: lostPromise,
      rejectLost,
    };
    current = g;
    try {
      /** Tracked native acquisition/close; races never cancel ownership. */
      const pending = tracked(g, connector(url, { timeout }));
      void pending
        .then(
          (connection) => {
            connection.on('error', () => {});
            connection.on('close', () => {
              g.connectionClosed = true;
              g.cleanupFailed = false;
              lost(g);
            });
            if (closed || !g.valid) {
              void releaseResource(g, connection).catch(() => {});
            }
          },
          () => {}
        )
        .catch(() => {
          cleanupFailures++;
        });
      g.connection = await bounded(
        pending,
        timeout,
        'CONNECT_DEADLINE',
        lifetime.signal
      );
      if (closed || !g.valid) {
        throw fail('CANCELLED');
      }
      if (definitions.some((d) => d.type === 'quorum')) {
        /** Broker advertisement checked before explicit quorum declarations. */
        const info = g.connection.connection?.serverProperties;
        if (
          info?.product !== 'RabbitMQ' ||
          typeof info.version !== 'string' ||
          !/^4\.\d+\.\d+(?:\+[^\s]+)?$/.test(info.version)
        ) {
          throw fail('BROKER_UNSUPPORTED');
        }
      }
      g.connection.on('error', () => lost(g));
      g.connection.on('blocked', () => {
        g.brokerBlocked = true;
      });
      g.connection.on('unblocked', () => {
        g.brokerBlocked = false;
      });
      g.producer = await acquireChannel(g, g.connection.createConfirmChannel());
      g.producer.on('error', () => lost(g));
      g.producer.on('close', () => lost(g));
      g.producer.on('drain', () => {
        g.blocked = false;
      });
      g.producer.on('return', (message: ConsumeMessage) => {
        /** Fresh private publication correlation ID; not recipient identity. */
        const key = message.properties.headers?.['x-zerux-publication'];
        /** Exact mandatory publication receipt, separate from consumer completion. */
        const confirmation =
          typeof key === 'string' ? g.confirms.get(key) : undefined;
        if (confirmation) {
          confirmation.returned = true;
        } else {
          lost(g);
        }
      });
      g.consumer = await acquireChannel(g, g.connection.createChannel());
      g.consumer.on('error', () => lost(g));
      g.consumer.on('close', () => lost(g));
      // Visit only fixed topology/recovery bounds or actual unsettled owners; never replay unknown work.
      for (const definition of definitions) {
        /** Code-owned validated physical destination. */
        const physical = `${prefix}.${definition.name}`;
        /** Code-owned queue arguments; policies remain explicit. */
        const base = {
          'x-queue-type': definition.type,
          'x-max-length': definition.maxLength,
          'x-overflow': 'reject-publish',
        };
        await phase(
          g,
          g.producer.assertQueue(`${physical}.dead`, {
            durable: true,
            arguments: base,
          })
        );
        await phase(
          g,
          g.producer.assertQueue(`${physical}.retry`, {
            durable: true,
            arguments: {
              'x-queue-type': 'classic',
              'x-message-ttl': definition.retryDelayMs,
              'x-max-length': definition.maxLength,
              'x-overflow': 'reject-publish',
              'x-dead-letter-exchange': '',
              'x-dead-letter-routing-key': physical,
            },
          })
        );
        await phase(
          g,
          g.producer.assertQueue(physical, {
            durable: true,
            arguments: {
              ...base,
              'x-dead-letter-exchange': '',
              'x-dead-letter-routing-key': `${physical}.dead`,
              ...(definition.type === 'quorum'
                ? { 'x-delivery-limit': definition.maxAttempts }
                : {}),
            },
          })
        );
      }
      g.accepting = true;
      // Visit only fixed topology/recovery bounds or actual unsettled owners; never replay unknown work.
      for (let i = 0; i < workers.length; i++) {
        /** Trusted queue/topology/handler selected from the finite allowlist. */
        const definition = workers[i];
        if (!definition) {
          throw fail('GENERATION_LOST');
        }
        /** Per-consumer prefetch share; total matches service concurrency without global quorum prefetch. */
        const credit =
          Math.floor(concurrency / workers.length) +
          (i < concurrency % workers.length ? 1 : 0);
        await phase(g, g.consumer.prefetch(credit, false));
        /** Native consumer tag owned by this exact channel/generation. */
        const tag = await phase(
          g,
          g.consumer.consume(
            `${prefix}.${definition.name}`,
            (message) => receive(g, definition, message),
            { noAck: false }
          )
        );
        g.tags.push(tag.consumerTag);
      }
      if (!g.valid) {
        throw fail('GENERATION_LOST');
      }
      return g;
    } catch (error) {
      invalidate(g);
      void retire(g).catch(() => {});
      throw fail('START_FAILED', error);
    }
  }
  /** Request bounded service shutdown or fulfill the native close primitive of an owned resource. Actual callbacks/native work may outlive caller waiting; inspect status for incomplete settlement.
   * @returns {Promise<void>} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
   */
  async function close(): Promise<void> {
    if (closing) {
      return closing;
    }
    closed = true;
    state = 'closing';
    lifetime.abort();
    externalSignal?.removeEventListener('abort', abort);
    closing = (async () => {
      /** Actual retirement/settlement barrier distinct from bounded caller waiting. */
      const retirement = current ? retire(current, true) : Promise.resolve();
      try {
        await bounded(
          Promise.allSettled([retirement, ...(recovering ? [recovering] : [])]),
          drain + timeout * 4,
          'CLOSE_DEADLINE'
        );
      } catch {
        drainTimeouts++;
      }
      if (allTasks.size || allNative.size) {
        state = 'incomplete';
      } else if (cleanupFailures) {
        state = 'failed';
      } else {
        state = 'closed';
      }
    })();
    return closing;
  }
  /** Scoped cancellation listener/host close request removed after its owned scope.
   * @returns {void} Validated inert result or cancellation request; actual native ownership stays explicit.
   */
  const abort = () => {
    void close().catch(() => {});
  };
  externalSignal?.addEventListener('abort', abort, { once: true });
  try {
    if (externalSignal?.aborted) {
      throw fail('CANCELLED');
    }
    await openGeneration();
    if (closed) {
      throw fail('CANCELLED');
    }
    state = 'ready';
  } catch (error) {
    await close();
    throw fail('START_FAILED', error);
  }
  return {
    capabilities: Object.freeze({
      publisherConfirms: true,
      acknowledgement: true,
      push: true,
      brokerRetry: true,
      delay: false,
      scheduler: false,
    }),
    /** Publish only to an allowlisted queue in the ready generation. Return after confirmation, not consumer processing or exactly-once side effects.
     * @param {string} queue - Configured logical queue; host independently authorizes tenant access.
     * @param {string} jobName - Validated inert job name, never executable source.
     * @param {Record<string, unknown>} data - Plain JSON object snapshotted under depth/node/byte budgets.
     * @returns {Promise<string>} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
     */
    async add(
      queue: string,
      jobName: string,
      data: Record<string, unknown>
    ): Promise<string> {
      if (closed || state !== 'ready' || !current?.valid) {
        throw fail('UNAVAILABLE');
      }
      /** Trusted queue/topology/handler selected from the finite allowlist. */
      const definition = definitions.find((d) => d.name === queue);
      if (!definition) {
        throw fail('QUEUE_NOT_CONFIGURED');
      }
      /** Bounded inert envelope bytes; prefer reference-only jobs for private side effects. */
      const body = encode(jobName, data);
      /** Generated stable message reference retained across explicit retries. */
      const id = randomUUID();
      await publish(current, `${prefix}.${definition.name}`, body, id, 1);
      return id;
    },
    /** Return fixed-label lifecycle counters without queue names, credentials or payloads. Actual late settlement may resolve incomplete to closed/failed.
     * @returns {object} Explicit lifecycle/native receipt; cancellation does not prove rollback or side-effect failure.
     */
    status() {
      return {
        state: (() => {
          if (state !== 'incomplete' || allTasks.size || allNative.size) {
            return state;
          }
          return cleanupFailures ? 'failed' : 'closed';
        })(),
        generation,
        reconnectAttempts,
        pendingHandlers: allTasks.size,
        pendingNative: allNative.size,
        pendingConfirms: current?.confirms.size ?? 0,
        unknownPublishes,
        returnedPublishes,
        deadLetters,
        cleanupFailures,
        drainTimeouts,
        handlerDeadlines,
        pendingTimers: timers.size,
      };
    },
    close,
  };
}
