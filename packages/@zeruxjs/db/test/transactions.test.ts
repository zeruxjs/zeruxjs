/** Node test registry; fixtures own all resources explicitly. */
const { test } = require('node:test');
/** Strict assertions; no test outcome is inferred from successful compilation. */
const assert = require('node:assert/strict');
/** Actual public pin, migration and manager APIs under test. */
const {
  createPinnedTransaction,
  createPinnedMigrationTransaction,
  createDatabaseMigrationRunner,
  createDatabaseManager,
} = require('@zeruxjs/db');
/** Synthetic private connection identity; no native driver opens. */
const config = {
  name: 'Synthetic',
  slug: 'test',
  connector: 'synthetic',
  options: {},
};
/** Check fixed abstraction error classifications.
 * @param {string} expected - Expected stable code.
 * @returns {(error: {details?:{code?:string}})=>boolean} Assertion predicate. */
const code = (expected) => (error) => error.details?.code === expected;
/** Model one pinned native transaction with isolated drafts and failure injection; not a durable adapter.
 * @param {Record<string,unknown>} flags - Explicit synthetic query/commit/rollback/release failure controls.
 * @returns {object} Independent committed state, lifecycle observations and public runner.
 */
function fixture(flags = {}) {
  /** Ordered native-session lifecycle observations with synthetic identities only. */
  const events = [];
  /** Synthetic committed journal/data, detached from each transaction draft. */
  const state = { journal: [], changes: [] };
  let active = 0,
    sequence = 0;
  /** Explicit native-shaped pin fixture; not a production transaction adapter. */
  const adapter = {
    capabilities: {
      isolationLevels: ['serializable'],
      timeout: 'cooperative',
      savepoints: false,
      transactionalDdl: true,
    },
    async acquire() {
      /** Monotonic synthetic lease identity used to detect unpinned execution. */
      const id = ++sequence;
      active++;
      let draft;
      events.push(['acquire', id]);
      return {
        begin() {
          draft = structuredClone(state);
          events.push(['begin', id]);
        },
        execute(operation, ctx) {
          events.push(['execute', id, operation.table]);
          assert.ok(ctx.signal instanceof AbortSignal);
          if (flags.failQuery === 'async') {
            return Promise.reject(Error('private query failure'));
          }
          if (flags.failQuery) {
            throw Error('private query failure');
          }
          if (flags.hang) {
            return new Promise((_, reject) =>
              ctx.signal.addEventListener(
                'abort',
                () => reject(Error('aborted native work')),
                { once: true }
              )
            );
          }
          if (operation.table === 'journal') {
            if (operation.op === 'select') {
              return { ok: true, rows: structuredClone(draft.journal) };
            }
            if (operation.op === 'insert') {
              draft.journal.push(structuredClone(operation.values));
            }
            if (operation.op === 'delete') {
              draft.journal = draft.journal.filter(
                (r) => r.id !== operation.where.value
              );
            }
          } else {
            draft.changes.push(operation.op);
          }
          return { ok: true, affectedCount: 1 };
        },
        commit() {
          events.push(['commit', id]);
          if (flags.failCommit) {
            throw Error('private commit failure');
          }
          state.journal = draft.journal;
          state.changes = draft.changes;
        },
        rollback() {
          events.push(['rollback', id]);
          if (flags.failRollback) {
            throw Error('private rollback failure');
          }
        },
        release() {
          events.push(['release', id]);
          active--;
          if (flags.failRelease) {
            throw Error('private release failure');
          }
        },
      };
    },
  };
  return {
    adapter,
    state,
    events,
    get active() {
      return active;
    },
    transaction: createPinnedTransaction(adapter, config),
  };
}
/** One inert insertion operation reused across callback/rollback checks. */
const operation = { op: 'insert', table: 'data', values: { id: 1 } };
test('pinned scope commits one identity, closes captured scope and rejects nesting', async () => {
  /** Independently owned synthetic transaction fixture. */
  const f = fixture();
  let captured;
  /** Application callback result exposed only after pin cleanup. */
  const value = await f.transaction(
    async (tx) => {
      captured = tx;
      assert.equal('native' in tx, false);
      await tx.query(operation);
      await assert.rejects(
        tx.transaction(() => {}),
        code('NESTED_TRANSACTION_UNSUPPORTED')
      );
      await assert.rejects(
        f.transaction(() => {}),
        code('NESTED_TRANSACTION_UNSUPPORTED')
      );
      return 42;
    },
    { isolation: 'serializable' }
  );
  assert.equal(value, 42);
  assert.equal(f.active, 0);
  assert.deepEqual(new Set(f.events.map((e) => e[1])), new Set([1]));
  assert.throws(
    () => captured.query(operation),
    code('TRANSACTION_SCOPE_CLOSED')
  );
  assert.deepEqual(f.state.changes, ['insert']);
});
test('callback/query failures roll back, including caught query failures and fire-and-forget work', async () => {
  /** Independently owned synthetic transaction fixture. */
  const f = fixture();
  await assert.rejects(
    f.transaction(async (tx) => {
      await tx.query(operation);
      throw Error('callback');
    }),
    /callback/
  );
  assert.deepEqual(f.state.changes, []);
  assert.equal(f.active, 0);
  /** Fixture with a synchronous query failure that must poison the scope. */
  const failed = fixture({ failQuery: true });
  await assert.rejects(
    failed.transaction(async (tx) => {
      try {
        await tx.query(operation);
      } catch {
        /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
      }
    }),
    code('TRANSACTION_ROLLBACK_ONLY')
  );
  assert.equal(failed.active, 0);
  /** Fixture with asynchronous fire-and-forget failure that still forces rollback. */
  const asyncFailure = fixture({ failQuery: 'async' });
  await assert.rejects(
    asyncFailure.transaction((tx) => {
      void tx.query(operation);
    }),
    code('TRANSACTION_ROLLBACK_ONLY')
  );
  assert.equal(asyncFailure.active, 0);
});
test('failed commit, rollback and release retain errors and release the lease once', async () => {
  // Verify each cleanup failure combination still releases the pin exactly once.
  for (const flags of [
    { failCommit: true },
    { failCommit: true, failRollback: true },
    { failRollback: true },
    { failRelease: true },
  ]) {
    /** Independently owned synthetic transaction fixture. */
    const f = fixture(flags);
    await assert.rejects(
      f.transaction(async (tx) => {
        await tx.query(operation);
        if (flags.failRollback && !flags.failCommit) {
          throw Error('callback failure');
        }
      })
    );
    assert.equal(f.active, 0);
    assert.equal(f.events.filter((e) => e[0] === 'release').length, 1);
  }
});
test('negotiation rejects before acquisition and deadline waits for rollback/release', async () => {
  /** Independently owned synthetic transaction fixture. */
  const f = fixture();
  await assert.rejects(
    f.transaction(() => {}, { isolation: 'snapshot' }),
    code('UNSUPPORTED_ISOLATION')
  );
  assert.equal(f.events.length, 0);
  /** Fixture explicitly denying cooperative timeout support. */
  const unsupported = fixture();
  unsupported.adapter.capabilities.timeout = 'unsupported';
  await assert.rejects(
    unsupported.transaction(() => {}, { timeoutMs: 1 }),
    code('UNSUPPORTED_TRANSACTION_TIMEOUT')
  );
  assert.equal(unsupported.events.length, 0);
  /** Fixture whose native promise settles only through cooperative abort. */
  const slow = fixture({ hang: true });
  await assert.rejects(
    slow.transaction((tx) => tx.query(operation), { timeoutMs: 5 }),
    code('TRANSACTION_ABORTED')
  );
  assert.equal(slow.active, 0);
  assert.deepEqual(
    slow.events.slice(-2).map((e) => e[0]),
    ['rollback', 'release']
  );
  /** Disposable SQLite manager proving unsupported shared async pins reject. */
  const db = await createDatabaseManager({
    connections: [
      {
        name: 'SQLite',
        slug: 'main',
        connector: '@zeruxjs/db-sqlite',
        options: { filename: ':memory:', driver: 'node' },
      },
    ],
  });
  try {
    await assert.rejects(
      db.transaction(() => {}),
      code('UNSUPPORTED_TRANSACTION')
    );
  } finally {
    await db.disconnect();
  }
});
/** Serialize synthetic test acquisitions with exact owner-fenced release; not cross-process production exclusion.
 * @returns {object} Reference test lock exposing active owners.
 */
