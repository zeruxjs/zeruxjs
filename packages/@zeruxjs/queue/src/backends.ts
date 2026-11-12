import {
  queueOptionKeys,
  queueInteger,
  queueName,
  QueueBackendError,
  type QueueCapabilities,
  type QueueBackendFactory,
} from './neutral.js';
import type {
  QueueServiceConfig,
  createQueueService,
} from '@zeruxjs/queue-bullmq';
/** Conservative unsupported-by-default capability set; each explicit adapter enables only native basics. */
const base: QueueCapabilities = {
  delay: false,
  retry: false,
  acknowledgement: false,
  scheduler: false,
  pull: false,
  push: false,
  publisherConfirms: false,
  destructiveRead: false,
};
/** Validate/snapshot explicit native queue names without granting tenant permissions or discovering backend packages.
 * @param {readonly string[]} queues - One through 100 unique common-subset queue names.
 * @returns {readonly string[]} Frozen independent allowlist preserving configured order.
 */
function allowedQueues(queues: readonly string[]) {
  if (
    !Array.isArray(queues) ||
    !queues.length ||
    queues.length > 100 ||
    new Set(queues).size !== queues.length
  ) {
    throw new QueueBackendError('INVALID_OPTIONS');
  }
  queues.forEach(queueName);
  return Object.freeze([...queues]);
}
/** Require backend native queue configuration to match the exact selected ordered allowlist.
 * @param {unknown} value - Unknown native queue definitions or names.
 * @param {readonly string[]} queues - Validated immutable selected names.
 * @returns {void} Rejects mismatched counts/order/names before native startup.
 */
function sameQueues(value: unknown, queues: readonly string[]) {
  if (
    !Array.isArray(value) ||
    value.length !== queues.length ||
    value.some((q, i) => (typeof q === 'string' ? q : q?.name) !== queues[i])
  ) {
    throw new QueueBackendError('INVALID_OPTIONS');
  }
}
/** Validate only declared optional native integer limits against the owning backend ceilings.
 * @param {Record<string, any>} options - Plain allowed-field native configuration.
 * @param {Record<string, number>} entries - Fixed backend-specific field maxima.
 * @returns {void} No network or resource allocation occurs.
 */
function limits(options: Record<string, any>, entries: Record<string, number>) {
  // Validate only the declared native option vocabulary before allocating resources.
  for (const [key, max] of Object.entries(entries)) {
    if (options[key] !== undefined) {
      queueInteger(options[key], 1, max);
    }
  }
}
/** Validate an optional common prefix as a namespace only, never authentication.
 * @param {Record<string, any>} options - Plain native configuration with an optional prefix.
 * @returns {void} Rejects invalid prefix syntax before backend creation.
 */
function prefix(options: Record<string, any>) {
  if (options.prefix !== undefined) {
    queueName(options.prefix);
  }
}
export interface PullBackend {
  /** Append one explicit plain record through the owning standalone producer contract.
   * @param {string} queue - Configured native queue.
   * @param {string} name - Validated task name.
   * @param {Record<string, unknown>} data - Bounded independent JSON reference payload.
   * @returns {Promise<unknown>} Backend-specific publish receipt; unknown disconnect outcomes are not replay-safe.
   */
  add(
    queue: string,
    name: string,
    data: Record<string, unknown>
  ): Promise<unknown>;
  /** Read one native delivery; RabbitMQ retains original-channel acknowledgement while MemcacheQ reads destructively.
   * @param {string} queue - Explicit allowlisted native queue.
   * @returns {Promise<any>} Native or neutral-shaped delivery/empty result; provider semantics remain distinct.
   */
  take(queue: string): Promise<
    | {
        /** Optional native opaque job identifier; not persistent business idempotency. */
        id?: string;
        /** Native task name, never an executable function or source string. */
        name: string;
        /** Explicit plain reference payload; bodies/secrets stay in host storage. */
        data: Record<string, unknown>;
        /** Optional native broker redelivery hint. */
        redelivered?: boolean;
        /** Acknowledge only the original RabbitMQ channel delivery after committed host work.
         * @returns {void} Native channel-specific acknowledgement; never moved to a replacement channel.
         */
        ack?(): void;
        /** Reject the original RabbitMQ delivery with an explicit host disposition.
         * @param {boolean} requeue - Explicit opt-in to requeue; poison-message loops remain host policy.
         * @returns {void} Native original-channel rejection; no delayed retry is emulated.
         */
        reject?(requeue?: boolean): void;
      }
    | undefined
  >;
  /** Close only resources owned by the injected standalone service.
   * @returns {void | Promise<void>} Native cleanup admission/settlement contract; wrapper also awaits whenClosed if provided.
   */
  close(): void | Promise<void>;
  /** Await actual native closure when the standalone package exposes a separate close barrier.
   * @returns {Promise<void>} Native socket/resource settlement, not just stop-admission.
   */
  whenClosed?(): Promise<void>;
}
/** Adapt an explicitly injected confirmed-producer/manual-pull factory without importing or starting it until open.
 * @param {function} create - Trusted owning-package async factory; options retain its inferred type.
 * @param {readonly string[]} queues - Explicit finite allowlist matching native queue configuration.
 * @returns {QueueBackendFactory<O,B>} Inert typed factory declaring manual ack and broker confirms, without delay/retry/scheduler emulation.
 */
