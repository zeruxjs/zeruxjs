import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCampaignPlanner,
  createMemoryCampaignStore,
  createCampaignDashboard,
} from '../dist/index.js';
/**
 * Create a fresh empty-source planner with a fixed clock and no external side effects.
 *
 * @returns {object} Independent process-local planner; no durability or SMTP acceptance is claimed.
 */
const planner = () =>
  createCampaignPlanner({
    store: createMemoryCampaignStore(),
    source: {
      page: async () => ({ contacts: [], nextCursor: null, done: true }),
    },
    isSubscribed: async () => true,
    isSuppressed: async () => false,
    ensureMessage: async () => {},
    enqueue: async () => {},
    now: () => 1000,
  });
/** Synthetic exact native-count projection with an explicit uncertain outcome and provider-event coverage. */
const performance = {
  campaignId: 'camp58',
  mode: 'database',
  complete: true,
  total: 101001,
  counts: {
    pending: 0,
    claimed: 0,
    sending: 0,
    sent: 101000,
    suppressed: 0,
    uncertain: 1,
    rejected: 0,
  },
  smtpAcceptedPercent: (100 * 101000) / 101001,
  dailyCoverage: 'not-computed',
  activityCoverage: 'not-computed',
  provider: {
    events: 2,
    coverage: 'reported-events-only',
    counts: {
      delivered: 1,
      deferred: 0,
      'hard-bounce': 1,
      'soft-bounce': 0,
      complaint: 0,
    },
  },
};
/**
 * Construct a synthetic Fetch request without any network operation.
 *
 * @param {string} id - Synthetic campaign identity; unauthorized alternatives exercise scoped denial.
 * @returns {Request} Local request for direct handler invocation.
 */
const req = (id) =>
  new Request(
    `https://app.example.test/_email/campaigns/api?id=${id}&view=performance`
  );
/**
 * Seed one campaign and return its explicit synthetic host authorization policies.
 *
 * @returns {Promise<object>} Fresh planner and matching session/campaign/CSRF fixture.
 */
const configure = async () => {
  /** Fresh synthetic planner populated before returning its authorized handler policy. */
  const p = planner();
  await p.create({ id: 'camp58', name: 'Campaign', sendAt: 1000 });
  return {
    planner: p,
    authorize: async () => ({ id: 'admin' }),
    authorizeCampaign: async (_, id) => id === 'camp58',
    verifyCsrf: async () => true,
    csrfToken: async () => 'csrf-long-very-secret-12345678',
  };
};
test('performance dashboard only serves authorized, PII-free summaries', async () => {
  /** Explicit synthetic session and per-campaign policy callbacks. */
  const options = await configure();
  /** Opt-in handler fixture; construction does not start a server. */
  const app = createCampaignDashboard({
    ...options,
    performanceReport: async () => ({
      ...performance,
      recipient: 'hidden@example.test',
      provider: {
        ...performance.provider,
        secret: 'private-secret',
        messageId: 'mail-1',
      },
      secret: 'top-secret',
    }),
  });
  /** Local authorized performance response; no provider endpoint is contacted. */
  const res = await app.handle(req('camp58'));
  assert.equal(res.status, 200);
  /** Serialized projection inspected for injected recipient and secret fields. */
  const text = await res.text();
  assert.equal(text.includes('hidden@example.test'), false);
  assert.equal(text.includes('secret'), false);
  /** Parsed allowlisted counts after response redaction. */
  const body = JSON.parse(text);
  assert.equal(body.total, 101001);
  assert.equal(body.provider.counts.delivered, 1);
  assert.equal((await app.handle(req('other'))).status, 403);
  assert.equal(
    (
      await createCampaignDashboard({
        ...options,
        authorize: async () => null,
        performanceReport: async () => performance,
      }).handle(req('camp58'))
    ).status,
    403
  );
});
test('performance endpoint rejects broken totals and fails closed when unconfigured', async () => {
  /** Explicit synthetic session and per-campaign policy callbacks. */
  const options = await configure();
  assert.equal(
    (await createCampaignDashboard(options).handle(req('camp58'))).status,
    404
  );
  /** Handler configured with deliberately inconsistent report metadata; it must fail closed. */
  const invalid = createCampaignDashboard({
    ...options,
    performanceReport: async () => ({ ...performance, total: 11 }),
  });
  assert.equal((await invalid.handle(req('camp58'))).status, 503);
});
