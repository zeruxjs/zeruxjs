import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinnedTransaction } from '@zeruxjs/db';
import {
  createWebhookWorkflow,
  WebhookError,
  signWebhook,
  verifyWebhook,
  verifyAndConsumeWebhook,
  webhookURL,
  createAcknowledgedWebhookPublisher,
  createWebhookProcessor,
} from '@zeruxjs/queue/webhooks';
import { createQueueBackend, selectQueueBackend } from '@zeruxjs/queue/neutral';
import { memcacheQBackend, rabbitMQBackend } from '@zeruxjs/queue/backends';
/** Synthetic compound/map/group identity or test-only signing key. */
const key = { id: 'current', key: new Uint8Array(32).fill(42) };
/** Synthetic previous rotation key, never an application secret. */
const previous = { id: 'old', key: new Uint8Array(32).fill(17) };
/** Explicit synthetic webhook/HTTPS packet with test-only signing data. */
const input = {
  tenant: 'tenant1',
  deliveryId: 'delivery1',
  eventId: 'event1',
  destination: 'partner',
  schemaVersion: 1,
  payload: { private: 'PRIVATE_BODY' },
};
/** Explicit finite synthetic retry/origin/egress policy. */
const policy = {
  maxAttempts: 3,
  maxAgeMs: 86400000,
  baseDelayMs: 100,
  maxDelayMs: 10000,
  retryAfterMaxMs: 5000,
  transientStatuses: [429, 500, 503],
  retryNotSent: true,
};
/** Create isolated synthetic durable/native state; caller or callback owns teardown.
 * @param {object} overrides - Trusted injected fixture overrides.
 * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
 */
