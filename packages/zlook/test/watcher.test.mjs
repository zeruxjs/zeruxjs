import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startWatcher, activeWatcherCount, diff } from '../dist/index.js';
/** Wait briefly for bounded polling integration assertions.
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>} Timer completion.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test('diff classifies changes', () => {
  /** Previous metadata fixture containing one updated and one removed file. */
  const before = new Map([
    ['a', { mtimeMs: 1, size: 1 }],
    ['b', { mtimeMs: 1, size: 1 }],
  ]);
  /** Candidate metadata fixture containing one updated and one new file. */
  const after = new Map([
    ['a', { mtimeMs: 2, size: 1 }],
    ['c', { mtimeMs: 1, size: 1 }],
  ]);
  assert.deepEqual(
    diff(before, after).map((x) => x.type),
    ['update', 'delete', 'new']
  );
});
test('watchers share resources and dispose', async () => {
  /** Owned temporary source directory used by the watcher fixture. */
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zlook-'));
  /** Events delivered to the first legacy subscriber. */
  const first = [];
  /** Events delivered to the second legacy subscriber. */
  const second = [];
  /** Identical polling/debounce settings used to prove shared resource ownership. */
  const opts = { pollIntervalMs: 100, debounceMs: 20 };
  /** First independent subscriber; its close operation must not stop the second subscriber. */
  const a = startWatcher(dir, (e) => first.push(e), opts);
  /** Second independent subscriber sharing compatible root/settings resources. */
  const b = startWatcher(dir, (e) => second.push(e), opts);
  try {
    assert.equal(activeWatcherCount(), 1);
    await sleep(200);
    await writeFile(path.join(dir, 'hello.txt'), 'hello');
    for (let i = 0; i < 25 && !first.some((e) => e.type === 'new'); i++) {
      await sleep(50);
    }
    assert.ok(first.some((e) => e.type === 'new'));
    assert.ok(second.some((e) => e.type === 'new'));
    a();
    assert.equal(activeWatcherCount(), 1);
    b();
    assert.equal(activeWatcherCount(), 0);
  } finally {
    a();
    b();
    await rm(dir, { recursive: true, force: true });
  }
});
