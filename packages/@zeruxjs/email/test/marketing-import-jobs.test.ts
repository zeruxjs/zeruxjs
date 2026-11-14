import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createMarketingImportJob,
  createMarketingCampaignService,
} from '../dist/index.js';
/** Fixed module bridge for the built SQLite connector; never arbitrary package discovery. */
const require = createRequire(import.meta.url);
/** Public built SQLite factory used only with owned synthetic state. */
const { createConnector } = require('../../db-sqllite/dist/index.js');
/** Fixed structured database context, unrelated to operator application storage. */
const ctx = {
  connection: {
    slug: 'main',
    name: 'main',
    connector: '@zeruxjs/db-sqlite',
    options: {},
  },
};
/**
 * Borrow only the fixture structured database operation allowlist.
 *
 * @param {object} c - Owned SQLite connector whose lifetime stays outside this borrowed port.
 * @returns {object} Borrowed port; native disconnect ownership stays with the caller.
 */
const dbFrom = (c) =>
  Object.fromEntries(
    ['createTable', 'createIndex', 'insert', 'select', 'update'].map((op) => [
      op,
      (arg) => c.execute({ op, ...arg }, ctx),
    ])
  );
/**
 * Create local create-only/load state for synthetic delivery identities.
 *
 * @returns {object} Process-local protocol fixture, not a durable message store.
 */