export function rabbitMQBackend<O, B extends PullBackend>(
  create: (options: O) => Promise<B>,
  queues: readonly string[]
): QueueBackendFactory<O, B> {
  /** Frozen validated ordered allowed-queue snapshot for this native factory. */
  const names = allowedQueues(queues);
  return {
    name: 'rabbitmq',
    queues: names,
    capabilities: Object.freeze({
      ...base,
      pull: true,
      acknowledgement: true,
      publisherConfirms: true,
    }),
    /** Validate only the declared backend-native option fields before startup. No package scan, connection or policy fallback is performed.
     * @param {unknown} value - Unknown explicit backend configuration; secret values stay server-only.
     * @returns {unknown} Owning-package configuration; detailed semantic validation also remains native.
     */
    validate(value) {
      queueOptionKeys(value, [
        'url',
        'prefix',
        'timeoutMs',
        'maxBytes',
        'maxPending',
        'prefetch',
        'queues',
      ]);
      sameQueues(value.queues, names);
      prefix(value);
      limits(value, {
        timeoutMs: 120000,
        maxBytes: 1048576,
        maxPending: 1000,
        prefetch: 1000,
      });
      try {
        /** Parsed private AMQP(S) destination; values never enter public errors. */
        const url = new URL(value.url);
        if (!['amqp:', 'amqps:'].includes(url.protocol)) {
          throw 0;
        }
      } catch {
        throw new QueueBackendError('INVALID_OPTIONS');
      }
      return { ...value, queues: [...names] } as O;
    },
    /** Open the explicit trusted native factory and register service cleanup immediately after acquisition.
     * @param {unknown} options - Previously validated native configuration.
     * @param {QueueStartupOwnership} ownership - Startup registrar that owns rollback and managed close.
     * @returns {unknown} Native-backed handle and typed extension; no duplicated ownership or automatic retries.
     */
    async open(options, ownership) {
      /** Owned standalone native service registered immediately for wrapper cleanup. */
      const client = await create(options);
      ownership.onCleanup(() => client.close());
      return {
        extension: client,
        /** Publish exactly once through native add, returning only the optional opaque ID.
         * @param {string} queue - Explicit allowed queue.
         * @param {string} name - Validated task name.
         * @param {Record<string,unknown>} data - Neutral-snapshotted bounded payload.
         * @returns {Promise<object>} Backend-specific optional ID receipt; no business exactly-once guarantee.
         */
        async publish(queue, name, data) {
          /** Optional native publish result; only string IDs become neutral receipts. */
          const id = await client.add(queue, name, data);
          return typeof id === 'string' ? { id } : {};
        },
        /** Read one native delivery; RabbitMQ retains original-channel acknowledgement while MemcacheQ reads destructively.
         * @param {string} queue - Explicit allowlisted native queue.
         * @returns {Promise<any>} Native or neutral-shaped delivery/empty result; provider semantics remain distinct.
         */
        async take(queue) {
          /** Native original-channel delivery or native BullMQ publish result. */
          const job = await client.take(queue);
          if (!job) {
            return;
          }
          if (
            typeof job.ack !== 'function' ||
            typeof job.reject !== 'function'
          ) {
            throw new QueueBackendError('INVALID_DELIVERY');
          }
          return {
            ...job,
            disposition: 'manual',
            /** Map explicit neutral disposition onto the original RabbitMQ delivery only.
             * @param {QueueDisposition} disposition - Explicit ack/discard/requeue chosen by trusted host code.
             * @returns {void} Native original-channel acknowledgement/rejection, not a portable retry policy.
             */
            settle(disposition) {
              if (disposition === 'ack') {
                job.ack!();
              } else {
                job.reject!(disposition === 'requeue');
              }
            },
          };
        },
      };
    },
  };
}
/** Adapt only explicit destructive FIFO basics; never add acknowledgement, automatic reinsertion or crash recovery.
 * @param {function} create - Trusted owning-package synchronous factory; close settlement stays native.
 * @param {readonly string[]} queues - Explicit finite allowed queue names.
 * @returns {QueueBackendFactory<O,B>} Inert destructive-pull factory; acknowledged workflows must reject it.
 */
