import test from 'node:test';
import assert from 'node:assert/strict';
import { ThreadWorkerPool, runWorkers } from '../dist/bootstrap/worker.js';

/** Quiet injected logger avoiding global logging state in worker fixtures. */
const logger = { info() {}, error() {} };

test('partial worker startup failure rolls back previous cleanups and pools', async () => {
  /** Ordered startup and rollback receipts for the synthetic worker generation. */
  const events = [];
  /** Injected pool recording shutdown without creating native worker threads. */
  const fakePool = {
    start() {
      events.push('pool:start');
    },
    async stop() {
      events.push('pool:stop');
    },
  };
  /** Synthetic generation with one successful worker and one denied startup. */
  const runtime = {
    workers: new Map([
      [
        'first',
        {
          start: async () => {
            events.push('first:start');
            return async () => events.push('first:stop');
          },
        },
      ],
      [
        'second',
        {
          start: async () => {
            events.push('second:start');
            throw Error('startup denied');
          },
        },
      ],
    ]),
    threadWorkers: new Map([['pool', fakePool]]),
    mode: 'dev',
    config: {},
    structure: {},
    logger,
    workerState: {},
  };
  await assert.rejects(runWorkers(runtime), /startup denied/);
  assert.deepEqual(events, [
    'first:start',
    'second:start',
    'pool:stop',
    'first:stop',
  ]);
});

test('pool shutdown rejects in-flight tasks instead of hanging promises', async () => {
  /** Pool owner exercised through an injected pending task rather than a live script. */
  const pool = new ThreadWorkerPool({
    rootDir: process.cwd(),
    mode: 'dev',
    config: {},
    logger,
    serviceName: 'zerux',
    worker: {
      name: 'test',
      script: '/nonexistent',
      minThreads: 0,
      maxThreads: 1,
    },
  });
  let failure;
  /** Unsettled task promise that shutdown must explicitly reject. */
  const pending = new Promise((_resolve, reject) => (failure = reject));
  /** Injected task callbacks representing one in-flight worker request. */
  const task = { id: 1, reject: failure, resolve() {} };
  pool.runningTasks.set({ terminate: async () => 0 }, task);
  /** Rejection assertion attached before shutdown to avoid an unhandled promise. */
  const reported = assert.rejects(pending, /stopped during task execution/);
  await pool.stop();
  await reported;
});