function fixture(overrides = {}) {
  let time = 1000000,
    send = async () => ({ status: 204 }),
    keys = { current: key };
  /** Synthetic table rows or copied query results, scoped to one fixture. */
  const rows = new Map();
  /** Fixture-local recorded authorized sends or headers, never a live SMTP claim. */
  const sent = [];
  /** Isolated synthetic CAS/delivery store, never operator data. */
  const store = {
    contract: 'webhook-cas-v1',
    /** Read an independent synthetic tenant-bound durable record clone.
     * @param {object} ref - Synthetic verified tenant/delivery reference.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async get(ref) {
      return structuredClone(
        rows.get(ref.tenant + '/' + ref.deliveryId) ?? null
      );
    },
    /** Compare exact tenant/delivery revision before replacing synthetic durable state.
     * @param {object} ref - Synthetic verified tenant/delivery reference.
     * @param {number} revision - Exact expected synthetic durable revision.
     * @param {object} next - Complete synthetic next durable state.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async cas(ref, revision, next) {
      /** Synthetic tenant/delivery compound lookup key. */
      const k = ref.tenant + '/' + ref.deliveryId;
      if (rows.get(k)?.revision !== revision) {
        return false;
      }
      rows.set(k, structuredClone(next));
      return true;
    },
    /** Return sorted bounded synthetic due references for the selected tenant only.
     * @param {string} tenant - Verified synthetic tenant scope.
     * @param {number} now - Fixed synthetic current epoch milliseconds.
     * @param {string | null} cursor - Exclusive synthetic continuation or null.
     * @param {number} limit - Finite synthetic query/page ceiling.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async due(tenant, now, cursor, limit) {
      return {
        ids: [...rows.values()]
          .filter(
            (r) =>
              r.tenant === tenant &&
              r.state === 'pending' &&
              r.nextAt <= now &&
              (!cursor || r.deliveryId > cursor)
          )
          .map((r) => r.deliveryId)
          .sort()
          .slice(0, limit),
        next: null,
      };
    },
  };
  /** Owned synthetic durable workflow; close before borrowed stores/transport. */
  const workflow = createWebhookWorkflow({
    store,
    transport: {
      contract: 'webhook-https-v1',
      validate: (url) => {
        webhookURL(url, ['https://hooks.example']);
      },
      /** Simulate a declared SMTP/HTTPS result without a real external delivery.
       * @param {object} req - Explicit injected signed HTTPS request.
       * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
       */
      async send(req) {
        sent.push(req);
        return send(req);
      },
    },
    authorize: (_action, ref, principal) =>
      principal === 'trusted' && ref.tenant === 'tenant1',
    destination: async (tenant, ref) => ({
      tenant,
      ref,
      url: 'https://hooks.example/events',
      enabled: true,
      consumerIdempotency: true,
      keys,
    }),
    policy,
    now: () => time,
    random: () => 0.5,
    ...overrides,
  });
  return {
    workflow,
    store,
    rows,
    sent,
    set time(v) {
      time = v;
    },
    get time() {
      return time;
    },
    set send(fn) {
      send = fn;
    },
    set keys(value) {
      keys = value;
    },
    /** Insert explicit synthetic rows or journal on the supplied pin; never a separate connection.
     * @param {unknown} value - Explicit synthetic stored value or outage mode.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async insert(value = input) {
      /** Synthetic durable record or record factory; authoritative state remains in the fixture store. */
      const record = await workflow.prepare(value, 'trusted');
      rows.set(record.tenant + '/' + record.deliveryId, record);
      return record;
    },
  };
}
/** Explicit synthetic tenant/delivery compound reference, never permission alone. */
const reference = { tenant: 'tenant1', deliveryId: 'delivery1' };
test('signed successful delivery persists redacted outcomes, rotates keys and cannot replay a completed record', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fixture();
  await f.insert();
  f.keys = { current: previous };
  await f.workflow.deliver(reference, 'trusted');
  assert.equal(f.sent.length, 1);
  /** Injected native request helper; no real external TLS connection. */
  const request = f.sent[0];
  assert.ok(
    verifyWebhook(
      {
        tenant: 'tenant1',
        destination: 'partner',
        deliveryId: 'delivery1',
        timestamp: request.headers['x-zerux-webhook-timestamp'],
        signature: request.headers['x-zerux-webhook-signature'],
        body: request.body,
      },
      { current: key, previous: [previous] },
      { now: f.time }
    )
  );
  assert.equal(JSON.parse(request.body).eventId, 'event1');
  /** Sanitized authorized durable-state projection excluding payloads and keys. */
  const summary = await f.workflow.inspect(reference, 'trusted');
  assert.equal(summary.state, 'delivered');
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE_BODY|signature|https:/);
  await f.workflow.deliver(reference, 'trusted');
  assert.equal(f.sent.length, 1);
  await f.workflow.close();
});
test('explicit transient status policy, bounded Retry-After and permanent/redirect responses remain distinct', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fixture();
  await f.insert();
  f.send = async () => ({ status: 429, retryAfter: '999999' });
  let result = await f.workflow.deliver(reference, 'trusted');
  assert.equal(result.state, 'pending');
  assert.equal(result.nextAt - f.time, 5000);
  await f.workflow.deliver(reference, 'trusted');
  assert.equal(f.sent.length, 1);
  f.time = result.nextAt;
  f.send = async () => ({ status: 500 });
  result = await f.workflow.deliver(reference, 'trusted');
  assert.equal(result.state, 'pending');
  f.time = result.nextAt;
  f.send = async () => ({ status: 503 });
  result = await f.workflow.deliver(reference, 'trusted');
  assert.equal(result.state, 'dead');
  assert.equal(result.history.at(-1).code, 'RETRY_LIMIT');
  await assert.rejects(
    f.workflow.redrive(reference, 'trusted'),
    (e) => e.code === 'RETRY_LIMIT'
  );
  await f.workflow.close();
  // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
  for (const status of [302, 400, 401, 404, 502]) {
    /** Independent synthetic workflow fixture with its own clock/store/credentials. */
    const g = fixture();
    await g.insert();
    g.send = async () => ({ status });
    assert.equal(
      (await g.workflow.deliver(reference, 'trusted')).state,
      'dead'
    );
    assert.equal(g.sent.length, 1);
    await g.workflow.close();
  }
});
test('lost acknowledgement and expired sending lease are uncertain, never automatically retried', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fixture();
  await f.insert();
  f.send = async () => {
    throw Error('PRIVATE transport secret');
  };
  assert.equal(
    (await f.workflow.deliver(reference, 'trusted')).state,
    'uncertain'
  );
  await f.workflow.deliver(reference, 'trusted');
  assert.equal(f.sent.length, 1);
  await assert.rejects(
    f.workflow.redrive(reference, 'denied', { confirmedUncertain: true }),
    (e) => e.code === 'FORBIDDEN'
  );
  await assert.rejects(
    f.workflow.redrive(reference, 'trusted'),
    (e) => e.code === 'REDRIVE_DENIED'
  );
  f.keys = { current: key };
  await f.workflow.redrive(reference, 'trusted', { confirmedUncertain: true });
  f.send = async () => ({ status: 204 });
  await f.workflow.deliver(reference, 'trusted');
  assert.equal(f.sent.length, 2);
  await f.workflow.close();
  /** Independent synthetic workflow fixture with its own clock/store/credentials. */
  const g = fixture();
  /** Explicit synthetic stored record inspected for state/revision consistency. */
  const row = await g.insert();
  row.state = 'sending';
  row.attempts = 1;
  row.lease = {
    token: '00000000-0000-0000-0000-000000000000',
    until: g.time - 1,
  };
  g.rows.set('tenant1/delivery1', row);
  assert.equal(
    (await g.workflow.deliver(reference, 'trusted')).state,
    'uncertain'
  );
  assert.equal(g.sent.length, 0);
  await g.workflow.close();
});
test('CAS claims fence simultaneous workers; outage and shutdown preserve ownership', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fixture();
  await f.insert();
  let finish;
  f.send = () => new Promise((resolve) => (finish = resolve));
  /** First operation/record/page used as the normal concurrency control. */
  const first = f.workflow.deliver(reference, 'trusted');
  try {
    while (!finish) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    await assert.rejects(
      f.workflow.deliver(reference, 'trusted'),
      (e) => e.code === 'BUSY'
    );
    assert.equal(f.sent.length, 1);
    let closed = false;
    /** Actual drain promise, observed separately from admission/cancellation. */
    const closing = f.workflow.close().then(() => (closed = true));
    await Promise.resolve();
    assert.equal(closed, false);
    assert.equal(f.sent[0].signal.aborted, true);
    finish({ status: 204 });
    assert.equal((await first).state, 'uncertain');
    await closing;
  } finally {
    finish?.();
    await Promise.allSettled([first]);
    await f.workflow.close();
  }
  /** Independent synthetic workflow fixture with its own clock/store/credentials. */
  const g = fixture();
  await g.insert();
  g.store.cas = async () => {
    throw Error('store unavailable');
  };
  await assert.rejects(
    g.workflow.deliver(reference, 'trusted'),
    (e) => e.code === 'DEPENDENCY_FAILED'
  );
  assert.equal(g.sent.length, 0);
  await g.workflow.close();
});
test('tenant/credential policy denial, malformed inputs, signature expiry and replay-store claim contract', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fixture();
  assert.throws(() =>
    f.workflow.prepare(
      {
        ...input,
        payload: {
          /** Deliberately unsupported function payload used to prove JSON data remains inert.
           * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
           */
          fn() {},
        },
      },
      'trusted'
    )
  );
  await assert.rejects(
    f.workflow.prepare({ ...input, tenant: 'tenant2' }, 'trusted'),
    (e) => e.code === 'FORBIDDEN'
  );
  await f.insert();
  f.keys = { current: { id: 'bad', key: new Uint8Array(4) } };
  await assert.rejects(f.workflow.deliver(reference, 'trusted'));
  assert.equal(f.sent.length, 0);
  await f.workflow.close();
  /** Fixed signed Unix-second fixture timestamp. */
  const timestamp = 1000;
  /** Synthetic body or consumed response bytes; no real recipient content. */
  const body = '{}';
  /** Fixed authenticated header result over exact synthetic bytes/context. */
  const signature = signWebhook(
    {
      tenant: 'tenant1',
      destination: 'partner',
      deliveryId: 'delivery1',
      timestamp,
      body,
    },
    { current: previous }
  );
  /** Synthetic received body/signature packet used for freshness/replay checks. */
  const packet = {
    tenant: 'tenant1',
    destination: 'partner',
    deliveryId: 'delivery1',
    timestamp: String(timestamp),
    signature: signature['x-zerux-webhook-signature'],
    body,
  };
  assert.equal(
    verifyWebhook(
      { ...packet, body: 'tampered' },
      { current: previous },
      { now: timestamp * 1000 }
    ),
    false
  );
  assert.equal(
    verifyWebhook(
      packet,
      { current: previous },
      { now: timestamp * 1000 + 400000 }
    ),
    false
  );
  assert.equal(
    verifyWebhook({ ...packet, timestamp: 'NaN' }, { current: previous }),
    false
  );
  /** Fixture-local unique replay keys; not a production durable adapter. */
  const claimed = new Set();
  /** Previously observed immutable event or unique-claim fixture, not a second side effect. */
  const replay = {
    contract: 'webhook-replay-v1',
    /** Claim one synthetic verified replay compound key once.
     * @param {object} ref - Synthetic verified tenant/delivery reference.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async consume(ref) {
      /** Synthetic compound/map/group identity or test-only signing key. */
      const key = JSON.stringify([ref.tenant, ref.destination, ref.deliveryId]);
      if (claimed.has(key)) {
        return false;
      }
      claimed.add(key);
      return true;
    },
  };
  assert.deepEqual(
    await Promise.all([
      verifyAndConsumeWebhook(
        packet,
        { current: key, previous: [previous] },
        replay,
        { now: 1000000, retentionMs: 86400000 }
      ),
      verifyAndConsumeWebhook(
        packet,
        { current: key, previous: [previous] },
        replay,
        { now: 1000000, retentionMs: 86400000 }
      ),
    ]),
    ['verified', 'duplicate']
  );
});
test('shared pinned executor commits mutation and outbox on one pin, rollback leaves neither and unsupported pin rejects', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fixture();
  /** Synthetic committed database effects used to verify atomic rollback. */
  const committed = [];
  /** Observed synthetic transaction pin identities; one operation must stay on one pin. */
  const pins = [];
  let seq = 0;
  /** Explicit pinned-transaction fixture or approved provider contract. */
  const adapter = {
    capabilities: {
      isolationLevels: ['serializable'],
      timeout: 'cooperative',
      savepoints: false,
      transactionalDdl: false,
    },
    /** Acquire one explicit synthetic pinned database lease with isolated draft effects.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async acquire() {
      /** Exact synthetic transaction lease, never a second database connection. */
      const pin = ++seq;
      let draft = [];
      return {
        /** Begin the synthetic pin without publishing or sending external effects.
         * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
         */
        begin() {},
        /** Record one synthetic operation on the exact leased pin.
         * @param {object} op - Structured synthetic database operation.
         * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
         */
        execute(op) {
          draft.push(op);
          pins.push(pin);
          return { ok: true, affectedCount: 1 };
        },
        /** Promote only this synthetic pin draft into committed effects.
         * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
         */
        commit() {
          committed.push(...draft);
        },
        /** Discard this synthetic pin draft after a deliberate failure.
         * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
         */
        rollback() {
          draft = [];
        },
        /** Release only this synthetic leased pin.
         * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
         */
        release() {},
      };
    },
  };
  /** Existing public pinned transaction coordinator over the injected adapter. */
  const transaction = createPinnedTransaction(adapter, {
    name: 'Synthetic',
    slug: 'pin',
    connector: 'synthetic',
    options: {},
  });
  /** Owned synthetic database facade or disposable native handle. */
  const database = {
    transaction,
    transactionCapabilities: () => adapter.capabilities,
  };
  /** Explicit synthetic journal writer using only its supplied transaction pin. */
  const writer = {
    /** Insert explicit synthetic rows or journal on the supplied pin; never a separate connection.
     * @param {object} pin - Exact synthetic leased transaction pin.
     * @param {object} record - Prepared private synthetic outbox record.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async insert(pin, record) {
      await pin.insert({
        table: 'outbox',
        values: { id: record.deliveryId, record: JSON.stringify(record) },
      });
    },
  };
  await f.workflow.commit(
    database,
    writer,
    input,
    async (pin) => {
      await pin.insert({ table: 'business', values: { id: 1 } });
    },
    'trusted'
  );
  assert.deepEqual(
    committed.map((o) => o.table),
    ['business', 'outbox']
  );
  assert.equal(new Set(pins).size, 1);
  await assert.rejects(
    f.workflow.commit(
      database,
      {
        /** Insert explicit synthetic rows or journal on the supplied pin; never a separate connection.
         * @param {object} pin - Exact synthetic leased transaction pin.
         * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
         */
        async insert(pin) {
          await pin.insert({ table: 'outbox', values: { id: 'bad' } });
          throw Error('journal failure');
        },
      },
      { ...input, deliveryId: 'second' },
      async (pin) => {
        await pin.insert({ table: 'business', values: { id: 2 } });
      },
      'trusted'
    ),
    (e) => e.code === 'DEPENDENCY_FAILED'
  );
  assert.equal(committed.length, 2);
  await assert.rejects(
    f.workflow.commit({}, writer, input, () => {}, 'trusted'),
    (e) => e.code === 'PINNED_TRANSACTION_REQUIRED'
  );
  await f.workflow.close();
});
test('opaque queue refs, dispatch and acknowledged capability checks reject destructive MemcacheQ', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fixture();
  await f.insert();
  /** Synthetic queued records or in-memory job map, scoped to one test. */
  const jobs = [];
  /** Injected opaque-reference producer, without real broker publication. */
  const publisher = {
    acknowledged: true,
    destructiveRead: false,
    /** Record only the explicit opaque reference or simulate the declared native failure.
     * @param {object} ref - Synthetic verified tenant/delivery reference.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async publish(ref) {
      jobs.push(ref);
    },
  };
  assert.equal(
    (await f.workflow.dispatch('tenant1', 'trusted', publisher)).published,
    1
  );
  assert.deepEqual(jobs, [reference]);
  /** Explicit allowlisted fixture processor; handlers are never discovered from source strings. */
  const processor = createWebhookProcessor(f.workflow, 'trusted');
  await assert.rejects(
    processor({
      name: 'webhook.deliver',
      data: { ...reference, body: 'PRIVATE' },
    }),
    (e) => e.code === 'INVALID_JOB_REFERENCE'
  );
  await processor({ name: 'webhook.deliver', data: reference });
  assert.equal(f.sent.length, 1);
  /** Borrowed synthetic queue or owned neutral wrapper; lifecycle follows the enclosing test. */
  const queue = await createQueueBackend(
    selectQueueBackend(
      memcacheQBackend(
        () => ({
          /** Record one explicit synthetic enqueue using the tested stable job identity.
           * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
           */
          async add() {} /** Pop one synthetic native delivery; manual channel disposition stays distinct from destructive reads.
           * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
           */,
          async take() {} /** Close only the fixture-owned service/resource or record its native shutdown call.
           * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
           */,
          close() {},
        }),
        ['jobs']
      ),
      {}
    )
  );
  assert.throws(() => createAcknowledgedWebhookPublisher(queue, 'jobs'));
  await queue.close();
  await f.workflow.close();
});
test('total age, pre-write failures and destination/credential revalidation bound explicit redrive', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fixture();
  await f.insert();
  f.send = async () => {
    throw new WebhookError('NOT_SENT');
  };
  let result = await f.workflow.deliver(reference, 'trusted');
  assert.equal(result.state, 'pending');
  assert.equal(result.history[0].code, 'NOT_SENT');
  f.time += 86400001;
  result = await f.workflow.deliver(reference, 'trusted');
  assert.equal(result.state, 'dead');
  assert.equal(f.sent.length, 1);
  await f.workflow.close();
  /** Independent synthetic workflow fixture with its own clock/store/credentials. */
  const g = fixture();
  await g.insert();
  g.send = async () => ({ status: 400 });
  await g.workflow.deliver(reference, 'trusted');
  /** Exact durable revision before an operation expected to fail without mutation. */
  const revision = g.rows.get('tenant1/delivery1').revision;
  g.keys = { current: { id: 'invalid', key: new Uint8Array(2) } };
  await assert.rejects(
    g.workflow.redrive(reference, 'trusted'),
    (e) => e.code === 'DEPENDENCY_FAILED'
  );
  assert.equal(g.rows.get('tenant1/delivery1').revision, revision);
  g.keys = { current: previous, previous: [key] };
  assert.equal(
    (await g.workflow.redrive(reference, 'trusted')).state,
    'pending'
  );
  await g.workflow.close();
  /** Deliberately unauthorized synthetic workflow/transport. */
  const denied = fixture({
    destination: (tenant, ref) => ({
      tenant,
      ref,
      url: 'https://private.example/events',
      enabled: true,
      consumerIdempotency: true,
      keys: { current: key },
    }),
  });
  await assert.rejects(
    denied.workflow.prepare(input, 'trusted'),
    (e) => e.code === 'DESTINATION_DENIED'
  );
  assert.equal(denied.sent.length, 0);
  await denied.workflow.close();
});
test('inspection validates stored history and never exposes extra secret values', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fixture();
  /** Synthetic durable record or record factory; authoritative state remains in the fixture store. */
  const record = await f.insert();
  record.history = [
    {
      at: f.time,
      durationMs: 0,
      outcome: 'dead',
      code: 'POLICY_DENIED',
      body: 'PRIVATE_SECRET',
    },
  ];
  f.rows.set('tenant1/delivery1', record);
  await assert.rejects(
    f.workflow.inspect(reference, 'trusted'),
    (e) => !JSON.stringify(e).includes('PRIVATE_SECRET')
  );
  await f.workflow.close();
});
test('acknowledged RabbitMQ bridge publishes only scoped opaque references', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fixture();
  await f.insert();
  /** Recorded synthetic published references, not raw messages. */
  const published = [];
  /** Borrowed synthetic queue or owned neutral wrapper; lifecycle follows the enclosing test. */
  const queue = await createQueueBackend(
    selectQueueBackend(
      rabbitMQBackend(
        async () => ({
          /** Record one explicit synthetic enqueue using the tested stable job identity.
           * @param {string} queue - Explicit allowed synthetic queue.
           * @param {string} name - Fixed synthetic queue/job/event name.
           * @param {Record<string,unknown>} data - Synthetic bounded job data, never production content.
           * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
           */
          async add(queue, name, data) {
            published.push({ queue, name, data });
            return 'native-id';
          },
          /** Pop one synthetic native delivery; manual channel disposition stays distinct from destructive reads.
           * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
           */
          async take() {},
          /** Close only the fixture-owned service/resource or record its native shutdown call.
           * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
           */
          async close() {},
        }),
        ['delivery']
      ),
      { url: 'amqps://broker.example', queues: ['delivery'] }
    )
  );
  try {
    /** Injected opaque-reference producer, without real broker publication. */
    const publisher = createAcknowledgedWebhookPublisher(queue, 'delivery');
    await f.workflow.dispatch('tenant1', 'trusted', publisher);
    assert.deepEqual(JSON.parse(JSON.stringify(published)), [
      {
        queue: 'delivery',
        name: 'webhook.deliver',
        data: { tenant: 'tenant1', deliveryId: 'delivery1' },
      },
    ]);
    assert.doesNotMatch(
      JSON.stringify(published),
      /PRIVATE_BODY|partner|event1/
    );
  } finally {
    await queue.close();
    await f.workflow.close();
  }
});
