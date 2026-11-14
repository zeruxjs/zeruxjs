import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createConnector } from '@zeruxjs/db-sqlite';
import { createWebhookWorkflow } from '@zeruxjs/queue/webhooks';
test('existing SQLite synchronous pin rolls back business/outbox together on a disposable file', async (t) => {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    t.skip('node:sqlite unavailable');
    return;
  }
  /** Owned isolated fixture/repository root used only for explicit local test inputs. */
  const root = await mkdtemp(join(tmpdir(), 'zx-webhook-sqlite-'));
  /** Owned synthetic database facade or disposable native handle. */
  const database = new DatabaseSync(join(root, 'fixture.sqlite'));
  let connector, workflow;
  try {
    database.exec(
      'CREATE TABLE business(id INTEGER PRIMARY KEY); CREATE TABLE outbox(tenant TEXT, id TEXT, document TEXT, UNIQUE(tenant,id))'
    );
    connector = await createConnector({
      databaseInstance: database,
      journalMode: 'wal',
    });
    /** Owned synthetic durable workflow; close before borrowed stores/transport. */
    workflow = createWebhookWorkflow({
      store: {
        contract: 'webhook-cas-v1',
        get: async () => null,
        cas: async () => false,
        due: async () => ({ ids: [], next: null }),
      },
      transport: {
        contract: 'webhook-https-v1',
        /** Simulate the fixed transport policy check; never fetch an arbitrary URL.
         * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
         */
        validate() {},
        /** Simulate a declared SMTP/HTTPS result without a real external delivery.
         * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
         */
        async send() {
          throw Error('not used');
        },
      },
      authorize: () => true,
      destination: (tenant, ref) => ({
        tenant,
        ref,
        url: 'https://hooks.example/events',
        enabled: true,
        consumerIdempotency: true,
        keys: { current: { id: 'key', key: new Uint8Array(32).fill(1) } },
      }),
      policy: {
        maxAttempts: 3,
        maxAgeMs: 86400000,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        retryAfterMaxMs: 1000,
        transientStatuses: [429, 503],
        retryNotSent: false,
      },
    });
    /** Synthetic durable record or record factory; authoritative state remains in the fixture store. */
    const record = await workflow.prepare(
      {
        tenant: 'tenant1',
        deliveryId: 'delivery1',
        eventId: 'event1',
        destination: 'partner',
        schemaVersion: 1,
        payload: { id: 'business1' },
      },
      {}
    );
    assert.throws(
      () =>
        connector.transactionSync((pin) => {
          pin.insert({ table: 'business', values: { id: 1 } });
          pin.insert({
            table: 'outbox',
            values: {
              tenant: record.tenant,
              id: record.deliveryId,
              document: JSON.stringify(record),
            },
          });
          throw Error('rollback');
        }),
      /rollback/
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS n FROM business').get().n,
      0
    );
    assert.equal(
      database.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,
      0
    );
    connector.transactionSync((pin) => {
      pin.insert({ table: 'business', values: { id: 1 } });
      pin.insert({
        table: 'outbox',
        values: {
          tenant: record.tenant,
          id: record.deliveryId,
          document: JSON.stringify(record),
        },
      });
    });
    assert.equal(
      database.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,
      1
    );
    await workflow.close();
  } finally {
    try {
      await workflow?.close();
    } finally {
      try {
        await connector?.disconnect();
      } finally {
        try {
          database.close();
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    }
  }
});
