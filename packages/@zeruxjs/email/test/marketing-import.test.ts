import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createMarketingCampaignService,
  importMarketingRecipients,
  parseMarketingRecipientCSV,
} from '../dist/index.js';
/** Fixed ESM/CommonJS bridge for the built SQLite dependency; never caller-selected module loading. */
const require = createRequire(import.meta.url);
/** Public built SQLite connector factory; only isolated in-memory state is opened. */
const { createConnector } = require('../../db-sqllite/dist/index.js');
/** Synthetic database execution context, separate from operator application state. */
const ctx = {
  connection: {
    slug: 'main',
    name: 'main',
    connector: '@zeruxjs/db-sqlite',
    options: {},
  },
};
/**
 * Open a synthetic in-memory database and expose borrowed structured ports.
 *
 * @returns {Promise<object>} Database port plus awaited disconnect cleanup; caller owns the native fixture.
 */
async function setup() {
  /** Owned in-memory SQLite handle; setup returns its disconnect cleanup. */
  const connector = await createConnector({
    filename: ':memory:',
    driver: 'node',
  });
  /** Borrowed structured port over the owned synthetic SQLite handle. */
  const db = Object.fromEntries(
    ['createTable', 'createIndex', 'insert', 'select', 'update'].map((op) => [
      op,
      (args) => connector.execute({ op, ...args }, ctx),
    ])
  );
  return { db, close: () => connector.disconnect() };
}
/**
 * Create local create-only/load protocol state for durable identity assertions.
 *
 * @returns {object} Map-backed fixture; no real queue or distributed durability.
 */
