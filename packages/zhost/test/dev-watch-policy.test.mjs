import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevelopmentWatchIgnore } from '../dist/index.js';
import { watchDirectory, activeWatcherCount } from 'zlook';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('development exclusions are validated snapshots and do not match sibling prefixes', () => {
  const paths = ['.workspace', '.zerux'], ignored = createDevelopmentWatchIgnore(paths); paths.push('app');
  assert.equal(ignored('.workspace/objects/private'), true); assert.equal(ignored('.workspace'), true);
  assert.equal(ignored('.workspace-other/file'), false); assert.equal(ignored('app/page.ts'), false);
  for (const value of [['../secret'], ['/absolute'], ['folder//child'], ['C:\\private'], ['.'], ['a/../b'], 'all', [123]]) assert.throws(() => createDevelopmentWatchIgnore(value));
  assert.equal(createDevelopmentWatchIgnore()('anything'), false);
});
test('private data does not enter source events; source changes and watcher disposal still work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zhost-watch-policy-')), before = activeWatcherCount();
  await mkdir(join(root, '.workspace')); await mkdir(join(root, 'app'));
  const events = [], watcher = watchDirectory(root, event => events.push(event.file), { ignored: createDevelopmentWatchIgnore(['.workspace']), debounceMs: 20, pollIntervalMs: 1000 });
  try {
    await watcher.ready; await writeFile(join(root, '.workspace/private.sqlite'), 'synthetic'); await writeFile(join(root, 'app/page.ts'), 'source'); await watcher.flush();
    assert.deepEqual(events, ['app/page.ts']);
  } finally { watcher.close(); await watcher.closed; await rm(root, { recursive: true, force: true }); }
  assert.equal(activeWatcherCount(), before);
});
