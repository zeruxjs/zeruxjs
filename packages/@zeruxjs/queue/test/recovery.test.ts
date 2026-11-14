import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createDatabaseEmailDeliveryStore,
  createEmailDeliveryRecoveryScanner,
  createDatabaseEmailDeliveryHistory,
  createJournaledEmailDeliveryStore,
} from '../dist/index.js';
/** Installed local dependency resolver; no arbitrary package discovery. */
const require = createRequire(import.meta.url);
/** Existing public SQLite connector used only with synthetic disposable databases. */
const { createConnector } = require('../../db-sqllite/dist/index.js');
/** Trusted synthetic connection context used by the database facade. */
const ctx = {
  connection: {
    slug: 'main',
    name: 'main',
    connector: '@zeruxjs/db-sqlite',
    options: {},
  },
};
/** Adapt explicit public connector operations into the fixture database contract.
 * @param {object} c - Borrowed disposable connector; outer fixture disconnects it.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const facade = (c) =>
  Object.fromEntries(
    ['createTable', 'createIndex', 'insert', 'select', 'update'].map((op) => [
      op,
      (arg) => c.execute({ op, ...arg }, ctx),
    ])
  );
test('expired claimed is retry-safe, sending becomes uncertain; history reports actual recovery only', async () => {
  /** Owned disposable SQLite connector; disconnect in finally. */
  const c = await createConnector({ filename: ':memory:', driver: 'node' });
  try {
    /** Fixed synthetic epoch clock; this case never advances it. */
    const t = 10000;
    /** Synthetic/injected database facade; its underlying connector remains separately owned. */
    const db = facade(c);
    /** Underlying synthetic current-state store, independent of journal decoration. */
    const raw = createDatabaseEmailDeliveryStore(db);
    /** Synthetic append-only transition ledger, distinct from current delivery state. */
    const history = createDatabaseEmailDeliveryHistory(db);
    /** Isolated synthetic CAS/delivery store, never operator data. */
    const store = createJournaledEmailDeliveryStore(raw, history, () => t);
    // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
    for (const [id, state, expiresAt] of [
      ['a', 'claimed', 9000],
      ['b', 'sending', 9000],
      ['c', 'sending', 11000],
      ['d', 'sent', 9000],
    ]) {
      await store.create({
        id,
        version: 1,
        purpose: 'marketing',
        recipient: 'private@example.test',
        campaignId: 'camp69',
        state,
        lease:
          state === 'sent'
            ? null
            : { owner: 'worker', token: 'opaque', expiresAt },
        updatedAt: 8000,
      });
    }
    /** Explicit synthetic recovery/report/processor callback selected by this test. */
    const run = createEmailDeliveryRecoveryScanner({
      store: { ...store, pageCampaign: raw.pageCampaign },
      now: () => t,
    });
    /** Nonmutating synthetic preview receipt; must not create/delete records. */
    const dry = await run('camp69', { limit: 2 });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.expiredClaims, 1);
    assert.equal(dry.uncertainSubmissions, 1);
    assert.equal((await raw.load('a')).state, 'claimed');
    /** Observed operation outcome compared with explicit fixture expectations. */
    const result = await run('camp69', { limit: 3, dryRun: false });
    assert.deepEqual(
      [result.recoveredClaims, result.markedUncertain, result.contended],
      [1, 1, 0]
    );
    assert.equal((await raw.load('a')).state, 'pending');
    assert.equal((await raw.load('b')).state, 'uncertain');
    assert.equal((await raw.load('c')).state, 'sending');
    assert.equal((await history.latest('camp69', 'a')).to, 'pending');
    assert.equal((await history.latest('camp69', 'b')).to, 'uncertain');
    /** Repeated synthetic scan result proving no invented transitions. */
    const repeat = await run('camp69', { limit: 4, dryRun: false });
    assert.equal(repeat.recoveredClaims, 0);
    assert.equal(repeat.markedUncertain, 0);
    assert.equal(
      JSON.stringify(result).includes('private@example.test'),
      false
    );
    await assert.rejects(run('other!', {}), /Invalid/);
  } finally {
    await c.disconnect();
  }
});
