import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRabbitMQWorker } from '@zeruxjs/queue-rabbitmq/worker';
/** Assert fixed redacted failure categories without exposing the injected secret cause.
 * @param {unknown} code - Explicit injected callback/configuration or fixed expected error code.
 * @returns {function} Synthetic fixture result; never a live broker acceptance claim.
 */
const error = (code) => (e) => e.code === code && !e.message.includes('SECRET');
/** Yield one fixture event-loop turn without opening a broker connection.
 * @returns {Promise<void>} Synthetic fixture result; never a live broker acceptance claim.
 */
const tick = () => new Promise((resolve) => setImmediate(resolve));
/** Wait for a bounded injected condition with at most 100 short polls; never infer live broker acceptance.
 * @param {unknown} check - Explicit synthetic native argument/value, never private live data.
 * @returns {Promise<void>} Explicit fixture result or intentional test failure.
 */
async function until(check) {
  // Inspect only finite synthetic outcomes/handles or the explicit polling ceiling.
  for (let i = 0; i < 100; i++) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw Error('fixture condition not reached');
}
/** Create fresh amqplib-shaped owned resources and fixed synthetic outcomes without opening sockets.
 * @returns {object} Explicit fixture result or intentional test failure.
 */
function fixture() {
  /** Fresh injected native connection owners; never borrowed live connections. */
  const connections = [];
  /** Synthetic native-operation ordering log; no real broker acceptance is claimed. */
  const log = [];
  let mode = 'confirm',
    backpressure = false;
  /** Injected native driver double; not a live RabbitMQ server or crash-recovery qualification.
   */
  class Producer extends EventEmitter {
    /** Construct one synthetic native resource and retain only finite fixture state.
     * @param {unknown} id - Explicit synthetic native argument/value, never private live data.
     */
    constructor(id) {
      super();
      this.id = id;
      this.published = [];
      this.topology = [];
    }
    /** Capture explicit broker topology for assertions without declaring real queues.
     * @param {unknown} name - Explicit synthetic native argument/value, never private live data.
     * @param {unknown} options - Explicit synthetic native argument/value, never private live data.
     * @returns {Promise<void>} Explicit fixture result or intentional test failure.
     */
    async assertQueue(name, options) {
      this.topology.push({ name, options });
    }
    /** Capture one injected mandatory publication and exercise return/nack/confirmation/backpressure callbacks.
     * @param {unknown} queue - Explicit synthetic native argument/value, never private live data.
     * @param {unknown} body - Explicit synthetic native argument/value, never private live data.
     * @param {unknown} options - Explicit synthetic native argument/value, never private live data.
     * @param {unknown} callback - Explicit synthetic native argument/value, never private live data.
     * @returns {boolean} Explicit fixture result or intentional test failure.
     */
    sendToQueue(queue, body, options, callback) {
      /** Captured finite native publication and callback used to exercise confirmation outcomes. */
      const publish = { queue, body, options, callback };
      this.published.push(publish);
      log.push(['publish', this.id, queue]);
      if (mode === 'return') {
        this.emit('return', { properties: { headers: options.headers } });
        queueMicrotask(() => callback(null));
      } else if (mode === 'nack') {
        queueMicrotask(() => callback(Error('message nacked')));
      } else if (mode === 'confirm') {
        queueMicrotask(() => callback(null));
      }
      return !backpressure;
    }
    /** Expose synthetic native close and ordering; no real socket/cluster behavior is certified.
     * @returns {Promise<void>} Explicit fixture result or intentional test failure.
     */
    async close() {
      log.push(['producer-close', this.id]);
      this.emit('close');
    }
  }
  /** Injected native driver double; not a live RabbitMQ server or crash-recovery qualification.
   */
  class Consumer extends EventEmitter {
    /** Construct one synthetic native resource and retain only finite fixture state.
     * @param {unknown} id - Explicit synthetic native argument/value, never private live data.
     */
    constructor(id) {
      super();
      this.id = id;
      this.handlers = new Map();
      this.dispositions = [];
      this.credits = [];
    }
    /** Capture per-consumer credit and global flag for bounded ownership assertions.
     * @param {unknown} n - Explicit synthetic native argument/value, never private live data.
     * @param {unknown} global - Explicit synthetic native argument/value, never private live data.
     * @returns {Promise<void>} Explicit fixture result or intentional test failure.
     */
    async prefetch(n, global) {
      this.credits.push([n, global]);
    }
    /** Register the trusted fixture delivery callback on its original channel.
     * @param {unknown} queue - Explicit synthetic native argument/value, never private live data.
     * @param {unknown} handler - Explicit synthetic native argument/value, never private live data.
     * @returns {Promise<{consumerTag:string}>} Explicit fixture result or intentional test failure.
     */
    async consume(queue, handler) {
      this.handlers.set(queue, handler);
      return { consumerTag: queue };
    }
    /** Capture cancellation of the original native consumer tag.
     * @param {unknown} tag - Explicit synthetic native argument/value, never private live data.
     * @returns {Promise<void>} Explicit fixture result or intentional test failure.
     */
    async cancel(tag) {
      log.push(['cancel', this.id, tag]);
    }
    /** Record one original-channel acknowledgement after handler work settles.
     * @param {unknown} message - Explicit synthetic native argument/value, never private live data.
     * @returns {void} Explicit fixture result or intentional test failure.
     */
    ack(message) {
      this.dispositions.push(['ack', message]);
      log.push(['ack', this.id]);
    }
    /** Assert nonrequeue dead-letter disposition on the original delivery channel.
     * @param {unknown} message - Explicit synthetic native argument/value, never private live data.
     * @param {unknown} all - Explicit synthetic native argument/value, never private live data.
     * @param {unknown} requeue - Explicit synthetic native argument/value, never private live data.
     * @returns {void} Explicit fixture result or intentional test failure.
     */
    nack(message, all, requeue) {
      assert.equal(all, false);
      assert.equal(requeue, false);
      this.dispositions.push(['dead', message]);
      log.push(['dead', this.id]);
    }
    /** Expose synthetic native close and ordering; no real socket/cluster behavior is certified.
     * @returns {Promise<void>} Explicit fixture result or intentional test failure.
     */
    async close() {
      log.push(['consumer-close', this.id]);
      this.emit('close');
    }
  }
  /** Injected native driver double; not a live RabbitMQ server or crash-recovery qualification.
   */
  class Connection extends EventEmitter {
    /** Construct one synthetic native resource and retain only finite fixture state.
     */
    constructor() {
      super();
      this.connection = {
        serverProperties: { product: 'RabbitMQ', version: '4.1.4' },
      };
      this.id = connections.length + 1;
      this.producer = new Producer(this.id);
      this.consumer = new Consumer(this.id);
      connections.push(this);
    }
    /** Return this exact fixture generation producer; late acquisition overrides remain owned.
     * @returns {Promise<object>} Explicit fixture result or intentional test failure.
     */
    async createConfirmChannel() {
      return this.producer;
    }
    /** Return this exact fixture generation consumer; never transfer acknowledgement handles.
     * @returns {Promise<object>} Explicit fixture result or intentional test failure.
     */
    async createChannel() {
      return this.consumer;
    }
    /** Expose synthetic native close and ordering; no real socket/cluster behavior is certified.
     * @returns {Promise<void>} Explicit fixture result or intentional test failure.
     */
    async close() {
      log.push(['connection-close', this.id]);
      this.emit('close');
    }
  }
  return {
    connections,
    log,
    connector: async () => new Connection(),
    /** Choose the finite synthetic producer outcome for this isolated fixture.
     * @param {unknown} value - Explicit synthetic native argument/value, never private live data.
     * @returns {void} Explicit fixture result or intentional test failure.
     */
    set mode(value) {
      mode = value;
    },
    /** Toggle synthetic native buffer pressure without changing broker-blocked state.
     * @param {unknown} value - Explicit synthetic native argument/value, never private live data.
     * @returns {void} Explicit fixture result or intentional test failure.
     */
    set backpressure(value) {
      backpressure = value;
    },
  };
}
/** Private synthetic destination and tiny finite test supervision budgets.
 * @param {unknown} handler - Explicit injected callback/configuration or fixed expected error code.
 * @returns {object} Synthetic fixture result; never a live broker acceptance claim.
 */
