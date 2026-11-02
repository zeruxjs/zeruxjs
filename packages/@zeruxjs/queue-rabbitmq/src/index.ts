import { connect, type ChannelModel, type ConfirmChannel, type GetMessage } from 'amqplib';
import { randomUUID } from 'node:crypto';
export interface RabbitMQOptions {
  /** Server-only AMQP/AMQPS URL. Never returned in diagnostics. */
  url: string;
  prefix?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxPending?: number;
  prefetch?: number;
  /** Owns this explicit queue allowlist; no dynamic queue declaration from incoming requests. */
  queues: string[];
}
const validName = (name: string) => {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(name)) throw new TypeError('Invalid queue or job name');
  return name;
};
const bounded = (n: number, max: number, name: string) => {
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new RangeError(`Invalid ${name}`);
  return n;
};

/** Create a dedicated confirmed producer and manual-ack consumer channel; owns its connection. */
export async function createRabbitMQ(options: RabbitMQOptions) {
  const parsed = new URL(options.url);
  if (!['amqp:', 'amqps:'].includes(parsed.protocol)) throw new TypeError('AMQP URL required');
  const prefix = validName(options.prefix ?? 'zerux');
  if (!Array.isArray(options.queues) || !options.queues.length || options.queues.length > 100) throw new TypeError('Provide 1–100 queues');
  const queues = new Set(options.queues.map(validName));
  const timeout = bounded(options.timeoutMs ?? 3000, 120000, 'timeoutMs');
  const maxBytes = bounded(options.maxBytes ?? 65536, 1024 * 1024, 'maxBytes');
  const maxPending = bounded(options.maxPending ?? 32, 1000, 'maxPending');
  const prefetch = bounded(options.prefetch ?? 16, 1000, 'prefetch');
  let connection: ChannelModel | undefined, producer: ConfirmChannel | undefined, consumer: Awaited<ReturnType<ChannelModel['createChannel']>> | undefined;
  let closed = false, failed = false, pending = 0, pendingTakes = 0, backpressured = false;
  const outstanding = new Set<GetMessage>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const ensure = () => { if (closed || failed) throw new Error('RabbitMQ service unavailable'); };
  const name = (queue: string) => { ensure(); if (!queues.has(queue)) throw new Error('Queue not configured'); return `${prefix}.${queue}`; };
  const deadline = <T>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { timers.delete(timer); failed = true; void connection?.close().catch(() => undefined); reject(new Error('RabbitMQ deadline exceeded; outcome may be unknown')); }, timeout);
    timers.add(timer);
    promise.then(resolve, reject).finally(() => { clearTimeout(timer); timers.delete(timer); });
  });
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
      // Connection close requeues unacknowledged deliveries. Do not ack pending application work.
      if (connection) await deadline(connection.close());
      outstanding.clear();
    })();
    return closePromise;
  };
  try {
    // The driver enforces the socket handshake deadline; no unowned late connection Promise.
    connection = await connect(options.url, {timeout});
    connection.on('error', () => { failed = true; });
    connection.on('close', () => { failed = true; });
    producer = await deadline(connection.createConfirmChannel());
    producer.on('drain', () => { backpressured = false; });
    producer.on('error', () => { failed = true; });
    producer.on('close', () => { failed = true; });
    consumer = await deadline(connection.createChannel());
    consumer.on('error', () => { failed = true; });
    consumer.on('close', () => { failed = true; });
    await deadline(consumer.prefetch(prefetch));
    for (const queue of queues) await deadline(producer.assertQueue(`${prefix}.${queue}`, {durable: true}));
    return {
      capabilities: Object.freeze({acknowledgement: true, publisherConfirms: true, delay: false, automaticRetry: false}),
      /** Publish persistent JSON and await the broker confirmation. No transparent retry. */
      async add(queue: string, jobName: string, data: Record<string, unknown>): Promise<string> {
        const queueName = name(queue); validName(jobName);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('Job data must be an object');
        const body = Buffer.from(JSON.stringify({name: jobName, data}));
        if (body.length > maxBytes) throw new RangeError('Job exceeds maxBytes');
        if (backpressured || pending >= maxPending) throw new Error('Publisher concurrency limit exceeded');
        pending++;
        const id = randomUUID();
        try {
          await deadline(new Promise<void>((resolve, reject) => {
            const writable = producer!.sendToQueue(queueName, body, {persistent: true, contentType: 'application/json', messageId: id}, error => error ? reject(new Error('Publish confirmation failed; outcome may be unknown')) : resolve());
            if (!writable) backpressured = true;
          }));
          return id;
        } finally { pending--; }
      },
      /** Pull a message with explicit disposition. Call ack after durable processing, or reject. */
      async take(queue: string) {
        const queueName = name(queue);
        // Reserve before await so simultaneous takes cannot exceed prefetch.
        if (outstanding.size + pendingTakes >= prefetch) throw new Error('Unacknowledged delivery limit exceeded');
        pendingTakes++;
        let message: GetMessage | false;
        try { message = await deadline(consumer!.get(queueName, {noAck: false})); }
        finally { pendingTakes--; }
        if (!message) return undefined;
        outstanding.add(message);
        let envelope: {name: string; data: Record<string, unknown>};
        try {
          if (message.content.length > maxBytes) throw new Error('Oversized message');
          envelope = JSON.parse(message.content.toString('utf8'));
          validName(envelope.name);
          if (!envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) throw new Error('Invalid job data');
        } catch {
          consumer!.nack(message, false, false); outstanding.delete(message);
          throw new Error('Invalid job rejected without requeue');
        }
        const disposition = (requeue?: boolean) => {
          ensure();
          if (!outstanding.has(message)) throw new Error('Message already disposed');
          if (requeue === undefined) consumer!.ack(message); else consumer!.nack(message, false, requeue);
          outstanding.delete(message);
        };
        return {id: message.properties.messageId as string | undefined, ...envelope,
          redelivered: message.fields.redelivered, ack: () => disposition(), reject: (requeue = false) => disposition(requeue)};
      },
      close
    };
  } catch (error) {
    try { await close(); } catch { /* preserve startup failure */ }
    throw new Error('RabbitMQ startup failed', {cause: error});
  }
}

export * from './worker.js';
