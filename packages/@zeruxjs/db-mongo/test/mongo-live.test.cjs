/** Node test registry; all native transports are explicitly injected or separately gated. */
const { test } = require('node:test');
/** Strict assertions; compilation alone does not prove native behavior. */
const assert = require('node:assert/strict');
/** Random namespace creation for the explicitly configured disposable live acceptance test. */
const { randomBytes } = require('node:crypto');
/** Public connector factory, invoked only inside the configured live gate. */
const { createConnector } = require('../dist/index.js');
test(
  'disposable replica-set/sharded native session rollback and BSON precision',
  {
    skip: !process.env.ZX_TEST_MONGO_URI
      ? 'ZX_TEST_MONGO_URI is not configured'
      : false,
  },
  async () => {
    /** Actual optional native driver/BSON types used only with operator-provided isolated infrastructure. */
    const { MongoClient, Decimal128, Long } = require('mongodb');
    /** Random disposable database name; never an existing operator application database. */
    const name = `zx_mongo_${randomBytes(8).toString('hex')}`;
    /** Host-configured native client, explicitly closed in finally. */
    const client = new MongoClient(process.env.ZX_TEST_MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    let db;
    /** Private connection context for the live-only disposable database. */
    const ctx = {
      connection: {
        name: 'Live',
        slug: 'live',
        connector: 'mongo',
        options: {},
      },
    };
    try {
      await client.connect();
      db = await createConnector({
        client,
        database: name,
        transactions: true,
      });
      /** Actual isolated native database used to provision and remove fixture state. */
      const native = client.db(name);
      await native.createCollection('items');
      await native.collection('items').insertOne({
        id: 'one',
        revision: 1,
        amount: Decimal128.fromString('12345678901234567890.123456789'),
        counter: Long.fromString('9007199254740993'),
      });
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx.update({
            table: 'items',
            values: { revision: 2 },
            where: { field: 'id', operator: 'eq', value: 'one' },
          });
          throw Error('rollback fixture');
        })
      );
      /** Native BSON result inspected without lossy numeric conversion. */
      const result = await db.execute(
        {
          op: 'select',
          table: 'items',
          where: { field: 'id', operator: 'eq', value: 'one' },
        },
        ctx
      );
      assert.equal(result.rows[0].revision, 1);
      assert.equal(
        result.rows[0].amount.toString(),
        '12345678901234567890.123456789'
      );
      assert.equal(result.rows[0].counter.toString(), '9007199254740993');
      await db.transaction(async (tx) => {
        /** Native transaction result whose matched/modified counts must remain separate. */
        const changed = await tx.update({
          table: 'items',
          values: { revision: 2 },
          where: { field: 'id', operator: 'eq', value: 'one' },
        });
        assert.equal(changed.matchedCount, 1);
        assert.equal(changed.changedCount, 1);
      });
      /** Zero-row native CAS outcome; no false conversion to a match. */
      const miss = await db.execute(
        {
          op: 'update',
          table: 'items',
          values: { revision: 3 },
          where: { field: 'revision', operator: 'eq', value: 9 },
        },
        ctx
      );
      assert.equal(miss.affectedCount, 0);
      assert.equal(miss.matchedCount, 0);
    } finally {
      try {
        await db?.disconnect();
      } finally {
        try {
          await client.db(name).dropDatabase();
        } finally {
          await client.close();
        }
      }
    }
  }
);