const options = (handler) => ({
  url: 'amqp://user:SECRET@localhost',
  prefix: 'test',
  queues: [{ name: 'jobs', type: 'quorum', ...(handler ? { handler } : {}) }],
  timeoutMs: 30,
  drainMs: 30,
  reconnect: { maxAttempts: 2, delayMs: 1 },
});
/** Build an inert synthetic envelope with explicit attempt/redelivery facts.
 * @param {number} attempt - Explicit synthetic native argument/value, never private live data.
 * @param {number} count - Explicit synthetic native argument/value, never private live data.
 * @returns {object} Explicit fixture result or intentional test failure.
 */
function message(attempt = 1, count = 0) {
  return {
    content: Buffer.from(
      JSON.stringify({ name: 'send', data: { recordId: 'one' } })
    ),
    properties: {
      contentType: 'application/json',
      messageId: 'message-one',
      headers: { 'x-zerux-attempt': attempt, 'x-delivery-count': count },
    },
    fields: { redelivered: count > 0 },
  };
}
/** Invoke only the registered fixture consumer callback on the selected original generation.
 * @param {unknown} f - Explicit synthetic native argument/value, never private live data.
 * @param {unknown} messageValue - Explicit synthetic native argument/value, never private live data.
 * @param {number} index - Explicit synthetic native argument/value, never private live data.
 * @returns {void} Explicit fixture result or intentional test failure.
 */