export function memcacheQBackend<O, B extends PullBackend>(
  create: (options: O) => B,
  queues: readonly string[]
): QueueBackendFactory<O, B> {
  return {
    name: 'memcacheq',
    queues: allowedQueues(queues),
    capabilities: Object.freeze({ ...base, pull: true, destructiveRead: true }),

    /** Validate only the declared backend-native option fields before startup. No package scan, connection or policy fallback is performed.
     * @param {unknown} value - Unknown explicit backend configuration; secret values stay server-only.
     * @returns {unknown} Owning-package configuration; detailed semantic validation also remains native.
     */
    validate(value) {
      queueOptionKeys(value, [
        'host',
        'port',
        'tls',
        'timeoutMs',
        'maxBytes',
        'maxConcurrent',
        'prefix',
        'serverMaxBytes',
        'acceptLegacy',
      ]);
      prefix(value);
      if (
        (value.acceptLegacy !== undefined &&
          typeof value.acceptLegacy !== 'boolean') ||
        (value.maxBytes !== undefined &&
          value.serverMaxBytes !== undefined &&
          value.maxBytes > value.serverMaxBytes)
      ) {
        throw new QueueBackendError('INVALID_OPTIONS');
      }
      limits(value, {
        port: 65535,
        timeoutMs: 120000,
        maxBytes: 65500,
        maxConcurrent: 1000,
        serverMaxBytes: 65500,
      });
      if (
        (value.host !== undefined &&
          (typeof value.host !== 'string' ||
            !value.host.length ||
            value.host.length > 253 ||
            // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
            /[\s\x00-\x1f]/.test(value.host))) ||
        (value.tls !== undefined && typeof value.tls !== 'boolean')
      ) {
        throw new QueueBackendError('INVALID_OPTIONS');
      }
      return { ...value } as O;
    },
    /** Open the explicit trusted native factory and register service cleanup immediately after acquisition.
     * @param {unknown} options - Previously validated native configuration.
     * @param {QueueStartupOwnership} ownership - Startup registrar that owns rollback and managed close.
     * @returns {unknown} Native-backed handle and typed extension; no duplicated ownership or automatic retries.
     */
    open(options, ownership) {
      /** Owned standalone native service registered immediately for wrapper cleanup. */
      const client = create(options);
      ownership.onCleanup(async () => {
        await client.close();
        await client.whenClosed?.();
      });
      return {
        extension: client,
        /** Publish exactly once through native add, returning only the optional opaque ID.
         * @param {string} queue - Explicit allowed queue.
         * @param {string} name - Validated task name.
         * @param {Record<string,unknown>} data - Neutral-snapshotted bounded payload.
         * @returns {Promise<object>} Backend-specific optional ID receipt; no business exactly-once guarantee.
         */
        async publish(queue, name, data) {
          await client.add(queue, name, data);
          return {};
        },
        /** Read one native delivery; RabbitMQ retains original-channel acknowledgement while MemcacheQ reads destructively.
         * @param {string} queue - Explicit allowlisted native queue.
         * @returns {Promise<any>} Native or neutral-shaped delivery/empty result; provider semantics remain distinct.
         */
        async take(queue) {
          /** Native original-channel delivery or native BullMQ publish result. */
          const job = await client.take(queue);
          return job ? { ...job, disposition: 'consumed' } : undefined;
        },
      };
    },
  };
}
type BullMQService = Awaited<ReturnType<typeof createQueueService>>;
/** Adapt native BullMQ publishing while preserving push processors/schedulers on the typed extension. Manual neutral take remains unsupported.
 * @param {readonly string[]} queues - Explicit finite queue allowlist matching native configuration.
 * @param {function} create - Optional trusted injected service factory; otherwise lazily import the fixed BullMQ package.
 * @returns {QueueBackendFactory<QueueServiceConfig,BullMQService>} Inert typed producer factory; owned service close remains native and dashboard options reject.
 */
