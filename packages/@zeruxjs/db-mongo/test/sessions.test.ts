/** Node test registry; all native transports are explicitly injected or separately gated. */
const { test } = require('node:test');
/** Strict assertions; compilation alone does not prove native behavior. */
const assert = require('node:assert/strict');
/** Public connector and structured validation APIs under test. */
const {
  createConnector,
  buildWhere,
  buildProjection,
  buildSort,
  assertSafeDocument,
} = require('../dist/index.js');
/** Synthetic private connection identity and options. */
const context = {
  connection: { slug: 'main', connector: 'mongo', name: 'Main', options: {} },
};
/** Explicit safe identity predicate shared by synthetic writes. */
const where = { field: 'id', operator: 'eq', value: 'one' };
/** Own synthetic deployment/session observations without opening a native client or server.
 * @param {Record<string,unknown>} options - Explicit hello/commit/abort/end failure scripts.
 * @returns {object} Independent native-shaped client, database, sessions and close counter.
 */
function fixture(options = {}) {
  /** Synthetic deployment/session/CRUD observations; no credentials or live data. */
  const events = [];
  /** Distinct acquired fixture sessions retained for identity assertions. */
  const sessions = [];
  let closes = 0;
  /** Scripted native collection retaining the actual options/session argument. */
  const collection = {
    insertOne: async (doc, opts) => {
      events.push(['insert', opts]);
      return { insertedId: 'one' };
    },
    insertMany: async (docs, opts) => {
      events.push(['insertMany', opts]);
      return { insertedIds: { 0: 'one' } };
    },
    updateMany: async (q, values, opts) => {
      events.push(['update', opts]);
      return { matchedCount: 1, modifiedCount: 0 };
    },
    deleteMany: async (q, opts) => {
      events.push(['delete', opts]);
      return { deletedCount: 1 };
    },
    find(q, opts) {
      events.push(['find', opts]);
      return { toArray: async () => [] };
    },
    aggregate(pipeline, opts) {
      events.push(['aggregate', opts]);
      return { toArray: async () => [] };
    },
  };
  /** Borrowed native-shaped database or connector wrapper, disposed after assertions. */
  const db = {
    collection: () => collection,
    command: async (cmd, opts) => {
      events.push(['hello', cmd, opts]);
      if (options.probeFailure) {
        throw options.probeFailure;
      }
      return (
        options.hello ?? {
          setName: 'rs0',
          maxWireVersion: 17,
          logicalSessionTimeoutMinutes: 30,
        }
      );
    },
  };
  /** Borrowed session-capable synthetic client; close count remains host-owned. */
  const client = {
    db: () => db,
    close: async () => {
      closes++;
    },
    startSession() {
      /** One synthetic native session used for begin/commit/abort/end observations. */
      const session = {
        startTransaction(opts) {
          events.push(['begin', session, opts]);
        },
        async commitTransaction() {
          events.push(['commit', session]);
          if (options.commitError) {
            /** Explicit synthetic native failure/label used to test commit-only retry. */
            const error = options.commitError;
            options.commitError = undefined;
            throw error;
          }
        },
        async abortTransaction() {
          events.push(['abort', session]);
          if (options.abortError) {
            throw options.abortError;
          }
        },
        async endSession() {
          events.push(['end', session]);
          if (options.endError) {
            throw options.endError;
          }
        },
      };
      sessions.push(session);
      return session;
    },
  };
  return { client, db, collection, events, sessions, closes: () => closes };
}
test('one pinned native session reaches every CRUD and aggregation path', async (t) => {
  /** Independent injected session/deployment fixture. */
  const f = fixture();
  /** Borrowed native-shaped database or connector wrapper, disposed after assertions. */
  const db = await createConnector({ client: f.client, transactions: true });
  t.after(() => db.disconnect());
  assert.equal(db.capabilities.transactions, 'supported');
  assert.equal(db.capabilities.cancellation, 'unsupported');
  await db.transaction(
    async (tx) => {
      await tx.insert({ table: 'items', values: { id: 'one' } });
      await tx.insert({ table: 'items', values: [{ id: 'two' }] });
      await tx.select({ table: 'items', where });
      /** No-op native update proving matchedCount is distinct from modifiedCount. */
      const update = await tx.update({
        table: 'items',
        values: { name: 'Ada' },
        where,
      });
      assert.equal(update.affectedCount, 0);
      assert.equal(update.matchedCount, 1);
      await tx.delete({ table: 'items', where });
      await tx.select({
        table: 'items',
        columns: [
          {
            expr: {
              kind: 'function',
              name: 'COUNT',
              args: [{ kind: 'column', name: 'id' }],
            },
            as: 'event_count',
          },
        ],
      });
    },
    { isolation: 'snapshot' }
  );
  // Verify every CRUD/cursor call received the one acquired native session.
  for (const [name, opts] of f.events.filter((e) =>
    ['insert', 'insertMany', 'find', 'update', 'delete', 'aggregate'].includes(
      e[0]
    )
  )) {
    assert.equal(opts.session, f.sessions[0], name);
  }
  assert.deepEqual(
    f.events
      .filter((e) => ['begin', 'commit', 'abort', 'end'].includes(e[0]))
      .map((e) => e[0]),
    ['begin', 'commit', 'end']
  );
  await db.disconnect();
  await db.disconnect();
  assert.equal(f.closes(), 0);
  assert.throws(
    () => db.execute({ op: 'select', table: 'items' }, context),
    /closed/
  );
});
test('standalone, database-only and unsupported isolation fail before a callback/session', async (t) => {
  /** Fixture lacking replica-set/mongos facts; opt-in must reject before sessions. */
  const standalone = fixture({
    hello: { maxWireVersion: 17, logicalSessionTimeoutMinutes: 30 },
  });
  await assert.rejects(
    createConnector({ client: standalone.client, transactions: true }),
    /deployment/
  );
  assert.equal(standalone.sessions.length, 0);
  assert.equal(standalone.closes(), 0);
  await assert.rejects(
    createConnector({ db: standalone.db, transactions: true }),
    /client/
  );
  /** Independent injected session/deployment fixture. */
  const f = fixture();
  /** Borrowed native-shaped database or connector wrapper, disposed after assertions. */
  const db = await createConnector({ client: f.client });
  t.after(() => db.disconnect());
  assert.equal(f.events.length, 0);
  await assert.rejects(
    db.transaction(() => {}),
    /explicit enablement/
  );
  await db.disconnect();
  /** Explicitly enabled/probed wrapper used for isolation-negotiation denial. */
  const enabled = await createConnector({
    client: f.client,
    transactions: true,
  });
  t.after(() => enabled.disconnect());
  await assert.rejects(
    enabled.transaction(
      () => {
        throw Error('must not run');
      },
      { isolation: 'serializable' }
    ),
    /isolation/
  );
  assert.equal(f.sessions.length, 0);
  await enabled.disconnect();
});
test('only uncertain commit retries, bounded without callback replay', async (t) => {
  /** Explicit synthetic native failure/label used to test commit-only retry. */
  const error = Object.assign(Error('uncertain commit'), {
    hasErrorLabel: (label) => label === 'UnknownTransactionCommitResult',
  });
  /** Independent injected session/deployment fixture. */
  const f = fixture({ commitError: error });
  /** Borrowed native-shaped database or connector wrapper, disposed after assertions. */
  const db = await createConnector({
    client: f.client,
    transactions: true,
    maxCommitAttempts: 2,
  });
  t.after(() => db.disconnect());
  let callbacks = 0;
  await db.transaction(() => {
    callbacks++;
  });
  assert.equal(callbacks, 1);
  assert.equal(f.events.filter((e) => e[0] === 'commit').length, 2);
  assert.equal(f.sessions.length, 1);
  assert.equal(f.events.filter((e) => e[0] === 'end').length, 1);
  await db.disconnect();
  /** Independent commit-error fixture with no retry budget. */
  const exhausted = fixture({ commitError: error });
  /** Default single-attempt commit wrapper; callback is never replayed. */
  const once = await createConnector({
    client: exhausted.client,
    transactions: true,
  });
  t.after(() => once.disconnect());
  await assert.rejects(once.transaction(() => {}));
  assert.equal(exhausted.events.filter((e) => e[0] === 'commit').length, 1);
  assert.equal(exhausted.events.filter((e) => e[0] === 'abort').length, 1);
  await once.disconnect();
});
test('transient callback failure aborts/ends once without replay, retaining cleanup errors', async (t) => {
  /** Independent injected session/deployment fixture. */
  const f = fixture({
    abortError: Error('abort failed'),
    endError: Error('end failed'),
  });
  /** Borrowed native-shaped database or connector wrapper, disposed after assertions. */
  const db = await createConnector({ client: f.client, transactions: true });
  t.after(() => db.disconnect());
  let calls = 0;
  await assert.rejects(
    db.transaction(() => {
      calls++;
      throw Object.assign(Error('transient'), { hasErrorLabel: () => true });
    }),
    AggregateError
  );
  assert.equal(calls, 1);
  assert.deepEqual(
    f.events.filter((e) => ['abort', 'end'].includes(e[0])).map((e) => e[0]),
    ['abort', 'end']
  );
  await db.disconnect();
});
test('cooperative abort drains native work before abort/end and keeps sessions isolated', async (t) => {
  /** Independent injected session/deployment fixture. */
  const f = fixture();
  let settle, ready;
  /** Handshake proving native work began before cooperative abort assertions. */
  const started = new Promise((r) => {
    ready = r;
  });
  f.collection.updateMany = (q, values, opts) => {
    f.events.push(['update', opts]);
    ready();
    return new Promise((r) => {
      settle = r;
    });
  };
  /** Borrowed native-shaped database or connector wrapper, disposed after assertions. */
  const db = await createConnector({ client: f.client, transactions: true });
  t.after(() => db.disconnect());
  /** One transaction caller cancellation signal. */
  const controller = new AbortController();
  /** Accepted pinned transaction retained until its native work settles. */
  const work = db.transaction(
    (tx) => tx.update({ table: 'items', values: { name: 'new' }, where }),
    { signal: controller.signal }
  );
  await started;
  await db.transaction((tx) => tx.select({ table: 'items' }));
  assert.notEqual(f.sessions[0], f.sessions[1]);
  controller.abort();
  await new Promise((r) => setImmediate(r));
  assert.equal(
    f.events.some((e) => e[0] === 'end' && e[1] === f.sessions[0]),
    false
  );
  settle({ matchedCount: 1, modifiedCount: 1 });
  await assert.rejects(work);
  assert.equal(f.events.filter((e) => e[0] === 'abort').length, 1);
  await db.disconnect();
});
test('operator/aggregation injection and invalid index reject without native mutations', async (t) => {
  /** Independent injected session/deployment fixture. */
  const f = fixture();
  /** Borrowed native-shaped database or connector wrapper, disposed after assertions. */
  const db = await createConnector({ db: f.db });
  t.after(() => db.disconnect());
  // Reject raw native selector operands before any collection operation.
  for (const value of [{ $ne: null }, { kind: 'value', value: { $gt: 0 } }]) {
    assert.throws(() => buildWhere({ field: 'id', operator: 'eq', value }));
  }
  // Reject executable/unknown projection expression objects.
  for (const expr of [
    { kind: 'bad', $function: { body: 'evil' } },
    { kind: 'value', value: { $where: 'evil' } },
  ]) {
    assert.throws(() =>
      buildProjection({
        op: 'select',
        table: 'items',
        columns: [{ expr, as: 'v' }],
      })
    );
  }
  assert.deepEqual(
    buildProjection({
      op: 'select',
      table: 'items',
      columns: [{ expr: { kind: 'value', value: '$private' }, as: 'v' }],
    }),
    { v: { $literal: '$private' } }
  );
  assert.throws(() => buildWhere({ and: [], field: 'id' }));
  assert.throws(() =>
    buildSort({ orderBy: [{ by: 'id', direction: 'sideways' }] })
  );
  assert.throws(() => assertSafeDocument({}, NaN));
  await assert.rejects(
    db.execute({ op: 'select', table: 'items', groupBy: ['$where'] }, context)
  );
  await assert.rejects(
    db.execute(
      { op: 'update', table: 'items', values: { name: 'bad' } },
      context
    )
  );
  await assert.rejects(
    db.execute(
      {
        op: 'createTable',
        table: 'items',
        indexes: [{ name: 'bad', columns: ['$where'] }],
      },
      context
    )
  );
  assert.equal(f.events.length, 0);
  await db.disconnect();
});
test('probe failures and budgets do not create sessions or close borrowed clients', async () => {
  /** Independent injected session/deployment fixture. */
  const f = fixture({ probeFailure: Error('unavailable') });
  await assert.rejects(
    createConnector({ client: f.client, transactions: true }),
    /unavailable/
  );
  assert.equal(f.sessions.length, 0);
  assert.equal(f.closes(), 0);
  // Reject each invalid opt-in/session budget before a session can be acquired.
  for (const config of [
    { maxCommitAttempts: 4 },
    { maxSessions: 0 },
    { transactions: 'yes' },
    { allowUnfilteredWrites: 'true' },
  ]) {
    await assert.rejects(createConnector({ ...config, client: f.client }));
  }
  /** Uncooperative read-only probe fixture; no session should be acquired. */
  const slow = fixture();
  slow.db.command = () => new Promise(() => {});
  await assert.rejects(
    createConnector({
      client: slow.client,
      transactions: true,
      probeTimeoutMS: 5,
    }),
    /timeout/
  );
  assert.equal(slow.sessions.length, 0);
});
test('manager consumes Mongo adapter and pins one session for callback operations', async () => {
  /** Actual public named-manager consumer of the Mongo adapter. */
  const { createDatabaseManager } = require('@zeruxjs/db');
  /** Independent injected session/deployment fixture. */
  const f = fixture();
  /** Owned manager disconnected before releasing the borrowed fixture client. */
  const manager = await createDatabaseManager({
    connections: [
      {
        name: 'Main',
        slug: 'main',
        connector: '@zeruxjs/db-mongo',
        options: { client: f.client, transactions: true },
      },
    ],
  });
  try {
    assert.equal(manager.capabilities().transactions, 'supported');
    await manager.transaction(async (tx) => {
      await tx.select({ table: 'items' });
      await tx.update({ table: 'items', values: { revision: 2 }, where });
    });
    assert.equal(f.sessions.length, 1);
    assert.equal(f.events.filter((e) => e[0] === 'end').length, 1);
  } finally {
    await manager.disconnect();
  }
  assert.equal(f.closes(), 0);
});
test('session capacity, sharded probe and nonnegative exact counts are enforced', async (t) => {
  /** Independent injected session/deployment fixture. */
  const f = fixture({
    hello: {
      msg: 'isdbgrid',
      maxWireVersion: 8,
      logicalSessionTimeoutMinutes: 30,
    },
  });
  /** Borrowed native-shaped database or connector wrapper, disposed after assertions. */
  const db = await createConnector({
    client: f.client,
    transactions: true,
    maxSessions: 1,
  });
  t.after(() => db.disconnect());
  let finish, ready;
  /** Explicit gate keeping one session active for capacity testing. */
  const wait = new Promise((r) => {
    finish = r;
  });
  /** Handshake proving native work began before cooperative abort assertions. */
  const started = new Promise((r) => {
    ready = r;
  });
  /** Accepted transaction retaining the one available session slot. */
  const first = db.transaction(async () => {
    ready();
    await wait;
  });
  await started;
  await assert.rejects(
    db.transaction(() => {}),
    /limit/
  );
  finish();
  await first;
  await db.disconnect();
  /** Independent trusted executor wrapper returning an invalid native count. */
  const invalid = await createConnector({
    executor: () => ({ modifiedCount: -1 }),
  });
  t.after(() => invalid.disconnect());
  await assert.rejects(
    invalid.execute(
      { op: 'update', table: 'items', values: { revision: 2 }, where },
      context
    ),
    /count/
  );
  await invalid.disconnect();
});
test('DDL, native returning and unsafe document shape never reach an acquired session', async (t) => {
  /** Independent injected session/deployment fixture. */
  const f = fixture();
  /** Borrowed native-shaped database or connector wrapper, disposed after assertions. */
  const db = await createConnector({ client: f.client, transactions: true });
  t.after(() => db.disconnect());
  await assert.rejects(
    db.transaction((tx) => tx.createTable({ table: 'items', columns: [] })),
    /DDL/
  );
  await assert.rejects(
    db.transaction((tx) =>
      tx.update({
        table: 'items',
        values: { revision: 2 },
        where,
        returning: ['id'],
      })
    )
  );
  await assert.rejects(
    db.execute(
      { op: 'update', table: 'items', values: [{ revision: 2 }], where },
      context
    )
  );
  assert.equal(
    f.events.some((e) => e[0] === 'update'),
    false
  );
  assert.equal(f.events.filter((e) => e[0] === 'end').length, 2);
  await db.disconnect();
});