function deliver(f, messageValue, index = 0) {
  f.connections[index].consumer.handlers.get('test.jobs')(messageValue);
}
test('mandatory publish, returned routing, broker nack and drain backpressure never auto-replay', async (t) => {
  /** Fresh injected driver fixture, with no external broker connection. */
  const f = fixture();
  /** Owned supervised worker; bounded close and actual settlement are checked independently. */
  const service = await createRabbitMQWorker(options(), f.connector);
  // Release held fixture work even if an intermediate assertion fails.
  t.after(async () => {
    await service.close();
    await until(
      () =>
        service.status().pendingHandlers === 0 &&
        service.status().pendingNative === 0
    );
  });
  try {
    assert.equal(service.capabilities.publisherConfirms, true);
    await service.add('jobs', 'send', { recordId: 'one' });
    assert.equal(
      f.connections[0].producer.published[0].options.mandatory,
      true
    );
    f.mode = 'return';
    await assert.rejects(service.add('jobs', 'send', {}), error('UNROUTABLE'));
    assert.equal(service.status().returnedPublishes, 1);
    assert.equal(service.status().state, 'ready');
    f.mode = 'nack';
    await assert.rejects(
      service.add('jobs', 'send', {}),
      error('PUBLISH_NACK')
    );
    f.mode = 'confirm';
    f.backpressure = true;
    await service.add('jobs', 'send', {});
    await assert.rejects(
      service.add('jobs', 'send', {}),
      error('PUBLISH_BACKPRESSURE')
    );
    f.backpressure = false;
    f.connections[0].producer.emit('drain');
    await service.add('jobs', 'send', {});
    await assert.rejects(
      service.add('other', 'send', {}),
      error('QUEUE_NOT_CONFIGURED')
    );
    await assert.rejects(
      service.add('jobs', 'send', {
        /** Represent forbidden executable input; validation must reject without invoking it.
         * @returns {void} Explicit fixture result or intentional test failure.
         */
        fn() {},
      }),
      error('INVALID_PAYLOAD')
    );
  } finally {
    await service.close();
  }
  assert.equal(service.status().state, 'closed');
  assert.equal(service.status().pendingNative, 0);
});
test('declared topology uses broker TTL, per-consumer credits, finite attempt headers and dead-letter nack', async (t) => {
  /** Fresh injected driver fixture, with no external broker connection. */
  const f = fixture();
  let calls = 0;
  /** Owned supervised worker; bounded close and actual settlement are checked independently. */
  const service = await createRabbitMQWorker(
    options(async () => {
      calls++;
      return 'retry';
    }),
    f.connector
  );
  // Release held fixture work even if an intermediate assertion fails.
  t.after(async () => {
    await service.close();
    await until(
      () =>
        service.status().pendingHandlers === 0 &&
        service.status().pendingNative === 0
    );
  });
  try {
    /** Exact injected generation confirm channel; never reused by another generation. */
    const producer = f.connections[0].producer;
    /** Exact original delivery channel whose acknowledgements are recorded. */
    const consumer = f.connections[0].consumer;
    assert.deepEqual(consumer.credits, [[16, false]]);
    /** Declared broker-TTL retry topology observed in the injected channel. */
    const retry = producer.topology.find((t) => t.name === 'test.jobs.retry');
    assert.equal(retry.options.arguments['x-message-ttl'], 1000);
    assert.equal(
      retry.options.arguments['x-dead-letter-routing-key'],
      'test.jobs'
    );
    assert.equal(
      producer.topology.find((t) => t.name === 'test.jobs').options.arguments[
        'x-delivery-limit'
      ],
      3
    );
    deliver(f, message());
    await until(() => consumer.dispositions.length === 1);
    assert.equal(producer.published[0].queue, 'test.jobs.retry');
    assert.equal(producer.published[0].options.headers['x-zerux-attempt'], 2);
    assert.equal(consumer.dispositions[0][0], 'ack');
    deliver(f, message(3));
    await until(() => consumer.dispositions.length === 2);
    assert.equal(consumer.dispositions[1][0], 'dead');
    assert.equal(producer.published.length, 1);
    deliver(f, message(1, 3));
    await until(() => consumer.dispositions.length === 3);
    assert.equal(calls, 2);
    /** Synthetic malformed envelope; it must never reach the trusted handler. */
    const invalid = message();
    invalid.properties.headers['x-zerux-attempt'] = -1;
    deliver(f, invalid);
    await until(() => consumer.dispositions.length === 4);
    assert.equal(calls, 2);
  } finally {
    await service.close();
  }
});
test('graceful close cancels consumption, drains handler ack on original channel, then closes resources once', async (t) => {
  /** Fresh injected driver fixture, with no external broker connection. */
  const f = fixture();
  let finish;
  /** Owned supervised worker; bounded close and actual settlement are checked independently. */
  const service = await createRabbitMQWorker(
    options(() => new Promise((resolve) => (finish = resolve))),
    f.connector
  );
  // Release held fixture work even if an intermediate assertion fails.
  t.after(async () => {
    finish?.('ack');
    await service.close();
    await until(
      () =>
        service.status().pendingHandlers === 0 &&
        service.status().pendingNative === 0
    );
  });
  deliver(f, message());
  await until(() => finish);
  /** Bounded close promise observed before releasing held synthetic callback work. */
  const closing = service.close();
  await tick();
  assert.equal(service.status().state, 'closing');
  assert.ok(f.log.some((e) => e[0] === 'cancel'));
  assert.equal(f.connections[0].consumer.dispositions.length, 0);
  finish('ack');
  await closing;
  await service.close();
  assert.equal(f.connections[0].consumer.dispositions[0][0], 'ack');
  assert.ok(
    f.log.findIndex((e) => e[0] === 'ack') <
      f.log.findIndex((e) => e[0] === 'consumer-close')
  );
  assert.equal(f.log.filter((e) => e[0] === 'connection-close').length, 1);
});
test('disconnect fences old ack and waits for actual callback settlement before replacing channels', async (t) => {
  /** Fresh injected driver fixture, with no external broker connection. */
  const f = fixture();
  let finish,
    signal,
    calls = 0;
  /** Owned supervised worker; bounded close and actual settlement are checked independently. */
  const service = await createRabbitMQWorker(
    options((job) => {
      calls++;
      signal = job.signal;
      return calls === 1 ? new Promise((resolve) => (finish = resolve)) : 'ack';
    }),
    f.connector
  );
  // Release held fixture work even if an intermediate assertion fails.
  t.after(async () => {
    finish?.('ack');
    await service.close();
    await until(
      () =>
        service.status().pendingHandlers === 0 &&
        service.status().pendingNative === 0
    );
  });
  try {
    deliver(f, message());
    await until(() => finish);
    f.connections[0].emit('close');
    await tick();
    assert.equal(signal.aborted, true);
    assert.equal(f.connections.length, 1);
    finish('ack');
    await until(
      () => f.connections.length === 2 && service.status().state === 'ready'
    );
    assert.equal(f.connections[0].consumer.dispositions.length, 0);
    deliver(f, message(1, 1), 1);
    await until(() => f.connections[1].consumer.dispositions.length === 1);
    assert.equal(f.connections[1].consumer.dispositions[0][0], 'ack');
    assert.equal(calls, 2);
  } finally {
    await service.close();
  }
});
test('unknown confirmation is rejected once, never replayed; reconnect budget is finite', async (t) => {
  /** Fresh injected driver fixture, with no external broker connection. */
  const f = fixture();
  /** Fresh finite synthetic worker policy; mutations affect only this test fixture. */
  const settings = options();
  settings.timeoutMs = 5;
  settings.reconnect.maxAttempts = 1;
  /** Owned supervised worker; bounded close and actual settlement are checked independently. */
  const service = await createRabbitMQWorker(settings, f.connector);
  // Release held fixture work even if an intermediate assertion fails.
  t.after(async () => {
    await service.close();
    await until(
      () =>
        service.status().pendingHandlers === 0 &&
        service.status().pendingNative === 0
    );
  });
  try {
    f.mode = 'hold';
    await assert.rejects(
      service.add('jobs', 'send', {}),
      error('PUBLISH_OUTCOME_UNKNOWN')
    );
    await until(
      () => f.connections.length === 2 && service.status().state === 'ready'
    );
    assert.equal(f.connections[0].producer.published.length, 1);
    assert.equal(f.connections[1].producer.published.length, 0);
    assert.equal(service.status().unknownPublishes, 1);
    f.connections[1].emit('close');
    await until(() => service.status().state === 'failed');
    assert.equal(f.connections.length, 2);
    await assert.rejects(service.add('jobs', 'send', {}), error('UNAVAILABLE'));
  } finally {
    await service.close();
  }
});
test('bad topology/config and dependency startup failure are redacted; acquired channels are closed', async () => {
  /** Fresh injected driver fixture, with no external broker connection. */
  const f = fixture();
  // Inspect only finite synthetic outcomes/handles or the explicit polling ceiling.
  for (const settings of [
    {
      ...options(),
      queues: [{ name: 'jobs', type: 'classic', handler: async () => 'ack' }],
    },
    {
      ...options(),
      queues: [
        { name: 'jobs', type: 'quorum' },
        { name: 'jobs.retry', type: 'classic' },
      ],
    },
    { ...options(), unknown: 'SECRET' },
    { ...options(), reconnect: { maxAttempts: 100, delayMs: 1 } },
  ]) {
    await assert.rejects(
      createRabbitMQWorker(settings, f.connector),
      (e) => !e.message.includes('SECRET')
    );
  }
  assert.equal(f.connections.length, 0);
  await assert.rejects(
    createRabbitMQWorker(options(), async () => {
      throw Error('SECRET connection string');
    }),
    error('START_FAILED')
  );
  /** Trusted fixture connector returning fresh service-owned injected resources.
   * @returns {Promise<unknown>} Synthetic fixture result; never a live broker acceptance claim.
   */
  const connector = async () => {
    /** Fresh owned injected native connection for this one acquisition attempt. */
    const connection = await f.connector();
    connection.producer.assertQueue = async () => {
      throw Error('broker topology denied SECRET');
    };
    return connection;
  };
  await assert.rejects(
    createRabbitMQWorker(options(), connector),
    error('START_FAILED')
  );
  assert.equal(f.log.filter((e) => e[0] === 'connection-close').length, 1);
});
test('drain deadline aborts cooperative signal and reports incomplete until the callback actually settles', async (t) => {
  /** Fresh injected driver fixture, with no external broker connection. */
  const f = fixture();
  let finish, signal;
  /** Fresh finite synthetic worker policy; mutations affect only this test fixture. */
  const settings = options((job) => {
    signal = job.signal;
    return new Promise((resolve) => (finish = resolve));
  });
  settings.timeoutMs = 5;
  settings.drainMs = 5;
  /** Owned supervised worker; bounded close and actual settlement are checked independently. */
  const service = await createRabbitMQWorker(settings, f.connector);
  // Release held fixture work even if an intermediate assertion fails.
  t.after(async () => {
    finish?.('ack');
    await service.close();
    await until(
      () =>
        service.status().pendingHandlers === 0 &&
        service.status().pendingNative === 0
    );
  });
  deliver(f, message());
  await until(() => finish);
  await service.close();
  assert.equal(signal.aborted, true);
  assert.equal(service.status().state, 'incomplete');
  assert.equal(service.status().pendingHandlers, 1);
  finish('ack');
  await until(() => service.status().state === 'closed');
  assert.equal(f.connections[0].consumer.dispositions.length, 0);
});
test('handler deadline aborts cooperatively and replacement waits for real settlement; broker blocked state survives drain', async (t) => {
  /** Fresh injected driver fixture, with no external broker connection. */
  const f = fixture();
  let finish, signal;
  /** Fresh finite synthetic worker policy; mutations affect only this test fixture. */
  const settings = options((job) => {
    signal = job.signal;
    return new Promise((resolve) => (finish = resolve));
  });
  settings.handlerTimeoutMs = 5;
  /** Owned supervised worker; bounded close and actual settlement are checked independently. */
  const service = await createRabbitMQWorker(settings, f.connector);
  // Release held fixture work even if an intermediate assertion fails.
  t.after(async () => {
    finish?.('ack');
    await service.close();
    await until(
      () =>
        service.status().pendingHandlers === 0 &&
        service.status().pendingNative === 0
    );
  });
  try {
    f.connections[0].emit('blocked');
    f.connections[0].producer.emit('drain');
    await assert.rejects(
      service.add('jobs', 'send', {}),
      error('PUBLISH_BACKPRESSURE')
    );
    f.connections[0].emit('unblocked');
    deliver(f, message());
    await until(() => signal?.aborted);
    assert.equal(service.status().handlerDeadlines, 1);
    assert.equal(f.connections.length, 1);
    finish('ack');
    await until(
      () => f.connections.length === 2 && service.status().state === 'ready'
    );
    assert.equal(f.connections[0].consumer.dispositions.length, 0);
  } finally {
    finish?.('ack');
    await service.close();
  }
  assert.equal(service.status().pendingTimers, 0);
});
test('service-wide consumer credits sum to concurrency rather than enabling unsupported quorum global prefetch', async (t) => {
  /** Fresh injected driver fixture, with no external broker connection. */
  const f = fixture();
  /** Fresh finite synthetic worker policy; mutations affect only this test fixture. */
  const settings = options(async () => 'ack');
  settings.concurrency = 3;
  settings.queues.push({
    name: 'second',
    type: 'quorum',
    handler: async () => 'ack',
  });
  /** Owned supervised worker; bounded close and actual settlement are checked independently. */
  const service = await createRabbitMQWorker(settings, f.connector);
  // Release held fixture work even if an intermediate assertion fails.
  t.after(async () => {
    await service.close();
    await until(
      () =>
        service.status().pendingHandlers === 0 &&
        service.status().pendingNative === 0
    );
  });
  try {
    assert.deepEqual(f.connections[0].consumer.credits, [
      [2, false],
      [1, false],
    ]);
  } finally {
    await service.close();
  }
});
test('drain with pending confirmation reports unknown, and late native cancellation remains owned after close deadline', async (t) => {
  /** Fresh injected driver fixture, with no external broker connection. */
  const f = fixture();
  /** Fresh finite synthetic worker policy; mutations affect only this test fixture. */
  const settings = options(async () => 'ack');
  settings.timeoutMs = 5;
  settings.drainMs = 5;
  /** Owned supervised worker; bounded close and actual settlement are checked independently. */
  const service = await createRabbitMQWorker(settings, f.connector);
  // Release held fixture work even if an intermediate assertion fails.
  t.after(async () => {
    finishCancel?.({});
    await service.close();
    await until(
      () =>
        service.status().pendingHandlers === 0 &&
        service.status().pendingNative === 0
    );
  });
  let finishCancel;
  f.connections[0].consumer.cancel = () =>
    new Promise((resolve) => (finishCancel = resolve));
  f.mode = 'hold';
  /** Observed unknown-confirmation rejection; never transparently resend it. */
  const rejection = assert.rejects(
    service.add('jobs', 'send', {}),
    error('PUBLISH_OUTCOME_UNKNOWN')
  );
  await service.close();
  await rejection;
  assert.equal(service.status().state, 'incomplete');
  assert.equal(service.status().unknownPublishes, 1);
  assert.equal(service.status().pendingTimers, 0);
  finishCancel({});
  await until(() => service.status().pendingNative === 0);
  assert.equal(service.status().state, 'failed');
});

