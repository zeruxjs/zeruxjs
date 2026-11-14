/** Opt-in contract. No discovery, connections or optional driver imports on import. */
export interface QueueCapabilities {
  /** Whether native durable delay is supported; not emulated with process timers. */
  delay: boolean;
  /** Whether native attempts/retry options are supported. */
  retry: boolean;
  /** Whether neutral pull exposes manual original-channel settlement; distinct from BullMQ processor completion. */
  acknowledgement: boolean;
  /** Whether a typed native extension provides scheduling; neutral APIs do not fake a scheduler. */
  scheduler: boolean;
  /** Whether explicit take is supported; host owns polling/backoff. */
  pull: boolean;
  /** Whether native registered push processors are supported. */
  push: boolean;
  /** Whether broker publisher confirmations exist; not generic business durability. */
  publisherConfirms: boolean;
  /** Whether a pop permanently consumes the message without acknowledgement/recovery. */
  destructiveRead: boolean;
}
export type QueueCapability = keyof QueueCapabilities;
export type QueueDisposition = 'ack' | 'discard' | 'requeue';
export interface QueueDelivery {
  /** Optional native opaque delivery/publish identifier; not durable business idempotency. */
  id?: string;
  /** Validated task/factory label; never caller executable source. */
  name: string;
  /** Plain bounded JSON payload; use opaque records rather than secrets or bodies. */
  data: Record<string, unknown>;
  /** Optional native broker redelivery indicator, not an exactly-once guarantee. */
  redelivered?: boolean;
  /** Manual original-channel settlement or already-consumed destructive read. */
  disposition: 'manual' | 'consumed';
  /** Settle one original-channel manual delivery at most once locally. Unknown acknowledgement outcomes never move onto another channel or auto-replay.
   * @param {QueueDisposition} disposition - Explicit ack, discard or requeue; requeue may repeat indefinitely without host poison policy.
   * @returns {void | Promise<void>} Native settlement outcome; failure after invocation remains uncertain.
   */
  settle?(disposition: QueueDisposition): void | Promise<void>;
}
export interface QueuePublishOptions {
  /** Native delay milliseconds, zero through 366 days; unsupported backends reject even zero. */
  delay?: number;
  /** Native supported total attempts, validated 1 through 50; unsupported backends reject even one. */
  attempts?: number;
}
export interface QueueBackendHandle<Extension = unknown> {
  /** Validate/snapshot a bounded job and publish once through the explicit backend. Success meaning and unknown disconnect outcomes remain backend-specific.
   * @param {string} queue - Explicit allowed queue.
   * @param {string} name - Common validated task name.
   * @param {Record<string, unknown>} data - Plain bounded reference payload; never raw secrets.
   * @param {QueuePublishOptions} options - Backend-supported delay/attempt policy; even zero/one rejects if unsupported.
   * @returns {Promise<object>} Native optional ID receipt, not an exactly-once business acknowledgement.
   */
  publish(
    queue: string,
    name: string,
    data: Record<string, unknown>,
    options: QueuePublishOptions
  ): Promise<{
    /** Optional native opaque delivery/publish identifier; not durable business idempotency. */
    id?: string;
  }>;
  /** Pull one delivery only when supported and validate its payload/disposition. Destructive malformed reads may already have lost a message; no implicit reinsertion occurs.
   * @param {string} queue - Explicit registered pull queue.
   * @returns {Promise<QueueDelivery | undefined>} Validated delivery or empty; manual settlement stays bound to the original native channel.
   */
  take?(queue: string): Promise<QueueDelivery | undefined>;
  /** Trusted typed native handle, sharing the selected backend lifecycle. */
  extension?: Extension;
}
export interface QueueStartupOwnership {
  /** Register acquired resources immediately during factory startup only; reverse rollback/close invokes each registration once.
   * @param {function} cleanup - Owned resource cleanup; register before acquiring the next resource.
   * @returns {void} Stores at most 64 cleanup callbacks; invalid/late registration rejects.
   */
  onCleanup(cleanup: () => void | Promise<void>): void;
}
export interface QueueBackendFactory<Options = unknown, Extension = unknown> {
  /** Validated task/factory label; never caller executable source. */
  readonly name: string;
  /** One through 100 unique explicit allowed queue names; namespace does not grant tenant permission. */
  readonly queues: readonly string[];
  /** Explicit immutable-by-snapshot native capability declarations, not live certification. */
  readonly capabilities: Readonly<QueueCapabilities>;
  /** Validate owning backend options using pure synchronous trusted code; no connections/imports/logging or source execution.
   * @param {unknown} options - Unknown explicit backend configuration.
   * @returns {Options} Validated package-owned option value.
   */
  validate(options: unknown): Options;
  /** Acquire only explicitly configured backend resources and register their cleanup immediately.
   * @param {Options} options - Previously validated package-owned configuration.
   * @param {QueueStartupOwnership} ownership - Generation/startup cleanup registrar, valid only until open settles.
   * @returns {QueueBackendHandle<Extension> | Promise<QueueBackendHandle<Extension>>} Native adapter handle; partial startup must be rollback-safe.
   */
  open(
    options: Options,
    ownership: QueueStartupOwnership
  ): Promise<QueueBackendHandle<Extension>> | QueueBackendHandle<Extension>;
}
export interface QueueSelection {
  /** Explicit trusted factory; no arbitrary on-disk package discovery. */
  factory: QueueBackendFactory<any, any>;
  /** Owning backend configuration, private and independently validated. */
  options: unknown;
  /** Optional finite native capability requirements; unknown/unsupported values reject before startup. */
  requireCapabilities?: readonly QueueCapability[];
  /** UTF-8 JSON ceiling, default 64 KiB and maximum 1 MiB. */
  maxBytes?: number;
  /** Actual unsettled operation ceiling, default 32 and maximum 1000. */
  maxPending?: number;
}
/** Fixed public backend failure with an optional non-enumerable private native cause. */
export class QueueBackendError extends Error {
  /** Retain a fixed public backend code with an optional non-enumerable private cause. Never serialize underlying credentials or payloads indiscriminately.
   * @param {string} code - Fixed public backend failure discriminator.
   * @param {unknown} cause - Optional private native cause, not part of public JSON.
   */
  constructor(
    readonly code: string,
    cause?: unknown
  ) {
    super(`Queue backend error (${code})`);
    this.name = 'QueueBackendError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause });
    }
  }
}
/** Conservative common ASCII naming grammar, maximum 96 characters. */
const names = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
/** Finite known capability vocabulary; unknown declarations are rejected. */
const capabilities = [
  'delay',
  'retry',
  'acknowledgement',
  'scheduler',
  'pull',
  'push',
  'publisherConfirms',
  'destructiveRead',
] as const;
/** Validate the conservative common queue/job/factory name subset without treating a namespace as authorization.
 * @param {unknown} name - Unknown literal name, maximum 96 safe ASCII characters.
 * @returns {void} Narrows valid names or throws a fixed public error.
 */
