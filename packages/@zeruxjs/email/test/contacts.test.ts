import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMailingListService,
  createMemoryMailingContactStore,
  createDatabaseMailingContactStore,
} from '../dist/index.js';
/** Process-local contact service; membership is not marketing consent. */
const service = createMailingListService({
  store: createMemoryMailingContactStore(),
  now: () => 1000,
});
test('contact list management and campaign cursor stay deterministic', async () => {
  await service.upsert('first@example.test', ['vip'], {
    region: 'AU',
    spent: 23,
  });
  await service.upsert('second@example.test', ['vip', 'retail'], {
    region: 'US',
  });
  await service.upsert('third@example.test', ['retail']);
  await service.upsert('FIRST@example.test', ['vip', 'staff'], { spent: 40 });
  let cursor = null;
  /** Finite accumulated synthetic audience used to check deterministic keyset paging. */
  const all = [];
  // Read finite keyset pages until the explicit continuation ends; do not infer consent from membership.
  do {
    /** Bounded contact page and exclusive continuation used for consistency assertions. */
    const page = await service.campaignSource('vip').page({ cursor, limit: 1 });
    all.push(...page.contacts);
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(all.length, 2);
  assert.equal(
    all.find((r) => r.email === 'first@example.test').traits.spent,
    40
  );
  assert.equal(await service.removeFromList('FIRST@example.test', 'vip'), true);
  assert.equal((await service.page('vip')).contacts.length, 1);
  await assert.rejects(
    service.upsert('a@example.test', ['bad:list']),
    /memberships/
  );
  await assert.rejects(
    service.upsert('a@example.test', [], JSON.parse('{"__proto__":"bad"}')),
    /Invalid/
  );
});
test('database contact store shares updates and uses versioned CAS', async () => {
  /** Process-local native-row fixture shared only by this test case. */
  const records = new Map();
  /** Borrowed structured database protocol fixture; no network/database client starts. */
  const db = {
    /**
     * Initialize the named fixture table without a native migration.
     *
     * @returns {Promise<object>} Synthetic operation outcome; native connector semantics are qualified separately.
     */
    async createTable() {
      return { ok: true };
    },
    /**
     * Reserve one unique synthetic row identity; duplicate inserts reject.
     *
     * @param {object} query - Explicit structured fixture operation.
     * @param {object} query.values - Synthetic private row values including identity/revision.
     * @returns {Promise<object>} Synthetic operation outcome; native connector semantics are qualified separately.
     */
    async insert({ values }) {
      if (records.has(values.id)) {
        throw Error('unique');
      }
      records.set(values.id, { ...values });
      return { ok: true };
    },
    /**
     * Select only fixture-supported structured predicates in deterministic order.
     *
     * @param {object} query - Explicit structured fixture operation.
     * @param {object} query.where - Explicit equality/range/CAS predicates; never raw SQL.
     * @param {number} query.limit - Finite page size, default 100 for this fixture.
     * @returns {Promise<object>} Synthetic operation outcome; native connector semantics are qualified separately.
     */
    async select({ where, limit = 100 }) {
      /** Stable sorted synthetic rows before bounded predicate evaluation. */
      const all = [...records.values()].sort((a, b) =>
        a.id.localeCompare(b.id)
      );
      return {
        ok: true,
        rows: all
          .filter((r) =>
            (() => {
              if (!where) {
                return true;
              }
              if (where.and) {
                return where.and.every((c) => r[c.field] === c.value);
              }
              if (where.operator === 'gt') {
                return r.id > where.value;
              }
              return r.id === where.value;
            })()
          )
          .slice(0, limit),
      };
    },
    /**
     * Apply only an exact identity/revision fixture CAS update.
     *
     * @param {object} query - Explicit structured fixture operation.
     * @param {object} query.where - Explicit equality/range/CAS predicates; never raw SQL.
     * @param {object} query.values - Synthetic private row values including identity/revision.
     * @returns {Promise<object>} Synthetic operation outcome; native connector semantics are qualified separately.
     */
    async update({ where, values }) {
      /** Opaque row identity extracted from the fixed CAS predicate. */
      const id = where.and[0].value;
      /** Expected row revision; a mismatch must preserve the current record. */
      const version = where.and[1].value;
      /** Existing synthetic row used to fence revision updates. */
      const old = records.get(id);
      if (!old || old.version !== version) {
        return { ok: true, affectedCount: 0 };
      }
      records.set(id, { ...old, ...values });
      return { ok: true, affectedCount: 1 };
    },
  };
  /** First contact-service wrapper borrowing the shared fixture. */
  const one = createMailingListService({
    store: createDatabaseMailingContactStore(db),
  });
  /** Second contact-service wrapper verifying merge/revision visibility. */
  const two = createMailingListService({
    store: createDatabaseMailingContactStore(db),
  });
  await one.upsert('contact@example.test', ['newsletter'], { country: 'IN' });
  await two.upsert('contact@example.test', ['buyers'], { total: 100 });
  /** Bounded contact page and exclusive continuation used for consistency assertions. */
  const page = await one.page('buyers');
  assert.equal(page.contacts[0].traits.country, 'IN');
  assert.equal(page.contacts[0].traits.total, 100);
});
test('contact erasure uses atomic versioning and removes stored recipient PII', async () => {
  /** Contact service scoped only to synthetic in-memory records for authorized erasure assertions. */
  const s = createMailingListService({
    store: createMemoryMailingContactStore(),
  });
  await s.upsert('person@example.test', ['newsletter'], { region: 'AU' });
  assert.equal(await s.erase('PERSON@example.test'), true);
  assert.equal(await s.erase('person@example.test'), false);
  assert.deepEqual((await s.page('newsletter')).contacts, []);
  await s.upsert('person@example.test', ['newsletter'], { region: 'NZ' });
  assert.equal((await s.page('newsletter')).contacts[0].traits.region, 'NZ');
});
test('database contact erasure refuses missing atomic delete and respects row version fences', async () => {
  /** Synthetic private row map; no real user record is deleted. */
  const rows = new Map();
  /** Borrowed structured database protocol fixture; no network/database client starts. */
  const db = {
    /**
     * Initialize the named fixture table without a native migration.
     *
     * @returns {Promise<object>} Synthetic operation outcome; native connector semantics are qualified separately.
     */
    async createTable() {
      return { ok: true };
    },
    /**
     * Reserve one unique synthetic row identity; duplicate inserts reject.
     *
     * @param {object} query - Explicit structured fixture operation.
     * @param {object} query.values - Synthetic private row values including identity/revision.
     * @returns {Promise<object>} Synthetic operation outcome; native connector semantics are qualified separately.
     */
    async insert({ values }) {
      if (rows.has(values.id)) {
        throw Error('duplicate');
      }
      rows.set(values.id, { ...values });
      return { ok: true };
    },
    /**
     * Select only fixture-supported structured predicates in deterministic order.
     *
     * @param {object} query - Explicit structured fixture operation.
     * @param {object} query.where - Explicit equality/range/CAS predicates; never raw SQL.
     * @returns {Promise<object>} Synthetic operation outcome; native connector semantics are qualified separately.
     */
    async select({ where }) {
      return {
        ok: true,
        rows: [...rows.values()].filter((r) => r.id === where.value),
      };
    },
    /**
     * Apply only an exact identity/revision fixture CAS update.
     *
     * @returns {Promise<object>} Synthetic operation outcome; native connector semantics are qualified separately.
     */
    async update() {
      return { ok: true, affectedCount: 0 };
    },
  };
  /** Contact service scoped only to synthetic in-memory records for authorized erasure assertions. */
  const s = createMailingListService({
    store: createDatabaseMailingContactStore(db),
  });
  await s.upsert('erase@example.test', ['subscriber'], { country: 'IN' });
  await assert.rejects(s.erase('erase@example.test'), /atomic delete/);
  db.delete = async ({ where }) => {
    /** Opaque row identity extracted from the fixed CAS predicate. */
    const id = where.and[0].value;
    /** Expected delete revision; deletion is allowed only for the exact matching row. */
    const v = where.and[1].value;
    if (rows.get(id)?.version !== v) {
      return { ok: true, affectedCount: 0 };
    }
    rows.delete(id);
    return { ok: true, affectedCount: 1 };
  };
  assert.equal(await s.erase('erase@example.test'), true);
  assert.equal(rows.size, 0);
});
