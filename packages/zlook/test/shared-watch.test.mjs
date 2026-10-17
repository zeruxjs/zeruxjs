import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { watchDirectory, activeWatcherCount } from '../dist/index.js';

test('initial files are not emitted as new; manual flush observes later changes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'z-watch-base-'));
  await writeFile(path.join(dir, 'before.txt'), 'existing');
  const events = [];
  const handle = watchDirectory(dir, e => events.push(e), { pollIntervalMs: 60000 });
  try {
    await handle.ready;
    assert.deepEqual(await handle.flush(), []);
    assert.deepEqual(events, []);
    await writeFile(path.join(dir, 'after.txt'), 'new');
    const changes = await handle.flush();
    assert.ok(changes.some(e => e.file === 'after.txt' && e.type === 'new'));
    assert.equal(events.filter(e => e.file === 'after.txt').length, 1);
  } finally { handle.close(); await rm(dir, { recursive: true, force: true }); }
});

test('independent subscribers ignore their own paths and parent folders', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'z-watch-ignore-'));
  await mkdir(path.join(dir, 'private'));
  await mkdir(path.join(dir, 'public'));
  const visible = []; const everything = [];
  const a = watchDirectory(dir, e => visible.push(e), { ignored: p => p === 'private', pollIntervalMs: 60000 });
  const b = watchDirectory(dir, e => everything.push(e), { pollIntervalMs: 60000 });
  try {
    assert.equal(activeWatcherCount() >= 1, true);
    await Promise.all([a.ready, b.ready]);
    await writeFile(path.join(dir, 'private', 'secret.txt'), 's');
    await writeFile(path.join(dir, 'public', 'visible.txt'), 'v');
    await a.flush();
    assert.deepEqual(visible.map(e => e.file), ['public/visible.txt']);
    assert.deepEqual(everything.map(e => e.file), ['private/secret.txt', 'public/visible.txt']);
    a.close(); a.close();
    await writeFile(path.join(dir, 'public', 'second.txt'), 'two');
    await b.flush();
    assert.ok(everything.some(e => e.file === 'public/second.txt'));
    assert.equal(visible.length, 1);
  } finally { a.close(); b.close(); await rm(dir, { recursive: true, force: true }); }
});

test('symlink traversal is excluded; errors in callbacks are isolated', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'z-watch-link-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'z-watch-outside-'));
  await writeFile(path.join(outside, 'outside.txt'), 'private');
  const received = []; const errors = [];
  const a = watchDirectory(dir, () => { throw Error('listener failed'); }, { onError: e => errors.push(e.message), pollIntervalMs: 60000 });
  const b = watchDirectory(dir, e => received.push(e), { pollIntervalMs: 60000 });
  try {
    await Promise.all([a.ready, b.ready]);
    await symlink(outside, path.join(dir, 'link'), 'dir');
    await writeFile(path.join(dir, 'real.txt'), 'real');
    await b.flush();
    assert.deepEqual(received.map(e => e.file), ['real.txt']);
    assert.ok(errors.includes('listener failed'));
  } finally { a.close(); b.close(); await rm(dir, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
