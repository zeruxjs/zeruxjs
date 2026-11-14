import { isIP } from 'node:net';
export interface TransportBind {
  /** Explicit IP literal listener address; no implicit DNS bind. */
  host: string;
  /** Validated listener port, including explicit zero for ephemeral bind. */
  port: number;
}
export interface TransportLimits {
  /** Validated per-message byte ceiling, at most sixteen MiB. */
  maxMessageBytes: number;
  /** Validated concurrent-handler ceiling, at most 1024. */
  maxConcurrent: number;
  /** Cooperative timeout from ten through 120000 milliseconds; actual settlement remains owned. */
  timeoutMs: number;
}
export interface TransportStartContext {
  /** Frozen copied explicit native bind settings. */
  readonly bind: Readonly<TransportBind>;
  /** Frozen copied validated byte/concurrency/deadline policy. */
  readonly limits: Readonly<TransportLimits>;
  /** Owned registry cancellation signal; handlers must cooperate. */
  readonly signal: AbortSignal;
  /** Register cleanup immediately after acquisition so partial startup can release it.
   * @param {() => void | Promise<void>} cleanup - Trusted synchronous or asynchronous cleanup, at most sixty-four per entry.
   * @returns {void} Retains this callback until reverse cleanup; rejects registration after release.
   */
  onDispose(cleanup: () => void | Promise<void>): void;
}
export interface TransportHealth {
  /** Actual adapter readiness, never inferred solely from declaring a transport name. */
  ready: boolean;
}
/** Trusted adapter owns its listener/streams. Register cleanup immediately, including partial start.
 * stop must close admission, abort handlers, end streams/WS and release sockets/listener. */
export interface TransportAdapter {
  /** Start registered adapters sequentially with cooperative deadlines, require real readiness and reverse acquired resources on failure.
   * @returns {Promise<void>} Actual startup settlement; partial failure drains stop/cleanup before rejection.
   */
  start(context: TransportStartContext): Promise<void>;
  /** Report actual adapter readiness, mapping native failure to false rather than fabricated success.
   * @returns {TransportHealth | Promise<TransportHealth>} Adapter-owned health receipt; registry health separately returns per-registration observations.
   */
  health(): TransportHealth | Promise<TransportHealth>;
  /** Stop admission and release actual owned adapter work; the registry aborts all entries and waits startup before reverse cleanup.
   * @returns {void | Promise<void>} Adapter cleanup or registry shared stop settlement; signals alone are not forced JavaScript cancellation.
   */
  stop(): void | Promise<void>;
}
export type TransportAdapterFactory = (options: unknown) => TransportAdapter;
export interface TransportRegistration {
  /** Unique validated application-scoped registration identifier. */
  id: string;
  /** Explicit registered trusted factory name. */
  type: string;
  /** Frozen copied explicit native bind settings. */
  bind: TransportBind;
  /** Frozen copied validated byte/concurrency/deadline policy. */
  limits?: Partial<TransportLimits>;
  /** Borrowed adapter-owned configuration; never inferred executable source. */
  options?: unknown;
}
/** Fixed public lifecycle code with host-private native acquisition/cleanup causes. */
export class TransportLifecycleError extends Error {
  /** Create a fixed-code lifecycle failure with an optional private native cause; do not serialize causes to clients.
   * @param {string} code - Fixed redacted lifecycle classification.
   * @param {ErrorOptions} options - Optional host-private native cause.
   */
  constructor(
    readonly code: string,
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = 'TransportLifecycleError';
  }
}
/** Create a fixed lifecycle error without serializing native details.
 * @param {string} code Internal redacted lifecycle classification.
 * @returns {TransportLifecycleError} Typed lifecycle failure. */
const fail = (code: string) => new TransportLifecycleError(code);
/** Create an inert application-scoped registry accepting only explicit trusted factories; registration alone implements no transport or authorization.
 * @param {{ maxTransports?: number }} options - Bounded per-app registrations from one through 128, default thirty-two.
 * @param {number | undefined} options.maxTransports - Maximum explicit app registrations, default thirty-two and at most 128.
 * @returns {object} Inert registry; after start the host owns stop and actual adapter settlement.
 */
