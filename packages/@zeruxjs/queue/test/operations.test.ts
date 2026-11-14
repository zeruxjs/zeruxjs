import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createQueueService,
  createEmailDeliveryProcessor,
} from '../dist/index.js';

/** Create isolated injected BullMQ queue/worker/events classes and counters.
 * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
 */
function fakeBull() {
  /** Injected native operation order checked for worker/events/queue shutdown. */
  const trace = [];
  /** Synthetic queued records or in-memory job map, scoped to one test. */
  const jobs = new Map();
  /** Injected native QueueEvents handles tracked for exact cleanup. */
  const streams = [];
  /** Injected native fixture; it opens no real broker connection. */
  class Queue {
    /** Initialize only the injected native fixture instance and retain its explicit test options.
     * @param {string} name - Fixed synthetic queue/job/event name.
     */
    constructor(name) {
      this.name = name;
      trace.push(['queue', name]);
    }
    /** Simulate native readiness or the declared startup failure without contacting Redis.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async waitUntilReady() {}
    /** Record one explicit synthetic enqueue using the tested stable job identity.
     * @param {string} name - Fixed synthetic queue/job/event name.
     * @param {Record<string,unknown>} data - Synthetic bounded job data, never production content.
     * @param {object} opts - Explicit synthetic native options.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async add(name, data, opts = {}) {
      /** Synthetic raw native job retained only behind trusted fixture operations. */
      const j = {
        id: opts.jobId ?? '1',
        name,
        data,
        attemptsMade: 0,
        /** Read the current synthetic job state for retry/cancel preconditions.
         * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
         */
        async getState() {
          return this.state ?? 'failed';
        },
        /** Simulate the atomic native failed-to-waiting transition, recording its original state.
         * @param {string} state - Required original synthetic job state.
         * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
         */
        async retry(state) {
          trace.push(['retry', this.id, state]);
          this.state = 'waiting';
        },
      };
      jobs.set(j.id, j);
      return j;
    }
    /** Map only the explicit bounded synthetic jobs through the injected add contract.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async addBulk() {
      return [];
    }
    /** Read one synthetic raw job behind trusted fixture access.
     * @param {string} id - Opaque synthetic record/job/schedule ID.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async getJob(id) {
      return jobs.get(id) ?? null;
    }
    /** Return explicit fixture counts without exposing synthetic payload bodies.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async getJobCounts() {
      return { waiting: 1, failed: 1 };
    }
    /** Return the bounded synthetic inspection page for redaction/authorization checks.
     * @param {string[]} states - Fixed allowed synthetic state vocabulary.
     * @param {number} start - Inclusive bounded page start.
     * @param {number} end - Inclusive bounded page end.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async getJobs(states, start, end) {
      trace.push(['getJobs', states, start, end]);
      return [...jobs.values()].slice(start, end + 1);
    }
    /** Record the synthetic local/global pause operation selected by this fixture.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async pause() {
      trace.push(['pause', this.name]);
    }
    /** Record the synthetic local/global resume operation selected by this fixture.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async resume() {
      trace.push(['resume', this.name]);
    }
    /** Close only the fixture-owned service/resource or record its native shutdown call.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async close() {
      trace.push(['closeQueue', this.name]);
    }
  }
  /** Injected native fixture; it opens no real broker connection. */
  class Worker {
    /** Initialize only the injected native fixture instance and retain its explicit test options.
     * @param {string} name - Fixed synthetic queue/job/event name.
     */
    constructor(name) {
      this.name = name;
      trace.push(['worker', name]);
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
    async close() {
      trace.push(['closeWorker', this.name]);
    }
    /** Record the synthetic local/global pause operation selected by this fixture.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async pause() {
      trace.push(['pauseWorker', this.name]);
    }
    /** Record the synthetic local/global resume operation selected by this fixture.
     * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    resume() {
      trace.push(['resumeWorker', this.name]);
    }
  }
  /** Injected native fixture; it opens no real broker connection. */
  class QueueEvents {
    /** Initialize only the injected native fixture instance and retain its explicit test options.
     * @param {string} name - Fixed synthetic queue/job/event name.
     * @param {object} opts - Explicit synthetic native options.
     */
    constructor(name, opts) {
      this.name = name;
      this.opts = opts;
      this.handlers = {};
      streams.push(this);
    }
    /** Register a synthetic native event callback; no real event transport starts.
     * @param {string} event - Fixed synthetic event name.
     * @param {function} cb - Owned injected event callback.
     * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    on(event, cb) {
      this.handlers[event] = cb;
      return this;
    }
    /** Simulate native readiness or the declared startup failure without contacting Redis.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async waitUntilReady() {
      trace.push(['readyEvents', this.name]);
    }
    /** Close only the fixture-owned service/resource or record its native shutdown call.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async close() {
      trace.push(['closeEvents', this.name]);
    }
  }
  return { factory: { Queue, Worker, QueueEvents }, trace, jobs, streams };
}
test('queue administration defaults to deny-all and cannot leak payload from inspection', async () => {
  /** Injected native factory/counters; not live broker certification. */
  const fake = fakeBull();
  /** Owned injected queue service; await close on test teardown. */
  const svc = await createQueueService(
    { redis: { host: 'localhost' }, queues: ['emails'] },
    fake.factory
  );
  await svc
    .queue('emails')
    .add(
      'deliver',
      { password: 'private', email: 'private@example.com' },
      { jobId: 'safe1' }
    );
  await assert.rejects(svc.operations.inspect('emails', {}, {}), /forbidden/);
  await assert.rejects(
    svc.operations.retryFailed('emails', 'safe1', {}),
    /forbidden/
  );
  await assert.rejects(svc.operations.pauseQueue('emails', {}), /forbidden/);
  assert.equal(fake.trace.filter((x) => x[0] === 'retry').length, 0);
  await svc.close();
});
test('authorized controls are bounded, replay-safe, and locally separate from global queue pause', async () => {
  /** Injected native factory/counters; not live broker certification. */
  const fake = fakeBull();
  /** Redacted synthetic audit entries or coverage result; no payloads/addresses. */
  const audit = [];
  /** Recorded synthetic authorization calls; no browser role is production proof. */
  const auth = [];
  /** Owned injected queue service; await close on test teardown. */
  const svc = await createQueueService(
    {
      redis: { host: 'localhost' },
      queues: ['emails'],
      workers: { emails: { processor: async () => {} } },
      administration: {
        authorize: async (action, name, ctx) => {
          auth.push([action, name]);
          return ctx?.role === 'operator';
        },
        onAudit: (e) => audit.push(e),
        maxPageSize: 2,
      },
    },
    fake.factory
  );
  await svc
    .queue('emails')
    .add('send', { secret: 'DONT-LEAK' }, { jobId: 'mail1' });
  await assert.rejects(svc.operations.inspect('emails', {}, {}), /forbidden/);
  /** Trusted synthetic connection context used by the database facade. */
  const ctx = { role: 'operator' };
  /** Observed operation outcome compared with explicit fixture expectations. */
  const result = await svc.operations.inspect(
    'emails',
    { states: ['failed'], start: 0, limit: 2 },
    ctx
  );
  assert.equal(result.jobs[0].id, 'mail1');
  assert.equal(result.jobs[0].state, 'failed');
  assert.equal(JSON.stringify(result).includes('DONT-LEAK'), false);
  await assert.rejects(
    svc.operations.inspect('emails', { limit: 3 }, ctx),
    /Invalid inspection limit/
  );
  await assert.rejects(
    svc.operations.inspect('emails', { states: ['__proto__'] }, ctx),
    /Invalid job states/
  );
  await svc.operations.retryFailed('emails', 'mail1', ctx);
  assert.equal(fake.trace.filter((x) => x[0] === 'retry').length, 1);
  await assert.rejects(
    svc.operations.retryFailed('emails', 'mail1', ctx),
    /Only failed/
  );
  await svc.operations.pauseQueue('emails', ctx);
  await svc.operations.resumeQueue('emails', ctx);
  await svc.operations.pauseWorker('emails', ctx);
  await svc.operations.resumeWorker('emails', ctx);
  assert.deepEqual(
    fake.trace
      .filter((x) =>
        ['pause', 'resume', 'pauseWorker', 'resumeWorker'].includes(x[0])
      )
      .map((x) => x[0]),
    ['pause', 'resume', 'pauseWorker', 'resumeWorker']
  );
  assert.ok(audit.some((x) => x.action === 'retry' && x.success === true));
  assert.ok(audit.some((x) => x.action === 'retry' && x.success === false));
  assert.deepEqual((await svc.snapshot()).emails.counts, {
    waiting: 1,
    failed: 1,
  });
  await svc.close();
});
test('QueueEvents contain no job content, close with service, and callback throws cannot break stream', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fakeBull();
  /** Sanitized event notices recorded by the injected sink. */
  const received = [];
  /** Owned injected queue service; await close on test teardown. */
  const svc = await createQueueService(
    {
      redis: { url: 'redis://localhost' },
      queues: ['q'],
      events: {
        enabled: true,
        onEvent: (e) => {
          received.push(e);
          throw Error('logger broke');
        },
      },
    },
    f.factory
  );
  assert.equal(f.streams.length, 1);
  f.streams[0].handlers.failed({ jobId: 'abc', failedReason: 'PRIVATE' });
  assert.deepEqual(Object.keys(received[0]).sort(), [
    'at',
    'jobId',
    'queue',
    'type',
  ]);
  assert.equal(JSON.stringify(received).includes('PRIVATE'), false);
  assert.equal((await svc.snapshot()).q.events, true);
  await svc.close();
  assert.ok(
    f.trace.findIndex((x) => x[0] === 'closeEvents') <
      f.trace.findIndex((x) => x[0] === 'closeQueue')
  );
});
test('queue startup rolls back events if stream readiness fails', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fakeBull();
  /** Injected native fixture; it opens no real broker connection. */
  class BadEvents extends f.factory.QueueEvents {
    /** Simulate native readiness or the declared startup failure without contacting Redis.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async waitUntilReady() {
      throw Error('events offline');
    }
  }
  await assert.rejects(
    createQueueService(
      {
        redis: { host: 'localhost' },
        queues: ['q'],
        events: { enabled: true },
      },
      { ...f.factory, QueueEvents: BadEvents }
    ),
    /events offline/
  );
  assert.equal(f.trace.filter((x) => x[0] === 'closeEvents').length, 1);
  assert.equal(f.trace.filter((x) => x[0] === 'closeQueue').length, 1);
});
test('queued email adapter checks CURRENT marketing consent and never changes tracking', async () => {
  /** Explicit synthetic consent/suppression/send calls in expected order. */
  const actions = [];
  /** Synthetic FIFO records scoped to one injected native client. */
  const messages = new Map([
    [
      'market',
      { id: 'market', purpose: 'marketing', recipient: 'member@example.com' },
    ],
    ['receipt', { id: 'receipt', purpose: 'transactional' }],
  ]);
  let optIn = false;
  /** Explicit allowlisted fixture processor; handlers are never discovered from source strings. */
  const processor = createEmailDeliveryProcessor({
    load: async (id) => messages.get(id),
    isSubscribed: async (to) => {
      actions.push('consent:' + to);
      return optIn;
    },
    suppress: async (id, reason) => {
      actions.push('suppressed:' + id + ':' + reason);
    },
    deliver: async (id) => {
      actions.push('delivered:' + id);
      return 'sent';
    },
  });
  assert.deepEqual(
    await processor({ name: 'email.deliver', data: { messageId: 'market' } }),
    { status: 'suppressed' }
  );
  assert.deepEqual(actions, [
    'consent:member@example.com',
    'suppressed:market:unsubscribed',
  ]);
  optIn = true;
  assert.deepEqual(
    await processor({ name: 'email.deliver', data: { messageId: 'market' } }),
    { status: 'sent' }
  );
  assert.deepEqual(
    await processor({ name: 'email.deliver', data: { messageId: 'receipt' } }),
    { status: 'sent' }
  );
  assert.equal(
    actions.filter((x) => x === 'consent:member@example.com').length,
    2
  );
  await assert.rejects(
    processor({ name: 'email.deliver', data: { messageId: 'missing' } }),
    /missing/
  );
  await assert.rejects(
    processor({ name: 'bad', data: { messageId: 'receipt' } }),
    /Unexpected/
  );
  await assert.rejects(
    processor({ name: 'email.deliver', data: { messageId: '../../../etc' } }),
    /Invalid/
  );
});
test('consent outage fails closed and cannot deliver marketing mail', async () => {
  let sent = false;
  /** Explicit allowlisted fixture processor; handlers are never discovered from source strings. */
  const processor = createEmailDeliveryProcessor({
    load: async (id) => ({
      id,
      purpose: 'marketing',
      recipient: 'a@example.com',
    }),
    isSubscribed: async () => {
      throw Error('db offline');
    },
    suppress: async () => {},
    deliver: async () => {
      sent = true;
      return 'sent';
    },
  });
  await assert.rejects(
    processor({ name: 'email.deliver', data: { messageId: 'market' } }),
    /db offline/
  );
  assert.equal(sent, false);
});

test('enqueueEmailById stores only opaque DB ID with safe retry options', async () => {
  /** Public opaque-message enqueue helper; no SMTP body enters broker payloads. */
  const { enqueueEmailById } = await import('../dist/index.js');
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fakeBull();
  /** Owned injected queue service; await close on test teardown. */
  const svc = await createQueueService(
    { redis: { host: 'localhost' }, queues: ['emails'] },
    f.factory
  );
  /** Observed synthetic opaque-reference enqueue receipt. */
  const queued = await enqueueEmailById(svc.queue('emails'), 'mail_234', {
    delay: 2000,
  });
  assert.deepEqual(queued.data, { messageId: 'mail_234' });
  assert.equal(queued.id, 'email-mail_234');
  assert.equal(queued.name, 'email.deliver');
  await assert.rejects(
    enqueueEmailById(svc.queue('emails'), 'user@example.com'),
    /Invalid/
  );
  await assert.rejects(
    enqueueEmailById(svc.queue('emails'), 'msg', { delay: -3 }),
    /Invalid/
  );
  await svc.close();
});
