/** Node test registry; all native transports are explicitly injected or separately gated. */
const { test } = require('node:test');
/** Strict assertions; compilation alone does not prove native behavior. */
const assert = require('node:assert/strict');
/** Built public connector/query exports; import starts no database. */
const mongo = require('../dist/index.js');
/** Synthetic private connection identity and options. */
const context = {
  connection: { slug: 'main', connector: 'mongo', options: {}, name: 'Main' },
};
/** Provide only the scripted native collection methods required by these query-translation checks.
 * @returns {object} Independent borrowed database and observed calls; no live MongoDB.
 */
function mockDatabase() {
  /** Observed synthetic native calls used to prove rejected operations do not mutate. */
  const calls = [];
  /** Synthetic stored documents, not a native Mongo database. */
  const docs = [];
  /** Native-shaped collection fixture implementing only tested operations. */
  const collection = {
    async insertOne(value) {
      calls.push(['insertOne', value]);
      docs.push(value);
      return { insertedId: 'id1' };
    },
    find(where) {
      calls.push(['find', where]);
      return { toArray: async () => docs };
    },
    async updateMany(where, update) {
      calls.push(['updateMany', where, update]);
      return { modifiedCount: 1 };
    },
    async deleteMany(where) {
      calls.push(['deleteMany', where]);
      return { deletedCount: 1 };
    },
  };
  return {
    db: {
      collection(name) {
        calls.push(['collection', name]);
        return collection;
      },
    },
    calls,
  };
}
test('Mongo connector inserts and rejects selector injection', async (t) => {
  /** Independent borrowed database fixture and observed calls. */
  const { db, calls } = mockDatabase();
  /** Owned connector wrapper around a borrowed synthetic database. */
  const connector = await mongo.createConnector({ db }, context.connection);
  t.after(() => connector.disconnect());
  /** Normalized insertion result whose native identity is preserved. */
  const inserted = await connector.execute(
    { op: 'insert', table: 'users', values: { name: 'Ada' } },
    context
  );
  assert.deepEqual(inserted.insertedIds, ['id1']);
  await assert.rejects(
    connector.execute(
      { op: 'insert', table: 'users', values: { $where: 'bad' } },
      context
    ),
    /Unsafe MongoDB field/
  );
  await assert.rejects(
    connector.execute(
      {
        op: 'select',
        table: 'users',
        where: { field: 'name', operator: 'eq', value: { $ne: null } },
      },
      context
    ),
    /Unsafe MongoDB field/
  );
  assert.equal(calls.filter((x) => x[0] === 'insertOne').length, 1);
});
test('Mongo protects destructive writes and validates fields', async (t) => {
  /** Independent synthetic borrowed database. */
  const { db } = mockDatabase();
  /** Owned connector wrapper around a borrowed synthetic database. */
  const connector = await mongo.createConnector({ db }, context.connection);
  t.after(() => connector.disconnect());
  await assert.rejects(
    connector.execute({ op: 'delete', table: 'users' }, context),
    /requires a where/
  );
  await assert.rejects(
    connector.execute(
      { op: 'update', table: 'users', values: { name: 'x' } },
      context
    ),
    /requires a where/
  );
  await assert.rejects(
    connector.execute(
      {
        op: 'delete',
        table: '$users',
        where: { field: 'a', operator: 'eq', value: 'b' },
      },
      context
    ),
    /Unsafe MongoDB field/
  );
  /** Native modified-count outcome checked independently from matches. */
  const updated = await connector.execute(
    {
      op: 'update',
      table: 'users',
      where: { field: 'name', operator: 'eq', value: 'Ada' },
      values: { name: 'Anne' },
    },
    context
  );
  assert.equal(updated.affectedCount, 1);
});
test('Mongo SQL-like pattern escapes special regex characters', () => {
  /** Private normalized result/predicate checked against the exact supported shape. */
  const result = mongo.buildWhere({
    field: 'name',
    operator: 'like',
    value: 'a.%',
  });
  assert.deepEqual(result, { name: { $regex: '^a\\..*$' } });
});
test('Mongo simple filtered select uses find not aggregate', async (t) => {
  /** Independent borrowed database fixture and observed calls. */
  const { db, calls } = mockDatabase();
  /** Owned connector wrapper around a borrowed synthetic database. */
  const connector = await mongo.createConnector({ db }, context.connection);
  t.after(() => connector.disconnect());
  /** Private normalized result/predicate checked against the exact supported shape. */
  const result = await connector.execute(
    {
      op: 'select',
      table: 'users',
      where: { field: 'name', operator: 'eq', value: 'Ada' },
    },
    context
  );
  assert.deepEqual(result.rows, []);
  assert.equal(
    calls.some((x) => x[0] === 'find'),
    true
  );
});
test('Mongo native count/group query DSL produces correct aggregation pipelines', async (t) => {
  /** Generated pipelines captured before any real engine execution. */
  const seen = [];
  /** Borrowed database fixture with explicitly scripted aggregate output. */
  const db = {
    collection: () => ({
      aggregate(pipeline) {
        seen.push(pipeline);
        return {
          toArray: async () =>
            pipeline.some((s) => s.$count)
              ? []
              : [
                  { category: 'web', event_count: 705 },
                  { category: 'server', event_count: 205 },
                ],
        };
      },
    }),
  };
  /** Owned connector wrapper around a borrowed synthetic database. */
  const connector = await mongo.createConnector({ db }, context.connection);
  t.after(() => connector.disconnect());
  /** Exact supported COUNT projection alias used by the analytics consumer. */
  const count = {
    expr: {
      kind: 'function',
      name: 'COUNT',
      args: [{ kind: 'column', name: 'id' }],
    },
    as: 'event_count',
  };
  /** Ungrouped aggregate result preserving the documented empty count. */
  const total = await connector.execute(
    {
      op: 'select',
      table: 'analytics_events',
      columns: [count],
      where: { field: 'site', operator: 'eq', value: 'a' },
    },
    context
  );
  assert.deepEqual(total.rows, [{ event_count: 0 }]);
  assert.deepEqual(seen[0], [
    { $match: { site: 'a' } },
    { $count: 'event_count' },
  ]);
  /** Private normalized result/predicate checked against the exact supported shape. */
  const result = await connector.execute(
    {
      op: 'select',
      table: 'analytics_events',
      columns: [
        { expr: { kind: 'column', name: 'source' }, as: 'category' },
        count,
      ],
      groupBy: ['source'],
      limit: 3,
      where: { field: 'site', operator: 'eq', value: 'a' },
    },
    context
  );
  assert.deepEqual(result.rows, [
    { category: 'web', event_count: 705 },
    { category: 'server', event_count: 205 },
  ]);
  assert.deepEqual(seen[1], [
    { $match: { site: 'a' } },
    { $group: { _id: '$source', event_count: { $sum: 1 } } },
    { $project: { _id: 0, category: '$_id', event_count: 1 } },
    { $sort: { event_count: -1, category: 1 } },
    { $limit: 3 },
  ]);
});
test('Mongo numeric fact expressions use native aggregation and preserve empty count', async (t) => {
  /** Generated pipelines captured before any real engine execution. */
  const seen = [];
  /** Borrowed database fixture with explicitly scripted aggregate output. */
  const db = {
    collection: () => ({
      aggregate(pipeline) {
        seen.push(pipeline);
        return {
          toArray: async () =>
            pipeline.some((s) => s.$group?._id === null)
              ? []
              : [{ category: 'web', metric_value: 55, numeric_count: 11 }],
        };
      },
    }),
  };
  /** Owned connector wrapper around a borrowed synthetic database. */
  const connector = await mongo.createConnector({ db }, context.connection);
  t.after(() => connector.disconnect());
  /** Exact supported numeric fact metric expression. */
  const metric = {
    expr: {
      kind: 'function',
      name: 'SUM',
      args: [{ kind: 'column', name: 'numeric_value' }],
    },
    as: 'metric_value',
  };
  /** Exact supported COUNT projection alias used by the analytics consumer. */
  const count = {
    expr: {
      kind: 'function',
      name: 'COUNT',
      args: [{ kind: 'column', name: 'event_id' }],
    },
    as: 'numeric_count',
  };
  /** Ungrouped aggregate result preserving the documented empty count. */
  const total = await connector.execute(
    {
      op: 'select',
      table: 'analytics_events_numeric',
      columns: [metric, count],
      where: { field: 'property_name', operator: 'eq', value: 'cost' },
    },
    context
  );
  assert.deepEqual(total.rows, [{ metric_value: null, numeric_count: 0 }]);
  assert.deepEqual(seen[0], [
    { $match: { property_name: 'cost' } },
    {
      $group: {
        _id: null,
        metric_value: { $sum: '$numeric_value' },
        numeric_count: { $sum: 1 },
      },
    },
    { $project: { _id: 0, metric_value: 1, numeric_count: 1 } },
  ]);
  /** Grouped numeric outcome preserving count and metric fields. */
  const groups = await connector.execute(
    {
      op: 'select',
      table: 'analytics_events_numeric',
      columns: [
        { expr: { kind: 'column', name: 'source' }, as: 'category' },
        metric,
        count,
      ],
      groupBy: ['source'],
      limit: 3,
    },
    context
  );
  assert.deepEqual(groups.rows, [
    { category: 'web', metric_value: 55, numeric_count: 11 },
  ]);
  assert.deepEqual(seen[1], [
    {
      $group: {
        _id: '$source',
        metric_value: { $sum: '$numeric_value' },
        numeric_count: { $sum: 1 },
      },
    },
    {
      $project: { _id: 0, category: '$_id', metric_value: 1, numeric_count: 1 },
    },
    { $sort: { metric_value: -1, category: 1 } },
    { $limit: 3 },
  ]);
});

