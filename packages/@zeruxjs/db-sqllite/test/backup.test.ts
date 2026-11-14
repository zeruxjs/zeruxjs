import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Resolve the built CommonJS public API from this ESM fixture. */
const require = createRequire(import.meta.url);

/** Built public connector and online-backup APIs under test. */
const {
  createConnector,
  createSqliteConsistentBackup,
} = require('../dist/index.js');

/** Synthetic private connection identity, never an authorization credential. */
const ctx = {
  connection: { slug: 'main', name: 'main', connector: 'sqlite', options: {} },
};
test('consistent SQLite WAL backup passes integrity check and offline restore rehearsal', async () => {
  /** Exclusive disposable fixture directory; never an operator database path. */
  const dir = mkdtempSync(path.join(tmpdir(), 'zx-backup-'));

  /** Live synthetic database filename; never copied directly during active WAL work. */
  const source = path.join(dir, 'live.sqlite');

  /** No-overwrite native snapshot destination in the owned temporary directory. */
  const backup = path.join(dir, 'snapshot.sqlite');

  /** Read-only snapshot connector closed before directory removal. */
  const restored = path.join(dir, 'restored.sqlite');

  /** Owned live database connector used to verify WAL-consistent online copying. */
  const live = await createConnector({ filename: source, driver: 'node' });
  try {
    /** Privileged native handle borrowed from the connector or explicitly opened by this fixture. */
    const raw = live.getNativeConnection();
    raw.exec('PRAGMA journal_mode=WAL');
    await live.execute(
      {
        op: 'createTable',
        table: 'audit',
        columns: [
          { name: 'id', type: 'integer', primary: true },
          { name: 'message', type: 'text' },
        ],
      },
      ctx
    );
    await live.execute(
      { op: 'insert', table: 'audit', values: { id: 1, message: 'keep' } },
      ctx
    );
    assert.deepEqual(await createSqliteConsistentBackup(raw, backup), {
      destination: backup,
      integrity: 'ok',
    });
    await assert.rejects(
      createSqliteConsistentBackup(raw, backup),
      /already exists/
    );
    await live.execute(
      {
        op: 'insert',
        table: 'audit',
        values: { id: 2, message: 'after backup' },
      },
      ctx
    );
    copyFileSync(backup, restored); // offline restore into an unallocated destination, NEVER over a live SQLite DB

    /** Read-only restored snapshot handle; closed independently of the live writer. */
    const recovered = await createConnector({
      filename: restored,
      driver: 'node',
      readonly: true,
    });
    try {
      /** Observed private rows used only for fixture assertions. */
      const rows = (
        await recovered.execute({ op: 'select', table: 'audit' }, ctx)
      ).rows;
      assert.deepEqual(
        rows.map((r: { message: string }) => r.message),
        ['keep']
      );
    } finally {
      await recovered.disconnect();
    }
    assert.equal(existsSync(backup), true);
  } finally {
    await live.disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});
