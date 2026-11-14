import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createQueueBackend,
  selectQueueBackend,
  validateQueueSelection,
} from '@zeruxjs/queue/neutral';
import {
  rabbitMQBackend,
  memcacheQBackend,
  bullMQBackend,
} from '@zeruxjs/queue/backends';
/** Fixed expected public error code or deliberate synthetic validation helper.
 * @param {string} expected - Fixed public error code expected by this assertion.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const code = (expected) => (error) =>
  error.code === expected && !error.message.includes('SECRET');
/** Create an isolated native-basic FIFO fixture with explicit manual/destructive disposition.
 * @param {boolean} manual - Whether this fixture returns original-channel manual acknowledgements.
 * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
 */
function client(manual = false) {
  /** Injected native operation/disposition trace without production payloads. */
  const log = [];
  /** Synthetic FIFO records scoped to one injected native client. */
  const messages = [];
  let closed = 0;
  return {
    log,
    messages,
    get closed() {
      return closed;
    },
    /** Record one explicit synthetic enqueue using the tested stable job identity.
     * @param {string} q - Explicit synthetic queue name.
     * @param {string} name - Fixed synthetic queue/job/event name.
     * @param {Record<string,unknown>} data - Synthetic bounded job data, never production content.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async add(q, name, data) {
      messages.push({ name, data });
      log.push(['add', q]);
      return 'one';
    },
    /** Pop one synthetic native delivery; manual channel disposition stays distinct from destructive reads.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async take() {
      /** One synthetic native delivery or grouped report row. */
      const item = messages.shift();
      return (() => {
        if (item) {
          return {
            ...item,
            ...(manual
              ? {
                  /** Record acknowledgement of the original synthetic channel delivery.
                   * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
                   */
                  ack() {
                    log.push('ack');
                  },
                  /** Record an explicit synthetic discard/requeue decision without automatic reinsertion.
                   * @param {boolean} requeue - Explicit fixture requeue decision.
                   * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
                   */
                  reject(requeue) {
                    log.push(requeue ? 'requeue' : 'discard');
                  },
                }
              : {}),
          };
        } else {
          return undefined;
        }
      })();
    },
    /** Close only the fixture-owned service/resource or record its native shutdown call.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async close() {
      closed++;
      log.push('close');
    },
  };
}
test('MemcacheQ selection preserves destructive disposition, allowlist, bounds and unsupported feature rejection', async () => {
  /** Injected native service; neutral wrapper owns only its registered cleanup. */
  const native = client();
  /** Explicit trusted injected backend descriptor; no package scanning. */
  const factory = memcacheQBackend(() => native, ['jobs']);
  /** Owned fixture queue service; await close after admitted work settles. */
  const service = await createQueueBackend(
    selectQueueBackend(factory, { host: 'localhost' }, { maxBytes: 64 })
  );
  assert.equal(service.capabilities.destructiveRead, true);
  await service.publish('jobs', 'send', { id: 'one' });
  /** Observed original-channel or destructive disposition with distinct guarantees. */
  const delivery = await service.take('jobs');
  assert.equal(delivery.disposition, 'consumed');
  assert.equal(delivery.settle, undefined);
  // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
  for (const options of [
    { delay: 0 },
    { attempts: 1 },
    { repeat: { every: 1000 } },
  ]) {
    await assert.rejects(service.publish('jobs', 'send', {}, options));
  }
  assert.throws(
    () => service.require('acknowledgement'),
    code('UNSUPPORTED_CAPABILITY')
  );
  assert.throws(
    () => service.require('scheduler'),
    code('UNSUPPORTED_CAPABILITY')
  );
  await assert.rejects(
    service.publish('other', 'send', {}),
    code('QUEUE_NOT_REGISTERED')
  );
  await assert.rejects(
    service.publish('jobs', 'send', { large: 'x'.repeat(100) }),
    code('PAYLOAD_LIMIT')
  );
  await assert.rejects(
    service.publish('jobs', 'send', JSON.parse('{"__proto__":1}')),
    code('INVALID_PAYLOAD')
  );
  assert.equal(service.extension(factory), native);
  assert.throws(
    () => service.extension(memcacheQBackend(() => native, ['jobs'])),
    code('UNSUPPORTED_EXTENSION')
  );
  await Promise.all([service.close(), service.close()]);
  assert.equal(native.closed, 1);
  await assert.rejects(service.take('jobs'), code('CLOSED'));
});
test('RabbitMQ preserves confirmed IDs and exactly-once local disposition without auto retry', async () => {
  /** Injected native service; neutral wrapper owns only its registered cleanup. */
  const native = client(true);
  /** Explicit trusted injected backend descriptor; no package scanning. */
  const factory = rabbitMQBackend(async () => native, ['jobs']);
  /** Owned fixture queue service; await close after admitted work settles. */
  const service = await createQueueBackend(
    selectQueueBackend(factory, { url: 'amqps://host', queues: ['jobs'] })
  );
  assert.equal((await service.publish('jobs', 'send', {})).id, 'one');
  /** Synthetic manual delivery/descriptor; acknowledgement remains channel-bound. */
  const message = await service.take('jobs');
  assert.equal(message.disposition, 'manual');
  await message.settle('requeue');
  await assert.rejects(message.settle('ack'), code('INVALID_DISPOSITION'));
  assert.ok(native.log.includes('requeue'));
  await service.close();
});
test('unknown backend options/capabilities fail before factory invocation; startup rollback and errors are redacted', async () => {
  let opens = 0;
  /** Explicit trusted injected backend descriptor; no package scanning. */
  const factory = memcacheQBackend(() => {
    opens++;
    return client();
  }, ['jobs']);
  assert.throws(
    () => selectQueueBackend(factory, { servers: ['SECRET'] }),
    code('INVALID_OPTIONS')
  );
  assert.throws(
    () => selectQueueBackend(factory, {}, { requireCapabilities: ['retry'] }),
    code('UNSUPPORTED_CAPABILITY')
  );
  assert.equal(opens, 0);
  /** Injected native operation/disposition trace without production payloads. */
  const log = [];
  /** Deliberately failing startup factory used to verify reverse rollback. */
  const broken = {
    ...factory,
    /** Acquire only the explicitly injected synthetic service and register its cleanup.
     * @param {object} _opts - Validated native options ignored by the deliberate startup failure.
     * @param {object} own - Explicit cleanup registrar owned by the neutral wrapper.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async open(_opts, own) {
      own.onCleanup(() => log.push('first'));
      own.onCleanup(() => log.push('second'));
      throw Error('SECRET password');
    },
  };
  await assert.rejects(
    createQueueBackend({ factory: broken, options: {} }),
    (error) => {
      assert.equal(JSON.stringify(error).includes('SECRET'), false);
      return code('START_FAILED')(error);
    }
  );
  assert.deepEqual(log, ['second', 'first']);
  /** Deliberately unavailable dependency/record fixture; failure must stay explicit. */
  const missing = {
    ...factory,
    /** Acquire only the explicitly injected synthetic service and register its cleanup.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async open() {
      throw Error('Cannot find optional driver SECRET');
    },
  };
  await assert.rejects(
    createQueueBackend({ factory: missing, options: {} }),
    code('START_FAILED')
  );
  /** Malformed synthetic capability/options object expected to reject. */
  const bad = {
    ...factory,
    capabilities: { ...factory.capabilities, unknown: true },
  };
  assert.throws(
    () => validateQueueSelection({ factory: bad, options: {} }),
    code('INVALID_CAPABILITIES')
  );
});
test('close drains actual pending work before releasing resources, bounds pending calls and preserves uncertain failures', async () => {
  let settle,
    closed = 0;
  /** Explicit trusted injected backend descriptor; no package scanning. */
  const factory = memcacheQBackend(
    () => ({
      /** Record one explicit synthetic enqueue using the tested stable job identity.
       * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
       */
      async add() {
        return new Promise((resolve) => (settle = resolve));
      },
      /** Pop one synthetic native delivery; manual channel disposition stays distinct from destructive reads.
       * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
       */
      async take() {},
      /** Close only the fixture-owned service/resource or record its native shutdown call.
       * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
       */
      close() {
        closed++;
      },
    }),
    ['jobs']
  );
  /** Owned fixture queue service; await close after admitted work settles. */
  const service = await createQueueBackend(
    selectQueueBackend(factory, {}, { maxPending: 1 })
  );
  /** Actual unsettled synthetic operation retained until its barrier is released. */
  const pending = service.publish('jobs', 'send', {});
  try {
    await Promise.resolve();
    await assert.rejects(
      service.publish('jobs', 'send', {}),
      code('PENDING_LIMIT')
    );
    /** Actual drain promise, observed separately from admission/cancellation. */
    const closing = service.close();
    assert.equal(closed, 0);
    settle();
    await pending;
    await closing;
    assert.equal(closed, 1);
  } finally {
    settle?.();
    await Promise.allSettled([pending]);
    await service.close();
  }
  /** Owned injected backend whose unknown write failure must never auto-replay. */
  const failing = await createQueueBackend(
    selectQueueBackend(
      memcacheQBackend(
        () => ({
          /** Record one explicit synthetic enqueue using the tested stable job identity.
           * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
           */
          async add() {
            throw Error('SECRET unknown outcome');
          },
          /** Pop one synthetic native delivery; manual channel disposition stays distinct from destructive reads.
           * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
           */
          async take() {},
          /** Close only the fixture-owned service/resource or record its native shutdown call.
           * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
           */
          close() {},
        }),
        ['jobs']
      ),
      {}
    )
  );
  await assert.rejects(
    failing.publish('jobs', 'send', {}),
    code('OPERATION_FAILED')
  );
  await failing.close();
});
test('BullMQ neutral producer maps native options; push workers and schedulers stay typed extensions', async () => {
  /** Recorded injected native calls; no real broker operation occurs in this fixture. */
  const calls = [];
  /** Injected native service; neutral wrapper owns only its registered cleanup. */
  const native = {
    /** Return the explicit synthetic native queue facade.
     * @param {string} q - Explicit synthetic queue name.
     * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    queue(q) {
      return {
        /** Record one explicit synthetic enqueue using the tested stable job identity.
         * @param {string} name - Fixed synthetic queue/job/event name.
         * @param {Record<string,unknown>} data - Synthetic bounded job data, never production content.
         * @param {object} options - Explicit synthetic request/native settings.
         * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
         */
        async add(name, data, options) {
          calls.push({ q, name, data, options });
          return { id: 'bull-one' };
        },
      };
    },
    close: async () => calls.push('close'),
    /** Return the deliberate native-only scheduler extension marker.
     * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    schedules() {
      return 'native';
    },
  };
  /** Explicit trusted injected backend descriptor; no package scanning. */
  const factory = bullMQBackend(['jobs'], async () => native);
  /** Explicit typed backend/options binding validated before opening resources. */
  const selection = selectQueueBackend(factory, {
    redis: { host: 'localhost' },
    queues: ['jobs'],
  });
  /** Owned fixture queue service; await close after admitted work settles. */
  const service = await createQueueBackend(selection);
  assert.equal(
    (await service.publish('jobs', 'send', {}, { delay: 10, attempts: 2 })).id,
    'bull-one'
  );
  assert.deepEqual(calls[0].options, { delay: 10, attempts: 2 });
  assert.equal(service.extension(factory).schedules(), 'native');
  await assert.rejects(service.take('jobs'), code('UNSUPPORTED_CAPABILITY'));
  await service.close();
  assert.throws(
    () =>
      selectQueueBackend(factory, {
        redis: { host: 'localhost' },
        queues: [{ name: 'jobs', defaultJobOptions: { secretOption: true } }],
      }),
    code('INVALID_OPTIONS')
  );
});
test('malformed pulled payloads discard manual deliveries; cleanup failure remains private and close runs once', async () => {
  /** Explicit synthetic configuration or store underlying the current case. */
  const base = rabbitMQBackend(async () => client(true), ['jobs']);
  let discarded = 0,
    closed = 0;
  /** Explicit trusted injected backend descriptor; no package scanning. */
  const factory = {
    ...base,
    /** Acquire only the explicitly injected synthetic service and register its cleanup.
     * @param {object} _options - Validated configuration used by this injected fixture.
     * @param {object} own - Explicit cleanup registrar owned by the neutral wrapper.
     * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    open(_options, own) {
      own.onCleanup(() => {
        closed++;
        throw Error('SECRET cleanup');
      });
      return {
        /** Record only the explicit opaque reference or simulate the declared native failure.
         * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
         */
        async publish() {
          return {};
        },
        /** Pop one synthetic native delivery; manual channel disposition stays distinct from destructive reads.
         * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
         */
        async take() {
          return {
            name: 'invalid name',
            data: {},
            disposition: 'manual',
            /** Observe one original-delivery disposition; never move it to a replacement channel.
             * @param {string} action - Explicit original-delivery disposition.
             * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
             */
            settle(action) {
              assert.equal(action, 'discard');
              discarded++;
            },
          };
        },
      };
    },
  };
  /** Owned fixture queue service; await close after admitted work settles. */
  const service = await createQueueBackend(
    selectQueueBackend(factory, { url: 'amqp://host', queues: ['jobs'] })
  );
  await assert.rejects(service.take('jobs'), code('INVALID_NAME'));
  assert.equal(discarded, 1);
  await assert.rejects(service.close(), code('CLOSE_FAILED'));
  await assert.rejects(service.close(), code('CLOSE_FAILED'));
  assert.equal(closed, 1);
  /** Owned destructive-read neutral fixture; acknowledged workflows must reject it. */
  const mem = await createQueueBackend(
    selectQueueBackend(
      memcacheQBackend(() => client(), ['jobs']),
      {}
    )
  );
  /** Deliberately oversized sparse array used for early complexity rejection. */
  const sparse = [];
  sparse.length = 100000000;
  await assert.rejects(
    mem.publish('jobs', 'send', { sparse }),
    code('PAYLOAD_LIMIT')
  );
  await mem.close();
});
test('MemcacheQ native close barrier is awaited without requiring it from older injected factories', async () => {
  let finish,
    closed = 0;
  /** Explicit trusted injected backend descriptor; no package scanning. */
  const factory = memcacheQBackend(
    () => ({
      /** Record one explicit synthetic enqueue using the tested stable job identity.
       * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
       */
      async add() {},
      /** Pop one synthetic native delivery; manual channel disposition stays distinct from destructive reads.
       * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
       */
      async take() {},
      /** Close only the fixture-owned service/resource or record its native shutdown call.
       * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
       */
      close() {
        closed++;
      },
      /** Expose an actual synthetic native-close barrier distinct from stop-admission.
       * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
       */
      whenClosed() {
        return new Promise((resolve) => (finish = resolve));
      },
    }),
    ['jobs']
  );
  /** Owned fixture queue service; await close after admitted work settles. */
  const service = await createQueueBackend(selectQueueBackend(factory, {}));
  let settled = false;
  /** Actual drain promise, observed separately from admission/cancellation. */
  const closing = service.close().then(() => (settled = true));
  try {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(closed, 1);
    finish();
    await closing;
    assert.equal(settled, true);
  } finally {
    finish?.();
    await closing;
  }
});
