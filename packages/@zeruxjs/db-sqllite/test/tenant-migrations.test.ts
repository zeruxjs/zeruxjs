import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
/** Resolve the built CommonJS public API from this ESM fixture. */
const require = createRequire(import.meta.url);
/** Public connector factory under test; every opened handle needs disconnect. */
const { createConnector } = require('../dist/index.js');
/** Public tenant and migration contracts under test; callback ownership remains explicit. */
const {
  createTenantDatabaseFacade,
  createDatabaseMigrationRunner,
} = require('@zeruxjs/db');
/** Synthetic private connection identity, never an authorization credential. */
const ctx = {
  connection: { slug: 'main', name: 'Main', connector: 'sqlite', options: {} },
};
/** Open a synthetic connector and bind structured fixture operations to one context.
 * @param {string} file - Disposable database filename or in-memory marker.
 * @returns {Promise<object>} Owned connector plus borrowed execution/facade helpers. */
const setup = async (file) => {
  /** Owned synthetic database connector returned to the enclosing fixture for teardown. */
  const connector = await createConnector({ filename: file, driver: 'node' });
  /** Bind one fixture operation to the synthetic private context.
   * @param {import("@zeruxjs/db").QueryOperation} operation - Structured test operation.
   * @returns {unknown} Native connector result; fixture callers await as needed. */
  const exec = (operation) => connector.execute(operation, ctx);
  return {
    connector,
    exec,
    facade: {
      select: exec,
      insert: exec,
      update: exec,
      delete: exec,
      query: exec,
    },
  };
};

