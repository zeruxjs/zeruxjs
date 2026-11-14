import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createProcessMarker } from '../dist/portless/lifecycle.js';
import {
  encodeCommittedState,
  readCommittedProxyState,
  PendingStartupTransactionError,
} from '../dist/portless/committed-state.js';
import {
  recoverInterruptedStartup,
  publishStartupState,
  assertStartupOwnership,
} from '../dist/portless/startup-state.js';
import {
  snapshot,
  writeStartupJournal,
  atomicStateWrite,
  journalPath,
} from '../dist/portless/startup-journal.js';
import {
  readPortFromDir,
  readTlsMarker,
  readTldFromDir,
  discoverState,
} from '../dist/portless/cli-utils.js';

/** Own private synthetic proxy metadata around a synchronous assertion callback.
 * @param {(dir: string) => unknown} fn - Assertions restricted to the supplied temporary directory.
 * @returns {unknown} Callback result after removing all fixture state in finally.
 */
function inDir(fn) {
  /** Owned private synthetic proxy-state root, removed by the fixture finally block. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-commit-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
/** Join only fixed fixture leaf names within the owned private state root.
 * @param {string} dir - Owned fixture directory.
 * @param {string} name - Fixed metadata filename.
 * @returns {string} Fixture-local path.
 */
const file = (dir, name) => path.join(dir, name);

test('published record is atomic authority even when legacy files disagree', () =>
  inDir((dir) => {
    /** Synthetic startup publication receipt; rollback must preserve files changed by another writer. */
    const publisher = publishStartupState({
      stateDir: dir,
      port: 4333,
      https: true,
      tld: 'test',
    });
    /** Complete synthetic prior state view retained for transaction/legacy consistency assertions. */
    const before = readCommittedProxyState(dir);
    assert.equal(before?.legacy, false);
    assert.deepEqual(
      [before.port, before.tls, before.tld],
      [4333, true, 'test']
    );
    fs.writeFileSync(file(dir, 'proxy.port'), '9999\n');
    fs.rmSync(file(dir, 'proxy.tls'));
    fs.writeFileSync(file(dir, 'proxy.tld'), 'other\n');
    assert.deepEqual(
      [readPortFromDir(dir), readTlsMarker(dir), readTldFromDir(dir)],
      [4333, true, 'test']
    );
    assert.equal(readCommittedProxyState(dir).marker.pid, process.pid);
    assert.throws(() => assertStartupOwnership(dir), /live process/);
    // Reverting must not erase compatibility files modified by another writer.
    publisher.rollback();
  }));

test('pending journal fails closed for readers; recovery restores last state', () =>
  inDir((dir) => {
    fs.writeFileSync(file(dir, 'proxy.port'), '4000\n');
    /** Complete synthetic prior state view retained for transaction/legacy consistency assertions. */
    const before = snapshot(dir);
    /** Synthetic candidate journal state, never applied to operator proxy metadata. */
    const after = { ...before, 'proxy.port': Buffer.from('5555\n') };
    writeStartupJournal(dir, before, after);
    atomicStateWrite(file(dir, 'proxy.port'), Buffer.from('5555\n'));
    assert.throws(
      () => readCommittedProxyState(dir),
      PendingStartupTransactionError
    );
    assert.equal(recoverInterruptedStartup(dir), true);
    assert.equal(readCommittedProxyState(dir)?.port, 4000);
    assert.equal(fs.existsSync(journalPath(dir)), false);
  }));

test('legacy state works, invalid values and corrupt commits fail closed', () =>
  inDir((dir) => {
    assert.equal(readCommittedProxyState(dir), null);
    fs.writeFileSync(file(dir, 'proxy.port'), '4444\n');
    fs.writeFileSync(file(dir, 'proxy.tld'), 'local\n');
    assert.deepEqual(
      [
        readCommittedProxyState(dir)?.port,
        readCommittedProxyState(dir)?.legacy,
      ],
      [4444, true]
    );
    fs.writeFileSync(file(dir, 'proxy.port'), '4444junk\n');
    assert.throws(
      () => readCommittedProxyState(dir),
      /Invalid legacy proxy port/
    );
    fs.writeFileSync(file(dir, 'proxy.state.json'), '{bad');
    assert.throws(
      () => readCommittedProxyState(dir),
      /Invalid committed proxy state/
    );
  }));

test('migration can recover a version-1 journal without canonical record field', () =>
  inDir((dir) => {
    fs.writeFileSync(file(dir, 'proxy.port'), '4000\n');
    /** Exact legacy metadata vocabulary used to test V1 journal migration. */
    const names = ['proxy.port', 'proxy.tls', 'proxy.tld', 'proxy.pid'];
    /** Complete synthetic prior state view retained for transaction/legacy consistency assertions. */
    const before = Object.fromEntries(
      names.map((name) => [
        name,
        fs.existsSync(file(dir, name))
          ? fs.readFileSync(file(dir, name)).toString('base64')
          : null,
      ])
    );
    /** Synthetic candidate journal state, never applied to operator proxy metadata. */
    const after = {
      ...before,
      'proxy.port': Buffer.from('5555\n').toString('base64'),
    };
    fs.writeFileSync(
      journalPath(dir),
      JSON.stringify({ version: 1, before, after })
    );
    fs.writeFileSync(file(dir, 'proxy.port'), '5555\n');
    assert.equal(recoverInterruptedStartup(dir), true);
    assert.equal(readCommittedProxyState(dir)?.port, 4000);
  }));

test('recovery protects a live committed owner even without its legacy PID file', () =>
  inDir((dir) => {
    /** Verified current-test-process identity used only as synthetic ownership evidence. */
    const marker = createProcessMarker();
    /** Prior committed bytes or restored environment setting retained for exact cleanup. */
    const previous = encodeCommittedState({
      port: 4321,
      tls: false,
      tld: 'localhost',
      marker,
    });
    fs.writeFileSync(file(dir, 'proxy.state.json'), previous);
    /** Complete synthetic prior state view retained for transaction/legacy consistency assertions. */
    const before = snapshot(dir);
    /** Synthetic candidate journal state, never applied to operator proxy metadata. */
    const after = { ...before, 'proxy.state.json': null };
    writeStartupJournal(dir, before, after);
    fs.rmSync(file(dir, 'proxy.state.json'));
    // Old committed state is in the journal; a live owner must still be protected.
    // A crash before state removal is the path we can verify without false positives.
    fs.writeFileSync(file(dir, 'proxy.state.json'), previous);
    assert.throws(
      () => recoverInterruptedStartup(dir),
      /committed process is live/
    );
    assert.equal(fs.existsSync(journalPath(dir)), true);
  }));

test('discovery reads the snapshot once and refuses half-published state', async () => {
  /** Prior committed bytes or restored environment setting retained for exact cleanup. */
  const previous = process.env.PORTLESS_STATE_DIR;
  /** Owned private synthetic proxy-state root, removed by the fixture finally block. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhost-discovery-'));
  try {
    process.env.PORTLESS_STATE_DIR = dir;
    /** Synthetic publication receipt rolled back only after removing the fixture’s pending journal. */
    const publication = publishStartupState({
      stateDir: dir,
      port: 5666,
      https: true,
      tld: 'test',
    });
    assert.deepEqual(await discoverState(), {
      dir,
      port: 5666,
      tls: true,
      tld: 'test',
    });
    /** Complete synthetic prior state view retained for transaction/legacy consistency assertions. */
    const before = snapshot(dir);
    /** Synthetic candidate journal state, never applied to operator proxy metadata. */
    const after = { ...before, 'proxy.port': Buffer.from('7777\n') };
    writeStartupJournal(dir, before, after);
    await assert.rejects(discoverState(), PendingStartupTransactionError);
    // The journal stays present until an explicit locked recovery.
    assert.equal(fs.existsSync(journalPath(dir)), true);
    fs.rmSync(journalPath(dir));
    publication.rollback();
  } finally {
    if (previous === undefined) {
      delete process.env.PORTLESS_STATE_DIR;
    } else {
      process.env.PORTLESS_STATE_DIR = previous;
    }
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

test('lifecycle discovery repairs pending legacy journal only under operation lock', async () => {
  /** Lifecycle discovery helper exercised only with an explicit temporary PORTLESS_STATE_DIR. */
  const { discoverStateWithRecovery } =
    await import('../dist/portless/cli-utils.js');
  /** Prior committed bytes or restored environment setting retained for exact cleanup. */
  const previous = process.env.PORTLESS_STATE_DIR;
  /** Owned private synthetic proxy-state root, removed by the fixture finally block. */
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'zhost-recover-discovery-')
  );
  try {
    process.env.PORTLESS_STATE_DIR = dir;
    fs.writeFileSync(file(dir, 'proxy.port'), '4689\n');
    /** Complete synthetic prior state view retained for transaction/legacy consistency assertions. */
    const before = snapshot(dir);
    /** Synthetic candidate journal state, never applied to operator proxy metadata. */
    const after = { ...before, 'proxy.port': Buffer.from('6000\n') };
    writeStartupJournal(dir, before, after);
    atomicStateWrite(file(dir, 'proxy.port'), after['proxy.port']);
    /** Observed recovered fixture state after the locked recovery path. */
    const state = await discoverStateWithRecovery();
    assert.deepEqual(state, { dir, port: 4689, tls: false, tld: 'localhost' });
    assert.equal(fs.existsSync(journalPath(dir)), false);
    assert.equal(fs.existsSync(file(dir, '.proxy-operation.lock')), false);
  } finally {
    if (previous === undefined) {
      delete process.env.PORTLESS_STATE_DIR;
    } else {
      process.env.PORTLESS_STATE_DIR = previous;
    }
    fs.rmSync(dir, { force: true, recursive: true });
  }
});
