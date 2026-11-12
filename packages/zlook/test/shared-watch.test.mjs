import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { watchDirectory, activeWatcherCount } from '../dist/index.js';

test('initial files are not emitted as new; manual flush observes later changes', async () => {
  /** Owned temporary source directory used by the watcher fixture. */
  const dir = await mkdtemp(path.join(os.tmpdir(), 'z-watch-base-'));
  await writeFile(path.join(dir, 'before.txt'), 'existing');
  /** Events retained by the filtered subscriber for deterministic assertions. */
  const events = [];
  /** Owned watcher subscription; close and await settlement before removing its tree. */
  const handle = watchDirectory(dir, (e) => events.push(e), {
    pollIntervalMs: 60000,
  });
  try {
    await handle.ready;
    assert.deepEqual(await handle.flush(), []);
    assert.deepEqual(events, []);
    await writeFile(path.join(dir, 'after.txt'), 'new');
    /** Explicit reconciliation result after writing a new file. */
    const changes = await handle.flush();
    assert.ok(changes.some((e) => e.file === 'after.txt' && e.type === 'new'));
    assert.equal(events.filter((e) => e.file === 'after.txt').length, 1);
  } finally {
    handle.close();
    await handle.closed;
    await rm(dir, { recursive: true, force: true });
  }
});

test('independent subscribers ignore their own paths and parent folders', async () => {
  /** Owned temporary source directory used by the watcher fixture. */
  const dir = await mkdtemp(path.join(os.tmpdir(), 'z-watch-ignore-'));
  await mkdir(path.join(dir, 'private'));
  await mkdir(path.join(dir, 'public'));
  /** Visible event result after subscriber-specific filtering. */
  const visible = [];
  /** All retained events from the subscriber without a custom ignore policy. */
  const everything = [];
  /** First independent subscriber; its close operation must not stop the second subscriber. */
  const a = watchDirectory(dir, (e) => visible.push(e), {
    ignored: (p) => p === 'private',
    pollIntervalMs: 60000,
  });
  /** Second independent subscriber sharing compatible root/settings resources. */
  const b = watchDirectory(dir, (e) => everything.push(e), {
    pollIntervalMs: 60000,
  });
  try {
    assert.equal(activeWatcherCount() >= 1, true);
    await Promise.all([a.ready, b.ready]);
    await writeFile(path.join(dir, 'private', 'secret.txt'), 's');
    await writeFile(path.join(dir, 'public', 'visible.txt'), 'v');
    await a.flush();
    assert.deepEqual(
      visible.map((e) => e.file),
      ['public/visible.txt']
    );
    assert.deepEqual(
      everything.map((e) => e.file),
      ['private/secret.txt', 'public/visible.txt']
    );
    a.close();
    a.close();
    await writeFile(path.join(dir, 'public', 'second.txt'), 'two');
    await b.flush();
    assert.ok(everything.some((e) => e.file === 'public/second.txt'));
    assert.equal(visible.length, 1);
  } finally {
    a.close();
    b.close();
    await Promise.all([a.closed, b.closed]);
    await rm(dir, { recursive: true, force: true });
  }
});

test('symlink traversal is excluded; errors in callbacks are isolated', async () => {
  /** Owned temporary source directory used by the watcher fixture. */
  const dir = await mkdtemp(path.join(os.tmpdir(), 'z-watch-link-'));
  /** Separate owned directory whose symlinked contents must remain unvisited. */
  const outside = await mkdtemp(path.join(os.tmpdir(), 'z-watch-outside-'));
  await writeFile(path.join(outside, 'outside.txt'), 'private');
  /** Successful subscriber events despite another callback throwing. */
  const received = [];
  /** Private fixture failures collected for error-isolation and redaction assertions. */
  const errors = [];
  /** First independent subscriber; its close operation must not stop the second subscriber. */
  const a = watchDirectory(
    dir,
    () => {
      throw Error('listener failed');
    },
    { onError: (e) => errors.push(e.message), pollIntervalMs: 60000 }
  );
  /** Second independent subscriber sharing compatible root/settings resources. */
  const b = watchDirectory(dir, (e) => received.push(e), {
    pollIntervalMs: 60000,
  });
  try {
    await Promise.all([a.ready, b.ready]);
    await symlink(outside, path.join(dir, 'link'), 'dir');
    await writeFile(path.join(dir, 'real.txt'), 'real');
    await b.flush();
    assert.deepEqual(
      received.map((e) => e.file),
      ['real.txt']
    );
    assert.ok(errors.includes('listener failed'));
  } finally {
    a.close();
    b.close();
    await Promise.all([a.closed, b.closed]);
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
