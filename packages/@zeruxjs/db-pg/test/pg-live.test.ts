import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createConnector } from '@zeruxjs/db-pg';
/** Explicit isolated live-test endpoint gate; never logged. */
const url = process.env.ZX_TEST_PG_URL;
test(
  'opt-in disposable PostgreSQL transaction, precision, cancellation and reset',
  {
    skip: !url
      ? 'ZX_TEST_PG_URL dedicated disposable PostgreSQL database is not configured'
      : false,
  },
  async () => {
    /** Owned native wrapper for the dedicated disposable database. */
    const connector = await createConnector({
      connectionString: url,
      max: 3,
      lockTimeoutMs: 50,
      statementTimeoutMs: 1000,
      queryTimeoutMs: 2000,
    });
    /** Random disposable table name; never an application-owned table. */
    const table = `zx_pg_${randomBytes(8).toString('hex')}`;
    /** Independent disposable table used to prove transactional DDL rollback. */
    const rolled = `${table}_rollback`;
    /** Private live-only execution identity. */
    const context = {
      connection: {
        name: 'Disposable',
        slug: 'test',
        connector: '@zeruxjs/db-pg',
        options: {},
      },
    };
    let blocker;
    try {
      await connector.execute(
        {
          op: 'createTable',
          table,
          columns: [
            { name: 'id', type: 'integer', primary: true },
            { name: 'value', type: 'text' },
            { name: 'amount', type: 'numeric', precision: 30, scale: 8 },
          ],
        },
        context
      );
      await connector.transaction(async (tx) => {
        await tx.insert({
          table,
          values: {
            id: 1,
            value: 'before',
            amount: '1234567890123456789012.12345678',
          },
        });
      });
      await assert.rejects(
        connector.transaction(async (tx) => {
          await tx.update({ table, values: { value: 'rollback' } });
          throw Error('rollback fixture');
        })
      );
      /** Native precision/rollback result inspected without parser coercion. */
      const rows = (await connector.execute({ op: 'select', table }, context))
        .rows;
      assert.equal(rows[0].value, 'before');
      assert.equal(rows[0].amount, '1234567890123456789012.12345678');
      await assert.rejects(
        connector.transaction(async (tx) => {
          await tx.query({
            op: 'createTable',
            table: rolled,
            columns: [{ name: 'id', type: 'integer' }],
          });
          throw Error('DDL rollback fixture');
        })
      );
      assert.equal(
        (
          await connector.execute(
            {
              op: 'select',
              table: 'pg_catalog.pg_tables',
              columns: ['tablename'],
              where: { field: 'tablename', operator: 'eq', value: rolled },
            },
            context
          )
        ).rows.length,
        0
      );
      /** Privileged native pool used only to hold an isolated test lock. */
      const pool = connector.getNativeConnection();
      blocker = await pool.connect();
      await blocker.query('BEGIN');
      await blocker.query(`UPDATE "${table}" SET value='locked' WHERE id=1`);
      await assert.rejects(
        connector.execute(
          {
            op: 'update',
            table,
            values: { value: 'timeout' },
            where: { field: 'id', operator: 'eq', value: 1 },
          },
          context
        )
      );
      /** One caller cancellation scope for the destructive-abort acceptance case. */
      const abort = new AbortController();
      /** Explicit abort trigger removed in finally. */
      const timer = setTimeout(() => abort.abort(), 10);
      try {
        await assert.rejects(
          connector.execute(
            {
              op: 'update',
              table,
              values: { value: 'cancelled' },
              where: { field: 'id', operator: 'eq', value: 1 },
            },
            { ...context, signal: abort.signal }
          )
        );
      } finally {
        clearTimeout(timer);
      }
      await blocker.query('ROLLBACK');
      blocker.release();
      blocker = undefined;
      /** Actual zero-row CAS result with empty RETURNING rows. */
      const missed = await connector.execute(
        {
          op: 'update',
          table,
          values: { value: 'miss' },
          where: { field: 'id', operator: 'eq', value: 99 },
          returning: ['id'],
        },
        context
      );
      assert.equal(missed.affectedCount, 0);
      assert.deepEqual(missed.rows, []);
      assert.equal(connector.getPoolStatus().activeLeases, 0);
    } finally {
      if (blocker) {
        try {
          await blocker.query('ROLLBACK');
        } finally {
          blocker.release(true);
        }
      }
      try {
        await connector.execute(
          { op: 'dropTable', table, ifExists: true },
          context
        );
        await connector.execute(
          { op: 'dropTable', table: rolled, ifExists: true },
          context
        );
      } finally {
        await connector.disconnect();
      }
    }
  }
);
