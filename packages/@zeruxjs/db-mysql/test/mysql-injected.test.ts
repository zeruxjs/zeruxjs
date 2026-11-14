import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
/** Resolve built CommonJS exports from this ESM fixture. */
const require = createRequire(import.meta.url);
/** Public connector factory used only with synthetic injection. */
const { createConnector } = require('../dist/index.js');
/** Synthetic private execution identity; no configured database endpoint. */
const context = {
  connection: { slug: 'mysql', name: 'mysql', connector: 'mysql', options: {} },
};
test('injected mysql2 Promise-style query result is not double-wrapped', async (t) => {
  /** Owned wrapper around a borrowed scripted client/executor. */
  const connector = await createConnector({
    client: {
      query: async (_sql, _args) => [
        [{ id: 2, name: 'Alice' }],
        [{ name: 'id' }],
      ],
    },
  });
  t.after(() => connector.disconnect());
  /** Normalized tuple/update result checked independently from field metadata. */
  const result = await connector.execute(
    { op: 'select', table: 'users' },
    context
  );
  assert.deepEqual(result.rows, [{ id: 2, name: 'Alice' }]);
  await connector.disconnect();
});
test('MySQL injected executor uses parameter placeholders and returns affected rows', async (t) => {
  let received;
  /** Owned wrapper around a borrowed scripted client/executor. */
  const connector = await createConnector({
    executor: async (sql, params) => {
      received = { sql, params };
      return { affectedRows: 2, insertId: 4 };
    },
  });
  t.after(() => connector.disconnect());
  /** Normalized tuple/update result checked independently from field metadata. */
  const result = await connector.execute(
    {
      op: 'update',
      table: 'items',
      values: { name: 'new' },
      where: { field: 'id', operator: 'eq', value: 2 },
    },
    context
  );
  assert.equal(result.affectedCount, 2);
  assert.equal(result.insertedIds, undefined);
  assert.match(received.sql, /\?/);
  assert.deepEqual(received.params, ['new', 2]);
  await connector.disconnect();
});