export function createTransportRegistry(
  options: { maxTransports?: number } = {}
) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw fail('TRANSPORT_INVALID');
  }
  /** Validated bound shared by factory and transport registrations. */
  const max = options.maxTransports ?? 32;
  if (!Number.isSafeInteger(max) || max < 1 || max > 128) {
    throw fail('TRANSPORT_INVALID');
  }
  /** Application-owned explicit trusted factories, inert until start. */
  const factories = new Map<string, TransportAdapterFactory>();
  type Entry = {
    spec: TransportRegistration;
    /** Frozen copied validated byte/concurrency/deadline policy. */
    limits: TransportLimits;
    state: 'registered' | 'starting' | 'ready' | 'failed' | 'stopped';
    adapter?: TransportAdapter;
    controller?: AbortController;
    cleanups: (() => void | Promise<void>)[];
    released: boolean;
  };
  /** Bounded application-owned acquisition/state records in registration order. */
  const entries = new Map<string, Entry>();
  let state:
      | 'registered'
      | 'starting'
      | 'ready'
      | 'failed'
      | 'stopping'
      | 'stopped' = 'registered',
    startPromise: Promise<void> | undefined,
    stopPromise: Promise<void> | undefined;
  /** Check a fixed registration/type identifier without executing any source.
   * @param {unknown} value Unknown candidate label.
   * @returns {boolean} Whether the supported bounded lower-case identifier matches. */
  const name = (value: unknown) =>
    typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  /** Abort one acquired adapter, await its native stop and reverse its registered cleanup handles, reporting every cleanup failure.
   * @param {Entry} entry - Registry-owned acquisition record, including partially started adapters.
   * @returns {Promise<void>} Settles actual trusted cleanup operations; cooperative abort cannot force arbitrary JavaScript to finish.
   */
  async function release(entry: Entry) {
    if (entry.released) {
      return;
    }
    entry.released = true;
    entry.controller?.abort();
    /** Collected native acquisition/cleanup causes retained privately for aggregate failure. */
    const errors: unknown[] = [];
    try {
      await entry.adapter?.stop();
    } catch (error) {
      errors.push(error);
    }
    for (const cleanup of entry.cleanups.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    entry.cleanups.length = 0;
    entry.state = 'stopped';
    if (errors.length) {
      throw new AggregateError(errors, 'Transport cleanup failed');
    }
  }
  return {
    /** Register one explicitly trusted factory before startup; no installed-package discovery or dynamic code loading occurs.
     * @param {string} type - Validated unique transport type label.
     * @param {TransportAdapterFactory} factory - Trusted application code creating one supported adapter.
     * @returns {void} Adds the inert factory or rejects invalid/closed/full registration.
     */
    registerAdapter(type: string, factory: TransportAdapterFactory) {
      if (state !== 'registered') {
        throw fail('TRANSPORT_REGISTRATION_CLOSED');
      }
      if (
        !name(type) ||
        typeof factory !== 'function' ||
        factories.has(type) ||
        factories.size >= max
      ) {
        throw fail('TRANSPORT_INVALID_ADAPTER');
      }
      factories.set(type, factory);
    },
    /** Validate a declared transport, fixed-port reservation and bounded message/work policy before acquiring any listener.
     * @param {TransportRegistration} spec - Explicit trusted registration; adapter options remain borrowed and adapter-owned.
     * @returns {{ remove(): boolean }} Frozen inert unregister handle usable only before startup.
     */
    register(spec: TransportRegistration) {
      if (state !== 'registered') {
        throw fail('TRANSPORT_REGISTRATION_CLOSED');
      }
      if (
        !spec ||
        !name(spec.id) ||
        !name(spec.type) ||
        !spec.bind ||
        typeof spec.bind.host !== 'string' ||
        !isIP(spec.bind.host) ||
        !Number.isSafeInteger(spec.bind.port) ||
        spec.bind.port < 0 ||
        spec.bind.port > 65535 ||
        entries.has(spec.id) ||
        entries.size >= max
      ) {
        throw fail('TRANSPORT_INVALID');
      }
      if (!factories.has(spec.type)) {
        throw fail('TRANSPORT_UNSUPPORTED');
      }
      // Conservative TCP reservation: all fixed-port collisions reject before any start. Port 0 is ephemeral.
      if (
        spec.bind.port &&
        [...entries.values()].some(
          (entry) => entry.spec.bind.port === spec.bind.port
        )
      ) {
        throw fail('TRANSPORT_BIND_CONFLICT');
      }
      if (
        spec.limits !== undefined &&
        (!spec.limits ||
          typeof spec.limits !== 'object' ||
          Array.isArray(spec.limits))
      ) {
        throw fail('TRANSPORT_INVALID_LIMITS');
      }
      /** Normalized validated per-registration work policy. */
      const limits = {
        maxMessageBytes: 1024 * 1024,
        maxConcurrent: 32,
        timeoutMs: 30000,
        ...spec.limits,
      };
      if (
        (spec.limits &&
          Object.keys(spec.limits).some(
            (key) =>
              !['maxMessageBytes', 'maxConcurrent', 'timeoutMs'].includes(key)
          )) ||
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
        throw fail('TRANSPORT_INVALID_LIMITS');
      }
      /** Owned registration or acquired adapter record retained for rollback/stop. */
      const entry: Entry = {
        spec: { ...spec, bind: { ...spec.bind } },
        limits,
        state: 'registered',
        cleanups: [],
        released: false,
      };
      entries.set(spec.id, entry);
      return Object.freeze({
        /** Remove this registration only while the registry remains inert.
         * @returns {boolean} Whether the exact current registration was removed; closed registration rejects.
         */
        remove() {
          if (state !== 'registered') {
            throw fail('TRANSPORT_REGISTRATION_CLOSED');
          }
          return (
            entries.get(entry.spec.id) === entry &&
            entries.delete(entry.spec.id)
          );
        },
      });
    },
    /** Start registered adapters sequentially with cooperative deadlines, require real readiness and reverse acquired resources on failure.
     * @returns {Promise<void>} Actual startup settlement; partial failure drains stop/cleanup before rejection.
     */
    start() {
      if (state === 'stopped' || state === 'stopping' || state === 'failed') {
        return Promise.reject(fail('TRANSPORT_CLOSED'));
      }
      if (startPromise) {
        return startPromise;
      }
      if (state !== 'registered') {
        return Promise.reject(fail('TRANSPORT_CLOSED'));
      }
      state = 'starting';
      return (startPromise = Promise.resolve().then(async () => {
        try {
          for (const entry of entries.values()) {
            if (state === 'stopping') {
              throw fail('TRANSPORT_CANCELLED');
            }
            entry.state = 'starting';
            entry.controller = new AbortController();
            /** Explicit trusted factory result, checked for actual lifecycle functions. */
            const adapter = factories.get(entry.spec.type)!(entry.spec.options);
            entry.adapter = adapter;
            if (
              !adapter ||
              typeof adapter.start !== 'function' ||
              typeof adapter.health !== 'function' ||
              typeof adapter.stop !== 'function'
            ) {
              throw fail('TRANSPORT_INVALID_ADAPTER');
            }
            /** Owned cooperative startup timer; always cleared after actual startup/readiness settles. */
            const deadline = setTimeout(
              () => entry.controller?.abort(),
              entry.limits.timeoutMs
            );
            try {
              await adapter.start({
                bind: Object.freeze({ ...entry.spec.bind }),
                limits: Object.freeze({ ...entry.limits }),
                signal: entry.controller.signal,
                /** Register cleanup immediately after acquisition so partial startup can release it.
                 * @param {() => void | Promise<void>} cleanup - Trusted synchronous or asynchronous cleanup, at most sixty-four per entry.
                 * @returns {void} Retains this callback until reverse cleanup; rejects registration after release.
                 */ onDispose(cleanup) {
                  if (
                    entry.released ||
                    typeof cleanup !== 'function' ||
                    entry.cleanups.length >= 64
                  ) {
                    throw fail('TRANSPORT_INVALID_CLEANUP');
                  }
                  entry.cleanups.push(cleanup);
                },
              });
              if (entry.controller.signal.aborted) {
                throw fail('TRANSPORT_CANCELLED');
              }
              /** Actual adapter health receipt checked only after startup settlement. */
              const health = await adapter.health();
              if (
                entry.controller.signal.aborted ||
                !health ||
                health.ready !== true
              ) {
                throw fail('TRANSPORT_NOT_READY');
              }
              entry.state = 'ready';
            } finally {
              clearTimeout(deadline);
            }
          }
          state = 'ready';
        } catch (cause) {
          state = state === 'stopping' ? 'stopping' : 'failed';
          /** Collected native acquisition/cleanup causes retained privately for aggregate failure. */
          const errors: unknown[] = [cause];
          for (const entry of [...entries.values()].reverse()) {
            if (entry.adapter) {
              try {
                await release(entry);
              } catch (error) {
                errors.push(error);
              }
            }
          }
          throw new TransportLifecycleError('TRANSPORT_START_FAILED', {
            cause:
              errors.length === 1
                ? cause
                : new AggregateError(errors, 'Transport rollback failed'),
          });
        }
      }));
    },
    /** Report actual adapter readiness, mapping native failure to false rather than fabricated success.
     * @returns {Promise<{ id: string; type: string; state: string; ready: boolean }[]>} Detached current per-registration readiness with native failures reported as false.
     */
    async health() {
      /** Bounded detached per-registration observations, excluding credentials and adapter options. */
      const output: {
        /** Unique validated application-scoped registration identifier. */
        id: string;
        /** Explicit registered trusted factory name. */
        type: string;
        state: string;
        /** Actual adapter readiness, never inferred solely from declaring a transport name. */
        ready: boolean;
      }[] = [];
      for (const entry of entries.values()) {
        let ready = false;
        if (entry.state === 'ready') {
          try {
            ready = (await entry.adapter!.health()).ready === true;
          } catch {
            /* readiness is false, never a fabricated healthy result */
          }
        }
        output.push({
          id: entry.spec.id,
          type: entry.spec.type,
          state: entry.state,
          ready,
        });
      }
      return output;
    },
    /** Stop admission and release actual owned adapter work; the registry aborts all entries and waits startup before reverse cleanup.
     * @returns {void | Promise<void>} Adapter cleanup or registry shared stop settlement; signals alone are not forced JavaScript cancellation.
     */
    stop() {
      if (stopPromise) {
        return stopPromise;
      }
      state = 'stopping';
      for (const entry of entries.values()) {
        entry.controller?.abort();
      }
      return (stopPromise = Promise.resolve().then(async () => {
        await startPromise?.catch(() => {});
        /** Collected native acquisition/cleanup causes retained privately for aggregate failure. */
        const errors: unknown[] = [];
        for (const entry of [...entries.values()].reverse()) {
          try {
            await release(entry);
          } catch (error) {
            errors.push(error);
          }
        }
        state = 'stopped';
        if (errors.length) {
          throw new AggregateError(errors, 'Transport stop failed');
        }
      }));
    },
    get state() {
      return state;
    },
  };
}
