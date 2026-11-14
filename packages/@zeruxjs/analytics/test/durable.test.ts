import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createAnalytics, createEventSchemaRegistry } from '@zeruxjs/analytics';
import { createDurableAnalytics } from '@zeruxjs/analytics/durable';
/** Scoped CommonJS bridge for the existing SQLite test connector. */
const require = createRequire(import.meta.url);
/** Native SQLite fixture factory; only synthetic memory/owned temporary state is used. */
const { createConnector } = require('../../db-sqllite/dist/index.js');
/** UTC day duration used for deterministic window arithmetic. */
const DAY = 86400000;
/** Explicit validated sale schema for the isolated durable fixture. */
const schema = createEventSchemaRegistry([
  {
    name: 'sale',
    version: 1,
    properties: { amount: { kind: 'metric', unit: 'count', required: true } },
  },
]);
/** Create isolated synthetic state and explicit fault/clock controls for this case.
 * @returns {Promise<object>} Isolated fixture values for the following assertions.
 */
async function fixture() {
  /** Owned temporary fixture directory, recursively removed during teardown. */
  const directory = await mkdtemp(path.join(os.tmpdir(), 'analytics-durable-'));
  let connector;
  /** Generated local open URL; no remote resource is fetched.
   * @returns {Promise<unknown>} Generated local open URL; no remote resource is fetched. */
  const open = async () =>
    (connector = await createConnector({
      filename: path.join(directory, 'data.sqlite'),
      driver: 'node',
      journalMode: 'wal',
    }));
  await open();
  /** Synthetic connector/message context containing no real credentials or recipient data. */
  const context = {
    connection: {
      slug: 'analytics',
      name: 'analytics',
      connector: '@zeruxjs/db-sqlite',
      options: {},
    },
  };
  /** Fixture connector operation adapter pinned to the synthetic context.
   * @param {object} op - Structured fixture database operation.
   * @returns {unknown} Fixture connector operation adapter pinned to the synthetic context. */
  const execute = (op) => connector.execute(op, context);
  /** Injected or synthetic database facade; ownership expectations are asserted explicitly. */
  const connection = Object.fromEntries(
    ['createTable', 'createIndex', 'insert', 'select', 'update', 'delete'].map(
      (op) => [op, (args) => execute({ op, ...args })]
    )
  );
  /** Manager configured only against the fixture-owned or injected database. */
  const analytics = createAnalytics({
    analytics: 'analytics',
    database: {
      connectionSlugs: ['analytics'],
      getConnectionFacade: () => connection,
    },
    schemaRegistry: schema,
    numericFields: ['amount'],
    onWarning: () => {},
    approveRetention: () => true,
    durableRetention: true,
  });
  await analytics.initialize();
  await connection.createTable({
    table: 'durable_ledger',
    ifNotExists: true,
    columns: [
      { name: 'id', type: 'varchar', length: 32, primary: true },
      { name: 'site', type: 'varchar', length: 200 },
      { name: 'revision', type: 'bigint' },
      { name: 'occurred_at', type: 'bigint' },
      { name: 'body', type: 'text' },
    ],
  });
  await connection.createTable({
    table: 'business',
    ifNotExists: true,
    columns: [{ name: 'id', type: 'varchar', length: 32, primary: true }],
  });
  /** Structured fixture row mapping; payloads remain inert JSON.
   * @param {object} r - Synthetic record/result.
   * @returns {object} Structured fixture row mapping; payloads remain inert JSON. */
  const values = (r) => ({
    id: r.id,
    site: r.site,
    revision: r.revision,
    occurred_at: r.occurredAt,
    body: JSON.stringify(r),
  });
  /** Explicit tenant/reference predicates used by the synthetic durable primary.
   * @param {object} r - Synthetic record/result.
   * @returns {object} Explicit tenant/reference predicates used by the synthetic durable primary. */
  const predicates = (r) => ({
    and: [
      { field: 'id', operator: 'eq', value: r.id },
      { field: 'site', operator: 'eq', value: r.site },
    ],
  });
  /** Isolated reference store; production durability is not inferred from this fixture. */
  const store = {
    contract: 'analytics-durable-v1',
    async insert(r) {
      try {
        /** Actual operation receipt checked by the following assertions. */
        const result = await connection.insert({
          table: 'durable_ledger',
          values: values(r),
        });
        if (result.ok) {
          return true;
        }
        if (await this.get(r)) {
          return false;
        }
        throw Error('ledger insert failure');
      } catch (error) {
        if (error.code === 'ERR_SQLITE_ERROR' && (await this.get(r))) {
          return false;
        }
        throw error;
      }
    },
    async get(ref) {
      /** Actual stored row or connector outcome validated in this fixture. */
      const r = await connection.select({
        table: 'durable_ledger',
        where: predicates(ref),
        limit: 1,
      });
      if (!r.ok) {
        throw Error('ledger read failed');
      }
      return r.rows?.[0] ? JSON.parse(r.rows[0].body) : null;
    },
    async cas(revision, next) {
      /** Actual stored row or connector outcome validated in this fixture. */
      const r = await connection.update({
        table: 'durable_ledger',
        values: values(next),
        where: {
          and: [
            ...predicates(next).and,
            { field: 'revision', operator: 'eq', value: revision },
          ],
        },
      });
      if (!r.ok) {
        throw Error('CAS failed');
      }
      return r.affectedCount === 1;
    },
    async page(site, q) {
      /** Actual stored row or connector outcome validated in this fixture. */
      const r = await connection.select({
        table: 'durable_ledger',
        where: {
          and: [
            { field: 'site', operator: 'eq', value: site },
            ...(q.before !== undefined
              ? [{ field: 'occurred_at', operator: 'lt', value: q.before }]
              : []),
            ...(q.cursor
              ? [{ field: 'id', operator: 'gt', value: q.cursor }]
              : []),
          ],
        },
        orderBy: [{ by: 'id', direction: 'asc' }],
        limit: q.limit,
      });
      if (!r.ok) {
        throw Error('page failed');
      }
      return r.rows.map((r) => JSON.parse(r.body));
    },
  };
  /** Require explicit connector success inside the fixture journal.
   * @param {object} r - Synthetic record/result.
   * @returns {unknown} Require explicit connector success inside the fixture journal. */
  const ok = (r) => {
    if (!r.ok) {
      throw Error('transaction operation failed');
    }
    return r;
  };
  /** Read one durable record on the supplied synthetic transaction pin.
   * @param {object} pin - Synthetic transaction pin.
   * @param {object} r - Synthetic record/result.
   * @returns {unknown} Read one durable record on the supplied synthetic transaction pin. */
  const read = (pin, r) => {
    /** Bounded fixture query rows, not production data. */
    const rows = ok(
      pin.select({ table: 'durable_ledger', where: predicates(r), limit: 1 })
    ).rows;
    return rows?.[0] ? JSON.parse(rows[0].body) : null;
  };
  /** Assert exact revision/lease ownership before fixture journal mutations.
   * @param {object} pin - Synthetic transaction pin.
   * @param {object} plan - Revision-fenced fixture plan.
   * @returns {void} Assert exact revision/lease ownership before fixture journal mutations. */
  const fence = (pin, plan) => {
    /** Current fixture state/revision used to verify conditional mutation. */
    const current = read(pin, plan.record);
    if (
      !current ||
      current.revision !== plan.record.revision ||
      current.lease?.token !== plan.record.lease?.token
    ) {
      throw Error('fence lost');
    }
  };
  /** Fixture-only version-fenced ledger replacement on the same pin.
   * @param {object} pin - Synthetic transaction pin.
   * @param {object} plan - Revision-fenced fixture plan.
   * @returns {void} Fixture-only version-fenced ledger replacement on the same pin. */
  const replace = (pin, plan) => {
    /** Actual operation receipt checked by the following assertions. */
    const result = ok(
      pin.update({
        table: 'durable_ledger',
        values: values(plan.next),
        where: {
          and: [
            ...predicates(plan.record).and,
            { field: 'revision', operator: 'eq', value: plan.record.revision },
          ],
        },
      })
    );
    if (result.affectedCount !== 1) {
      throw Error('fence lost');
    }
  };
  /** Host-style injected journal used only with synthetic transactions. */
  const journal = {
    append(pin, record) {
      ok(pin.insert({ table: 'durable_ledger', values: values(record) }));
      return true;
    },
    materialize(pin, plan, crash = false) {
      fence(pin, plan);
      ok(pin.insert({ table: 'analytics_events', values: plan.record.row }));
      if (crash) {
        throw Error('simulated crash between event and facts');
      }
      // Insert sidecars on the same synchronous fixture pin before advancing the ledger.
      for (const fact of plan.record.facts) {
        ok(pin.insert({ table: 'analytics_events_numeric', values: fact }));
      }
      replace(pin, plan);
      return true;
    },
    purge(pin, plans) {
      // Fence every candidate and verify fact/source counts before the fixture tombstone update.
      for (const plan of plans) {
        fence(pin, plan);
        /** Actual sidecar delete receipt compared against expected projection count. */
        const removedFacts = ok(
          pin.delete({
            table: 'analytics_events_numeric',
            where: {
              and: [
                {
                  field: 'event_id',
                  operator: 'eq',
                  value: plan.record.eventId,
                },
                { field: 'site', operator: 'eq', value: plan.record.site },
              ],
            },
          })
        );
        /** Expected field type or deletion count for the isolated assertion. */
        const expected =
          plan.record.status === 'persisted' ? plan.record.facts.length : 0;
        if (removedFacts.affectedCount !== expected) {
          throw Error('fact count mismatch');
        }
        /** Actual source deletion receipt checked before accepting the fixture journal. */
        const removed = ok(
          pin.delete({
            table: 'analytics_events',
            where: predicates(plan.record),
          })
        );
        if (
          removed.affectedCount !== (plan.record.status === 'persisted' ? 1 : 0)
        ) {
          throw Error('event count mismatch');
        }
        replace(pin, plan);
      }
      return true;
    },
  };
  return {
    analytics,
    store,
    journal,
    connection,
    get connector() {
      return connector;
    },
    async reopen() {
      await connector.disconnect();
      await open();
    },
    async close() {
      await connector.disconnect();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
/** Explicit synthetic consented sale event builder.
 * @param {string} site - Synthetic verified tenant/site.
 * @returns {object} Explicit synthetic consented sale event builder. */
const input = (site = 'north') => ({
  name: 'sale',
  site,
  source: 'web',
  consent: 'granted',
  occurredAt: Date.now() - 2 * DAY,
  properties: { amount: 3 },
});
/** Synthetic stable idempotency/property/group key. */
const key = 'opaque_ingest_0123456789';
test('SQLite/WAL durable acceptance survives reopen; event/fact/ledger rollback and expired-lease recovery are atomic', async () => {
  /** Isolated fixture resources and fault controls for this case. */
  const f = await fixture();
  let now = Date.now();
  /** Owned durable coordinator; tests close it before fixture teardown. */
  const durable = createDurableAnalytics({
    schemaRegistry: schema,
    numericFields: ['amount'],
    store: f.store,
    authorize: () => true,
    now: () => now,
    leaseMs: 1000,
    baseDelayMs: 1,
  });
  try {
    /** Synthetic event/input used for repeatable validation and dedup checks. */
    const event = input();
    /** Durable acceptance receipt; not yet proof of event materialization. */
    const accepted = await durable.accept(event, key, 'host');
    assert.equal(accepted.state, 'accepted');
    assert.equal((await f.analytics.events()).length, 0);
    await f.reopen();
    assert.equal((await durable.confirm(accepted, 'host')).state, 'accepted');
    /** First fixture receipt, service, key or lease in this comparison. */
    const first = await durable.prepareMaterialization(accepted, 'worker');
    assert.ok(first.plan);
    assert.throws(
      () =>
        f.connector.transactionSync((pin) =>
          f.journal.materialize(pin, first.plan, true)
        ),
      /simulated crash/
    );
    assert.equal((await f.analytics.events()).length, 0);
    assert.equal(
      (await f.connection.select({ table: 'analytics_events_numeric' })).rows
        .length,
      0
    );
    assert.equal((await durable.confirm(accepted, 'host')).state, 'uncertain');
    now += 2000;
    /** Explicit replay after the fixture lease expires. */
    const retry = await durable.prepareMaterialization(accepted, 'worker');
    assert.equal(retry.plan.record.attempts, 2);
    assert.throws(
      () =>
        f.connector.transactionSync((pin) =>
          f.journal.materialize(pin, first.plan)
        ),
      /fence/
    );
    f.connector.transactionSync((pin) =>
      f.journal.materialize(pin, retry.plan)
    );
    assert.equal((await durable.confirm(accepted, 'host')).state, 'persisted');
    /** Existing durable acceptance receipt used to assert no repeated business work. */
    const duplicate = await durable.accept(event, key, 'host');
    assert.equal(duplicate.state, 'persisted');
    assert.equal(duplicate.duplicate, true);
    assert.equal((await f.analytics.events()).length, 1);
    assert.equal(
      (
        await f.analytics.aggregateNumeric({
          groupBy: 'site',
          metric: 'sum',
          valueField: 'amount',
        })
      ).total,
      3
    );
    assert.equal(
      (await durable.prepareMaterialization(accepted, 'worker')).acknowledgement
        .state,
      'persisted'
    );
    await assert.rejects(
      f.analytics.purgePage({ site: 'north', before: Date.now() - DAY }),
      /Durable retention/
    );
  } finally {
    await durable.close();
    await f.close();
  }
});
test('unique acceptance, consent/schema/tenant denial, body conflict and retention tombstones preserve dedup lifetime', async () => {
  /** Isolated fixture resources and fault controls for this case. */
  const f = await fixture();
  /** Owned durable coordinator; tests close it before fixture teardown. */
  const durable = createDurableAnalytics({
    schemaRegistry: schema,
    numericFields: ['amount'],
    store: f.store,
    authorize: (_action, ref, principal) =>
      principal === 'trusted' && ref.site === 'north',
  });
  try {
    /** Synthetic event/input used for repeatable validation and dedup checks. */
    const event = input();
    /** Concurrent acceptance outcomes; exactly one must reserve the fixture key. */
    const replies = await Promise.all([
      durable.accept(event, key, 'trusted'),
      durable.accept(event, key, 'trusted'),
    ]);
    assert.equal(replies.filter((r) => !r.duplicate).length, 1);
    // Consent, schema and forged-site cases must never reserve a durable acceptance.
    for (const bad of [
      { ...event, consent: 'denied' },
      { ...event, site: 'south' },
      { ...event, properties: { amount: '3' } },
    ]) {
      await assert.rejects(durable.accept(bad, key, 'trusted'));
    }
    await assert.rejects(
      durable.accept({ ...event, properties: { amount: 4 } }, key, 'trusted'),
      (e) => e.code === 'DEDUPE_CONFLICT'
    );
    await assert.rejects(
      durable.confirm(replies[0], 'other'),
      (e) => e.code === 'DENIED'
    );
    /** Payload-free bounded purge preview; no deletion occurs here. */
    const preview = await durable.previewPurge(
      'north',
      Date.now() - DAY,
      'trusted'
    );
    assert.equal(preview.unprocessed, 1);
    assert.doesNotMatch(
      JSON.stringify(preview),
      /amount|properties_json|lease/
    );
    await assert.rejects(
      durable.preparePurge(preview, 'reject-unprocessed', 'trusted'),
      (e) => e.code === 'UNPROCESSED_CONFLICT'
    );
    await assert.rejects(
      durable.preparePurge(preview, 'cancel-unprocessed', 'denied'),
      (e) => e.code === 'DENIED'
    );
    /** Authorized revision-fenced fixture plans before journal execution. */
    const plans = await durable.preparePurge(
      preview,
      'cancel-unprocessed',
      'trusted'
    );
    f.connector.transactionSync((pin) => f.journal.purge(pin, plans));
    assert.equal((await durable.accept(event, key, 'trusted')).state, 'purged');
    assert.equal((await f.store.get(replies[0])).row, null);
  } finally {
    await durable.close();
    await f.close();
  }
});
test('bounded transient retry/dead-letter, opaque dispatch and approved numeric/source deletion', async () => {
  /** Isolated fixture resources and fault controls for this case. */
  const f = await fixture();
  let now = Date.now();
  /** Owned durable coordinator; tests close it before fixture teardown. */
  const durable = createDurableAnalytics({
    schemaRegistry: schema,
    numericFields: ['amount'],
    store: f.store,
    authorize: () => true,
    maxAttempts: 2,
    leaseMs: 1000,
    baseDelayMs: 1,
    now: () => now,
  });
  try {
    /** Durable acceptance receipt; not yet proof of event materialization. */
    const accepted = await durable.accept(input(), key, 'host');
    /** Independent synthetic durable record used for dispatch/isolation. */
    const other = await durable.accept(input(), 'other_0123456789', 'host');
    /** First fixture receipt, service, key or lease in this comparison. */
    const first = await durable.prepareMaterialization(accepted, 'worker');
    await durable.settleFailure(
      accepted,
      first.plan.record.lease.token,
      'transient',
      'worker'
    );
    now += 2;
    /** Second fixture receipt, service, key or lease for replay/rotation/isolation checks. */
    const second = await durable.prepareMaterialization(accepted, 'worker');
    assert.equal(
      (
        await durable.settleFailure(
          accepted,
          second.plan.record.lease.token,
          'permanent',
          'worker'
        )
      ).state,
      'dead'
    );
    /** Opaque references observed by the injected acknowledged publisher. */
    const published = [];
    /** Injected acknowledged nondestructive backend; it performs no network I/O. */
    const publisher = {
      acknowledgement: true,
      destructiveRead: false,
      async publish(ref) {
        published.push(ref);
      },
    };
    await durable.dispatch('north', 'worker', publisher);
    assert.deepEqual(published, [{ site: 'north', id: other.id }]);
    await assert.rejects(
      durable.dispatch('north', 'worker', {
        ...publisher,
        acknowledgement: false,
        destructiveRead: true,
      }),
      (e) => e.code === 'ACKNOWLEDGED_PUBLISHER_REQUIRED'
    );
    /** Leased materialization plan whose transaction is executed by the fixture. */
    const work = await durable.prepareMaterialization(other, 'worker');
    f.connector.transactionSync((pin) => f.journal.materialize(pin, work.plan));
    /** Payload-free bounded purge preview; no deletion occurs here. */
    const preview = await durable.previewPurge('north', now - DAY, 'host');
    assert.equal(preview.items.length, 2);
    assert.equal(preview.eventCandidates, 1);
    assert.equal(preview.numericFactCandidates, 1);
    /** Authorized revision-fenced fixture plans before journal execution. */
    const plans = await durable.preparePurge(
      preview,
      'cancel-unprocessed',
      'host'
    );
    f.connector.transactionSync((pin) => f.journal.purge(pin, plans));
    assert.equal((await f.analytics.events()).length, 0);
    assert.equal(
      (await f.connection.select({ table: 'analytics_events_numeric' })).rows
        .length,
      0
    );
    await assert.rejects(
      durable.preparePurge(preview, 'cancel-unprocessed', 'host'),
      (e) => e.code === 'STALE_PREVIEW'
    );
  } finally {
    await durable.close();
    await f.close();
  }
});
test('SQLite synchronous business+ledger append rolls back together; unsupported async pin rejects before claiming', async () => {
  /** Isolated fixture resources and fault controls for this case. */
  const f = await fixture();
  /** Owned durable coordinator; tests close it before fixture teardown. */
  const durable = createDurableAnalytics({
    schemaRegistry: schema,
    numericFields: ['amount'],
    store: f.store,
    authorize: () => true,
  });
  try {
    /** Prepared immutable acceptance; preparation alone does not persist it. */
    const record = await durable.prepare(input(), key, 'host');
    assert.throws(() =>
      f.connector.transactionSync((pin) => {
        f.journal.append(pin, record);
        pin.insert({ table: 'business', values: { id: record.id } });
        throw Error('abort business');
      })
    );
    assert.equal(await f.store.get(record), null);
    assert.equal(
      (await f.connection.select({ table: 'business' })).rows.length,
      0
    );
    await assert.rejects(
      durable.commit({}, f.journal, input(), key, 'host', () => {}),
      (e) => e.code === 'PINNED_TRANSACTION_REQUIRED'
    );
    assert.equal(await f.store.get(record), null);
    await durable.accept(input(), key, 'host');
    await assert.rejects(
      durable.persist({}, f.journal, record, 'worker'),
      (e) => e.code === 'PINNED_TRANSACTION_REQUIRED'
    );
    assert.equal((await f.store.get(record)).attempts, 0);
  } finally {
    await durable.close();
    await f.close();
  }
});
test('failed acceptance is uncertain, does not claim success, and close drains without closing host storage', async () => {
  let finish,
    closed = 0;
  /** Isolated reference store; production durability is not inferred from this fixture. */
  const store = {
    contract: 'analytics-durable-v1',
    async insert() {
      await new Promise((resolve) => (finish = resolve));
      throw Error('PRIVATE database password');
    },
    async get() {
      return null;
    },
    async cas() {
      return false;
    },
    async page() {
      return [];
    },
    close() {
      closed++;
    },
  };
  /** Owned durable coordinator; tests close it before fixture teardown. */
  const durable = createDurableAnalytics({
    store,
    schemaRegistry: schema,
    authorize: () => true,
    maxPending: 1,
  });
  /** Durable acceptance receipt; not yet proof of event materialization. */
  const accepted = durable.accept(input(), key, 'host');
  /** Attached rejection observer preventing unhandled promise errors during close tests. */
  const observed = assert.rejects(
    accepted,
    (e) => e.code === 'ACCEPTANCE_UNCERTAIN' && !e.message.includes('PRIVATE')
  );
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    durable.accept(input(), 'second_0123456789', 'host'),
    (e) => e.code === 'OVERLOAD'
  );
  let settled = false;
  /** Observed close promise; must wait for actual native work settlement. */
  const closing = durable.close().then(() => (settled = true));
  await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(settled, false);
  finish();
  await observed;
  await closing;
  assert.equal(closed, 0);
  await assert.rejects(
    durable.accept(input(), key, 'host'),
    (e) => e.code === 'CLOSED'
  );
});
test('shared pinned transaction extension: business/ledger commit, rollback and lost commit acknowledgement', async () => {
  /** Public pinned-transaction factory used with an entirely synthetic adapter. */
  const { createPinnedTransaction } = await import('@zeruxjs/db');
  let state = { ledger: new Map(), events: [], facts: [], business: [] },
    active = 0,
    sequence = 0,
    loseAck = false;
  /** Observed transaction operations used to prove same-pin ownership. */
  const operations = [];
  /** Explicit synthetic native transaction capability declaration. */
  const caps = {
    isolationLevels: ['serializable'],
    timeout: 'cooperative',
    savepoints: false,
    transactionalDdl: true,
  };
  /** Injected fixture backend with bounded in-memory/synthetic state. */
  const adapter = {
    capabilities: caps,
    async acquire() {
      /** Synthetic opaque source/correlation identifier. */
      const id = ++sequence;
      active++;
      let draft;
      return {
        begin() {
          draft = structuredClone(state);
        },
        execute(op) {
          operations.push({ id, table: op.table });
          if (op.op === 'select') {
            return { ok: true, rows: [] };
          }
          if (op.table === 'ledger') {
            draft.ledger.set(op.values.id, JSON.parse(op.values.body));
          } else {
            draft[op.table].push(op.values);
          }
          return { ok: true, affectedCount: 1 };
        },
        commit() {
          state = draft;
          if (loseAck) {
            loseAck = false;
            throw Error('PRIVATE commit acknowledgement lost');
          }
        },
        rollback() {},
        release() {
          active--;
        },
      };
    },
  };
  /** Pinned synthetic transaction callback used for rollback/unknown-commit tests. */
  const tx = createPinnedTransaction(adapter, {
    slug: 'pin',
    name: 'Pin',
    connector: 'synthetic',
    options: {},
  });
  /** Isolated fixture database or injected facade for this test. */
  const db = { transaction: tx, transactionCapabilities: () => caps };
  /** Isolated reference store; production durability is not inferred from this fixture. */
  const store = {
    contract: 'analytics-durable-v1',
    async insert(r) {
      if (state.ledger.has(r.id)) {
        return false;
      }
      state.ledger.set(r.id, structuredClone(r));
      return true;
    },
    async get(r) {
      return structuredClone(state.ledger.get(r.id) ?? null);
    },
    async cas(revision, r) {
      if (state.ledger.get(r.id)?.revision !== revision) {
        return false;
      }
      state.ledger.set(r.id, structuredClone(r));
      return true;
    },
    async page() {
      return [];
    },
  };
  /** Host-style injected journal used only with synthetic transactions. */
  const journal = {
    async append(pin, r) {
      await pin.insert({
        table: 'ledger',
        values: { id: r.id, body: JSON.stringify(r) },
      });
      return true;
    },
    async materialize(pin, p) {
      assert.equal(state.ledger.get(p.record.id).revision, p.record.revision);
      await pin.insert({ table: 'events', values: p.record.row });
      // Keep every sidecar on the same synthetic asynchronous pin as the event and ledger.
      for (const fact of p.record.facts) {
        await pin.insert({ table: 'facts', values: fact });
      }
      await pin.insert({
        table: 'ledger',
        values: { id: p.next.id, body: JSON.stringify(p.next) },
      });
      return true;
    },
  };
  /** Owned durable coordinator; tests close it before fixture teardown. */
  const durable = createDurableAnalytics({
    store,
    schemaRegistry: schema,
    numericFields: ['amount'],
    authorize: () => true,
  });
  try {
    /** Synthetic event/input used for repeatable validation and dedup checks. */
    const event = input();
    await assert.rejects(
      durable.commit(db, journal, event, key, 'host', async (pin) => {
        await pin.insert({ table: 'business', values: { id: 'rollback' } });
        throw Error('abort');
      }),
      (e) => e.code === 'COMMIT_UNCERTAIN'
    );
    assert.equal(state.ledger.size, 0);
    assert.equal(state.business.length, 0);
    assert.equal(active, 0);
    /** Durable acceptance receipt; not yet proof of event materialization. */
    const accepted = await durable.commit(
      db,
      journal,
      event,
      key,
      'host',
      async (pin) => {
        await pin.insert({ table: 'business', values: { id: 'once' } });
      }
    );
    assert.equal(accepted.state, 'accepted');
    assert.equal(state.business.length, 1);
    assert.equal(new Set(operations.slice(-2).map((o) => o.id)).size, 1);
    let replayed = 0;
    assert.equal(
      (await durable.commit(db, journal, event, key, 'host', () => replayed++))
        .duplicate,
      true
    );
    assert.equal(replayed, 0);
    loseAck = true;
    assert.equal(
      (await durable.persist(db, journal, accepted, 'worker')).state,
      'uncertain'
    );
    assert.equal((await durable.confirm(accepted, 'host')).state, 'persisted');
    assert.equal(
      (await durable.persist(db, journal, accepted, 'worker')).state,
      'persisted'
    );
    assert.equal(state.events.length, 1);
    assert.equal(state.facts.length, 1);
    assert.equal(active, 0);
  } finally {
    await durable.close();
  }
});
test('schema catalog upgrades and long-lived replay keep the original schema identity; expiry never silently reuses keys', async () => {
  /** Isolated fixture resources and fault controls for this case. */
  const f = await fixture();
  let now = Date.now();
  /** Initial generation/acceptance before schema or lease changes. */
  const initial = createDurableAnalytics({
    store: f.store,
    schemaRegistry: schema,
    authorize: () => true,
    now: () => now,
  });
  let upgraded;
  try {
    /** Synthetic event/input used for repeatable validation and dedup checks. */
    const event = input();
    /** Durable acceptance receipt; not yet proof of event materialization. */
    const accepted = await initial.accept(event, key, 'host');
    /** Additive-only schema upgrade retaining earlier immutable definitions. */
    const nextSchema = createEventSchemaRegistry([
      {
        name: 'sale',
        version: 1,
        properties: {
          amount: { kind: 'metric', unit: 'count', required: true },
        },
      },
      {
        name: 'sale',
        version: 2,
        properties: {
          amount: { kind: 'metric', unit: 'count', required: true },
          extra: { kind: 'parameter', type: 'boolean' },
        },
      },
    ]);
    upgraded = createDurableAnalytics({
      store: f.store,
      schemaRegistry: nextSchema,
      authorize: () => true,
      now: () => now,
    });
    assert.equal((await upgraded.accept(event, key, 'host')).duplicate, true);
    now = accepted.dedupUntil;
    await assert.rejects(
      upgraded.accept(event, key, 'host'),
      (e) => e.code === 'DEDUPE_KEY_EXPIRED'
    );
  } finally {
    await initial.close();
    await upgraded?.close();
    await f.close();
  }
});
test('a worker claim after approved purge preparation fences deletion and preserves rows', async () => {
  /** Isolated fixture resources and fault controls for this case. */
  const f = await fixture();
  /** Owned durable coordinator; tests close it before fixture teardown. */
  const durable = createDurableAnalytics({
    store: f.store,
    schemaRegistry: schema,
    authorize: () => true,
  });
  try {
    /** Durable acceptance receipt; not yet proof of event materialization. */
    const accepted = await durable.accept(input(), key, 'host');
    /** Payload-free bounded purge preview; no deletion occurs here. */
    const preview = await durable.previewPurge(
      'north',
      Date.now() - DAY,
      'host'
    );
    /** Authorized revision-fenced fixture plans before journal execution. */
    const plans = await durable.preparePurge(
      preview,
      'cancel-unprocessed',
      'host'
    );
    /** Private leased plan used to test stale approved purge fencing. */
    const claimed = await durable.prepareMaterialization(accepted, 'worker');
    assert.ok(claimed.plan);
    assert.throws(
      () => f.connector.transactionSync((pin) => f.journal.purge(pin, plans)),
      /fence/
    );
    assert.equal((await f.store.get(accepted)).status, 'processing');
    /** Authorized payload-free inspection result. */
    const metadata = await durable.inspect(accepted, 'host');
    assert.equal(metadata.attempts, 1);
    assert.doesNotMatch(
      JSON.stringify(metadata),
      /amount|properties_json|token/
    );
  } finally {
    await durable.close();
    await f.close();
  }
});
