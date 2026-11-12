import {
  connect,
  type ChannelModel,
  type ConfirmChannel,
  type GetMessage,
} from 'amqplib';
import { randomUUID } from 'node:crypto';
export interface RabbitMQOptions {
  /** Server-only AMQP/AMQPS URL. Never returned in diagnostics. */
  url: string;
  /** Conservative queue namespace, default zerux; not tenant authorization. */
  prefix?: string;
  /** Default 3000ms, allowed 1–120000; expiration fails this service because native outcome may be unknown. */
  timeoutMs?: number;
  /** Default 65536, allowed 1–1048576 serialized envelope bytes. */
  maxBytes?: number;
  /** Default 32, allowed 1–1000 outstanding publisher confirmations. */
  maxPending?: number;
  /** Default 16, allowed 1–1000 outstanding deliveries plus local reservations. */
  prefetch?: number;
  /** Owns this explicit queue allowlist; no dynamic queue declaration from incoming requests. */
  queues: string[];
}
/** Validate the conservative logical queue/job/prefix grammar; permission remains host-owned.
 * @param {string} name - Validated queue/job/prefix or fixed diagnostic option label.
 * @returns {string} Explicit validated/native result; transport failure can leave outcome unknown.
 */
const validName = (name: string) => {
  if (
    typeof name !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(name)
  ) {
    throw new TypeError('Invalid queue or job name');
  }
  return name;
};
/** Require finite positive safe integer configuration within its declared hard ceiling.
 * @param {number} n - Untrusted positive integer configuration.
 * @param {number} max - Inclusive hard integer ceiling.
 * @param {string} name - Validated queue/job/prefix or fixed diagnostic option label.
 * @returns {number} Explicit validated/native result; transport failure can leave outcome unknown.
 */
const bounded = (n: number, max: number, name: string) => {
  if (!Number.isSafeInteger(n) || n < 1 || n > max) {
    throw new RangeError(`Invalid ${name}`);
  }
  return n;
};

/** Own one confirmed producer and one manual-ack pull channel on a dedicated connection. Startup rollback closes acquired resources; this legacy client neither supervises reconnect nor drains application handlers.
 * @param {RabbitMQOptions} options - Explicit private AMQP destination, finite limits and queue allowlist; host owns tenant permissions.
 * @returns {Promise<object>} Owned basic service; retain close and never treat publisher confirms as consumer completion.
 */