export function bullMQBackend(
  queues: readonly string[],
  create?: (options: QueueServiceConfig) => Promise<BullMQService>
): QueueBackendFactory<QueueServiceConfig, BullMQService> {
  /** Frozen validated ordered allowed-queue snapshot for this native factory. */
  const names = allowedQueues(queues);
  return {
    name: 'bullmq',
    queues: names,
    capabilities: Object.freeze({
      ...base,
      delay: true,
      retry: true,
      scheduler: true,
      push: true,
    }),
    /** Validate only the declared backend-native option fields before startup. No package scan, connection or policy fallback is performed.
     * @param {unknown} value - Unknown explicit backend configuration; secret values stay server-only.
     * @returns {unknown} Owning-package configuration; detailed semantic validation also remains native.
     */
    validate(value) {
      queueOptionKeys(value, [
        'enabled',
        'redis',
        'prefix',
        'queues',
        'workers',
        'readyTimeoutMs',
        'shutdownGraceMs',
        'onWorkerError',
        'events',
        'administration',
      ]);
      sameQueues(value.queues, names);
      // Validate only the declared native option vocabulary before allocating resources.
      for (const queue of value.queues) {
        if (typeof queue !== 'string') {
          queueOptionKeys(queue, ['name', 'defaultJobOptions']);
          if (queue.defaultJobOptions !== undefined) {
            /** Allowed native default-job options, recursively checked before BullMQ startup. */
            const settings = queue.defaultJobOptions;
            queueOptionKeys(settings, [
              'jobId',
              'delay',
              'priority',
              'attempts',
              'backoff',
              'removeOnComplete',
              'removeOnFail',
              'repeat',
              'deduplication',
            ]);
            if (settings.repeat !== undefined) {
              queueOptionKeys(settings.repeat, [
                'every',
                'pattern',
                'limit',
                'immediately',
              ]);
            }
            if (settings.deduplication !== undefined) {
              queueOptionKeys(settings.deduplication, ['id', 'ttl']);
            }
            if (settings.backoff && typeof settings.backoff === 'object') {
              queueOptionKeys(settings.backoff, ['type', 'delay']);
            }
            // Validate only the declared native option vocabulary before allocating resources.
            for (const k of ['removeOnComplete', 'removeOnFail']) {
              if (settings[k] && typeof settings[k] === 'object') {
                queueOptionKeys(settings[k], ['age', 'count']);
              }
            }
          }
        }
      }
      queueOptionKeys(value.redis, [
        'url',
        'host',
        'port',
        'username',
        'password',
        'db',
        'tls',
        'cluster',
      ]);
      if (value.redis.cluster !== undefined) {
        queueOptionKeys(value.redis.cluster, ['nodes']);
        if (
          !Array.isArray(value.redis.cluster.nodes) ||
          !value.redis.cluster.nodes.length ||
          value.redis.cluster.nodes.length > 100
        ) {
          throw new QueueBackendError('INVALID_OPTIONS');
        }
        // Validate only the declared native option vocabulary before allocating resources.
        for (const node of value.redis.cluster.nodes) {
          queueOptionKeys(node, ['host', 'port']);
        }
      }
      if (value.workers !== undefined) {
        queueOptionKeys(value.workers, names);
        // Validate only the declared native option vocabulary before allocating resources.
        for (const worker of Object.values(value.workers)) {
          queueOptionKeys(worker, [
            'processor',
            'concurrency',
            'autorun',
            'lockDuration',
            'limiter',
          ]);
          if (worker.limiter !== undefined) {
            queueOptionKeys(worker.limiter, ['max', 'duration']);
          }
          if (typeof worker.processor !== 'function') {
            throw new QueueBackendError('INVALID_OPTIONS');
          }
        }
      }
      if (value.events !== undefined) {
        queueOptionKeys(value.events, ['enabled', 'onEvent', 'onError']);
      }
      if (value.administration !== undefined) {
        queueOptionKeys(value.administration, [
          'authorize',
          'onAudit',
          'maxPageSize',
        ]);
      }
      return value as unknown as QueueServiceConfig;
    },
    /** Open the explicit trusted native factory and register service cleanup immediately after acquisition.
     * @param {unknown} options - Previously validated native configuration.
     * @param {QueueStartupOwnership} ownership - Startup registrar that owns rollback and managed close.
     * @returns {unknown} Native-backed handle and typed extension; no duplicated ownership or automatic retries.
     */
    async open(options, ownership) {
      /** Explicit injected service factory or fixed lazy BullMQ factory; no arbitrary package import. */
      const open =
        create ?? (await import('@zeruxjs/queue-bullmq')).createQueueService;
      /** Owned native BullMQ service; processors/schedulers remain its lifecycle responsibility. */
      const service = await open(options);
      ownership.onCleanup(() => service.close());
      return {
        extension: service,
        /** Publish exactly once through native add, returning only the optional opaque ID.
         * @param {string} queue - Explicit allowed queue.
         * @param {string} name - Validated task name.
         * @param {Record<string,unknown>} data - Neutral-snapshotted bounded payload.
         * @param {QueuePublishOptions} settings - Validated native-supported delay/attempt options.
         * @returns {Promise<object>} Backend-specific optional ID receipt; no business exactly-once guarantee.
         */
        async publish(queue, name, data, settings) {
          /** Native original-channel delivery or native BullMQ publish result. */
          const job = await service.queue(queue).add(name, data, settings);
          return { id: job.id };
        },
      };
    },
  };
}
