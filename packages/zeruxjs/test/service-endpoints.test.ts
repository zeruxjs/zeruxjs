import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApplicationLifecycle } from 'zeruxjs';
import {
  registerServiceEndpoints,
  createServiceClient,
  createTransactionalOutbox,
} from 'zeruxjs/service-endpoints';
import { createProtocolGateway } from 'zhost/protocols';
import { createPinnedTransaction } from '@zeruxjs/db';
import { object, string } from '@zeruxjs/validator/schemas';
/** Explicit endpoint concurrency, deadline and byte limits shared by the synthetic gateways. */
const limits = { maxMessageBytes: 4096, maxConcurrent: 4, timeoutMs: 500 };
/** Response schema independently validating the fixed endpoint value shape. */
const schema = object({ value: string() });
/** Bind a test-owned server to an ephemeral loopback port.
 * @param {import("node:http").Server} server - Isolated server owner.
 * @returns {Promise<number>} Port assigned after listener readiness.
 */
const listen = async (server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};
/** Create an application generation without starting any endpoint listener implicitly.
 * @returns {Promise<object>} Application/API fixture owning generation and temporary project cleanup.
 */
async function fixture() {
  /** Temporary endpoint project removed after generation shutdown. */
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'zx007-'));
  /** Generation owner retaining endpoint cleanup registered through its plugin API. */
  const app = await createApplicationLifecycle({
    rootDir,
    config: {},
    providers: { database: async () => null, cache: async () => null },
  });
  return {
    app,
    api: app.runtime().asPluginApi(),
    /** Close the generation before deleting its isolated project.
     * @returns {Promise<void>} Resolves after owned endpoint registrations are drained.
     */
    async close() {
      await app.close();
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}
/** Describe an inert explicitly authorized loopback endpoint.
 * @param {string} name - Unique endpoint registration name.
 * @param {object} gateway - Explicit protocol gateway to bind at startup.
 * @param {object} extra - Fixture policy overrides used for invalid/bind-conflict cases.
 * @returns {object} Endpoint declaration; registration alone does not open a listener.
 */
function endpoint(name, gateway, extra = {}) {
  return {
    name,
    transport: 'http',
    bind: { host: '127.0.0.1', port: 0 },
    limits,
    gateway,
    authorize: (req) => req.headers.authorization === 'test',
    ...extra,
  };
}
/** Build a bounded explicitly allowed client destination and response schema.
 * @param {string} endpoint - Authored loopback endpoint URL.
 * @param {object} extra - Fixture overrides for authorization, retries or transport behavior.
 * @returns {object} Private service-client options.
 */
function options(endpoint, extra = {}) {
  return {
    endpoint,
    timeoutMs: 200,
    maxPayloadBytes: 4096,
    maxConcurrent: 2,
    transport: fetch,
    allowDestination: (url) => url.hostname === '127.0.0.1',
    headers: () => ({ authorization: 'test' }),
    schema,
    retry: { maxAttempts: 1, idempotent: false },
    ...extra,
  };
}

test('multiple inert endpoints start independently and close with their owning generation', async () => {
  /** Isolated application or pin fixture; no production server or database is used. */
  const f = await fixture();
  let client;
  try {
    /** First explicitly authorized gateway with its own endpoint listener. */
    const a = createProtocolGateway({ authorize: () => true });
    /** Second independently authorized gateway proving endpoint address isolation. */
    const b = createProtocolGateway({ authorize: () => true });
    let deadline;
    a.connect.register('app.Status', 'Get', (input, ctx) => {
      deadline = ctx.deadline;
      return input;
    });
    b.connect.register('app.Status', 'Get', () => ({ value: 'second' }));
    /** Generation-owned endpoint registration retaining startup rollback and listener cleanup. */
    const group = registerServiceEndpoints(f.api, [
      endpoint('first', a),
      endpoint('second', b),
    ]);
    assert.equal(group.address('first'), null);
    assert.throws(() =>
      registerServiceEndpoints(f.api, [
        endpoint('other', createProtocolGateway()),
      ])
    );
    /** Worker cleanup returned after explicit endpoint startup; safely repeatable at generation close. */
    const cleanup = await f.app
      .runtime()
      .workers.get('service-endpoints')
      .start({});
    assert.notEqual(group.address('first').port, group.address('second').port);
    client = createServiceClient(
      options(`http://127.0.0.1:${group.address('first').port}/app.Status/Get`)
    );
    /** Absolute authored call deadline propagated to the registered gateway handler. */
    const until = Date.now() + 150;
    assert.deepEqual(
      await client.call({ value: 'normal' }, { deadline: until }),
      { value: 'normal' }
    );
    assert.equal(deadline, until);
    /** Owned client carrying a deliberately invalid authorization value. */
    const denied = createServiceClient(
      options(
        `http://127.0.0.1:${group.address('second').port}/app.Status/Get`,
        { headers: () => ({ authorization: 'denied' }) }
      )
    );
    await assert.rejects(
      denied.call({ value: 'private' }),
      (e) => e.code === 'CALL_HTTP_FAILED'
    );
    await denied.close();
    await cleanup();
    assert.equal(group.address('first'), null);
    assert.equal(group.address('second'), null);
  } finally {
    await client?.close();
    await f.close();
  }
});
test('conflicts and missing endpoint policy reject without listeners; bind failure rolls back siblings', async () => {
  /** Isolated application or pin fixture; no production server or database is used. */
  const f = await fixture();
  /** Test-owned server reserving a port to trigger deterministic bind failure. */
  const blocker = createServer();
  /** Ephemeral reserved port used only for endpoint conflict assertions. */
  const port = await listen(blocker);
  try {
    assert.throws(() =>
      registerServiceEndpoints(f.api, [
        endpoint('a', createProtocolGateway(), { authorize: undefined }),
      ])
    );
    assert.throws(() =>
      registerServiceEndpoints(f.api, [
        endpoint('a', createProtocolGateway(), {
          bind: { host: '127.0.0.1', port },
        }),
        endpoint('b', createProtocolGateway(), {
          bind: { host: '0.0.0.0', port },
        }),
      ])
    );
    /** Generation-owned endpoint registration retaining startup rollback and listener cleanup. */
    const group = registerServiceEndpoints(f.api, [
      endpoint('first', createProtocolGateway()),
      endpoint('blocked', createProtocolGateway(), {
        bind: { host: '127.0.0.1', port },
      }),
    ]);
    await assert.rejects(group.start(), { code: 'TRANSPORT_START_FAILED' });
    assert.equal(group.address('first'), null);
    assert.equal(group.address('blocked'), null);
  } finally {
    await new Promise((r) => blocker.close(r));
    await f.close();
  }
});
test('caller cancellation aborts an in-flight service handler and does not retry a write', async () => {
  /** Isolated application or pin fixture; no production server or database is used. */
  const f = await fixture();
  let client,
    started,
    stopped,
    calls = 0;
  /** Promise proving the synthetic handler/transport started before cancellation. */
  const began = new Promise((r) => (started = r));
  /** Promise proving cooperative handler cancellation reached its terminal callback. */
  const ended = new Promise((r) => (stopped = r));
  try {
    /** Explicitly configured protocol gateway for the cancellable write fixture. */
    const gateway = createProtocolGateway({ authorize: () => true });
    gateway.connect.register(
      'app.Write',
      'Run',
      (_input, { signal }) =>
        new Promise((resolve) => {
          calls++;
          started();
          signal.addEventListener(
            'abort',
            () => {
              stopped();
              resolve({ value: 'cancelled' });
            },
            { once: true }
          );
        })
    );
    /** Generation-owned endpoint registration retaining startup rollback and listener cleanup. */
    const group = registerServiceEndpoints(f.api, [
      endpoint('writer', gateway),
    ]);
    await group.start();
    client = createServiceClient(
      options(`http://127.0.0.1:${group.address('writer').port}/app.Write/Run`)
    );
    /** Caller cancellation owner; abort must never trigger automatic mutation replay. */
    const controller = new AbortController();
    /** Pending client request whose cancellation and capacity are asserted. */
    const call = client.call({ value: 'write' }, { signal: controller.signal });
    /** Expected cancellation rejection attached before aborting the request. */
    const rejected = assert.rejects(call, (e) => e.code === 'CALL_CANCELLED');
    await began;
    controller.abort();
    await rejected;
    await ended;
    assert.equal(calls, 1);
    assert.equal(client.activeCalls, 0);
  } finally {
    await client?.close();
    await f.close();
  }
});
test('client bounds, response cleanup, explicit retry policy and closed use', async () => {
  let calls = 0,
    cancelled = 0;
  /** Build bounded client options with a local injected transport.
   * @param {object} [extra] - Explicit fixture policy/transport overrides.
   * @returns {object} Client settings with no remote network dependency.
   */
  const make = (extra = {}) =>
    options('http://127.0.0.1:12345/test', {
      transport: async () => {
        calls++;
        return Response.json({ value: 'ok' });
      },
      ...extra,
    });
  assert.throws(() =>
    createServiceClient(make({ retry: { maxAttempts: 2, idempotent: false } }))
  );
  assert.throws(() =>
    createServiceClient(make({ allowDestination: () => false }))
  );
  /** Owned client rejecting oversized request data before transport execution. */
  const limited = createServiceClient(make({ maxPayloadBytes: 8 }));
  await assert.rejects(
    limited.call({ value: 'too large' }),
    (e) => e.code === 'PAYLOAD_LIMIT'
  );
  assert.equal(calls, 0);
  await limited.close();
  await assert.rejects(limited.call({}), (e) => e.code === 'CLIENT_CLOSED');
  /** Owned client permitting only the explicitly declared idempotent retry. */
  const retry = createServiceClient(
    make({
      retry: { maxAttempts: 2, idempotent: true },
      transport: async () => {
        calls++;
        return calls === 1
          ? new Response('failure', { status: 503 })
          : Response.json({ value: 'retry' });
      },
    })
  );
  assert.deepEqual(await retry.call({}), { value: 'retry' });
  assert.equal(calls, 2);
  await retry.close();
  /** Owned client cancelling its injected oversized response stream. */
  const oversized = createServiceClient(
    make({
      maxPayloadBytes: 8,
      transport: async () =>
        new Response(
          new ReadableStream({
            /** Enqueue an oversized chunk without closing, requiring client body-budget cancellation.
             * @param {ReadableStreamDefaultController} c - Injected response stream controller.
             * @returns {void} Produces only the controlled oversized fixture chunk.
             */
            start(c) {
              c.enqueue(new Uint8Array(9));
            },
            /** Record cancellation of the injected oversized response source.
             * @returns {void} Increments the response-source cleanup counter.
             */
            cancel() {
              cancelled++;
            },
          }),
          { headers: { 'content-type': 'application/json' } }
        ),
    })
  );
  await assert.rejects(oversized.call({}), (e) => e.code === 'CALL_BODY_LIMIT');
  assert.equal(cancelled, 1);
  await oversized.close();
  /** Owned client whose injected transport cooperates with request deadline cancellation. */
  const slow = createServiceClient(
    make({
      timeoutMs: 10,
      transport: async (req) =>
        new Promise((_resolve, reject) =>
          req.signal.addEventListener('abort', () => reject(Error('private')), {
            once: true,
          })
        ),
    })
  );
  await assert.rejects(
    slow.call({}),
    (e) => e.code === 'CALL_CANCELLED' && !e.message.includes('private')
  );
  assert.equal(slow.activeCalls, 0);
  await slow.close();
});
/** Create a synthetic shared-pin facade exercising actual transaction orchestration.
 * @returns {object} Operation log and facade using the real createPinnedTransaction contract.
 */
function pinned() {
  /** Synthetic pin operation receipts proving business and outbox writes share one lease. */
  const log = [];
  let id = 0;
  /** Explicit synthetic serializable pin capability contract; no native driver guarantee is inferred. */
  const capabilities = {
    isolationLevels: ['serializable'],
    timeout: 'cooperative',
    savepoints: false,
    transactionalDdl: false,
  };
  /** Injected pinned adapter recording begin/execute/commit/rollback/release ordering. */
  const adapter = {
    capabilities,
    /** Acquire a fresh synthetic lease whose operations retain the same pin identity.
     * @returns {Promise<object>} Lease callbacks recording transaction ownership and release.
     */
    async acquire() {
      /** Unique synthetic lease identifier retained across all transaction operations. */
      const pin = ++id;
      return {
        /** Record transaction start on this acquired lease.
         * @returns {void} Appends the begin receipt for the current pin.
         */
        begin() {
          log.push(['begin', pin]);
        },
        /** Record a query on the same synthetic lease.
         * @param {{table: string}} operation - Authored business/outbox query operation.
         * @returns {object} Successful affected-row receipt for the fixture operation.
         */
        execute(operation) {
          log.push([operation.table, pin]);
          return { ok: true, affectedCount: 1 };
        },
        /** Record successful completion on the acquired transaction pin.
         * @returns {void} Appends the commit receipt.
         */
        commit() {
          log.push(['commit', pin]);
        },
        /** Record failed completion on the acquired transaction pin.
         * @returns {void} Appends the rollback receipt.
         */
        rollback() {
          log.push(['rollback', pin]);
        },
        /** Record lease release after its transaction terminal action.
         * @returns {void} Appends the release receipt.
         */
        release() {
          log.push(['release', pin]);
        },
      };
    },
  };
  return {
    log,
    facade: {
      transaction: createPinnedTransaction(adapter, {
        name: 'test',
        slug: 'test',
        connector: 'synthetic',
        options: {},
      }),
      transactionCapabilities: () => capabilities,
    },
  };
}
test('outbox uses the real shared pin, awaits journal writes and rolls back on journal failure', async () => {
  assert.throws(
    () =>
      createTransactionalOutbox(
        {},
        {
          /** Exercise the declared journal writer; successful writes use the supplied pin.
           * @returns {void | Promise<void>} Fixture write completion; the failure fixture deliberately throws.
           */
          enqueue() {},
        }
      ),
    (e) => e.code === 'OUTBOX_PINNED_TRANSACTION_REQUIRED'
  );
  /** Isolated application or pin fixture; no production server or database is used. */
  const f = pinned();
  let pin, escaped;
  /** Pin-consuming outbox wrapper borrowing the explicit facade and journal writer. */
  const outbox = createTransactionalOutbox(f.facade, {
    /** Exercise the declared journal writer; successful writes use the supplied pin.
     * @param {object} tx - Pinned transaction shared with the business mutation.
     * @param {object} event - Synthetic bounded outbox record.
     * @returns {void | Promise<void>} Fixture write completion; the failure fixture deliberately throws.
     */
    async enqueue(tx, event) {
      assert.equal(tx, pin);
      await tx.query({ op: 'insert', table: 'outbox', values: event });
    },
  });
  await outbox.run(
    async (tx, enqueue) => {
      pin = tx;
      escaped = enqueue;
      await tx.query({ op: 'insert', table: 'business', values: { id: 1 } });
      void enqueue({ id: 2 });
    },
    { isolation: 'serializable' }
  );
  assert.deepEqual(f.log, [
    ['begin', 1],
    ['business', 1],
    ['outbox', 1],
    ['commit', 1],
    ['release', 1],
  ]);
  await assert.rejects(
    escaped({ id: 3 }),
    (e) => e.code === 'OUTBOX_SCOPE_CLOSED'
  );
  /** Separate pin fixture used to prove journal failure rolls back rather than commits. */
  const failed = pinned();
  /** Outbox wrapper with an intentionally failing journal writer. */
  const broken = createTransactionalOutbox(failed.facade, {
    /** Exercise the declared journal writer; successful writes use the supplied pin.
     * @returns {void | Promise<void>} Fixture write completion; the failure fixture deliberately throws.
     */
    enqueue() {
      throw Error('journal failed');
    },
  });
  await assert.rejects(
    broken.run(async (_tx, enqueue) => {
      await enqueue({ id: 1 }).catch(() => {});
    }),
    /journal failed/
  );
  assert.deepEqual(failed.log, [
    ['begin', 1],
    ['rollback', 1],
    ['release', 1],
  ]);
});

test('outbox budgets taint the pin even if application code catches enqueue failures', async () => {
  /** Isolated application or pin fixture; no production server or database is used. */
  const f = pinned();
  /** Pin-consuming outbox wrapper borrowing the explicit facade and journal writer. */
  const outbox = createTransactionalOutbox(f.facade, {
    /** Exercise the declared journal writer; successful writes use the supplied pin.
     * @returns {void | Promise<void>} Fixture write completion; the failure fixture deliberately throws.
     */
    enqueue() {},
  });
  await assert.rejects(
    outbox.run(async (_tx, enqueue) => {
      for (let i = 0; i < 65; i++) {
        await enqueue({ id: i }).catch(() => {});
      }
    }),
    (e) => e.code === 'OUTBOX_EVENT_LIMIT'
  );
  assert.equal(
    f.log.some(([name]) => name === 'commit'),
    false
  );
  assert.equal(f.log.at(-1)[0], 'release');
});

test('noncooperative client transport retains capacity until its actual settlement', async () => {
  let finish, started;
  /** Promise proving the synthetic handler/transport started before cancellation. */
  const began = new Promise((resolve) => (started = resolve));
  /** Owned bounded client retaining its active slot until a noncooperating transport settles. */
  const client = createServiceClient(
    options('http://127.0.0.1:1/call', {
      maxConcurrent: 1,
      transport: async () => {
        started();
        return new Promise(
          (resolve) =>
            (finish = () => resolve(Response.json({ value: 'late' })))
        );
      },
    })
  );
  /** Caller cancellation owner; abort must never trigger automatic mutation replay. */
  const controller = new AbortController();
  /** Pending client request whose cancellation and capacity are asserted. */
  const call = client.call({}, { signal: controller.signal });
  /** Expected cancellation rejection attached before aborting the request. */
  const rejected = assert.rejects(call, (e) => e.code === 'CALL_CANCELLED');
  await began;
  controller.abort();
  assert.equal(client.activeCalls, 1);
  await assert.rejects(client.call({}), (e) => e.code === 'CLIENT_OVERLOAD');
  finish();
  await rejected;
  assert.equal(client.activeCalls, 0);
  await client.close();
});
