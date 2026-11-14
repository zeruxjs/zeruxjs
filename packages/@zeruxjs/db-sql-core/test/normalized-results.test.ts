import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
/** Resolve built CommonJS public exports from this ESM fixture. */
const require = createRequire(import.meta.url);
/** Public inert compiler/executor facade factory. */
const { createSqlConnector } = require('../dist/index.js');
/** Synthetic private configured identity. */
const context = {
  connection: { slug: 'test', name: 'test', connector: 'sqlite', options: {} },
};
/** Explicit SQLite compiler fixture, not a native capability probe. */
const dialect = {
  kind: 'sqlite',
  quoteIdentifier: (s) => `"${s}"`,
  placeholder: () => '?',
  functions: {},
  autoIncrementKeyword: 'AUTOINCREMENT',
};
test('result normalization avoids false inserted IDs for DDL and UPDATE', async () => {
  /** Facade borrowing a scripted native result callback. */
  const connector = createSqlConnector(dialect, {
    executor: () => ({ lastInsertRowid: 1, changes: 3 }),
  });
  /** DDL result which must not invent generated insert identities. */
  const table = await connector.execute(
    {
      op: 'createTable',
      table: 't',
      columns: [{ name: 'id', type: 'integer' }],
    },
    context
  );
  /** UPDATE result which must not expose a stale insert ID. */
  const update = await connector.execute(
    { op: 'update', table: 't', values: { id: 2 } },
    context
  );
  assert.equal(table.insertedIds, undefined);
  assert.equal(update.insertedIds, undefined);
});
test('bigint insert IDs preserve precision', async () => {
  /** Facade borrowing a scripted native result callback. */
  const connector = createSqlConnector(dialect, {
    executor: () => ({ lastInsertRowid: 9007199254740993n, changes: 1 }),
  });
  /** Normalized native outcome checked for precision, zero and sync semantics. */
  const result = await connector.execute(
    { op: 'insert', table: 't', values: { id: 1 } },
    context
  );
  assert.deepEqual(result.insertedIds, ['9007199254740993']);
});
test('capabilities describe the structured API and zero affected counts remain exact', async () => {
  let calls = 0;
  /** Facade borrowing a scripted native result callback. */
  const connector = createSqlConnector(dialect, {
    executor: () => {
      calls++;
      return { changes: 0 };
    },
  });
  assert.equal(connector.capabilities.returning, 'unsupported');
  assert.equal(connector.capabilities.transactions, 'unsupported');
  assert.equal(connector.capabilities.cancellation, 'unsupported');
  assert.throws(
    () =>
      connector.execute(
        { op: 'update', table: 't', values: { id: 1 }, returning: ['id'] },
        context
      ),
    /RETURNING/
  );
  assert.equal(calls, 0);
  /** Normalized native outcome checked for precision, zero and sync semantics. */
  const result = await connector.execute(
    { op: 'update', table: 't', values: { id: 1 } },
    context
  );
  assert.equal(result.affectedCount, 0);
  assert.equal(result.counts.affected, 'exact');
});
test('explicit synchronous execution never creates an async multi-statement tail', async () => {
  /** Multi-statement DDL used to prove strict sync mode has no asynchronous tail. */
  const operation = {
    op: 'createTable',
    table: 't',
    columns: [{ name: 'id', type: 'integer' }],
    indexes: [{ op: 'createIndex', table: 't', name: 'ix', columns: ['id'] }],
  };
  /** Observed synchronous statement order. */
  const seen = [];
  /** Explicit strictly synchronous borrowed executor facade. */
  const synchronous = createSqlConnector(dialect, {
    synchronous: true,
    executor(sql) {
      seen.push(sql);
      return { changes: 0 };
    },
  });
  /** Normalized native outcome checked for precision, zero and sync semantics. */
  const result = synchronous.execute(operation, context);
  assert.equal(typeof result.then, 'undefined');
  assert.equal(seen.length, 2);
  /** Observed thenable executor calls; no later DDL may be issued. */
  const asynchronous = [];
  /** Strict-sync facade whose executor violates the declared owner contract. */
  const denied = createSqlConnector(dialect, {
    synchronous: true,
    executor(sql) {
      asynchronous.push(sql);
      return Promise.resolve({ changes: 0 });
    },
  });
  assert.throws(
    () => denied.execute(operation, context),
    (error) => error.details?.code === 'ASYNCHRONOUS_EXECUTOR'
  );
  await new Promise(setImmediate);
  assert.equal(asynchronous.length, 1);
});
