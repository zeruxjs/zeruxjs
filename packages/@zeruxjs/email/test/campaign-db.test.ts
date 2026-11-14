import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDatabaseCampaignStore,
  createDatabaseMarketingSuppressionStore,
  createMarketingSuppressionService,
  createCampaignPlanner,
} from '../dist/index.js';
/**
 * Implement the finite SQL-shaped CAS protocol without claiming native database acceptance.
 *
 * @returns {object} Process-local table operations with exact synthetic affected counts.
 */
function fakeDb() {
  /** Process-local table maps implementing only the tested structured CAS protocol. */
  const tables = new Map();
  return {
    /**
     * Initialize the named fixture table without a native migration.
     *
     * @param {object} query - Explicit structured fixture operation.
     * @param {string} query.table - Fixed private fixture table name.
     * @returns {Promise<object>} Synthetic operation outcome; native connector semantics are qualified separately.
     */
    async createTable({ table }) {
      if (!tables.has(table)) {
        tables.set(table, new Map());
      }
      return { ok: true };
    },
    /**
     * Reserve one unique synthetic row identity; duplicate inserts reject.
     *
     * @param {object} query - Explicit structured fixture operation.
     * @param {string} query.table - Fixed private fixture table name.
     * @param {object} query.values - Synthetic private row values including identity/revision.
     * @returns {Promise<object>} Synthetic operation outcome; native connector semantics are qualified separately.
     */
    async insert({ table, values }) {
      /** Selected synthetic table; it is not a native transaction or distributed lock. */
      const t = tables.get(table);
      if (t.has(values.id)) {
        throw Error('UNIQUE constraint');
      }
      t.set(values.id, { ...values });
      return { ok: true, affectedCount: 1 };
    },
    /**
     * Select only fixture-supported structured predicates in deterministic order.
     *
     * @param {object} query - Explicit structured fixture operation.
     * @param {string} query.table - Fixed private fixture table name.
     * @param {object} query.where - Explicit equality/range/CAS predicates; never raw SQL.
     * @returns {Promise<object>} Synthetic operation outcome; native connector semantics are qualified separately.
     */
    async select({ table, where }) {
      /** Synthetic row selected by its explicit identity predicate. */
      const v = tables.get(table).get(where.value);
      return { ok: true, rows: v ? [v] : [] };
    },
    /**
     * Apply only an exact identity/revision fixture CAS update.
     *
     * @param {object} query - Explicit structured fixture operation.
     * @param {string} query.table - Fixed private fixture table name.
     * @param {object} query.values - Synthetic private row values including identity/revision.
     * @param {object} query.where - Explicit equality/range/CAS predicates; never raw SQL.
     * @returns {Promise<object>} Synthetic operation outcome; native connector semantics are qualified separately.
     */
    async update({ table, values, where }) {
      /** Exact identity and expected revision extracted from the fixture CAS predicates. */
      const [id, version] = where.and.map((c) => c.value);
      /** Selected synthetic table; it is not a native transaction or distributed lock. */
      const t = tables.get(table);
      /** Current synthetic row; revision mismatch must report zero affected rows. */
      const existing = t.get(id);
      if (!existing || existing.version !== version) {
        return { ok: true, affectedCount: 0 };
      }
      t.set(id, { ...existing, ...values });
      return { ok: true, affectedCount: 1 };
    },
  };
}
test('DB-backed campaign store enforces CAS and stores resumable checkpoints', async () => {
  /** Shared process-local structured protocol fixture; no native database is opened. */
  const db = fakeDb();
  /** First campaign-store wrapper borrowing the shared fixture. */
  const a = createDatabaseCampaignStore(db);
  /** Second wrapper over the same fixture; native isolation is qualified in separate tests. */
  const b = createDatabaseCampaignStore(db);
  /**
   * Create a deterministic planner over an explicit borrowed store.
   *
   * @param {object} store - Explicit borrowed fixture campaign store.
   * @returns {object} Planner with an empty source and no queue/SMTP side effects.
   */
  const setup = (store) =>
    createCampaignPlanner({
      store,
      now: () => 1000,
      source: {
        page: async () => ({ contacts: [], done: true, nextCursor: null }),
      },
      isSubscribed: async () => true,
      isSuppressed: async () => false,
      ensureMessage: async () => {},
      enqueue: async () => {},
    });
  /** First planner instance sharing the fixture campaign namespace. */
  const p1 = setup(a);
  /** Second planner instance used to exercise conflict/recovery visibility. */
  const p2 = setup(b);
  await p1.create({ id: 'shared1', name: 'Test', sendAt: 1000 });
  await assert.rejects(
    p2.create({ id: 'shared1', name: 'Test', sendAt: 1000 }),
    /already exists/
  );
  await p2.command('shared1', 'schedule');
  /** Stale campaign revision captured before another planner advances the checkpoint. */
  const old = await a.load('shared1');
  await p1.runOnce('shared1', 'worker');
  assert.equal((await b.load('shared1')).status, 'completed');
  assert.equal(
    await a.save({ ...old, version: old.version + 1 }, old.version),
    false
  );
});
test('DB-backed suppression service persists hard bounces across service instances', async () => {
  /** Shared process-local structured protocol fixture; no native database is opened. */
  const db = fakeDb();
  /** First suppression service over the shared protocol fixture. */
  const s1 = createMarketingSuppressionService({
    store: createDatabaseMarketingSuppressionStore(db),
  });
  /** Second suppression service verifying persisted fixture visibility. */
  const s2 = createMarketingSuppressionService({
    store: createDatabaseMarketingSuppressionStore(db),
  });
  assert.equal(await s2.isSuppressed('a@example.test'), false);
  await s1.recordFeedback({
    email: 'a@example.test',
    kind: 'complaint',
    eventId: 'provider-1',
  });
  assert.equal(await s2.isSuppressed('A@example.test'), true);
});
test('CAS stores refuse connectors that do not report affected rows', async () => {
  /** Shared process-local structured protocol fixture; no native database is opened. */
  const db = fakeDb();
  /** Campaign-store wrapper whose update port deliberately omits affected-count evidence. */
  const store = createDatabaseCampaignStore({
    ...db,
    update: async () => ({ ok: true }),
  });
  /** Planner used to verify fail-closed rejection of unverifiable CAS. */
  const p = createCampaignPlanner({
    store,
    now: () => 1000,
    source: {
      page: async () => ({ contacts: [], done: true, nextCursor: null }),
    },
    isSubscribed: async () => true,
    isSuppressed: async () => false,
    ensureMessage: async () => {},
    enqueue: async () => {},
  });
  await p.create({ id: 'unsafe', name: 'Unsafe', sendAt: 1000 });
  await assert.rejects(
    p.command('unsafe', 'schedule'),
    /missing affectedCount/
  );
});