export async function createRabbitMQ(options: RabbitMQOptions) {
  /** Private parsed connection URL used only to validate the AMQP scheme. */
  const parsed = new URL(options.url);
  if (!['amqp:', 'amqps:'].includes(parsed.protocol)) {
    throw new TypeError('AMQP URL required');
  }
  /** Validated physical queue namespace, default zerux; not a security boundary. */
  const prefix = validName(options.prefix ?? 'zerux');
  if (
    !Array.isArray(options.queues) ||
    !options.queues.length ||
    options.queues.length > 100
  ) {
    throw new TypeError('Provide 1–100 queues');
  }
  /** Explicit logical allowlist; no incoming message may declare additional queues. */
  const queues = new Set(options.queues.map(validName));
  /** Validated operation/handshake deadline, default 3000ms. */
  const timeout = bounded(options.timeoutMs ?? 3000, 120000, 'timeoutMs');
  /** Validated serialized envelope budget, default 64 KiB. */
  const maxBytes = bounded(options.maxBytes ?? 65536, 1024 * 1024, 'maxBytes');
  /** Validated finite confirmation ceiling, default 32. */
  const maxPending = bounded(options.maxPending ?? 32, 1000, 'maxPending');
  /** Validated local outstanding-delivery/reservation ceiling, default 16. */
  const prefetch = bounded(options.prefetch ?? 16, 1000, 'prefetch');
  let connection: ChannelModel | undefined,
    producer: ConfirmChannel | undefined,
    consumer: Awaited<ReturnType<ChannelModel['createChannel']>> | undefined;
  let closed = false,
    failed = false,
    pending = 0,
    pendingTakes = 0,
    backpressured = false;
  /** Original-channel delivery handles retained until one disposition or connection close. */
  const outstanding = new Set<GetMessage>();
  /** Owned operation deadlines removed when the corresponding native promise settles. */
  const timers = new Set<ReturnType<typeof setTimeout>>();
  /** Reject operations after close or native failure without reconnecting.
   * @returns {void} Explicit validated/native result; transport failure can leave outcome unknown.
   */
  const ensure = () => {
    if (closed || failed) {
      throw new Error('RabbitMQ service unavailable');
    }
  };
  /** Resolve only configured logical queues into the fixed physical namespace.
   * @param {string} queue - Configured logical queue authorized by the host.
   * @returns {string} Explicit validated/native result; transport failure can leave outcome unknown.
   */
  const name = (queue: string) => {
    ensure();
    if (!queues.has(queue)) {
      throw new Error('Queue not configured');
    }
    return `${prefix}.${queue}`;
  };
  /** Bound caller waiting and retire the connection on timeout; a deadline does not cancel arbitrary native work or prove rollback.
   * @param {Promise<T>} promise - Already-started native promise; settlement retains its native ownership.
   * @returns {Promise<T>} Explicit validated/native result; transport failure can leave outcome unknown.
   */
  const deadline = <T>(promise: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      /** Owned absolute operation timer; clear it when native work settles. */
      const timer = setTimeout(() => {
        timers.delete(timer);
        failed = true;
        void connection?.close().catch(() => undefined);
        reject(new Error('RabbitMQ deadline exceeded; outcome may be unknown'));
      }, timeout);
      timers.add(timer);
      promise.then(resolve, reject).finally(() => {
        clearTimeout(timer);
        timers.delete(timer);
      });
    });
  let closePromise: Promise<void> | undefined;
  /** Idempotent connection shutdown; do not ack pending application work during cleanup.
   * @returns {Promise<void>} Explicit validated/native result; transport failure can leave outcome unknown.
   */
  const close = (): Promise<void> => {
    if (closePromise) {
      return closePromise;
    }
    closed = true;
    closePromise = (async () => {
      // Connection close requeues unacknowledged deliveries. Do not ack pending application work.
      if (connection) {
        await deadline(connection.close());
      }
      outstanding.clear();
    })();
    return closePromise;
  };
  try {
    // The driver enforces the socket handshake deadline; no unowned late connection Promise.
    connection = await connect(options.url, { timeout });
    connection.on('error', () => {
      failed = true;
    });
    connection.on('close', () => {
      failed = true;
    });
    producer = await deadline(connection.createConfirmChannel());
    producer.on('drain', () => {
      backpressured = false;
    });
    producer.on('error', () => {
      failed = true;
    });
    producer.on('close', () => {
      failed = true;
    });
    consumer = await deadline(connection.createChannel());
    consumer.on('error', () => {
      failed = true;
    });
    consumer.on('close', () => {
      failed = true;
    });
    await deadline(consumer.prefetch(prefetch));
    // Declare only the finite explicit queue allowlist; no request-driven topology.
    for (const queue of queues) {
      await deadline(
        producer.assertQueue(`${prefix}.${queue}`, { durable: true })
      );
    }
    return {
      capabilities: Object.freeze({
        acknowledgement: true,
        publisherConfirms: true,
        delay: false,
        automaticRetry: false,
      }),
      /** Publish one persistent bounded JSON envelope and wait for confirmation without transparent retry. An interrupted/failed confirmation can have an unknown outcome; host side effects require durable idempotency.
       * @param {string} queue - Explicit configured logical queue, never a dynamic declaration.
       * @param {string} jobName - Validated opaque job name, not executable code.
       * @param {Record<string, unknown>} data - Host-provided object serialized by the legacy producer; keep secrets out and use trusted plain data.
       * @returns {Promise<string>} Generated message ID after confirmation, not proof of delivery/processing.
       */
      async add(
        queue: string,
        jobName: string,
        data: Record<string, unknown>
      ): Promise<string> {
        /** Allowlisted physical destination, not caller-provided topology or a URL. */
        const queueName = name(queue);
        validName(jobName);
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new TypeError('Job data must be an object');
        }
        /** Serialized finite private envelope; queue payloads should remain opaque references. */
        const body = Buffer.from(JSON.stringify({ name: jobName, data }));
        if (body.length > maxBytes) {
          throw new RangeError('Job exceeds maxBytes');
        }
        if (backpressured || pending >= maxPending) {
          throw new Error('Publisher concurrency limit exceeded');
        }
        pending++;
        /** Generated native message reference; not an exactly-once side-effect key. */
        const id = randomUUID();
        try {
          await deadline(
            new Promise<void>((resolve, reject) => {
              /** Native buffer acceptance; false pauses new publishing until drain. */
              const writable = producer!.sendToQueue(
                queueName,
                body,
                {
                  persistent: true,
                  contentType: 'application/json',
                  messageId: id,
                },
                (error) =>
                  error
                    ? reject(
                        new Error(
                          'Publish confirmation failed; outcome may be unknown'
                        )
                      )
                    : resolve()
              );
              if (!writable) {
                backpressured = true;
              }
            })
          );
          return id;
        } finally {
          pending--;
        }
      },
      /** Reserve local prefetch capacity before awaiting a destructive broker delivery with manual acknowledgement. Ack/reject once using its original consumer channel; malformed envelopes are rejected without requeue.
       * @param {string} queue - Configured logical queue whose access the host authorizes independently.
       * @returns {Promise<object|undefined>} Private delivery with ack/reject handles, or undefined for an empty queue; no automatic replay.
       */
      async take(queue: string) {
        /** Allowlisted physical destination, not caller-provided topology or a URL. */
        const queueName = name(queue);
        // Reserve before await so simultaneous takes cannot exceed prefetch.
        if (outstanding.size + pendingTakes >= prefetch) {
          throw new Error('Unacknowledged delivery limit exceeded');
        }
        pendingTakes++;
        let message: GetMessage | false;
        try {
          message = await deadline(consumer!.get(queueName, { noAck: false }));
        } finally {
          pendingTakes--;
        }
        if (!message) {
          return undefined;
        }
        outstanding.add(message);
        let envelope: {
          /** Validated job name decoded from a private delivery; not executable source. */
          name: string; /** Private deserialized object; host owns business validation, tenant checks and safe handling. */
          data: Record<string, unknown>;
        };
        try {
          if (message.content.length > maxBytes) {
            throw new Error('Oversized message');
          }
          envelope = JSON.parse(message.content.toString('utf8'));
          validName(envelope.name);
          if (
            !envelope.data ||
            typeof envelope.data !== 'object' ||
            Array.isArray(envelope.data)
          ) {
            throw new Error('Invalid job data');
          }
        } catch {
          consumer!.nack(message, false, false);
          outstanding.delete(message);
          throw new Error('Invalid job rejected without requeue');
        }
        /** One-shot original-channel ack/nack guard; explicit requeue can loop without host attempt policy.
         * @param {boolean} requeue - Undefined acknowledges; false discards/dead-letters; true explicitly requeues and may loop.
         * @returns {void} Explicit validated/native result; transport failure can leave outcome unknown.
         */
        const disposition = (requeue?: boolean) => {
          ensure();
          if (!outstanding.has(message)) {
            throw new Error('Message already disposed');
          }
          if (requeue === undefined) {
            consumer!.ack(message);
          } else {
            consumer!.nack(message, false, requeue);
          }
          outstanding.delete(message);
        };
        return {
          id: message.properties.messageId as string | undefined,
          ...envelope,
          redelivered: message.fields.redelivered,
          ack: () => disposition(),
          reject: (requeue = false) => disposition(requeue),
        };
      },
      close,
    };
  } catch (error) {
    try {
      await close();
    } catch {
      /* preserve startup failure */
    }
    throw new Error('RabbitMQ startup failed', { cause: error });
  }
}

export * from './worker.js';