test('tenant facade isolates reads, writes, bulk updates and deletes across real SQLite connections', async () => {
  /** Exclusive disposable fixture directory; never an operator database path. */
  const dir = mkdtempSync(path.join(tmpdir(), 'zx-tenant-'));
  /** First synthetic connection; finally closes before temporary directory removal. */
  const a = await setup(path.join(dir, 'data.sqlite'));
  /** Second synthetic connection sharing only the owned fixture file. */
  const b = await setup(path.join(dir, 'data.sqlite'));
  try {
    await a.exec({
      op: 'createTable',
      table: 'emails',
      columns: [
        { name: 'id', type: 'integer', primary: true },
        { name: 'tenant_id', type: 'text', notNull: true },
        { name: 'body', type: 'text' },
      ],
    });
    /** Server-bound Alice tenant facade; caller filters cannot replace its predicate. */
    const alice = createTenantDatabaseFacade(a.facade, {
      tenantId: 'alice',
      tables: { messages: 'emails' },
    });
    /** Server-bound Bob tenant facade; isolated from Alice writes and deletes. */
    const bob = createTenantDatabaseFacade(b.facade, {
      tenantId: 'bob',
      tables: { messages: 'emails' },
    });
    await alice.insert({ table: 'messages', values: { id: 1, body: 'a' } });
    await bob.insert({ table: 'messages', values: { id: 2, body: 'b' } });
    assert.deepEqual(
      (await alice.select({ table: 'messages' })).rows.map((row) => row.body),
      ['a']
    );
    assert.deepEqual(
      (await bob.select({ table: 'messages' })).rows.map((row) => row.body),
      ['b']
    );
    // A caller-controlled OR condition cannot neutralize the injected tenant AND predicate.
    assert.deepEqual(
      (
        await alice.select({
          table: 'messages',
          where: {
            or: [
              { field: 'id', operator: 'eq', value: 2 },
              { field: 'id', operator: 'eq', value: 1 },
            ],
          },
        })
      ).rows.map((row) => row.id),
      [1]
    );
    await alice.update({ table: 'messages', values: { body: 'updated' } });
    assert.equal((await bob.select({ table: 'messages' })).rows[0].body, 'b');
    await alice.delete({ table: 'messages' });
    assert.equal((await alice.select({ table: 'messages' })).rows.length, 0);
    assert.equal((await bob.select({ table: 'messages' })).rows.length, 1);
    assert.throws(
      () =>
        alice.insert({
          table: 'messages',
          values: { id: 3, tenant_id: 'bob', body: 'bad' },
        }),
      /Tenant identifier/
    );
    assert.throws(
      () => alice.update({ table: 'messages', values: { tenant_id: 'bob' } }),
      /Tenant identifier/
    );
    assert.throws(() => alice.select({ table: 'unknown' }), /allowlist/);
    assert.throws(
      () => alice.select({ table: 'messages', into: 'private_db' }),
      /Cross-connection/
    );
    assert.throws(
      () =>
        alice.select({
          table: 'messages',
          joins: [
            {
              table: 'users',
              type: 'inner',
              on: { field: 'id', operator: 'eq', value: 1 },
            },
          ],
        }),
      /joins\/unions/
    );
    assert.throws(
      () =>
        alice.select({
          table: 'messages',
          where: {
            operator: 'exists',
            query: { op: 'select', table: 'private' },
          },
        }),
      /subqueries/
    );
    assert.throws(
      () =>
        createTenantDatabaseFacade(a.facade, {
          tenantId: 'alice',
          tables: { x: 'emails; DROP TABLE emails' },
        }),
      /Unsafe tenant table/
    );
  } finally {
    await a.connector.disconnect();
    await b.connector.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('exclusive SQLite transaction migration journal is reversible; failures roll back DDL and journal', async () => {
  /** Test-owned connector; finally releases its native database. */
  const db = await setup(':memory:');
  try {
    await db.exec({
      op: 'createTable',
      table: 'migration_journal',
      columns: [
        { name: 'id', type: 'text', primary: true },
        { name: 'checksum', type: 'text', notNull: true },
        { name: 'appliedAt', type: 'text', notNull: true },
      ],
    });
    /** Privileged fixture handle manually pinned for this legacy migration journal test. */
    const native = db.connector.getNativeConnection();
    /** Own one explicit native migration interval and roll back callback failures.
     * @param {Function} fn - Trusted migration callback operating on this fixture only.
     * @returns {Promise<unknown>} Callback result after native COMMIT; no production lock guarantee. */
    const transaction = async (fn) => {
      native.exec('BEGIN IMMEDIATE');
      /** Synthetic journal bound to the same native database interval as migration DDL. */
      const journal = {
        list: async () =>
          (
            await db.exec({
              op: 'select',
              table: 'migration_journal',
              orderBy: [{ by: 'id' }],
            })
          ).rows,
        insert: async (record) => {
          await db.exec({
            op: 'insert',
            table: 'migration_journal',
            values: record,
          });
        },
        remove: async (id) => {
          await db.exec({
            op: 'delete',
            table: 'migration_journal',
            where: { field: 'id', operator: 'eq', value: id },
          });
        },
      };
      try {
        /** Observed operation/callback result; zero and bigint values retain their semantics. */
        const result = await fn(db.facade, journal);
        native.exec('COMMIT');
        return result;
      } catch (err) {
        native.exec('ROLLBACK');
        throw err;
      }
    };
    /** Deterministic synthetic up/down operations used to test journal checksums. */
    const migrations = [
      {
        id: '2026101401_add_events',
        up: [
          {
            op: 'createTable',
            table: 'events',
            columns: [{ name: 'id', type: 'integer', primary: true }],
          },
        ],
        down: [{ op: 'dropTable', table: 'events' }],
      },
    ];
    /** Migration coordinator using the explicitly supplied transaction callback. */
    const runner = createDatabaseMigrationRunner(migrations, { transaction });
    assert.deepEqual(await runner.status(), { applied: 0, pending: 1 });
    assert.deepEqual(await runner.apply(), [migrations[0].id]);
    assert.deepEqual(await runner.apply(), []);
    assert.deepEqual(await runner.status(), { applied: 1, pending: 0 });
    await assert.rejects(
      runner.rollbackLast(async () => false),
      /not approved/
    );
    assert.equal(
      (await db.exec({ op: 'select', table: 'migration_journal' })).rows.length,
      1
    );
    assert.equal(await runner.rollbackLast(async () => true), migrations[0].id);
    assert.deepEqual(await runner.status(), { applied: 0, pending: 1 });
    /** Failing migration coordinator used to verify DDL and journal rollback. */
    const fails = createDatabaseMigrationRunner(
      [
        {
          id: '2026101401_add_events',
          up: [
            {
              op: 'createTable',
              table: 'events',
              columns: [{ name: 'id', type: 'integer', primary: true }],
            },
            { op: 'insert', table: 'missing_table', values: { id: 1 } },
          ],
          down: [{ op: 'dropTable', table: 'events' }],
        },
      ],
      { transaction }
    );
    await assert.rejects(fails.apply());
    assert.equal(
      (await db.exec({ op: 'select', table: 'migration_journal' })).rows.length,
      0
    );
    assert.equal(
      (
        await db.exec({
          op: 'select',
          table: 'sqlite_master',
          columns: ['name'],
          where: { field: 'name', operator: 'eq', value: 'events' },
        })
      ).rows.length,
      0
    );
    await runner.apply();
    /** Changed checksum fixture; existing journal history must reject silent replacement. */
    const changed = createDatabaseMigrationRunner(
      [
        {
          id: '2026101401_add_events',
          up: [
            {
              op: 'createTable',
              table: 'different',
              columns: [{ name: 'id', type: 'integer' }],
            },
          ],
          down: [{ op: 'dropTable', table: 'different' }],
        },
      ],
      { transaction }
    );
    await assert.rejects(changed.status(), /modified migration/);
  } finally {
    await db.connector.disconnect();
  }
});
