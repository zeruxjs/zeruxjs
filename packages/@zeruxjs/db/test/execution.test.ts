/** Node test registry; fixtures own all resources explicitly. */
const { test } = require('node:test');
/** Strict assertions; no test outcome is inferred from successful compilation. */
const assert = require('node:assert/strict');
/** Filesystem utilities restricted to disposable fixture roots. */
const fs = require('node:fs');
/** Temporary-directory discovery; no operator database path is used. */
const os = require('node:os');
/** Filesystem path construction without shell interpolation. */
const path = require('node:path');
/** Public manager, tenant and pagination contracts under test. */
const {
  createDatabaseManager,
  createTenantDatabaseFacade,
  createKeysetPage,
} = require('@zeruxjs/db');
/** Synthetic private update body used to prove metric redaction. */
const query = {
  op: 'update',
  table: 'records',
  values: { password: 'PRIVATE' },
  where: { field: 'id', operator: 'eq', value: 'PRIVATE' },
};
/** Match fixed abstraction codes rather than private native failures.
 * @param {string} expected - Expected public classification.
 * @returns {(error: {details?:{code?:string}})=>boolean} Assertion predicate. */
const code = (expected) => (error) => error.details?.code === expected;
/** Own a disposable explicit connector project and restore caller cwd after scoped execution.
 * @param {object} connector - Injected native-shaped implementation; no external database.
 * @param {import("@zeruxjs/db").DatabaseExecutionPolicy} execution - Test-specific bounded policy.
 * @param {(manager: import("@zeruxjs/db").DatabaseManager)=>Promise<void>} run - Assertions run while the owned manager is live.
 * @returns {Promise<void>} Assertions and manager/temp cleanup complete.
 */