function syntheticLock() {
  let queue = Promise.resolve();
  /** Synthetic lock-owner set; this fixture is not cross-process exclusion. */
  const owners = new Set();
  return {
    owners,
    async acquire({ owner }) {
      let release;
      /** Prior synthetic lock tail or caller cwd retained for ordered cleanup. */
      const previous = queue;
      queue = new Promise((resolve) => (release = resolve));
      await previous;
      owners.add(owner);
      return {
        owner,
        async assertOwned() {
          assert.equal(owners.has(owner), true);
        },
        async release(expected) {
          assert.equal(expected, owner);
          assert.equal(owners.delete(owner), true);
          release();
        },
      };
    },
  };
}
/** Single immutable-by-ownership synthetic migration definition. */
const migrations = [
  {
    id: '2026102601_create_data',
    up: [
      {
        op: 'createTable',
        table: 'data',
        columns: [{ name: 'id', type: 'integer' }],
      },
    ],
    down: [{ op: 'dropTable', table: 'data' }],
  },
];
test('migration lock serializes concurrent runners and pins journal plus operations', async () => {
  /** Independently owned synthetic transaction fixture. */
  const f = fixture();
  /** Synthetic serial lock for shared contract checks, not a production implementation. */
  const lock = syntheticLock();
  /** Explicit lock-and-pin coordinator acquired only when invoked. */
  const transaction = createPinnedMigrationTransaction(f.transaction, {
    lock,
    lockName: 'test-db',
    journalTable: 'journal',
  });
  /** First independent migration runner sharing the same coordinated journal. */
  const a = createDatabaseMigrationRunner(migrations, { transaction });
  /** Second runner racing to apply that same definition. */
  const b = createDatabaseMigrationRunner(migrations, { transaction });
  /** Concurrent runner outcomes; exactly one synthetic apply is expected. */
  const results = await Promise.all([a.apply(), b.apply()]);
  assert.deepEqual(results, [[migrations[0].id], []]);
  assert.equal(f.state.changes.length, 1);
  assert.equal(f.state.journal.length, 1);
  assert.equal(lock.owners.size, 0);
  // Verify every concurrent synthetic lease has exactly one release observation.
  for (const id of new Set(f.events.map((e) => e[1]))) {
    assert.equal(
      f.events.filter((e) => e[1] === id && e[0] === 'release').length,
      1
    );
  }
  await assert.rejects(
    a.rollbackLast(() => 'yes'),
    code('MIGRATION_APPROVAL_REQUIRED')
  );
  assert.equal(f.state.journal.length, 1);
  await a.rollbackLast(() => true);
  assert.equal(f.state.journal.length, 0);
});
test('migration drift identifies checksum mismatch and releases owned lock', async () => {
  /** Independently owned synthetic transaction fixture. */
  const f = fixture();
  /** Synthetic serial lock for shared contract checks, not a production implementation. */
  const lock = syntheticLock();
  /** Explicit lock-and-pin coordinator acquired only when invoked. */
  const transaction = createPinnedMigrationTransaction(f.transaction, {
    lock,
    lockName: 'test-db',
    journalTable: 'journal',
  });
  await createDatabaseMigrationRunner(migrations, { transaction }).apply();
  /** Detached definition intentionally changed to prove checksum drift rejection. */
  const changed = structuredClone(migrations);
  changed[0].down = [{ op: 'delete', table: 'data' }];
  await assert.rejects(
    createDatabaseMigrationRunner(changed, { transaction }).status(),
    (error) =>
      error.details?.code === 'MIGRATION_DRIFT' &&
      error.details.details.reason === 'checksum'
  );
  assert.equal(f.active, 0);
  assert.equal(lock.owners.size, 0);
});
test('accepted operations serialize on the lease and transactional DDL stays opt-in', async () => {
  /** Independently owned synthetic transaction fixture. */
  const f = fixture();
  let active = 0,
    peak = 0;
  /** Captured original synthetic acquisition function before test interception. */
  const acquire = f.adapter.acquire;
  f.adapter.acquire = async (ctx) => {
    /** Acquired native-shaped session whose work must remain pinned. */
    const lease = await acquire(ctx);
    /** Original pinned executor retained while measuring serialized work. */
    const execute = lease.execute;
    lease.execute = async (...args) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(setImmediate);
      try {
        return execute(...args);
      } finally {
        active--;
      }
    };
    return lease;
  };
  await f.transaction(async (tx) => {
    await Promise.all([tx.query(operation), tx.query(operation)]);
  });
  assert.equal(peak, 1);
  assert.equal(f.state.changes.length, 2);
  /** Fixture denying transactional DDL before native execution. */
  const denied = fixture();
  denied.adapter.capabilities.transactionalDdl = false;
  await assert.rejects(
    denied.transaction((tx) =>
      tx.createTable({ table: 'private', columns: [] })
    ),
    code('TRANSACTION_DDL_UNSUPPORTED')
  );
  assert.equal(denied.active, 0);
});
test('lost migration ownership rolls back journal/data and lock timeout is explicit', async () => {
  /** Independently owned synthetic transaction fixture. */
  const f = fixture();
  /** Explicit lease-loss signal used to force rollback before commit. */
  const lost = new AbortController();
  let released = 0;
  /** Synthetic owner-fenced lease whose release is counted. */
  const ownerLock = {
    async acquire({ owner }) {
      return {
        owner,
        signal: lost.signal,
        async assertOwned() {
          if (lost.signal.aborted) {
            throw Error('ownership lost');
          }
        },
        async release(expected) {
          assert.equal(expected, owner);
          released++;
        },
      };
    },
  };
  /** Captured original synthetic acquisition function before test interception. */
  const acquire = f.adapter.acquire;
  f.adapter.acquire = async (ctx) => {
    /** Acquired native-shaped session whose work must remain pinned. */
    const lease = await acquire(ctx);
    /** Original pinned executor retained while measuring serialized work. */
    const execute = lease.execute;
    lease.execute = (operation, ...rest) => {
      /** Observed native synthetic result before inducing lease loss. */
      const result = execute(operation, ...rest);
      if (operation.table === 'journal' && operation.op === 'insert') {
        lost.abort();
      }
      return result;
    };
    return lease;
  };
  /** Explicit lock-and-pin coordinator acquired only when invoked. */
  const transaction = createPinnedMigrationTransaction(f.transaction, {
    lock: ownerLock,
    lockName: 'domain',
    journalTable: 'journal',
  });
  await assert.rejects(
    createDatabaseMigrationRunner(migrations, { transaction }).apply()
  );
  assert.deepEqual(f.state, { journal: [], changes: [] });
  assert.equal(f.active, 0);
  assert.equal(released, 1);
  /** Coordinator with a cooperative acquisition deadline and no lease. */
  const timeout = createPinnedMigrationTransaction(f.transaction, {
    lock: {
      acquire: ({ signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(Error('acquire cancelled')),
            { once: true }
          )
        ),
    },
    lockName: 'domain',
    journalTable: 'journal',
    lockTimeoutMs: 5,
  });
  await assert.rejects(
    timeout(() => {}),
    code('MIGRATION_LOCK_TIMEOUT')
  );
});
test('falsy callback rejections still roll back and release', async () => {
  /** Independently owned synthetic transaction fixture. */
  const f = fixture();
  let rejected = false;
  try {
    await f.transaction(async (tx) => {
      await tx.query(operation);
      throw undefined;
    });
  } catch (error) {
    rejected = true;
    assert.equal(error, undefined);
  }
  assert.equal(rejected, true);
  assert.deepEqual(f.state.changes, []);
  assert.equal(f.active, 0);
});
test('manager extension rejects unpinned callback access and routes all work through the lease', async () => {
  /** Filesystem utilities restricted to disposable fixture roots. */
  const fs = require('node:fs');
  /** Filesystem path construction without shell interpolation. */
  const path = require('node:path');
  /** Temporary-directory discovery; no operator database path is used. */
  const os = require('node:os');
  /** Owned temporary application containing one explicit injected pinned connector. */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinned-manager-'));
  /** Prior synthetic lock tail or caller cwd retained for ordered cleanup. */
  const previous = process.cwd();
  /** Independently owned synthetic transaction fixture. */
  const f = fixture();
  let manager,
    unbound = 0;
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    /** Disposable explicitly selected connector module returning the supplied fixture. */
    const mod = path.join(root, 'node_modules', 'test-pinned');
    fs.mkdirSync(mod, { recursive: true });
    fs.writeFileSync(
      path.join(mod, 'index.js'),
      'exports.createConnector=options=>options.instance;'
    );
    process.chdir(root);
    manager = await createDatabaseManager({
      connections: [
        {
          name: 'Main',
          slug: 'main',
          connector: 'test-pinned',
          options: {
            instance: {
              kind: 'fixture',
              options: {},
              capabilities: { transactions: 'supported' },
              transactionAdapter: f.adapter,
              execute() {
                unbound++;
                return { ok: true };
              },
            },
          },
        },
      ],
    });
    /** Captured unpinned facade which must reject within its own transaction callback. */
    const outer = manager.getConnectionFacade();
    assert.deepEqual(outer.transactionCapabilities().isolationLevels, [
      'serializable',
    ]);
    await manager.transaction(async (tx) => {
      assert.throws(
        () => manager.query(operation),
        code('TRANSACTION_SCOPE_REQUIRED')
      );
      assert.throws(
        () => manager.dbAccess('main'),
        code('TRANSACTION_SCOPE_REQUIRED')
      );
      assert.throws(() => outer.native(), code('TRANSACTION_SCOPE_REQUIRED'));
      await assert.rejects(
        manager.disconnect(),
        code('TRANSACTION_SCOPE_REQUIRED')
      );
      await tx.query(operation);
    });
    assert.equal(unbound, 0);
    assert.equal(f.active, 0);
  } finally {
    await manager?.disconnect();
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