export function queueName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !names.test(name)) {
    throw new QueueBackendError('INVALID_NAME');
  }
}
/** Reject unknown top-level fields, nonplain objects and accessors before backend startup. Does not execute getters or discover packages.
 * @param {unknown} value - Unknown explicit configuration object.
 * @param {readonly string[]} allowed - Fixed owning-backend field allowlist.
 * @returns {void} Narrows a plain own-data object; values still require backend-specific validation.
 */
export function queueOptionKeys(
  value: unknown,
  allowed: readonly string[]
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
    throw new QueueBackendError('INVALID_OPTIONS');
  }
}
/** Validate a safe-integer backend limit before resource allocation.
 * @param {unknown} value - Unknown configured bound.
 * @param {number} min - Inclusive minimum.
 * @param {number} max - Inclusive maximum.
 * @returns {number} Validated integer; invalid values reject with a fixed error.
 */
export function queueInteger(value: unknown, min: number, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new QueueBackendError('INVALID_OPTIONS');
  }
  return value;
}
/** Bind an explicitly trusted typed factory to its owning options and validate synchronously. Configuration remains private server code, not optional package discovery.
 * @param {QueueBackendFactory<O, E>} factory - Explicit registered trusted factory; identity controls native extension access.
 * @param {NoInfer<O>} options - Owning backend options; secrets stay server-side.
 * @param {Omit<QueueSelection, 'factory' | 'options'>} settings - Optional required capabilities and wrapper payload/pending limits.
 * @returns {QueueSelection & {factory: QueueBackendFactory<O,E>}} Validated selection; no connection opens until createQueueBackend.
 */
