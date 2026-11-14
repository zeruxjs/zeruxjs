import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevelopmentWatchIgnore } from '../dist/index.js';
import { watchDirectory, activeWatcherCount } from 'zlook';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('development exclusions are validated snapshots and do not match sibling prefixes', () => {
  /** Mutable host input used to prove that the predicate captures a detached exclusion snapshot. */
  const paths = ['.workspace', '.zerux'];
  /** Subscriber-local predicate under test; creating it acquires no watcher. */
  const ignored = createDevelopmentWatchIgnore(paths);
  paths.push('app');
  assert.equal(ignored('.workspace/objects/private'), true);
  assert.equal(ignored('.workspace'), true);
  assert.equal(ignored('.workspace-other/file'), false);
  assert.equal(ignored('app/page.ts'), false);
  for (const value of [
    ['../secret'],
    ['/absolute'],
    ['folder//child'],
    ['C:\\private'],
    ['.'],
    ['a/../b'],
    'all',
    [123],
  ]) {
    assert.throws(() => createDevelopmentWatchIgnore(value));
  }
  assert.equal(createDevelopmentWatchIgnore()('anything'), false);
});
test('private data does not enter source events; source changes and watcher disposal still work', async () => {
  /** Owned temporary source tree containing synthetic private data and a public source file. */
  const root = await mkdtemp(join(tmpdir(), 'zhost-watch-policy-'));
  /** Watcher count before acquisition, checked again after awaited cleanup. */
  const before = activeWatcherCount();
  await mkdir(join(root, '.workspace'));
  await mkdir(join(root, 'app'));
  /** Observed relative source paths; private data must never enter this list. */
  const events: string[] = [];
  /** Owned filesystem subscription, closed and awaited before removing its temporary tree. */
  const watcher = watchDirectory(root, (event) => events.push(event.file), {
    ignored: createDevelopmentWatchIgnore(['.workspace']),
    debounceMs: 20,
    pollIntervalMs: 1000,
  });
  try {
    await watcher.ready;
    await writeFile(join(root, '.workspace/private.sqlite'), 'synthetic');
    await writeFile(join(root, 'app/page.ts'), 'source');
    await watcher.flush();
    assert.deepEqual(events, ['app/page.ts']);
  } finally {
    watcher.close();
    await watcher.closed;
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(activeWatcherCount(), before);
});
