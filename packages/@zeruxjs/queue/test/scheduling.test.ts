import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createQueueTaskScheduler,
  createTaskRegistry,
  createQueueService,
} from '../dist/index.js';
/** Create an isolated injected queue/scheduler fixture without native connections.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const make = () => {
  /** Fixture-local declared native scheduler records. */
  const schedules = new Map();
  /** Recorded injected native calls; no real broker operation occurs in this fixture. */
  const calls = [];
  /** Borrowed synthetic queue or owned neutral wrapper; lifecycle follows the enclosing test. */
  const queue = {
    /** Record one explicit synthetic enqueue using the tested stable job identity.
     * @param {string} name - Fixed synthetic queue/job/event name.
     * @param {Record<string,unknown>} data - Synthetic bounded job data, never production content.
     * @param {object} opts - Explicit synthetic native options.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async add(name, data, opts) {
      calls.push(['add', name, data, opts]);
      return { id: opts?.jobId ?? 'job' };
    },
    /** Store one explicit native scheduler definition in the fixture map.
     * @param {string} id - Opaque synthetic record/job/schedule ID.
     * @param {object} repeat - Explicit synthetic native repeat definition.
     * @param {object} template - Explicit native scheduled task template.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async upsertJobScheduler(id, repeat, template) {
      schedules.set(id, { id, repeat, template });
      return { id };
    },
    /** Remove only the named synthetic native schedule.
     * @param {string} id - Opaque synthetic record/job/schedule ID.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async removeJobScheduler(id) {
      return schedules.delete(id);
    },
    /** Return a bounded synthetic scheduler page without private payload details.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async getJobSchedulers() {
      return [...schedules.values()].map((x) => ({
        id: x.id,
        name: x.template.name,
        next: 123,
        secret: 'must-not-expose',
      }));
    },
  };
  return { queue, schedules, calls };
};
test('one-off, interval and cron tasks are registered through durable BullMQ scheduler', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = make();
  /** Borrowed native scheduler facade; service owns native lifetime. */
  const scheduler = createQueueTaskScheduler(f.queue);
  await scheduler.once(
    'nightly1',
    { task: 'sync', data: { limit: 2 } },
    Date.now() + 60000
  );
  assert.equal(f.calls[0][1], 'zerux.task');
  assert.equal(f.calls[0][2].task, 'sync');
  await scheduler.every('hourly1', { task: 'sync' }, 60000, { limit: 3 });
  await scheduler.cron('morning1', { task: 'sync' }, '0 6 * * *', {
    timezone: 'Asia/Kolkata',
  });
  assert.equal(f.schedules.get('hourly1').repeat.every, 60000);
  assert.equal(f.schedules.get('morning1').repeat.tz, 'Asia/Kolkata');
  assert.deepEqual(
    (await scheduler.list()).map((i) => Object.keys(i).sort()),
    [
      ['id', 'name', 'next'],
      ['id', 'name', 'next'],
    ]
  );
  assert.equal(await scheduler.remove('hourly1'), true);
});
test('scheduler rejects malformed IDs, data, cron, dates and timezone', async () => {
  /** Fixture scheduler/service owner used for the current validation case. */
  const s = createQueueTaskScheduler(make().queue);
  assert.throws(
    () => s.once('bad:id', { task: 'ok' }, Date.now() + 40000),
    /schedule ID/
  );
  assert.throws(
    () => s.once('ok', { task: 'foo' }, Date.now() - 1),
    /Scheduled execution/
  );
  assert.throws(
    () => s.cron('ok', { task: 'foo' }, '* * * * *', { timezone: 'Not/AZone' }),
    /timezone/
  );
  assert.throws(
    () => s.cron('ok', { task: 'foo' }, 'curl https://evil.test'),
    /cron/
  );
  assert.throws(() => s.every('ok', { task: 'foo' }, 99), /interval/);
  assert.throws(
    () =>
      s.every('ok', { task: 'foo', data: { large: 'x'.repeat(9000) } }, 1000),
    /8 KiB/
  );
});
test('task registry invokes only explicitly registered code, and rejects unknown handlers', async () => {
  /** Explicit synthetic task registry; duplicate/unknown handlers reject. */
  const reg = createTaskRegistry();
  reg.register('purge', async (data) => data.count + 2);
  assert.equal(
    await reg.processor({
      name: 'zerux.task',
      data: { task: 'purge', payload: { count: 5 } },
      attemptsMade: 1,
    }),
    7
  );
  await assert.rejects(
    reg.processor({
      name: 'zerux.task',
      data: { task: 'remote', payload: {} },
    }),
    /Unregistered/
  );
  assert.throws(() => reg.register('purge', () => {}), /duplicate/);
  await assert.rejects(
    reg.processor({ name: 'other', data: { task: 'purge' } }),
    /Unexpected/
  );
});
test('service schedules are invalidated after shutdown and are redis-backed', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = make();
  /** Injected native fixture; it opens no real broker connection. */
  class Queue {
    /** Initialize only the injected native fixture instance and retain its explicit test options.
     */
    constructor() {
      this.api = f.queue;
    }
    /** Simulate native readiness or the declared startup failure without contacting Redis.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async waitUntilReady() {}
    /** Record one explicit synthetic enqueue using the tested stable job identity.
     * @param {...unknown} x - Forwarded fixed native method arguments.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async add(...x) {
      return f.queue.add(...x);
    }
    /** Store one explicit native scheduler definition in the fixture map.
     * @param {...unknown} x - Forwarded fixed native method arguments.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async upsertJobScheduler(...x) {
      return f.queue.upsertJobScheduler(...x);
    }
    /** Return a bounded synthetic scheduler page without private payload details.
     * @param {...unknown} x - Forwarded fixed native method arguments.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async getJobSchedulers(...x) {
      return f.queue.getJobSchedulers(...x);
    }
    /** Remove only the named synthetic native schedule.
     * @param {...unknown} x - Forwarded fixed native method arguments.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async removeJobScheduler(...x) {
      return f.queue.removeJobScheduler(...x);
    }
    /** Close only the fixture-owned service/resource or record its native shutdown call.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async close() {}
  }
  /** Injected native fixture; it opens no real broker connection. */
  class Worker {
    /** Register a synthetic native event callback; no real event transport starts.
     * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    on() {
      return this;
    }
    /** Close only the fixture-owned service/resource or record its native shutdown call.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async close() {}
  }
  /** Owned injected queue service; await close on test teardown. */
  const svc = await createQueueService(
    { redis: { host: 'localhost' }, queues: ['tasks'] },
    { Queue, Worker }
  );
  await svc.schedules('tasks').cron('daily', { task: 'purge' }, '0 0 * * *');
  assert.equal(f.schedules.size, 1);
  await svc.close();
  assert.throws(() => svc.schedules('tasks').list(), /closed/);
});
test('worker rate limiting is passed to BullMQ and validated per queue', async () => {
  /** Fixture-local observed job IDs or native worker options, not private bodies. */
  const seen = [];
  /** Injected native fixture; it opens no real broker connection. */
  class Queue {
    /** Simulate native readiness or the declared startup failure without contacting Redis.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async waitUntilReady() {}
    /** Close only the fixture-owned service/resource or record its native shutdown call.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async close() {}
  }
  /** Injected native fixture; it opens no real broker connection. */
  class Worker {
    /** Initialize only the injected native fixture instance and retain its explicit test options.
     * @param {string} _name - Ignored fixed native queue/job name.
     * @param {function} _fn - Ignored explicit synthetic worker handler.
     * @param {object} opts - Explicit synthetic native options.
     */
    constructor(_name, _fn, opts) {
      seen.push(opts);
    }
    /** Register a synthetic native event callback; no real event transport starts.
     * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    on() {
      return this;
    }
    /** Close only the fixture-owned service/resource or record its native shutdown call.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async close() {}
  }
  /** Explicit synthetic native options inspected before startup. */
  const opts = {
    redis: { host: 'localhost' },
    queues: ['emails'],
    workers: {
      emails: {
        processor: async () => {},
        limiter: { max: 120, duration: 60000 },
      },
    },
  };
  /** Owned fixture queue service; await close after admitted work settles. */
  const service = await createQueueService(opts, { Queue, Worker });
  assert.deepEqual(seen[0].limiter, { max: 120, duration: 60000 });
  await service.close();
  await assert.rejects(
    createQueueService(
      {
        ...opts,
        workers: {
          emails: {
            processor: async () => {},
            limiter: { max: 0, duration: 500 },
          },
        },
      },
      { Queue, Worker }
    ),
    /rate limit/
  );
});
test('one-off tasks can be canceled safely only while waiting or delayed', async () => {
  /** Synthetic native job-state map for cancel/precondition checks. */
  const states = new Map();
  /** Borrowed fixture queue facade; enclosing service owns cleanup. */
  const q = {
    /** Read one synthetic raw job behind trusted fixture access.
     * @param {string} id - Opaque synthetic record/job/schedule ID.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async getJob(id) {
      return states.get(id) ?? null;
    },
  };
  /** Fixture scheduler/service owner used for the current validation case. */
  const s = createQueueTaskScheduler(q);
  let removed = 0;
  states.set('task-later', {
    getState: async () => 'delayed',
    remove: async () => {
      removed++;
      states.delete('task-later');
    },
  });
  assert.equal(await s.cancelOnce('later'), true);
  assert.equal(removed, 1);
  assert.equal(await s.cancelOnce('later'), false);
  states.set('task-running', {
    getState: async () => 'active',
    remove: async () => {
      removed++;
    },
  });
  await assert.rejects(s.cancelOnce('running'), /Only pending/);
  assert.equal(removed, 1);
  states.set('task-unknown', { getState: async () => 'waiting' });
  await assert.rejects(s.cancelOnce('unknown'), /cannot safely cancel/);
});