export function selectQueueBackend<O, E>(
  factory: QueueBackendFactory<O, E>,
  options: NoInfer<O>,
  settings: Omit<QueueSelection, 'factory' | 'options'> = {}
): QueueSelection & {
  /** Explicit trusted factory; no arbitrary on-disk package discovery. */
  factory: QueueBackendFactory<O, E>;
} {
  /** Explicit trusted factory/options/settings binding validated before opening resources. */
  const selection = { ...settings, factory, options };
  validateQueueSelection(selection);
  return selection;
}
/** Validate explicit queue/capability/limit/factory contracts before database/cache/provider allocation. Custom validation must be pure synchronous host code.
 * @param {QueueSelection} selection - Private explicit backend selection and bounded policy.
 * @returns {void} Returns after validation, or throws a redacted backend error before startup.
 */
export function validateQueueSelection(selection: QueueSelection): void {
  try {
    queueOptionKeys(selection, [
      'factory',
      'options',
      'requireCapabilities',
      'maxBytes',
      'maxPending',
    ]);
    /** Selected trusted backend identity; native extension access requires this exact object. */
    const factory = selection.factory;
    queueName(factory?.name);
    if (
      typeof factory.validate !== 'function' ||
      typeof factory.open !== 'function' ||
      !Array.isArray(factory.queues) ||
      !factory.queues.length ||
      factory.queues.length > 100 ||
      new Set(factory.queues).size !== factory.queues.length
    ) {
      throw new QueueBackendError('INVALID_FACTORY');
    }
    factory.queues.forEach(queueName);
    if (
      factory.capabilities?.acknowledgement &&
      factory.capabilities.destructiveRead
    ) {
      throw new QueueBackendError('INVALID_CAPABILITIES');
    }
    if (
      !factory.capabilities ||
      capabilities.some(
        (key) => typeof factory.capabilities[key] !== 'boolean'
      ) ||
      Object.keys(factory.capabilities).some(
        (key) => !capabilities.includes(key as QueueCapability)
      )
    ) {
      throw new QueueBackendError('INVALID_CAPABILITIES');
    }
    /** Explicit capability requirements; missing declarations never imply compatibility. */
    const required = selection.requireCapabilities ?? [];
    if (
      !Array.isArray(required) ||
      required.length > 8 ||
      required.some(
        (key) =>
          !capabilities.includes(key) ||
          !factory.capabilities[key as QueueCapability]
      )
    ) {
      throw new QueueBackendError('UNSUPPORTED_CAPABILITY');
    }
    queueInteger(selection.maxBytes ?? 65536, 1, 1024 * 1024);
    queueInteger(selection.maxPending ?? 32, 1, 1000);
    factory.validate(selection.options);
  } catch (error) {
    if (error instanceof QueueBackendError) {
      throw error;
    }
    throw new QueueBackendError('INVALID_OPTIONS', error);
  }
}
/** Snapshot a bounded plain JSON payload without getters, cycles, classes or unsafe property names. This is data validation, not secret redaction.
 * @param {unknown} value - Unknown job payload; reference-only data is recommended.
 * @param {number} max - Actual serialized UTF-8 byte ceiling.
 * @returns {Record<string,unknown>} Independent JSON snapshot bounded by depth 16 and 8192 visited nodes.
 */