test('Mongo createTable ifNotExists tolerates existing namespaces for concurrent startups', async (t) => {
  /** Borrowed database fixture with explicitly scripted aggregate output. */
  const db = {
    createCollection: async () => {
      /** Synthetic native namespace-exists failure with the documented numeric code. */
      const e = Error('already there');
      e.code = 48;
      throw e;
    },
    collection: () => ({}),
  };
  /** Owned connector wrapper around a borrowed synthetic database. */
  const connector = await mongo.createConnector({ db }, context.connection);
  t.after(() => connector.disconnect());
  /** Successful guarded namespace creation outcome. */
  const ok = await connector.execute(
    {
      op: 'createTable',
      table: 'numeric_facts',
      ifNotExists: true,
      columns: [{ name: 'id', type: 'varchar' }],
    },
    context
  );
  assert.equal(ok.ok, true);
  await assert.rejects(
    connector.execute(
      {
        op: 'createTable',
        table: 'numeric_facts',
        columns: [{ name: 'id', type: 'varchar' }],
      },
      context
    ),
    /already there/
  );
});

test('Mongo rejects unsupported schema mutations and malformed operators', async (t) => {
  /** Independent synthetic borrowed database. */
  const { db } = mockDatabase();
  /** Owned connector wrapper around a borrowed synthetic database. */
  const connector = await mongo.createConnector({ db }, context.connection);
  t.after(() => connector.disconnect());
  await assert.rejects(
    connector.execute(
      {
        op: 'alterTable',
        table: 'records',
        actions: [{ type: 'dropColumn', name: 'name' }],
      },
      context
    ),
    /not supported/
  );
  assert.throws(
    () =>
      mongo.buildWhere({ field: 'name', operator: '$where', value: 'evil' }),
    /Unsupported Mongo comparison/
  );
  /** Independent index-validation wrapper; no native schema mutation should occur. */
  const ix = await mongo.createConnector(
    { db: { collection: () => ({ createIndex: async () => 'ix' }) } },
    context.connection
  );
  t.after(() => ix.disconnect());
  await assert.rejects(
    ix.execute(
      {
        op: 'createIndex',
        table: 'items',
        name: 'ix',
        columns: [{ kind: 'function', name: 'NOW' }],
      },
      context
    ),
    /plain named columns/
  );
});
test('Mongo reports matched versus changed counts without widening returning support', async (t) => {
  /** Owned connector wrapper around a borrowed synthetic database. */
  const connector = await mongo.createConnector(
    {
      executor: () => ({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 0,
      }),
    },
    context.connection
  );
  t.after(() => connector.disconnect());
  assert.equal(connector.capabilities.returning, 'unsupported');
  assert.equal(connector.capabilities.transactions, 'unsupported');
  assert.throws(
    () =>
      connector.execute(
        {
          op: 'update',
          table: 'users',
          values: { name: 'Ada' },
          returning: ['name'],
        },
        context
      ),
    /returning/
  );
  /** Private normalized result/predicate checked against the exact supported shape. */
  const result = await connector.execute(
    {
      op: 'update',
      table: 'users',
      values: { name: 'Ada' },
      where: { field: 'id', operator: 'eq', value: 'one' },
    },
    context
  );
  assert.equal(result.affectedCount, 0);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.changedCount, 0);
  assert.equal(result.counts.affectedMeaning, 'changed');
});