const delivery = () => {
  /** Private synthetic delivery identities retained only for this fixture. */
  const map = new Map();
  return {
    /**
     * Load one exact synthetic identity without acquiring resources.
     *
     * @param {string} id - Opaque synthetic delivery reference.
     * @returns {Promise<object | null>} Private synthetic row or absence.
     */
    async load(id) {
      return map.get(id) || null;
    },
    /**
     * Reserve one unique synthetic identity without overwriting an existing record.
     *
     * @param {object} r - Private synthetic pending delivery record.
     * @returns {Promise<boolean>} True for first creation, false on duplicate identity.
     */
    async create(r) {
      if (map.has(r.id)) {
        return false;
      }
      map.set(r.id, r);
      return true;
    },
  };
};
test('durable import with two SQLite connections recovers failed page and fences stale leases', async () => {
  /** Owned temporary directory removed after the native handles settle. */
  const folder = await mkdtemp(join(tmpdir(), 'zerux-import-'));
  /** Synthetic SQLite journal path inside the owned temporary directory. */
  const file = join(folder, 'state.db');
  /** First owned native handle over the synthetic journal; disconnect in cleanup. */
  let one;
  /** Second owned handle testing committed lease/CAS visibility across connections. */
  let two;
  try {
    // Own cleanup before either acquisition; a failed second open must not strand the first.
    one = await createConnector({ filename: file, driver: 'node' });
    two = await createConnector({ filename: file, driver: 'node' });
    /** Borrowed operation port over the first owned handle. */
    const db1 = dbFrom(one);
    /** Borrowed operation port over the second owned handle. */
    const db2 = dbFrom(two);
    /** Local delivery protocol fixture; no SMTP or broker starts. */
    const dummy = delivery();
    /** Function-first service borrowing only synthetic persistence and queue ports. */
    const service = createMarketingCampaignService({
      db: db1,
      delivery: dummy,
      queue: {
        /**
         * Capture only opaque native task arguments without contacting a broker.
         *
         * @returns {Promise<object>} Synthetic acceptance receipt; no import work has completed.
         */
        async add() {},
      },
      now: () => 1000,
    });
    /** Opaque synthetic campaign reference for the immutable-source import job. */
    const code = await service.create({
      name: 'Reusable import',
      subject: 'Hi',
      text: 'Welcome',
      account: 'primary',
      recipients: ['first@example.com'],
      autoEnqueue: false,
    });
    /** Finite immutable synthetic recipient array; sourceRevision represents this exact fixture. */
    const input = Array.from({ length: 240 }, (_, i) => ({
      email: `member${i}@example.com`,
      name: `User ${i}`,
      data: { segment: 'vip' },
    }));
    let time = 1000,
      failOnce = true;
    /** Registered local immutable-source capability; it never fetches a model/user-supplied URL. */
    const source = {
      /**
       * Read one finite immutable source slice, with a deliberate one-time dependency outage.
       *
       * @param {object} query - Explicit immutable-source page request.
       * @param {string | null} query.cursor - Exclusive fixture offset; null starts the source.
       * @param {number} query.limit - Finite page size selected by the persisted job.
       * @returns {Promise<object>} Private recipients and explicit continuation; failure does not advance the checkpoint.
       */
      async page({ cursor, limit }) {
        if (failOnce && cursor === '0100') {
          failOnce = false;
          throw new Error('upstream unavailable');
        }
        /** Numeric position decoded from the fixture exclusive cursor. */
        const index = cursor === null ? 0 : Number(cursor);
        /** Bounded private immutable-source slice; never enter checkpoint/queue payloads. */
        const recipients = input.slice(index, index + limit);
        /** Exclusive next offset derived only from this finite source slice. */
        const next = index + recipients.length;
        return {
          recipients,
          done: next >= input.length,
          nextCursor:
            next >= input.length ? null : String(next).padStart(4, '0'),
        };
      },
    };
    /** Fixed job/source identity and finite lease/page policy with a controlled clock. */
    const options = {
      id: 'csv-import-1',
      campaignCode: code,
      sourceRevision: 'snapshot-20261013-v1',
      source,
      now: () => time,
      leaseMs: 3000,
      batchSize: 100,
      append: (campaign, rows) => service.appendRecipients(campaign, rows),
    };
    /** First import controller over the shared durable SQLite fixture. */
    const a = createMarketingImportJob({ ...options, db: db1 });
    /** Second controller used to recover failure and take over only an expired lease. */
    const b = createMarketingImportJob({ ...options, db: db2 });
    /** First committed page receipt; later failure must preserve its progress. */
    const first = await a.runOnce('worker-a');
    assert.equal(first.state.processed, 100);
    assert.equal(first.state.status, 'pending');
    await assert.rejects(b.runOnce('worker-b'), /upstream unavailable/);
    assert.equal((await b.get()).processed, 100);
    /** Stale private lease used to verify commit/renew rejection after takeover. */
    const old = await a.acquire('worker-a');
    assert.ok(old);
    assert.equal(await b.acquire('worker-b'), null);
    time += 3001;
    /** New unexpired lease whose epoch/token fence the previous worker. */
    const takeover = await b.acquire('worker-b');
    assert.ok(takeover);
    await assert.rejects(
      a.commit(
        old,
        { recipients: [], done: true, nextCursor: null },
        { added: 0, existing: 0, recipientCount: 0 }
      ),
      /lease lost/
    );
    await assert.rejects(a.renew(old), /lease lost/);
    // Worker b releases its lease by committing the next page.
    /** Next immutable-source page read explicitly under the takeover lease. */
    const page = await source.page({ cursor: '0100', limit: 100 });
    /** Idempotent append receipt; metadata checkpoint is a separate commit. */
    const added = await service.appendRecipients(code, page.recipients);
    /** Token-free checkpoint receipt after the recovered page is appended. */
    const committed = await b.commit(takeover, page, added);
    assert.equal(committed.processed, 200);
    /** Final bounded page receipt; completed means import progress, not SMTP delivery. */
    const last = await a.runOnce('worker-a');
    assert.equal(last.state.status, 'completed');
    assert.equal(last.state.processed, 240);
    assert.equal((await b.runOnce('worker-b')).busy, true);
    assert.equal((await service.audience(code)).storedRecipientCount, 241);
    assert.equal(JSON.stringify(await a.get()).includes('@example.com'), false);
    /** Controller with incompatible source revision; persisted identity validation must reject. */
    const wrong = createMarketingImportJob({
      ...options,
      db: db2,
      sourceRevision: 'snapshot-20261013-v2',
    });
    await assert.rejects(wrong.get(), /identity or version conflict/);
    /** Separate synthetic job used to test cancellation fencing. */
    const secondary = createMarketingImportJob({
      ...options,
      db: db2,
      id: 'csv-import-cancel',
    });
    /** Private cancellation-test lease; never expose it through public management data. */
    const token = await secondary.acquire('worker-a');
    assert.ok(token);
    assert.equal((await secondary.cancel()).status, 'cancelled');
    await assert.rejects(
      secondary.commit(
        token,
        { recipients: [], done: true, nextCursor: null },
        { added: 0, existing: 0, recipientCount: 0 }
      ),
      /lease lost/
    );
  } finally {
    // Attempt both native closes and owned-folder removal even if an earlier close fails.
    try {
      await one?.disconnect();
    } finally {
      try {
        await two?.disconnect();
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    }
  }
});

test('BullMQ import adapter puts only opaque job identifiers in Redis and uses trusted resolver', async () => {
  /** Explicit public worker/enqueue adapters imported from the built package. */
  const { createMarketingImportProcessor, enqueueMarketingImportJob } =
    await import('../dist/index.js');
  /** Captured opaque native queue arguments; no Redis connection is made. */
  const calls = [];
  /** Synthetic explicit add port returning native-acceptance-shaped receipts. */
  const queue = {
    /**
     * Capture only opaque native task arguments without contacting a broker.
     *
     * @param {...unknown} args - Explicit native queue arguments captured only within the fixture.
     * @returns {Promise<object>} Synthetic acceptance receipt; no import work has completed.
     */
    async add(...args) {
      calls.push(args);
      return { id: args[2].jobId };
    },
  };
  /** Synthetic queue receipt; accepted task is not completed import. */
  const queued = await enqueueMarketingImportJob(queue, 'job62', 'campaign62');
  assert.equal(calls[0][0], 'marketing.import');
  assert.deepEqual(calls[0][1], { id: 'job62', campaignCode: 'campaign62' });
  assert.equal(queued.id, calls[0][2].jobId);
  /** Worker adapter resolving only the explicitly registered opaque job/campaign capability. */
  const processor = createMarketingImportProcessor(async (id, code) => {
    assert.equal(id, 'job62');
    assert.equal(code, 'campaign62');
    return {
      /**
       * Resolve the trusted worker invocation without executing arbitrary task data.
       *
       * @param {string} owner - Trusted synthetic worker identity; not a client role claim.
       * @returns {Promise<object>} Synthetic worker receipt with no recipient content.
       */
      async runOnce(owner) {
        return { busy: false, owner };
      },
    };
  });
  assert.deepEqual(await processor({ data: calls[0][1] }, 'worker-1'), {
    busy: false,
    owner: 'worker-1',
  });
  await assert.rejects(
    processor(
      { data: { ...calls[0][1], email: 'private@example.org' } },
      'worker-1'
    ),
    /only safe/
  );
  assert.equal(JSON.stringify(calls).includes('private@example.org'), false);
});

test('import checkpoint never persists upstream exception PII', async () => {
  /** Owned in-memory connector for the private-cause/checkpoint redaction case. */
  const c = await createConnector({ filename: ':memory:', driver: 'node' });
  try {
    /** Borrowed structured port over the owned in-memory connector. */
    const db = dbFrom(c);
    /** Import controller whose source deliberately fails with synthetic private content. */
    const job = createMarketingImportJob({
      db,
      id: 'privacy-test',
      campaignCode: 'campaign62',
      sourceRevision: 'snapshot-20261013',
      source: {
        /**
         * Read one finite immutable source slice, with a deliberate one-time dependency outage.
         *
         * @returns {Promise<object>} Private recipients and explicit continuation; failure does not advance the checkpoint.
         */
        async page() {
          throw Error('Bad email private@example.org');
        },
      },
      append: async () => ({ added: 0, existing: 0, recipientCount: 0 }),
    });
    await assert.rejects(job.runOnce('worker-1'), /private@example.org/);
    /** Sanitized checkpoint; only a fixed failure class may be persisted. */
    const state = await job.get();
    assert.equal(state.lastError, 'IMPORT_PAGE_FAILED');
    assert.equal(JSON.stringify(state).includes('private@example.org'), false);
  } finally {
    await c.disconnect();
  }
});
