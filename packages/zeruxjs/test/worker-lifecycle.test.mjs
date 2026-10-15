import test from 'node:test';
import assert from 'node:assert/strict';
import { ThreadWorkerPool, runWorkers } from '../dist/bootstrap/worker.js';

const logger = { info() {}, error() {} };

test('partial worker startup failure rolls back previous cleanups and pools', async () => {
  const events = [];
  const fakePool = { start() { events.push('pool:start'); }, async stop() { events.push('pool:stop'); } };
  const runtime = {
    workers: new Map([
      ['first', { start: async () => { events.push('first:start'); return async () => events.push('first:stop'); } }],
      ['second', { start: async () => { events.push('second:start'); throw Error('startup denied'); } }]
    ]),
    threadWorkers: new Map([['pool', fakePool]]),
    mode: 'dev', config: {}, structure: {}, logger, workerState: {}
  };
  await assert.rejects(runWorkers(runtime), /startup denied/);
  assert.deepEqual(events, ['first:start', 'second:start', 'pool:stop', 'first:stop']);
});

test('pool shutdown rejects in-flight tasks instead of hanging promises', async () => {
  const pool = new ThreadWorkerPool({ rootDir: process.cwd(), mode: 'dev', config: {},
    logger, serviceName: 'zerux', worker: { name: 'test', script: '/nonexistent', minThreads: 0, maxThreads: 1 } });
  let failure;
  const pending = new Promise((_resolve, reject) => failure = reject);
  const task = { id: 1, reject: failure, resolve() {} };
  pool.runningTasks.set({ terminate: async () => 0 }, task);
  const reported = assert.rejects(pending, /stopped during task execution/);
  await pool.stop();
  await reported;
});