function payload(value: unknown, max: number): Record<string, unknown> {
  let nodes = 0,
    characters = 0;
  /** Current recursive ancestor set detecting cycles without retaining caller objects. */
  const seen = new Set<object>();
  /** Copy one plain JSON node while enforcing recursive node/depth/character admission before serialization.
   * @param {unknown} v - Unknown nested value.
   * @param {number} depth - Current recursive depth, starting at zero.
   * @returns {unknown} Independent primitive/array/plain-object value; unsupported content rejects.
   */
  function visit(v: unknown, depth: number): unknown {
    if (++nodes > 8192 || depth > 16) {
      throw new QueueBackendError('PAYLOAD_LIMIT');
    }
    if (typeof v === 'string') {
      characters += v.length;
      if (characters > max) {
        throw new QueueBackendError('PAYLOAD_LIMIT');
      }
      return v;
    }
    if (v === null || typeof v === 'boolean') {
      return v;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
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
      throw new QueueBackendError('INVALID_PAYLOAD');
    }
    if (
      Object.keys(v).length > 8192 ||
      (Array.isArray(v) &&
        (v.length > 8192 || Object.keys(v).length !== v.length))
    ) {
      throw new QueueBackendError('PAYLOAD_LIMIT');
    }
    seen.add(v);
    /** Independent copied JSON node or root, verified before handing data to native code. */
    const result: any = Array.isArray(v) ? [] : Object.create(null);
    // Traverse only bounded own JSON descriptors or registered owned cleanup callbacks.
    for (const [key, d] of Object.entries(
      Object.getOwnPropertyDescriptors(v)
    )) {
      if (Array.isArray(v) && key === 'length') {
        continue;
      }
      if (
        ['__proto__', 'constructor', 'prototype'].includes(key) ||
        !('value' in d)
      ) {
        throw new QueueBackendError('INVALID_PAYLOAD');
      }
      characters += key.length;
      if (characters > max) {
        throw new QueueBackendError('PAYLOAD_LIMIT');
      }
      result[key] = visit(d.value, depth + 1);
    }
    seen.delete(v);
    return result;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new QueueBackendError('INVALID_PAYLOAD');
  }
  /** Independent copied JSON node or root, verified before handing data to native code. */
  const result = visit(value, 0) as Record<string, unknown>;
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > max) {
    throw new QueueBackendError('PAYLOAD_LIMIT');
  }
  return result;
}
/** Own explicit backend startup, rollback and bounded operations. Close drains actual pending settlement then releases registered resources in reverse order; never replay unknown mutations.
 * @param {QueueSelection & { factory: QueueBackendFactory<any, E> }} selection - Validated trusted backend selection with native package-owned options.
 * @returns {Promise<object>} Owned producer/pull/extension wrapper with idempotent awaited close; no automatic worker loop.
 */
