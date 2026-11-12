import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
/** Public native-pool wrapper under test. */
const { createConnector } = createRequire(import.meta.url)('../dist/index.js');
/** Synthetic private execution context. */
const ctx = {
  connection: { slug: 'test', connector: 'mysql', name: 'test', options: {} },
};
/** One inert version-checked update candidate. */
const update = {
  op: 'update',
  table: 'jobs',
  values: { revision: 2 },
  where: { field: 'revision', operator: 'eq', value: 1 },
};
/** Provide one scripted native lease and explicit release/destroy/end counters without a server.
 * @param {string|undefined} fail - Optional fixed transaction-control statement that rejects.
 * @returns {object} Independent native-shaped pool plus observed ownership.
 */
function fixture(fail) {
  /** Ordered synthetic control/execute observations without a native server. */
  const calls = [];
  let releases = 0,
    destroyed = 0,
    ended = 0;
  /** Scripted lease exposing query/execute/release/destroy ownership. */
  const connection = {
    query: async (sql) => {
      calls.push(sql);
      if (sql === fail) {
        throw new Error('dependency failure');
      }
      return [{}, []];
    },
    execute: async (sql, args) => {
      calls.push([sql, args]);
      return [
        { affectedRows: 0, changedRows: 0, insertId: '9007199254740993' },
        [],
      ];
    },
    release() {
      releases++;
    },
    destroy() {
      destroyed++;
    },
  };
  return {
    calls,
    connection,
    pool: {
      getConnection: async () => connection,
      execute: connection.execute,
      end: async () => {
        ended++;
      },
    },
    counts: () => ({ releases, destroyed, ended }),
  };
}
test('pinned transaction, zero CAS counts, placeholders and borrowed ownership', async (t) => {
  /** Independent borrowed native-pool fixture. */
  const f = fixture();
  /** Owned wrapper disconnected after each test; native fixture pool stays borrowed. */
  const db = await createConnector({
    pool: f.pool,
    affectedRowsMode: 'matched',
  });
  t.after(() => db.disconnect());
  await db.transaction(
    async (tx) => {
      /** Normalized callback/operation result checked for zero precedence or cancellation. */
      const result = await tx.update({
        table: 'jobs',
        values: { revision: 2 },
        where: { field: 'revision', operator: 'eq', value: 1 },
      });
      assert.equal(result.affectedCount, 0);
      assert.equal(result.matchedCount, 0);
      assert.equal(result.changedCount, 0);
    },
    { isolation: 'serializable' }
  );
  assert.equal(f.calls[0], 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  assert.deepEqual(f.calls[2][1], [2, 1]);
  assert.equal(f.calls.at(-1), 'COMMIT');
  await db.disconnect();
  assert.deepEqual(f.counts(), { releases: 1, destroyed: 0, ended: 0 });
});
test('callback and commit failures roll back; failed cleanup destroys', async (t) => {
  // Exercise callback/commit/rollback failure combinations without a native server.
  for (const fail of [undefined, 'COMMIT', 'ROLLBACK']) {
    /** Independent borrowed native-pool fixture. */
    const f = fixture(fail);
    /** Owned wrapper disconnected after each test; native fixture pool stays borrowed. */
    const db = await createConnector({ pool: f.pool });
    t.after(() => db.disconnect());
    await assert.rejects(
      db.transaction(async () => {
        if (fail !== 'COMMIT') {
          throw new Error('callback');
        }
      })
    );
    assert.ok(f.calls.includes('ROLLBACK'));
    assert.equal(f.counts().releases + f.counts().destroyed, 1);
    if (fail) {
      assert.equal(f.counts().destroyed, 1);
    }
    await db.disconnect();
  }
});
test('late acquisition releases once and retains capacity until settlement', async (t) => {
  /** Independent borrowed native-pool fixture. */
  const f = fixture();
  let resolve;
  f.pool.getConnection = () =>
    new Promise((r) => {
      resolve = r;
    });
  /** Owned wrapper disconnected after each test; native fixture pool stays borrowed. */
  const db = await createConnector({
    pool: f.pool,
    acquireTimeoutMs: 5,
    maxPendingAcquires: 1,
  });
  t.after(() => db.disconnect());
  await assert.rejects(db.execute(update, ctx), /deadline/);
  await assert.rejects(db.execute(update, ctx), /capacity/);
  resolve(f.connection);
  await new Promise((r) => setImmediate(r));
  assert.equal(f.counts().releases, 1);
  await db.disconnect();
});
test('unsafe config/returning reject before executing; changed counts and precise IDs', async (t) => {
  // Reject unsupported TLS/multi-statement/acquisition policy before pool use.
  for (const options of [
    { multipleStatements: true },
    { ssl: { rejectUnauthorized: false } },
    { ssl: 'Amazon RDS' },
    { acquireTimeoutMs: 0 },
  ]) {
    await assert.rejects(createConnector(options));
  }
  /** Independent borrowed native-pool fixture. */
  const f = fixture();
  /** Owned wrapper disconnected after each test; native fixture pool stays borrowed. */
  const db = await createConnector({
    pool: f.pool,
    affectedRowsMode: 'changed',
  });
  t.after(() => db.disconnect());
  assert.throws(() => db.execute({ ...update, returning: ['id'] }, ctx));
  assert.equal(f.calls.length, 0);
  assert.equal((await db.execute(update, ctx)).changedCount, 0);
  assert.deepEqual(
    (
      await db.execute(
        { op: 'insert', table: 'jobs', values: { revision: 1 } },
        ctx
      )
    ).insertedIds,
    ['9007199254740993']
  );
  await db.disconnect();
  assert.throws(() => db.execute(update, ctx), /closed/);
});
test('cooperative cancellation waits before rollback and release', async (t) => {
  /** Independent borrowed native-pool fixture. */
  const f = fixture();
  let settle, started;
  /** Handshake proving accepted native execution before cooperative abort. */
  const ready = new Promise((r) => {
    started = r;
  });
  f.connection.execute = () => {
    started();
    return new Promise((r) => {
      settle = r;
    });
  };
  /** One caller cancellation signal, not forced native query cancellation. */
  const controller = new AbortController();
  /** Owned wrapper disconnected after each test; native fixture pool stays borrowed. */
  const db = await createConnector({ pool: f.pool });
  t.after(() => db.disconnect());
  /** Normalized callback/operation result checked for zero precedence or cancellation. */
  const result = db.transaction(
    (tx) => tx.update({ table: 'jobs', values: { revision: 2 } }),
    { signal: controller.signal }
  );
  await ready;
  controller.abort();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.counts().releases, 0);
  settle([{ affectedRows: 1 }, []]);
  await assert.rejects(result);
  assert.equal(f.calls.at(-1), 'ROLLBACK');
  assert.equal(f.counts().releases, 1);
  await db.disconnect();
});
test('query-only injection cannot advertise transactions', async (t) => {
  /** Owned wrapper disconnected after each test; native fixture pool stays borrowed. */
  const db = await createConnector({ executor: () => ({ affectedRows: 0 }) });
  t.after(() => db.disconnect());
  assert.equal(db.capabilities.transactions, 'unsupported');
  await assert.rejects(
    db.transaction(() => {}),
    /unavailable/
  );
  await db.disconnect();
});
test('write tuples unwrap missing field metadata; unsafe injected integers reject', async (t) => {
  /** Owned wrapper disconnected after each test; native fixture pool stays borrowed. */
  const db = await createConnector({
    client: {
      execute: async () => [
        { affectedRows: 1, insertId: '9007199254740993' },
        undefined,
      ],
    },
  });
  t.after(() => db.disconnect());
  assert.deepEqual(
    (
      await db.execute(
        { op: 'insert', table: 'jobs', values: { revision: 1 } },
        ctx
      )
    ).insertedIds,
    ['9007199254740993']
  );
  await db.disconnect();
  /** Independent wrapper whose injected parser returned an unsafe integer. */
  const unsafe = await createConnector({
    executor: () => [{ id: 9007199254740992 }],
  });
  t.after(() => unsafe.disconnect());
  await assert.rejects(
    unsafe.execute({ op: 'select', table: 'jobs' }, ctx),
    /Unsafe MySQL integer/
  );
  await unsafe.disconnect();
});
test('owned pool precision/TLS policies are configured lazily without networking', async (t) => {
  /** Owned wrapper disconnected after each test; native fixture pool stays borrowed. */
  const db = await createConnector({ ssl: {}, affectedRowsMode: 'changed' });
  t.after(() => db.disconnect());
  /** Lazy owned pool configuration inspected without executing or connecting. */
  const config = db.getNativeConnection().pool.config.connectionConfig;
  assert.equal(config.multipleStatements, false);
  assert.equal(config.supportBigNumbers, true);
  assert.equal(config.bigNumberStrings, true);
  assert.equal(config.decimalNumbers, false);
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.verifyIdentity, true);
  assert.equal(config.clientFlags & 2, 0);
  await db.disconnect();
  await db.disconnect();
});
test('shared manager consumes MySQL pin and closes without ending borrowed pool', async () => {
  /** Actual named-manager consumer of the MySQL pin contract. */
  const { createDatabaseManager } = await import('@zeruxjs/db');
  /** Independent borrowed native-pool fixture. */
  const f = fixture();
  /** Owned manager closed before asserting the pool remains borrowed. */
  const manager = await createDatabaseManager({
    connections: [
      {
        name: 'Main',
        slug: 'main',
        connector: '@zeruxjs/db-mysql',
        options: { pool: f.pool, affectedRowsMode: 'matched' },
      },
    ],
  });
  try {
    assert.equal(manager.capabilities().transactions, 'supported');
    await manager.transaction(async (tx) => {
      await tx.update({ table: 'jobs', values: { revision: 2 } });
      await tx.update({ table: 'jobs', values: { revision: 3 } });
    });
    assert.equal(f.counts().releases, 1);
  } finally {
    await manager.disconnect();
  }
  assert.equal(f.counts().ended, 0);
});
test('disconnect waits for an accepted pin before pool cleanup', async (t) => {
  /** Independent borrowed native-pool fixture. */
  const f = fixture();
  let finish, ready;
  /** Handshake proving the pinned callback entered before shutdown. */
  const started = new Promise((r) => {
    ready = r;
  });
  /** Explicit callback gate keeping one lease active during drain assertions. */
  const wait = new Promise((r) => {
    finish = r;
  });
  /** Owned wrapper disconnected after each test; native fixture pool stays borrowed. */
  const db = await createConnector({ pool: f.pool });
  t.after(() => db.disconnect());
  /** Accepted transaction whose lease cannot release before the callback completes. */
  const transaction = db.transaction(async () => {
    ready();
    await wait;
  });
  await started;
  let closed = false;
  /** Disconnect receipt that must wait for the accepted pin. */
  const shutdown = db.disconnect().then(() => {
    closed = true;
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(closed, false);
  assert.equal(f.counts().releases, 0);
  finish();
  await transaction;
  await shutdown;
  assert.equal(f.counts().releases, 1);
  assert.equal(f.counts().ended, 0);
});