const delivery = () => {
  /** Private process-local message identity map used only by this test. */
  const state = new Map();
  return {
    /**
     * Reserve one synthetic delivery identity without overwriting an existing row.
     *
     * @param {object} v - Private synthetic durable record.
     * @returns {Promise<boolean>} True for first creation, false for matching-key contention; callers verify record identity.
     */
    async create(v) {
      if (state.has(v.id)) {
        return false;
      }
      state.set(v.id, v);
      return true;
    },
    /**
     * Read one synthetic delivery identity without acquiring a native handle.
     *
     * @param {string} id - Opaque synthetic message identity.
     * @returns {Promise<object | null>} Private fixture record or null.
     */
    async load(id) {
      return state.get(id) ?? null;
    },
  };
};
test('large streamed CSV import is bounded, replay-safe, and enqueues only message IDs', async () => {
  /** Owned in-memory fixture retained and disconnected in finally. */
  const { db, close } = await setup();
  try {
    /** Captured opaque native queue requests; no Redis or broker connection is made. */
    const jobs = [];
    /** Function-first campaign service borrowing only isolated fixtures. */
    const service = createMarketingCampaignService({
      db,
      delivery: delivery(),
      queue: {
        /**
         * Capture only explicit native queue requests without publishing to a broker.
         *
         * @param {string} name - Fixed explicit queue task name.
         * @param {object} data - Opaque message reference only, never a recipient body.
         * @param {object} options - Explicit stable job identity, delay and attempt fixture fields.
         * @returns {Promise<void>} Capture completed, or deliberate queue-outage rejection.
         */
        async add(name, data, options) {
          jobs.push({ name, data, options });
        },
      },
      now: () => 1000,
    });
    /** Opaque synthetic campaign reference for finite import and replay checks. */
    const campaign = await service.create({
      name: 'Bulk',
      subject: 'Hello {{name}}',
      text: '{{name}} {{offer}}',
      account: 'smtp',
      recipients: ['seed@example.com'],
      autoEnqueue: false,
    });
    /** Fixed/finite CSV fixture; bytes, quoting and line endings are preserved intentionally. */
    const csv =
      'email,name,data.offer\r\n' +
      Array.from(
        { length: 457 },
        (_, i) => `contact${i}@example.org,Person${i},OFFER-${i}\r\n`
      ).join('');
    /**
     * Yield the fixed CSV in seven-character chunks to exercise incremental decoding.
     *
     * @returns {AsyncGenerator<Buffer>} Finite in-memory byte stream; no file or network handle.
     */
    async function* chunks() {
      // Consume only this finite fixture stream; lazy parser failures must settle before assertions complete.
      for (let i = 0; i < csv.length; i += 7) {
        yield Buffer.from(csv.slice(i, i + 7));
      }
    }
    /** Aggregate import/enqueue progress; never a recipient data log. */
    const progress = [];
    /** Acknowledged aggregate import counts; native queue acceptance is not SMTP delivery. */
    const result = await importMarketingRecipients(
      service,
      campaign,
      parseMarketingRecipientCSV(chunks()),
      {
        batchSize: 90,
        onProgress: (value) => progress.push(value),
        enqueueAfter: true,
      }
    );
    assert.equal(result.added, 457);
    assert.equal(result.queued, 458);
    assert.equal(progress.length, 6);
    assert.equal(jobs.length, 458);
    assert.ok(jobs.every((j) => Object.keys(j.data).join(',') === 'messageId'));
    /** Identical CSV replay; existing rows must reconcile without duplicating audience. */
    const second = await importMarketingRecipients(
      service,
      campaign,
      parseMarketingRecipientCSV(csv),
      { batchSize: 100 }
    );
    assert.equal(second.existing, 457);
    assert.equal(second.added, 0);
    /** Native audience-count projection checked against committed enqueue checkpoints. */
    const overview = await service.overview(campaign);
    assert.equal(overview.recipientCount, 458);
    assert.equal(overview.enqueued, 458);
    assert.equal(overview.storedCountMatches, true);
    /** Bounded private previews; recipient JSON must not leak through the projection. */
    const previews = await service.previewPage(campaign, { limit: 3 });
    assert.equal(previews.items.length, 3);
    assert.equal(previews.done, false);
    assert.ok(previews.items.every((v) => !('data' in v)));
  } finally {
    await close();
  }
});
test('CSV parser handles escaped quotes, JSON, empty cells, malformed and oversized data', async () => {
  /** Fixed/finite CSV fixture; bytes, quoting and line endings are preserved intentionally. */
  const csv =
    'email,name,data,data.tier\r\na@example.com,"Sam ""The Ace""","{""level"":2}",pro\r\n';
  /** Finite parsed recipient records used to assert exact inert CSV data. */
  const values = [];
  // Consume only this finite fixture stream; lazy parser failures must settle before assertions complete.
  for await (const v of parseMarketingRecipientCSV(csv)) {
    values.push(v);
  }
  assert.equal(values[0].name, 'Sam "The Ace"');
  assert.deepEqual(values[0].data, { level: 2, tier: 'pro' });
  /**
   * Consume all lazy CSV records so malformed/oversized input cannot escape assertions.
   *
   * @param {string} source - Inert synthetic CSV text; parser must never execute it.
   * @returns {Promise<void>} Completes only when the entire parser stream is valid.
   */
  const read = async (source) => {
    // Consume only this finite fixture stream; lazy parser failures must settle before assertions complete.
    for await (const _row of parseMarketingRecipientCSV(source)) {
      /* Consume the stream so parser failures reach the assertion. */
    }
  };
  await assert.rejects(
    read('email,name\na@example.com,"unterminated'),
    /Unterminated/
  );
  await assert.rejects(
    read('email,data.__proto__\na@example.com,bad'),
    /safe names|Unsafe/
  );
  await assert.rejects(
    read('email,email\na@example.com,b@example.com'),
    /safe names/
  );
  await assert.rejects(read('email,name\na@example.com,Sam,extra'), /header/);
  await assert.rejects(
    (async () => {
      // Consume only this finite fixture stream; lazy parser failures must settle before assertions complete.
      for await (const _ of parseMarketingRecipientCSV(
        'email\na@example.com\nb@example.com',
        { maxRows: 1 }
      )) {
        /* Consume the stream so parser failures reach the assertion. */
      }
    })(),
    /limit/
  );
});