test('quorum worker topology rejects unqualified broker advertisements and closes the acquired connection', async () => {
  /** Fresh injected driver fixture, with no external broker connection. */
  const f = fixture();
  /** Trusted fixture connector returning fresh service-owned injected resources.
   * @returns {Promise<unknown>} Synthetic fixture result; never a live broker acceptance claim.
   */
  const connector = async () => {
    /** Fresh owned injected native connection for this one acquisition attempt. */
    const connection = await f.connector();
    connection.connection.serverProperties.version = '3.13.0';
    return connection;
  };
  await assert.rejects(
    createRabbitMQWorker(
      options(async () => 'ack'),
      connector
    ),
    error('START_FAILED')
  );
  assert.equal(f.connections[0].producer.topology.length, 0);
  assert.equal(f.log.filter((e) => e[0] === 'connection-close').length, 1);
});
test('late channel acquisition after startup timeout is closed exactly once, never adopted by another generation', async (t) => {
  /** Fresh injected driver fixture, with no external broker connection. */
  const f = fixture();
  let finish;
  t.after(async () => {
    // A startup deadline does not cancel the native acquisition promise.
    if (finish) {
      finish(f.connections[0].producer);
      await until(() => f.log.some((entry) => entry[0] === 'producer-close'));
    }
  });
  /** Trusted fixture connector returning fresh service-owned injected resources.
   * @returns {Promise<unknown>} Synthetic fixture result; never a live broker acceptance claim.
   */
  const connector = async () => {
    /** Fresh owned injected native connection for this one acquisition attempt. */
    const connection = await f.connector();
    connection.createConfirmChannel = () =>
      new Promise((resolve) => (finish = resolve));
    return connection;
  };
  /** Fresh finite synthetic worker policy; mutations affect only this test fixture. */
  const settings = options();
  settings.timeoutMs = 5;
  settings.drainMs = 5;
  await assert.rejects(
    createRabbitMQWorker(settings, connector),
    error('START_FAILED')
  );
  assert.equal(f.log.filter((e) => e[0] === 'connection-close').length, 1);
  finish(f.connections[0].producer);
  await until(() => f.log.some((e) => e[0] === 'producer-close'));
  assert.equal(f.log.filter((e) => e[0] === 'producer-close').length, 1);
  assert.equal(f.connections.length, 1);
});
test('unproven connection cleanup stops reconnection rather than overlapping a leaked generation', async (t) => {
  /** Fresh injected driver fixture, with no external broker connection. */
  const f = fixture();
  /** Trusted fixture connector returning fresh service-owned injected resources.
   * @returns {Promise<unknown>} Synthetic fixture result; never a live broker acceptance claim.
   */
  const connector = async () => {
    /** Fresh owned injected native connection for this one acquisition attempt. */
    const connection = await f.connector();
    connection.close = async () => {
      throw Error('SECRET close failure');
    };
    return connection;
  };
  /** Owned supervised worker; bounded close and actual settlement are checked independently. */
  const service = await createRabbitMQWorker(options(), connector);
  // Release held fixture work even if an intermediate assertion fails.
  t.after(async () => {
    await service.close();
    await until(
      () =>
        service.status().pendingHandlers === 0 &&
        service.status().pendingNative === 0
    );
  });
  f.connections[0].producer.emit('error', Error('broker unavailable'));
  await until(() => service.status().state === 'failed');
  assert.equal(f.connections.length, 1);
  assert.equal(service.status().reconnectAttempts, 0);
  await service.close();
  assert.equal(service.status().cleanupFailures, 1);
});