async function fixture(connector, execution, run) {
  /** Owned temporary project containing the explicitly injected test connector. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-exec-'));
  /** Caller working directory restored even when startup or assertions fail. */
  const previous = process.cwd();
  let manager;
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    /** Disposable allowlisted test connector package; no arbitrary disk package discovery. */
    const mod = path.join(dir, 'node_modules', 'test-execution');
    fs.mkdirSync(mod, { recursive: true });
    fs.writeFileSync(
      path.join(mod, 'index.js'),
      'exports.createConnector=options=>options.instance;'
    );
    process.chdir(dir);
    manager = await createDatabaseManager({
      connections: [
        {
          name: 'Test',
          slug: 'test',
          connector: 'test-execution',
          options: { instance: connector, password: 'PRIVATE' },
        },
      ],
      execution,
    });
    await run(manager);
  } finally {
    await manager?.disconnect();
    process.chdir(previous);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
/** Synthetic zero-affected CAS miss with a distinct command rowCount. */
const result = {
  ok: true,
  connection: 'test',
  connector: 'fake',
  operation: 'update',
  affectedCount: 0,
  rowCount: 99,
};
test('capabilities reject unsupported batch before execution and preserve zero CAS misses', async () => {
  let calls = 0;
  /** Captured frozen observations checked for zero precedence and private-value exclusion. */
  const metrics = [];
  await fixture(
    {
      kind: 'fake',
      options: {},
      capabilities: { returning: 'unsupported' },
      execute() {
        calls++;
        return result;
      },
    },
    { onMetric: (m) => metrics.push(m) },
    async (manager) => {
      assert.equal(manager.capabilities().transactions, 'unknown');
      assert.ok(Object.isFrozen(manager.capabilities()));
      assert.throws(
        () => manager.query([query, { ...query, returning: ['id'] }]),
        code('UNSUPPORTED_CAPABILITY')
      );
      assert.equal(calls, 0);
      assert.throws(
        () => manager.query(query, { require: ['transactions'] }),
        code('UNSUPPORTED_CAPABILITY')
      );
      assert.equal(manager.update(query).affectedCount, 0);
      assert.equal(metrics[0].count, 0);
      assert.equal(JSON.stringify(metrics).includes('PRIVATE'), false);
      assert.deepEqual(
        Object.keys(metrics[0]).sort(),
        ['operation', 'table', 'durationMs', 'count', 'outcome'].sort()
      );
    }
  );
});
test('cancelled callers retain the pending slot until actual driver settlement', async () => {
  let resolve,
    signal,
    calls = 0;
  await fixture(
    {
      kind: 'fake',
      options: {},
      execute(op, context) {
        calls++;
        signal = context.signal;
        return calls === 1 ? new Promise((r) => (resolve = r)) : result;
      },
    },
    { maxPending: 1 },
    async (manager) => {
      /** One caller cancellation scope; the native promise is settled separately. */
      const abort = new AbortController();
      /** Accepted operation whose cancelled wait must not release native capacity. */
      const pending = manager.query(query, { signal: abort.signal });
      abort.abort();
      await assert.rejects(pending, code('QUERY_CANCELLED'));
      assert.equal(signal.aborted, true);
      assert.throws(() => manager.query(query), code('QUERY_LIMIT'));
      resolve(result);
      await new Promise(setImmediate);
      assert.equal((await manager.query(query)).affectedCount, 0);
    }
  );
});
test('deadline, batch bounds, metric failures and dependency failure are explicit', async () => {
  await fixture(
    {
      kind: 'fake',
      options: {},
      execute(op, context) {
        return new Promise((_, reject) =>
          context.signal.addEventListener(
            'abort',
            () => reject(Error('PRIVATE')),
            { once: true }
          )
        );
      },
    },
    {
      maxBatch: 1,
      onMetric() {
        throw Error('hook');
      },
    },
    async (manager) => {
      assert.throws(() => manager.query([query, query]), code('BATCH_LIMIT'));
      await assert.rejects(
        manager.query(query, { timeoutMs: 10 }),
        code('QUERY_DEADLINE')
      );
      /** Pre-aborted signal proving no native dispatch. */
      const aborted = AbortSignal.abort();
      assert.throws(
        () => manager.query(query, { signal: aborted }),
        code('QUERY_CANCELLED')
      );
    }
  );
  /** Fixed-label failure observations without raw native causes. */
  const events = [];
  await fixture(
    {
      kind: 'fake',
      options: {},
      execute() {
        throw Error('driver unavailable PRIVATE');
      },
    },
    { onMetric: (e) => events.push(e) },
    async (manager) => {
      assert.throws(() => manager.query(query), /driver unavailable/);
      assert.equal(events[0].outcome, 'failure');
      assert.equal(JSON.stringify(events).includes('PRIVATE'), false);
    }
  );
});
test('disconnect aborts callers, closes once and denies stale facades', async () => {
  let closed = 0;
  await fixture(
    {
      kind: 'fake',
      options: {},
      execute() {
        return new Promise(() => {});
      },
      disconnect() {
        closed++;
      },
    },
    { shutdownGraceMs: 10 },
    async (manager) => {
      /** Captured bound facade used to verify rejection after manager disconnect. */
      const facade = manager.getConnectionFacade();
      /** Accepted operation whose cancelled wait must not release native capacity. */
      const pending = manager.query(query);
      /** Attached rejection assertion owns the pending failure. */
      const rejected = assert.rejects(pending, code('QUERY_CANCELLED'));
      await manager.disconnect();
      await rejected;
      await manager.disconnect();
      assert.equal(closed, 1);
      assert.throws(() => facade.query(query), code('MANAGER_CLOSED'));
      assert.throws(() => facade.native(), code('MANAGER_CLOSED'));
    }
  );
});
test('keyset continuation validates stable ordering and retains tenant allowlists', async () => {
  /** Explicit stable mixed-direction keys ending in a unique tie-breaker. */
  const order = [
    { column: 'created', direction: 'desc' },
    { column: 'id', direction: 'asc' },
  ];
  /** Initial keyset page with no continuation. */
  const first = createKeysetPage({
    table: 'records',
    order,
    uniqueKey: 'id',
    limit: 10,
  });
  /** Structured scalar continuation, not an authorization credential. */
  const cursor = first.continuation({ created: 12, id: 'a' });
  /** Following page retaining the exact table/order identity. */
  const next = createKeysetPage({
    table: 'records',
    order,
    uniqueKey: 'id',
    limit: 10,
    after: cursor,
  });
  assert.equal(next.operation.offset, undefined);
  assert.equal(next.operation.where.or.length, 2);
  assert.throws(
    () =>
      createKeysetPage({
        table: 'other',
        order,
        uniqueKey: 'id',
        limit: 10,
        after: cursor,
      }),
    code('INVALID_CONTINUATION')
  );
  assert.throws(
    () => first.continuation({ created: null, id: 'a' }),
    code('INVALID_CONTINUATION')
  );
  await fixture(
    {
      kind: 'fake',
      options: {},
      execute(op) {
        assert.equal(op.table, 'private_records');
        assert.equal(op.where.and.at(-1).value, 'verified');
        return result;
      },
    },
    {},
    async (manager) => {
      /** Facade built from a verified synthetic tenant and explicit physical table map. */
      const tenant = createTenantDatabaseFacade(manager.getConnectionFacade(), {
        tenantId: 'verified',
        tables: { records: 'private_records' },
      });
      await tenant.select(next.operation, { timeoutMs: 100 });
      assert.throws(
        () => tenant.select({ table: 'other' }),
        code('TENANT_SCOPE_DENIED')
      );
    }
  );
});
test('real SQLite keysets retain tenant scope and zero-row CAS counts', async () => {
  /** Owned disposable in-memory SQLite manager, disconnected in finally. */
  const manager = await createDatabaseManager({
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
    await manager.createTable({
      op: 'createTable',
      table: 'shared_records',
      columns: [
        { name: 'id', type: 'integer', primary: true },
        { name: 'created', type: 'integer' },
        { name: 'tenant_id', type: 'text' },
        { name: 'revision', type: 'integer' },
      ],
    });
    await manager.insert({
      op: 'insert',
      table: 'shared_records',
      values: [
        { id: 1, created: 10, tenant_id: 'A', revision: 1 },
        { id: 2, created: 10, tenant_id: 'B', revision: 1 },
        { id: 3, created: 10, tenant_id: 'A', revision: 1 },
      ],
    });
    /** Facade built from a verified synthetic tenant and explicit physical table map. */
    const tenant = createTenantDatabaseFacade(manager.getConnectionFacade(), {
      tenantId: 'A',
      tables: { records: 'shared_records' },
    });
    /** Bounded keyset options reused without mutation between pages. */
    const request = {
      table: 'records',
      order: [
        { column: 'created', direction: 'desc' },
        { column: 'id', direction: 'asc' },
      ],
      uniqueKey: 'id',
      limit: 1,
    };
    /** Initial keyset page with no continuation. */
    const first = createKeysetPage(request);
    /** First tenant-filtered result page used to derive the next cursor. */
    const rows = (await tenant.select(first.operation)).rows;
    assert.equal(rows[0].id, 1);
    /** Following page retaining the exact table/order identity. */
    const next = createKeysetPage({
      ...request,
      after: first.continuation(rows[0]),
    });
    assert.equal((await tenant.select(next.operation)).rows[0].id, 3);
    /** Zero-row native CAS outcome whose exact precision must remain visible. */
    const miss = await tenant.update({
      table: 'records',
      values: { revision: 2 },
      where: { field: 'revision', operator: 'eq', value: 99 },
    });
    assert.equal(miss.affectedCount, 0);
    assert.equal(miss.counts.affected, 'exact');
  } finally {
    await manager.disconnect();
  }
});
test('disconnect remains exactly once when driver abort callbacks reenter it', async () => {
  let current,
    closed = 0;
  await fixture(
    {
      kind: 'fake',
      options: {},
      execute(op, context) {
        context.signal.addEventListener(
          'abort',
          () => {
            void current.disconnect();
          },
          { once: true }
        );
        return new Promise(() => {});
      },
      disconnect() {
        closed++;
      },
    },
    { shutdownGraceMs: 5 },
    async (manager) => {
      current = manager;
      /** Accepted operation whose cancelled wait must not release native capacity. */
      const pending = manager.query(query);
      /** Attached rejection assertion owns the pending failure. */
      const rejected = assert.rejects(pending, code('QUERY_CANCELLED'));
      await Promise.all([manager.disconnect(), manager.disconnect()]);
      await rejected;
      assert.equal(closed, 1);
    }
  );
});
