import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createQueueService,
  createQueueTaskScheduler,
  createTaskRegistry,
} from '../dist/index.js';
/** Injected native factory/counters; not live broker certification.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const fake = () => {
  /** Fixture-local declared native scheduler records. */
  const schedules = new Map();
  /** Synthetic queued records or in-memory job map, scoped to one test. */
  const jobs = new Map();
  /** Explicit synthetic consent/suppression/send calls in expected order. */
  const actions = [];
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
    /** Record one explicit synthetic enqueue using the tested stable job identity.
     * @param {string} name - Fixed synthetic queue/job/event name.
     * @param {Record<string,unknown>} data - Synthetic bounded job data, never production content.
     * @param {object} options - Explicit synthetic request/native settings.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async add(name, data, options) {
      /** Validated synthetic opaque record/job identity, not authorization. */
      const id = options?.jobId ?? 'one';
      /** One explicit synthetic task with bounded opaque record-reference data. */
      const job = {
        id,
        name,
        data,
        getState: async () => 'delayed',
        remove: async () => {
          jobs.delete(id);
        },
      };
      jobs.set(id, job);
      return job;
    }
    /** Read one synthetic raw job behind trusted fixture access.
     * @param {string} id - Opaque synthetic record/job/schedule ID.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async getJob(id) {
      return jobs.get(id) ?? null;
    }
    /** Store one explicit native scheduler definition in the fixture map.
     * @param {string} id - Opaque synthetic record/job/schedule ID.
     * @param {object} repeat - Explicit synthetic native repeat definition.
     * @param {object} template - Explicit native scheduled task template.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async upsertJobScheduler(id, repeat, template) {
      schedules.set(id, { id, repeat, template });
      return { id };
    }
    /** Remove only the named synthetic native schedule.
     * @param {string} id - Opaque synthetic record/job/schedule ID.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async removeJobScheduler(id) {
      return schedules.delete(id);
    }
    /** Return a bounded synthetic scheduler page without private payload details.
     * @param {number} start - Inclusive bounded page start.
     * @param {number} end - Inclusive bounded page end.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async getJobSchedulers(start, end) {
      return [...schedules.values()].slice(start, end + 1).map((s) => ({
        id: s.id,
        name: s.template.name,
        next: 123,
        payload: 'secret',
      }));
    }
    /** Return explicit fixture counts without exposing synthetic payload bodies.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async getJobCounts() {
      return { waiting: jobs.size };
    }
    /** Record the synthetic local/global pause operation selected by this fixture.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async pause() {}
    /** Record the synthetic local/global resume operation selected by this fixture.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async resume() {}
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
  return { driver: { Queue, Worker }, schedules, jobs, actions };
};
test('schedule administration is per action and per queue, redacted, and audited', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fake();
  /** Redacted synthetic audit entries or coverage result; no payloads/addresses. */
  const audit = [];
  /** Owned injected queue service; await close on test teardown. */
  const svc = await createQueueService(
    {
      redis: { host: 'localhost' },
      queues: ['tenant-a', 'tenant-b'],
      administration: {
        authorize: (action, name, ctx) =>
          ctx?.tenant === name && ctx.permissions?.includes(action),
        onAudit: (e) => audit.push(e),
      },
    },
    f.driver
  );
  try {
    /** Synthetic host-authorized operator context; never trusted browser claims. */
    const admin = {
      tenant: 'tenant-a',
      permissions: ['schedule-create', 'schedule-inspect', 'schedule-remove'],
    };
    /** Synthetic read-only operator context expected to deny writes. */
    const read = { tenant: 'tenant-a', permissions: ['schedule-inspect'] };
    await assert.rejects(
      svc.operations.scheduleCron(
        'tenant-b',
        'nightly',
        { task: 'task' },
        '0 0 * * *',
        admin
      ),
      /forbidden/
    );
    await assert.rejects(
      svc.operations.scheduleCron(
        'tenant-a',
        'nightly',
        { task: 'task' },
        '0 0 * * *',
        read
      ),
      /forbidden/
    );
    /** Observed operation outcome compared with explicit fixture expectations. */
    const result = await svc.operations.scheduleCron(
      'tenant-a',
      'nightly',
      { task: 'task' },
      '0 0 * * *',
      admin,
      { timezone: 'Asia/Kolkata' }
    );
    assert.equal(result.id, 'nightly');
    assert.equal(f.schedules.get('nightly').repeat.tz, 'Asia/Kolkata');
    assert.deepEqual(await svc.operations.listSchedules('tenant-a', {}, read), [
      { id: 'nightly', name: 'zerux.task', next: 123 },
    ]);
    assert.equal(
      await svc.operations.removeSchedule('tenant-a', 'nightly', admin),
      true
    );
    await svc.operations.scheduleOnce(
      'tenant-a',
      'once1',
      { task: 'task' },
      Date.now() + 30_000,
      admin
    );
    assert.equal(
      await svc.operations.cancelOneOff('tenant-a', 'once1', admin),
      true
    );
    assert.ok(audit.every((e) => e.queue === 'tenant-a' && !('payload' in e)));
    assert.deepEqual(
      audit.map((e) => e.action),
      [
        'schedule-create',
        'schedule-inspect',
        'schedule-remove',
        'schedule-create',
        'schedule-remove',
      ]
    );
  } finally {
    await svc.close();
  }
});
test('job retry/retention/dedup and worker lock settings are checked before Redis', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fake();
  /** Owned injected queue service; await close on test teardown. */
  const svc = await createQueueService(
    { redis: { host: 'localhost' }, queues: ['q'] },
    f.driver
  );
  try {
    // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
    for (const opts of [
      { attempts: -1 },
      { backoff: { type: 'evil', delay: 20 } },
      { delay: 1e20 },
      { deduplication: { id: 'bad:colon' } },
      { removeOnFail: { age: -3 } },
      { repeat: { every: 0 } },
      { jobId: 'a'.repeat(200) },
    ]) {
      assert.throws(
        () => svc.queue('q').add('job', {}, opts),
        /Invalid|Repeat interval/
      );
    }
  } finally {
    await svc.close();
  }
  // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
  for (const lockDuration of [0, -100, 900000]) {
    await assert.rejects(
      createQueueService(
        {
          redis: { host: 'localhost' },
          queues: ['q'],
          workers: { q: { processor: async () => {}, lockDuration } },
        },
        f.driver
      ),
      /lock duration/
    );
  }
});
test('scheduled registry rejects nested unsafe properties, over-deep objects, and arbitrary handler names', async () => {
  /** Explicit code-owned handler/schema registry; inert data, not discovery. */
  const registry = createTaskRegistry();
  registry.register('safe', async (data) => data);
  /** Deliberate unsafe property fixture; must reject before native publication. */
  const malicious = JSON.parse(
    '{"safe":{"nested":{"__proto__":{"unsafe":true}}}}'
  );
  /** Fixture scheduler/service owner used for the current validation case. */
  const s = createQueueTaskScheduler({
    /** Record one explicit synthetic enqueue using the tested stable job identity.
     * @param {string} _name - Ignored fixed native queue/job name.
     * @param {Record<string,unknown>} data - Synthetic bounded job data, never production content.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async add(_name, data) {
      return { id: 'x', data };
    },
  });
  assert.throws(
    () =>
      s.once('once', { task: 'safe', data: malicious }, Date.now() + 30_000),
    /Unsafe/
  );
  /** Deliberately overdeep plain object used to test finite recursion. */
  const nested = {};
  let at = nested;
  // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
  for (let i = 0; i < 40; i++) {
    at.child = {};
    at = at.child;
  }
  assert.throws(
    () => s.once('once', { task: 'safe', data: nested }, Date.now() + 30_000),
    /nesting/
  );
  await assert.rejects(
    registry.processor({
      name: 'zerux.task',
      data: { task: 'missing', payload: {} },
    }),
    /Unregistered/
  );
});
