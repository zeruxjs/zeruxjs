import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConnector } from '@zeruxjs/db-sqlite';
import { createShortLinkService } from '@zeruxjs/share/server';
import { createSqliteShortLinkStore } from '@zeruxjs/share/sqlite';
test('host-owned disposable SQLite store uses real synchronous pins for cross-instance reservation/CAS and survives service close', async () => {
  /** Owned temporary directory holding only this test’s disposable SQLite state. */
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zx064-'));
  let one, two, a, b;
  try {
    /** Explicit Node SQLite configuration on the synthetic persistent file. */
    const options = {
      driver: 'node',
      filename: path.join(dir, 'links.sqlite'),
    };
    one = await createConnector(options);
    two = await createConnector(options);
    /** Borrowed first native connector adapter; service close must not disconnect it. */
    const firstStore = createSqliteShortLinkStore({
      database: one,
      persistent: true,
      initialize: true,
    });
    /** Borrowed second connector adapter to the same synthetic file. */
    const secondStore = createSqliteShortLinkStore({
      database: two,
      persistent: true,
    });
    /** Explicit synthetic origin, destination allowlist, store and host verifier configuration. */
    const config = {
      origin: 'https://sho.rt',
      allowedOrigins: ['https://example.test'],
      authorize: async () => ({ tenant: 'tenant', subject: 'owner' }),
    };
    a = createShortLinkService({ ...config, store: firstStore });
    b = createShortLinkService({ ...config, store: secondStore });
    /** Settled create-only outcomes from two service instances sharing native persistence. */
    const race = await Promise.allSettled([
      a.create({}, { slug: 'atomic', destination: 'https://example.test/a' }),
      b.create({}, { slug: 'atomic', destination: 'https://example.test/b' }),
    ]);
    assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
    /** Current authorized reservation used by the assertion, not a browser identity claim. */
    const value = await a.get({}, 'atomic');
    /** Committed optimistic revision; stale expected revisions must reject. */
    const updated = await b.edit({}, 'atomic', {
      expectedRevision: value.revision,
      destination: 'https://example.test/new',
    });
    await assert.rejects(
      a.edit({}, 'atomic', {
        expectedRevision: value.revision,
        destination: 'https://example.test/stale',
      }),
      { code: 'CONFLICT' }
    );
    assert.equal(
      (await a.handler(new Request('https://sho.rt/s/atomic'))).headers.get(
        'location'
      ),
      'https://example.test/new'
    );
    await a.close();
    assert.equal(
      one.transactionSync((tx) => tx.select({ table: 'share_short_links' }))
        .rowCount,
      1
    );
    await b.revoke({}, 'atomic', updated.revision);
    assert.equal(
      (await b.handler(new Request('https://sho.rt/s/atomic'))).status,
      404
    );
  } finally {
    // Attempt every teardown in dependency order, even if an earlier release fails.
    try {
      await a?.close();
    } finally {
      try {
        await b?.close();
      } finally {
        try {
          await one?.disconnect();
        } finally {
          try {
            await two?.disconnect();
          } finally {
            await rm(dir, { recursive: true, force: true });
          }
        }
      }
    }
  }
});
