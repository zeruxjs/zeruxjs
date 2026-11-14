import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueueService } from '../dist/index.js';

/** Injected native factory/counters; not live broker certification.
 * @returns {unknown} Explicit synthetic fixture result or declared failure; external acceptance remains separate.
 */
const fake = () => {
  /** Recorded injected native calls; no real broker operation occurs in this fixture. */
  const calls = [];
  /** Synthetic queued records or in-memory job map, scoped to one test. */
  const jobs = new Map();
  /** Injected native fixture; it opens no real broker connection. */
  class Queue {
    /** Initialize only the injected native fixture instance and retain its explicit test options.
     * @param {string} name - Fixed synthetic queue/job/event name.
     */
    constructor(name) {
      this.name = name;
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
    async add(name, data, opts) {
      /** One explicit synthetic task with bounded opaque record-reference data. */
      const job = {
        id: opts.jobId,
        name,
        data,
        attemptsMade: 1,
        getState: async () => job.state ?? 'failed',
        retry: async () => {
          job.state = 'waiting';
          calls.push('retry');
        },
      };
      jobs.set(job.id, job);
      return job;
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
      return jobs.get(id);
    }
    /** Return the bounded synthetic inspection page for redaction/authorization checks.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async getJobs() {
      return [...jobs.values()];
    }
    /** Return explicit fixture counts without exposing synthetic payload bodies.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async getJobCounts() {
      return { waiting: 0, failed: jobs.size };
    }
    /** Record the synthetic local/global pause operation selected by this fixture.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async pause() {
      calls.push('pause');
    }
    /** Record the synthetic local/global resume operation selected by this fixture.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async resume() {
      calls.push('resume');
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
    /** Record the synthetic local/global pause operation selected by this fixture.
     * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    async pause() {
      calls.push('localPause');
    }
    /** Record the synthetic local/global resume operation selected by this fixture.
     * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
     */
    resume() {
      calls.push('localResume');
    }
  }
  return { Queue, Worker, calls };
};
/** Synthetic host session/CSRF callbacks; production authentication stays host-owned. */
const dashboard = {
  authorize: (request) =>
    request.headers.get('cookie') === 'session=operator'
      ? { id: 'operator' }
      : null,
  csrfToken: () => '1234567890abcdef1234',
  verifyCsrf: (request) =>
    request.headers.get('x-csrf-token') === '1234567890abcdef1234',
};
/** Build a synthetic authenticated dashboard request; no live HTTP endpoint is contacted.
 * @param {string} url - Fixed synthetic dashboard/transport destination.
 * @param {object} options - Explicit synthetic request/native settings.
 * @returns {unknown} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
 */
function req(url, options = {}) {
  return new Request(url, {
    ...options,
    headers: { cookie: 'session=operator', ...(options.headers ?? {}) },
  });
}
/** Invoke an explicitly registered synthetic dashboard route after exact path selection.
 * @param {object} service - Borrowed injected service whose outer test owns close.
 * @param {string} url - Fixed synthetic dashboard/transport destination.
 * @param {object} options - Explicit synthetic request/native settings.
 * @returns {Promise<unknown>} Explicit fixture result or deliberate failure; no live-provider acceptance claim.
 */
async function dispatch(service, url, options) {
  /** Parsed fixed synthetic route path, without trusting request role claims. */
  const pathname = new URL(url).pathname;
  /** Explicit registered synthetic dashboard handler selected by exact path. */
  const route = service.routes().find((r) => r.pattern === pathname);
  assert.ok(route, pathname);
  return route.handler(req(url, options));
}
test('queue admin is opt-in and requires both session authorization and CSRF', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fake();
  await assert.rejects(
    createQueueService(
      { redis: { host: 'localhost' }, queues: ['emails'], dashboard },
      f
    ),
    /administrative authorization/
  );
  /** Fixture scheduler/service owner used for the current validation case. */
  const s = await createQueueService(
    {
      redis: { host: 'localhost' },
      queues: ['emails'],
      administration: {
        authorize: async (_, queue, identity) =>
          queue === 'emails' && identity?.id === 'operator',
      },
      dashboard,
    },
    f
  );
  assert.equal(s.routes().length, 4);
  /** Explicit synthetic configuration or store underlying the current case. */
  const base = 'https://example.test/_queue/admin';
  /** Synthetic unauthenticated response expected to deny before private exposure. */
  const noAuth = await s.routes()[0].handler(new Request(base));
  assert.equal(noAuth.status, 403);
  /** Consumed dashboard markup inspected for private-value leakage. */
  const html = await dispatch(s, base);
  assert.equal(html.status, 200);
  /** Synthetic body or consumed response bytes; no real recipient content. */
  const body = await html.text();
  assert.ok(body.includes('csrf-token'));
  assert.ok(!body.includes('redis://'));
  assert.equal((await dispatch(s, base + '/app.js')).status, 200);
  assert.equal((await dispatch(s, base + '/app.css')).status, 200);
  /** Authorized bounded synthetic queue count projection. */
  const counts = await (await dispatch(s, base + '/api?kind=queues')).json();
  assert.equal(counts.queues[0].name, 'emails');
  await s
    .queue('emails')
    .add('email.deliver', { password: 'HIDDEN' }, { jobId: 'secure1' });
  /** Redacted synthetic job inspection response, never raw private job data. */
  const inspection = await (
    await dispatch(s, base + '/api?kind=jobs&queue=emails')
  ).text();
  assert.ok(inspection.includes('secure1'));
  assert.ok(!inspection.includes('HIDDEN'));
  /** Explicit synthetic control payload sent through host authorization/CSRF checks. */
  const payload = JSON.stringify({
    queue: 'emails',
    action: 'retry',
    id: 'secure1',
  });
  /** Synthetic write request with explicit method/body/origin policy. */
  const post = {
    method: 'POST',
    body: payload,
    headers: {
      'content-type': 'application/json',
      origin: 'https://example.test',
    },
  };
  assert.equal(
    (await dispatch(s, base + '/api', post)).status,
    403,
    'csrf absent'
  );
  assert.equal(
    (
      await dispatch(s, base + '/api', {
        ...post,
        headers: {
          ...post.headers,
          'x-csrf-token': '1234567890abcdef1234',
          origin: 'https://attacker.test',
        },
      })
    ).status,
    403,
    'wrong origin'
  );
  assert.equal(
    (
      await dispatch(s, base + '/api', {
        ...post,
        headers: { ...post.headers, 'x-csrf-token': '1234567890abcdef1234' },
      })
    ).status,
    200
  );
  assert.deepEqual(f.calls, ['retry']);
  await s.close();
});
test('unauthorized queue names are not disclosed; dashboard validation rejects unsafe settings', async () => {
  /** Isolated fixture handles/counters; close owned services and settle held work on teardown. */
  const f = fake();
  /** Fixture scheduler/service owner used for the current validation case. */
  const s = await createQueueService(
    {
      redis: { host: 'localhost' },
      queues: ['allowed', 'secret'],
      administration: { authorize: async (_, queue) => queue === 'allowed' },
      dashboard,
    },
    f
  );
  /** Explicit synthetic configuration or store underlying the current case. */
  const base = 'https://example.test/_queue/admin';
  /** Authorized bounded page/list result used for scope assertions. */
  const list = await (await dispatch(s, base + '/api?kind=queues')).json();
  assert.deepEqual(
    list.queues.map((q) => q.name),
    ['allowed']
  );
  /** Denied private synthetic record/response; must not leak names or raw cursors. */
  const hidden = await dispatch(s, base + '/api?kind=jobs&queue=secret');
  assert.equal(hidden.status, 403);
  await s.close();
  // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
  for (const bad of [
    { ...dashboard, prefix: '//invalid' },
    { ...dashboard, csrfToken: undefined },
    { ...dashboard, verifyCsrf: undefined },
  ]) {
    await assert.rejects(
      createQueueService(
        {
          redis: { host: 'localhost' },
          queues: ['q'],
          administration: { authorize: () => true },
          dashboard: bad,
        },
        f
      ),
      /Invalid|requires/
    );
  }
});