export async function createQueueBackend<E = unknown>(
  selection: QueueSelection & {
    /** Explicit trusted factory; no arbitrary on-disk package discovery. */
    factory: QueueBackendFactory<any, E>;
  }
) {
  validateQueueSelection(selection);
  /** Selected trusted backend identity; native extension access requires this exact object. */
  const factory = selection.factory;
  /** Frozen per-generation native capability snapshot. */
  const caps = Object.freeze({ ...factory.capabilities });
  /** Private copied allowed-queue membership snapshot, not tenant authorization. */
  const queues = new Set(factory.queues);
  /** Per-generation serialized payload ceiling, default 64 KiB. */
  const maxBytes = selection.maxBytes ?? 65536;
  /** Per-generation actual unsettled operation ceiling, default 32. */
  const maxPending = selection.maxPending ?? 32;
  /** Immediately registered resource callbacks, invoked once in reverse acquisition order. */
  const cleanups: (() => void | Promise<void>)[] = [];
  /** Actually unsettled native operation promises; caller timeouts do not free capacity. */
  const pending = new Set<Promise<unknown>>();
  let closed = false,
    closing: Promise<void> | undefined,
    registering = true;
  /** Run all registered cleanup callbacks once while preserving private aggregate failures.
   * @returns {Promise<void>} Drains all callbacks; aggregate cleanup failure is explicit.
   */
  const release = async () => {
    /** Private cleanup failures collected without exposing credential-bearing native messages. */
    const errors: unknown[] = [];
    // Traverse only bounded own JSON descriptors or registered owned cleanup callbacks.
    for (const cleanup of cleanups.reverse().splice(0)) {
      try {
        await cleanup();
      } catch (e) {
        errors.push(e);
      }
    }
    if (errors.length) {
      throw new QueueBackendError('CLOSE_FAILED', new AggregateError(errors));
    }
  };
  let handle: QueueBackendHandle<E>;
  try {
    handle = await factory.open(factory.validate(selection.options), {
      /** Register acquired resources immediately during factory startup only; reverse rollback/close invokes each registration once.
       * @param {function} cleanup - Owned resource cleanup; register before acquiring the next resource.
       * @returns {void} Stores at most 64 cleanup callbacks; invalid/late registration rejects.
       */
      onCleanup(cleanup) {
        if (
          !registering ||
          typeof cleanup !== 'function' ||
          cleanups.length >= 64
        ) {
          throw new QueueBackendError('INVALID_CLEANUP');
        }
        cleanups.push(cleanup);
      },
    });
    registering = false;
    if (
      !handle ||
      typeof handle.publish !== 'function' ||
      (caps.pull && typeof handle.take !== 'function')
    ) {
      throw new QueueBackendError('INVALID_HANDLE');
    }
  } catch (error) {
    registering = false;
    let cause = error;
    try {
      await release();
    } catch (cleanupError) {
      cause = new AggregateError(
        [error, cleanupError],
        'Queue startup and rollback failed'
      );
    }
    throw new QueueBackendError('START_FAILED', cause);
  }
  /** Require an open wrapper and explicitly registered queue before a native operation.
   * @param {string} queue - Common validated queue name within this factory snapshot.
   * @returns {void} No tenant authorization is inferred from queue membership.
   */
  function ensure(queue: string) {
    if (closed) {
      throw new QueueBackendError('CLOSED');
    }
    queueName(queue);
    if (!queues.has(queue)) {
      throw new QueueBackendError('QUEUE_NOT_REGISTERED');
    }
  }
  /** Reserve process-local operation capacity until actual native settlement, preserving fixed public errors and private causes.
   * @param {function} work - One admitted native operation; never automatically retried.
   * @returns {Promise<T>} Original result with bounded actual-pending ownership.
   */
  async function run<T>(work: () => Promise<T>): Promise<T> {
    if (pending.size >= maxPending) {
      throw new QueueBackendError('PENDING_LIMIT');
    }
    /** One admitted native operation promise retained through actual settlement. */
    const job = Promise.resolve().then(work);
    pending.add(job);
    try {
      return await job;
    } catch (error) {
      if (error instanceof QueueBackendError) {
        throw error;
      }
      throw new QueueBackendError('OPERATION_FAILED', error);
    } finally {
      pending.delete(job);
    }
  }
  return {
    name: factory.name,
    capabilities: caps,
    /** Require a declared capability rather than emulating unsupported backend semantics.
     * @param {QueueCapability} capability - Known capability required by trusted host code.
     * @returns {void} Throws when unsupported; a boolean declaration is not live provider certification.
     */
    require(capability: QueueCapability) {
      if (!capabilities.includes(capability) || !caps[capability]) {
        throw new QueueBackendError('UNSUPPORTED_CAPABILITY');
      }
    },
    /** Return native trusted operations only for the exact selected factory object. Extensions bypass neutral payload/operation limits and must not be exposed to clients or closed separately.
     * @param {QueueBackendFactory<O, T>} expected - Exact explicitly registered factory identity.
     * @returns {T} Typed native service; no portability or separate lifecycle ownership implied.
     */
    extension<O, T>(expected: QueueBackendFactory<O, T>): T {
      if (closed) {
        throw new QueueBackendError('CLOSED');
      }
      if (expected !== factory || handle.extension === undefined) {
        throw new QueueBackendError('UNSUPPORTED_EXTENSION');
      }
      return handle.extension as unknown as T;
    },
    /** Validate/snapshot a bounded job and publish once through the explicit backend. Success meaning and unknown disconnect outcomes remain backend-specific.
     * @param {string} queue - Explicit allowed queue.
     * @param {string} name - Common validated task name.
     * @param {Record<string, unknown>} data - Plain bounded reference payload; never raw secrets.
     * @param {QueuePublishOptions} options - Backend-supported delay/attempt policy; even zero/one rejects if unsupported.
     * @returns {Promise<object>} Native optional ID receipt, not an exactly-once business acknowledgement.
     */
    async publish(
      queue: string,
      name: string,
      data: Record<string, unknown>,
      options: QueuePublishOptions = {}
    ) {
      ensure(queue);
      queueName(name);
      queueOptionKeys(options, ['delay', 'attempts']);
      if (options.delay !== undefined) {
        queueInteger(options.delay, 0, 366 * 86400000);
        if (!caps.delay) {
          throw new QueueBackendError('UNSUPPORTED_CAPABILITY');
        }
      }
      if (options.attempts !== undefined) {
        queueInteger(options.attempts, 1, 50);
        if (!caps.retry) {
          throw new QueueBackendError('UNSUPPORTED_CAPABILITY');
        }
      }
      /** Validated independent plain JSON payload snapshot. */
      const copy = payload(data, maxBytes);
      /** Copied native publish options so later caller mutation cannot alter this call. */
      const settings = { ...options };
      return run(() => handle.publish(queue, name, copy, settings));
    },
    /** Pull one delivery only when supported and validate its payload/disposition. Destructive malformed reads may already have lost a message; no implicit reinsertion occurs.
     * @param {string} queue - Explicit registered pull queue.
     * @returns {Promise<QueueDelivery | undefined>} Validated delivery or empty; manual settlement stays bound to the original native channel.
     */
    async take(queue: string): Promise<QueueDelivery | undefined> {
      ensure(queue);
      if (!caps.pull) {
        throw new QueueBackendError('UNSUPPORTED_CAPABILITY');
      }
      return run(async () => {
        /** Original native channel-bound delivery; validation never transfers acknowledgement ownership. */
        const delivery = await handle.take!(queue);
        if (!delivery) {
          return;
        }
        let data: Record<string, unknown>;
        try {
          queueName(delivery.name);
          data = payload(delivery.data, maxBytes);
        } catch (error) {
          if (caps.acknowledgement && typeof delivery.settle === 'function') {
            try {
              await delivery.settle('discard');
            } catch {
              /* Preserve the validation failure privately. */
            }
          }
          throw error;
        }
        if (
          delivery.disposition !==
            (caps.acknowledgement ? 'manual' : 'consumed') ||
          (caps.acknowledgement && typeof delivery.settle !== 'function')
        ) {
          throw new QueueBackendError('INVALID_DELIVERY');
        }
        let settled = false;
        return {
          id: delivery.id,
          name: delivery.name,
          data,
          redelivered: delivery.redelivered,
          disposition: delivery.disposition,
          ...(caps.acknowledgement
            ? {
                /** Settle one original-channel manual delivery at most once locally. Unknown acknowledgement outcomes never move onto another channel or auto-replay.
                 * @param {QueueDisposition} disposition - Explicit ack, discard or requeue; requeue may repeat indefinitely without host poison policy.
                 * @returns {void | Promise<void>} Native settlement outcome; failure after invocation remains uncertain.
                 */
                async settle(disposition: QueueDisposition) {
                  ensure(queue);
                  if (
                    !['ack', 'discard', 'requeue'].includes(disposition) ||
                    settled
                  ) {
                    throw new QueueBackendError('INVALID_DISPOSITION');
                  }
                  await run(async () => {
                    if (settled) {
                      throw new QueueBackendError('INVALID_DISPOSITION');
                    }
                    settled = true;
                    await delivery.settle!(disposition);
                  });
                },
              }
            : {}),
        };
      });
    },
    /** Stop admission, await actual pending calls and execute cleanup once in reverse acquisition order. Signals/deadlines do not force-cancel arbitrary native or JavaScript work.
     * @returns {Promise<void>} Shared close promise; cleanup failures remain explicit with private aggregate causes.
     */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      closing = (async () => {
        await Promise.allSettled([...pending]);
        await release();
      })();
      return closing;
    },
  };
}
