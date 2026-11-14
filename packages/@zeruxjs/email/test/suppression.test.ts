import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMarketingSuppressionService,
  createMemoryMarketingSuppressionStore,
} from '../dist/index.js';

test('hard bounce and complaint block marketing, duplicate provider notifications do not count twice', async () => {
  /** Fresh process-local suppression fixture; no restart or cross-process durability claim. */
  const store = createMemoryMarketingSuppressionStore();
  /** Shared-store suppression evaluator; construction owns no socket or cleanup handle. */
  const s = createMarketingSuppressionService({ store });
  /** Synthetic authenticated feedback facts used to test duplicate event identity. */
  const a = {
    email: 'BOUNCE@example.test',
    eventId: 'provider:001',
    kind: 'hard-bounce',
  };
  assert.deepEqual(await s.recordFeedback(a), {
    blocked: true,
    duplicate: false,
  });
  assert.deepEqual(await s.recordFeedback(a), {
    blocked: true,
    duplicate: true,
  });
  assert.equal(await s.isSuppressed('bounce@example.test'), true);
  assert.equal((await s.status('bounce@example.test')).softBounces, 0);
  assert.equal((await s.status('bounce@example.test')).eventIds.length, 1);
});
test('soft bounce threshold and CAS races count unique events', async () => {
  /** Shared-store suppression evaluator; construction owns no socket or cleanup handle. */
  const s = createMarketingSuppressionService({
    store: createMemoryMarketingSuppressionStore(),
  });
  /**
   * Create a unique synthetic soft-bounce event for a bounded CAS race.
   *
   * @param {number} n - Distinct synthetic event number for this CAS case.
   * @returns {object} Inert fixture notification; no provider is contacted.
   */
  const mk = (n) => ({
    email: 'soft@example.test',
    eventId: `smtp:${n}`,
    kind: 'soft-bounce',
  });
  /** Concurrent CAS outcomes for two distinct events; the ledger must count each exactly once. */
  const [first, second] = await Promise.all([
    s.recordFeedback(mk(1)),
    s.recordFeedback(mk(2)),
  ]);
  assert.equal(first.blocked && second.blocked, false);
  assert.equal((await s.status('soft@example.test')).softBounces, 2);
  assert.equal((await s.recordFeedback(mk(3))).blocked, true);
  assert.equal(await s.isSuppressed('SOFT@example.test'), true);
  assert.equal((await s.recordFeedback(mk(3))).duplicate, true);
});
test('invalid provider feedback is rejected and database outage never reports not suppressed', async () => {
  /** Shared-store suppression evaluator; construction owns no socket or cleanup handle. */
  const s = createMarketingSuppressionService({
    store: createMemoryMarketingSuppressionStore(),
  });
  await assert.rejects(
    s.recordFeedback({
      email: 'x@example.test',
      eventId: '',
      kind: 'complaint',
    }),
    /Invalid/
  );
  await assert.rejects(
    createMarketingSuppressionService({
      store: {
        load: async () => {
          throw Error('DB offline');
        },
        create: async () => true,
        save: async () => true,
      },
    }).isSuppressed('x@example.test'),
    /DB offline/
  );
});
