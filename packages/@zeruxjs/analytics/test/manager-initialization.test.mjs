import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalytics } from '../dist/index.js';

test('concurrent initialization shares migration work and releases failed work for an explicit retry', async () => {
  let calls = 0;
  let closes = 0;
  /** Host-controlled settlement gate avoids timing-based assertions. */
  const gate = Promise.withResolvers();
  /** Borrowed connection fails its first migration after both callers are waiting. */
  const connection = {
    async createTable() {
      calls++;
      if (calls === 1) {
        await gate.promise;
        throw new Error('synthetic migration outage');
      }
      return { ok: true };
    },
    async close() {
      closes++;
    },
  };
  /** Manager has no ownership of connection shutdown. */
  const analytics = createAnalytics({
    analytics: 'events',
    indexes: false,
    onWarning: () => {},
    database: {
      connectionSlugs: ['events'],
      getConnectionFacade: () => connection,
    },
  });
  /** Both callers are admitted before the borrowed migration settles. */
  const first = analytics.initialize();
  /** Second caller must await the same work instead of migrating concurrently. */
  const second = analytics.initialize();
  assert.equal(calls, 1);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(analytics.status().initialized, false);
  assert.equal(await analytics.initialize(), true);
  assert.equal(await analytics.initialize(), true);
  assert.equal(calls, 2);
  assert.equal(closes, 0);
});

test('invalid configuration cannot be enabled later or touch the host database', async () => {
  let lookups = 0;
  /** Invalid table configuration fences collection before database access. */
  const analytics = createAnalytics({
    analytics: 'events',
    table: 'events;DROP',
    onWarning: () => {},
    database: {
      connectionSlugs: ['events'],
      getConnectionFacade() {
        lookups++;
        throw new Error('must not resolve');
      },
    },
  });
  analytics.setEnabled(true);
  assert.equal(analytics.enabled, false);
  assert.equal(await analytics.initialize(), false);
  assert.equal(await analytics.track({ name: 'page.view' }), undefined);
  assert.equal(lookups, 0);
});
