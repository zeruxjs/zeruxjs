import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMarketingCampaignDashboard,
  createMarketingCampaignService,
} from '../dist/index.js';
import { createRequire } from 'node:module';
/** ESM-to-CommonJS loader for the existing SQLite fixture; it never loads a user-selected package. */
const require = createRequire(import.meta.url);
/** Public SQLite factory loaded from the built workspace dependency. */
const { createConnector } = require('../../db-sqllite/dist/index.js');
/** Synthetic database operation context, unrelated to operator workspace state. */
const ctx = {
  connection: {
    slug: 'main',
    name: 'main',
    connector: '@zeruxjs/db-sqlite',
    options: {},
  },
};
/**
 * Open only an in-memory SQLite fixture and expose borrowed operation ports plus cleanup.
 *
 * @returns {Promise<object>} Database port and awaited disconnect cleanup; the caller owns the native handle.
 */
async function setup() {
  /** Owned in-memory native SQLite handle; setup returns its disconnect cleanup. */
  const connector = await createConnector({
    filename: ':memory:',
    driver: 'node',
  });
  /** Borrowed structured port over the isolated SQLite handle. */
  const db = Object.fromEntries(
    ['createTable', 'createIndex', 'insert', 'select', 'update'].map((op) => [
      op,
      (args) => connector.execute({ op, ...args }, ctx),
    ])
  );
  return { db, close: () => connector.disconnect() };
}
/**
 * Create a local message-store protocol fixture with create-only identity reservation.
 *
 * @returns {object} Map-backed test port; it does not claim cross-worker durability.
 */
const delivery = () => {
  /** Private process-local delivery fixture records, discarded with this test. */
  const rows = new Map();
  return {
    async create(r) {
      if (rows.has(r.id)) {
        return false;
      }
      rows.set(r.id, r);
      return true;
    },
    async load(id) {
      return rows.get(id) ?? null;
    },
  };
};
/** Synthetic trusted request origin; no network listener is started. */
const origin = 'https://marketing.example.com';
/**
 * Construct a synthetic Fetch request without any network operation.
 *
 * @param {string} method - HTTP method; reads default to GET where supported.
 * @param {string} path - Fixed fixture route/query suffix; never a remote endpoint.
 * @param {object | undefined} data - Synthetic JSON action fields; absence creates a bodyless request.
 * @param {Record<string, string>} headers - Explicit synthetic origin/CSRF overrides for denial cases.
 * @returns {Request} Local request for direct handler invocation.
 */
const request = (method, path, data, headers = {}) =>
  new Request(origin + path, {
    method,
    headers: {
      ...headers,
      ...(data ? { 'content-type': 'application/json' } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
test('marketing dashboard requires auth, CSRF, origins, scoping and restricts exposed data', async () => {
  /** Owned in-memory fixture cleanup retained and awaited in finally. */
  const { db, close } = await setup();
  try {
    /** Function-first service borrowing only the isolated database/queue/delivery fixtures. */
    const service = createMarketingCampaignService({
      db,
      delivery: delivery(),
      queue: { async add() {} },
      now: () => 1000,
    });
    /** Opaque campaign identity produced from synthetic recipient data. */
    const code = await service.create({
      name: 'Campaign',
      subject: 'Hello {{name}}',
      content: '<p>{{password}}</p>',
      account: 'private_smtp',
      recipients: [
        {
          name: 'Sample',
          email: 'sample@example.com',
          data: { password: 'top-secret' },
        },
      ],
      autoEnqueue: false,
    });
    let active = true,
      scoped = true,
      csrf = true,
      allowList = false;
    /** Local authenticated handler fixture; no public server or browser is started. */
    const dashboard = createMarketingCampaignDashboard({
      service,
      authorize: () => (active ? { role: 'admin' } : null),
      authorizeCampaign: (_p, id) => scoped && id === code,
      authorizeCreate: () => true,
      authorizeList: () => allowList,
      verifyCsrf: () => csrf,
      csrfToken: () => 't'.repeat(32),
    });
    assert.equal(
      (
        await dashboard.handle(
          request('GET', '/_email/marketing/api?code=' + code)
        )
      ).status,
      200
    );
    assert.equal(
      (
        await dashboard.handle(
          request(
            'GET',
            '/_email/marketing/api?code=' + code + '&view=recipients'
          )
        )
      ).status,
      200
    );
    /** Local handler response whose private projection is asserted below. */
    const r = await dashboard.handle(
      request('GET', '/_email/marketing/api?code=' + code + '&view=recipients')
    );
    /** Serialized private response inspected for accidental secret/recipient leakage. */
    const raw = await r.text();
    assert.match(raw, /sample@example.com/);
    assert.doesNotMatch(raw, /top-secret|password/);
    /** Authorized private rendered preview; HTML remains data rather than executable dashboard markup. */
    const preview = await (
      await dashboard.handle(
        request('GET', '/_email/marketing/api?code=' + code + '&view=previews')
      )
    ).json();
    assert.match(preview.items[0].html, /top-secret/);
    assert.ok(!('messageId' in preview.items[0]));
    /** Projected overview checked for absence of mailbox, template secret and account reference. */
    const summary = await (
      await dashboard.handle(
        request('GET', '/_email/marketing/api?code=' + code + '&view=overview')
      )
    ).text();
    assert.doesNotMatch(summary, /sample@example.com|top-secret|private_smtp/);
    assert.equal(
      (
        await dashboard.handle(
          request('GET', '/_email/marketing/api?view=list')
        )
      ).status,
      403
    );
    allowList = true;
    assert.equal(
      (
        await dashboard.handle(
          request('GET', '/_email/marketing/api?view=list')
        )
      ).status,
      200
    );
    active = false;
    assert.equal(
      (await dashboard.handle(request('GET', '/_email/marketing'))).status,
      403
    );
    active = true;
    scoped = false;
    assert.equal(
      (
        await dashboard.handle(
          request('GET', '/_email/marketing/api?code=' + code)
        )
      ).status,
      403
    );
    scoped = true;
    csrf = false;
    /** Synthetic write request whose CSRF callback deliberately denies dispatch. */
    const post = request(
      'POST',
      '/_email/marketing/api',
      { code, action: 'pause' },
      { origin }
    );
    assert.equal((await dashboard.handle(post)).status, 403);
    csrf = true;
    assert.equal(
      (
        await dashboard.handle(
          request(
            'POST',
            '/_email/marketing/api',
            { code, action: 'pause' },
            { origin: 'https://attacker.invalid' }
          )
        )
      ).status,
      403
    );
    assert.equal(
      (
        await dashboard.handle(
          request(
            'POST',
            '/_email/marketing/api',
            { code, action: 'pause' },
            { origin }
          )
        )
      ).status,
      200
    );
    assert.equal(
      (
        await dashboard.handle(
          request(
            'POST',
            '/_email/marketing/api',
            { code, action: 'resume' },
            { origin }
          )
        )
      ).status,
      200
    );
    assert.equal(
      (
        await dashboard.handle(
          request(
            'POST',
            '/_email/marketing/api',
            { code, action: 'cancel' },
            { origin }
          )
        )
      ).status,
      200
    );
  } finally {
    await close();
  }
});
