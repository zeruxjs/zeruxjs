import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
/** Resolve built CommonJS exports from this ESM fixture. */
const require = createRequire(import.meta.url);
/** Public connector factory, invoked only with explicit synthetic injection. */
const { createConnector } = require('../dist/index.js');
/** Synthetic private connection identity. */
const context = {
  connection: { slug: 'pg', name: 'postgres', connector: 'pg', options: {} },
};
test('PG injected client executes parameterized query with correct result', async (t) => {
  /** Observed prepared SQL/parameters; no native database executes them. */
  const calls = [];
  /** Owned wrapper around a borrowed query-only transport. */
  const connector = await createConnector({
    client: {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [{ id: 3 }], rowCount: 1 };
      },
    },
  });
  t.after(() => connector.disconnect());
  try {
    /** Normalized parameterized select result; field metadata is not fabricated. */
    const result = await connector.execute(
      {
        op: 'select',
        table: 'users',
        where: { field: 'id', operator: 'eq', value: 3 },
      },
      context
    );
    assert.deepEqual(result.rows, [{ id: 3 }]);
    assert.match(calls[0].sql, /\$1/);
    assert.deepEqual(calls[0].params, [3]);
  } finally {
    await connector.disconnect();
  }
});
test('external PG pools are not closed by connector', async (t) => {
  let closed = false;
  /** Owned wrapper around a borrowed query-only transport. */
  const connector = await createConnector({
    pool: {
      query: async () => ({ rows: [], rowCount: 0 }),
      end: async () => {
        closed = true;
      },
    },
  });
  t.after(() => connector.disconnect());
  await connector.disconnect();
  assert.equal(closed, false);
});
