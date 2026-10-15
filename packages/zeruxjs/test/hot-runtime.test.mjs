import test from 'node:test';
import assert from 'node:assert/strict';
import { createHotRuntime } from '../dist/bootstrap/hot-runtime.js';

test('failed rebuild preserves serving generation and later retries succeed', async () => {
  let shouldFail = true;
  let active = 'v1';
  const disposed = [];
  const runtime = createHotRuntime('v1', {
    prepare: async () => { if (shouldFail) throw Error('syntax error'); return 'v2'; },
    activate: v => { active = v; },
    dispose: v => { disposed.push(v); }
  });
  await assert.rejects(runtime.reload(), /syntax error/);
  assert.equal(active, 'v1');
  assert.equal(runtime.status().failures, 1);
  shouldFail = false;
  await runtime.reload();
  assert.equal(active, 'v2');
  assert.deepEqual(disposed, ['v1']);
  assert.equal(runtime.status().generation, 2);
  await runtime.close();
  await runtime.close();
  assert.deepEqual(disposed, ['v1', 'v2']);
  await assert.rejects(runtime.reload(), /closed/);
});

test('concurrent reloads are serialized and close waits for active swap', async () => {
  let concurrent = 0; let maximum = 0;
  const disposed = [];
  const runtime = createHotRuntime(0, {
    prepare: async () => {
      concurrent++; maximum = Math.max(maximum, concurrent);
      await new Promise(resolve => setTimeout(resolve, 10));
      concurrent--;
      return disposed.length + 1;
    },
    activate: () => {}, dispose: v => { disposed.push(v); }
  });
  await Promise.all([runtime.reload(), runtime.reload(), runtime.reload()]);
  assert.equal(maximum, 1);
  assert.equal(runtime.status().generation, 4);
  await runtime.close();
  assert.equal(disposed.length, 4);
});

test('activation failure disposes candidate without replacing live runtime', async () => {
  const disposed = [];
  const runtime = createHotRuntime('old', {
    prepare: async () => 'bad',
    activate: () => { throw Error('activate failed'); },
    dispose: v => { disposed.push(v); }
  });
  await assert.rejects(runtime.reload(), /activate failed/);
  assert.equal(runtime.current(), 'old');
  assert.deepEqual(disposed, ['bad']);
  await runtime.close();
});
