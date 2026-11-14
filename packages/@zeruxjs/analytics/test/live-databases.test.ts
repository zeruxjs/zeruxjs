/** Opt-in parity gate; no external services, credentials or native drivers required for offline npm test.
 * Provision dedicated disposable databases and build the four DB workspaces first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAnalytics } from '../dist/index.js';
/** Synthetic fixture context for the declared operation.
 * @param {string} engine - Explicit fixture connector name.
 * @returns {object} Synthetic fixture context for the declared operation. */
const ctx = (engine) => ({
  connection: {
    slug: 'analytics',
    name: 'analytics',
    connector: engine,
    options: {},
  },
});
/** Unique isolated live-test table allocator; only explicitly configured acceptance runs may use it.
 * @returns {string} Unique isolated live-test table allocator; only explicitly configured acceptance runs may use it. */
const uniqueTable = () =>
  `analytics_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
/** Exercise only explicitly configured disposable native databases, then remove owned tables and close the supplied client.
 * @param {object} options - Explicit fixture settings; no application configuration is read.
 * @param {object} options.connector - Explicit disposable connector.
 * @param {string} options.engine - Declared connector identifier.
 * @param {Function} options.close - Owned fixture teardown callback.
 * @returns {Promise<object>} Settles after fixture assertions and owned cleanup.
 */
async function verify({ connector, engine, close }) {
  /** Unique fixture table, never a user application table. */
  const table = uniqueTable();
  /** Synthetic connector/message context containing no real credentials or recipient data. */
  const context = ctx(engine);
  /** Isolated fixture database or injected facade for this test. */
  const db = Object.fromEntries(
    ['createTable', 'createIndex', 'insert', 'select', 'update', 'delete'].map(
      (op) => [op, (args) => connector.execute({ op, ...args }, context)]
    )
  );
  /** First fixture manager, worker or response in the scoped comparison. */
  const a = createAnalytics({
    analytics: 'analytics',
    database: { connectionSlugs: ['analytics'], getConnectionFacade: () => db },
    table,
    numericFields: ['amount'],
    approveRetention: () => true,
  });
  /** Synthetic tenant/site label. */
  const site = uniqueTable();
  /** Server-time fixture sample used for relative policy bounds. */
  const now = Date.now();
  /** Earlier accepted token/lease/state kept to verify compatibility or fencing. */
  const old = now - 4 * 86400000;
  try {
    assert.equal(
      await a.initialize(),
      true,
      'collection schema must initialize'
    );
    assert.equal(
      typeof (await a.track({
        name: 'purchase',
        site,
        occurredAt: old,
        properties: { amount: 12 },
      })),
      'string'
    );
    assert.equal(
      typeof (await a.track({
        name: 'purchase',
        site,
        properties: { amount: 7 },
      })),
      'string'
    );
    /** Native event-count result for the isolated scope. */
    const counts = await a.aggregate({ groupBy: 'event', site });
    assert.equal(
      counts.total,
      2,
      'native count should be exact over persisted rows'
    );
    assert.equal(
      (
        await a.aggregateNumeric({
          metric: 'sum',
          valueField: 'amount',
          groupBy: 'event',
          site,
        })
      ).total,
      19
    );
    /** Approved synthetic retention receipt. */
    const deleted = await a.purgePage({
      site,
      before: now - 2 * 86400000,
      dryRun: false,
      limit: 1,
    });
    assert.equal(deleted.deleted, 1);
    assert.equal(deleted.deletedNumericFacts, 1);
    assert.equal((await a.aggregate({ groupBy: 'event', site })).total, 1);
    assert.equal(
      (
        await a.aggregateNumeric({
          metric: 'sum',
          valueField: 'amount',
          groupBy: 'event',
          site,
        })
      ).total,
      7
    );
  } finally {
    // Only drop the unique disposable collections after this particular test; no application data touched.
    for (const name of [table, `${table.slice(0, 55)}_numeric`]) {
      try {
        await connector.execute(
          { op: 'dropTable', table: name, ifExists: true },
          context
        );
      } catch {
        /* Preserve original failure */
      }
    }
    await close();
  }
}
/** Optional opt-in PostgreSQL URL read only by the dedicated live test. */
const pg = process.env.ZERUX_TEST_PG_URL;
test(
  'PostgreSQL: ingestion/count/numeric/tenant retention parity (opt-in)',
  { skip: !pg },
  async () => {
    /** Native SQLite fixture factory; only synthetic memory/owned temporary state is used. */
    const { createConnector } = await import('../../db-pg/dist/index.js');
    /** Fixture-owned SQLite connector; teardown disconnects it. */
    const connector = await createConnector({ connectionString: pg });
    await verify({
      connector,
      engine: '@zeruxjs/db-pg',
      close: () => connector.disconnect(),
    });
  }
);
/** Optional dedicated MySQL host selected by the live test. */
const host = process.env.ZERUX_TEST_MYSQL_HOST;
/** Optional dedicated disposable MySQL database name. */
const dbname = process.env.ZERUX_TEST_MYSQL_DATABASE;
test(
  'MySQL: ingestion/count/numeric/tenant retention parity (opt-in)',
  { skip: !host || !dbname },
  async () => {
    /** Native SQLite fixture factory; only synthetic memory/owned temporary state is used. */
    const { createConnector } = await import('../../db-mysql/dist/index.js');
    /** Fixture-owned SQLite connector; teardown disconnects it. */
    const connector = await createConnector({
      host,
      port: Number(process.env.ZERUX_TEST_MYSQL_PORT ?? 3306),
      user: process.env.ZERUX_TEST_MYSQL_USER,
      password: process.env.ZERUX_TEST_MYSQL_PASSWORD,
      database: dbname,
    });
    await verify({
      connector,
      engine: '@zeruxjs/db-mysql',
      close: () => connector.disconnect(),
    });
  }
);
/** Optional opt-in MongoDB URI; never printed by the fixture. */
const mongo = process.env.ZERUX_TEST_MONGO_URI;
/** Optional dedicated disposable MongoDB database name. */
const mongodb = process.env.ZERUX_TEST_MONGO_DATABASE;
test(
  'MongoDB: ingestion/count/numeric/tenant retention parity (opt-in)',
  { skip: !mongo || !mongodb },
  async () => {
    /** Optional driver imported only inside the explicitly enabled live test. */
    const { MongoClient } = await import('mongodb');
    /** Injected browser client or explicitly owned optional live client. */
    const client = new MongoClient(mongo, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    try {
      /** Native SQLite fixture factory; only synthetic memory/owned temporary state is used. */
      const { createConnector } = await import('../../db-mongo/dist/index.js');
      /** Fixture-owned SQLite connector; teardown disconnects it. */
      const connector = await createConnector({ client, database: mongodb });
      await verify({
        connector,
        engine: '@zeruxjs/db-mongo',
        close: async () => connector.disconnect?.(),
      });
    } finally {
      await client.close();
    }
  }
);
