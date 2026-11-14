import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCampaignPlanner,
  createMemoryCampaignStore,
  createCampaignDashboard,
} from '../dist/index.js';
/**
 * Seed a fresh memory planner with fixed UTC trend permissions.
 *
 * @returns {Promise<object>} Independent planner and host authorization fixture.
 */
async function setup() {
  /** Synthetic process-local planner with an empty source and fixed clock; no broker or SMTP connection. */
  const planner = createCampaignPlanner({
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
  await planner.create({ id: 'fall', name: 'Fall', sendAt: 1000 });
  return {
    planner,
    authorize: async () => ({ id: 'admin' }),
    authorizeCampaign: async (_: unknown, id: string) => id === 'fall',
    csrfToken: async () => 'token-not-short-123456',
    verifyCsrf: async () => true,
  };
}
/**
 * Construct a synthetic Fetch request without any network operation.
 *
 * @param {string} id - Synthetic campaign identity; unauthorized alternatives exercise scoped denial.
 * @param {string} from - Explicit UTC date boundary; invalid input exercises validation.
 * @param {string} to - Explicit UTC end day; fixture asserts exact returned coverage.
 * @returns {Request} Local request for direct handler invocation.
 */
const req = (id = 'fall', from = '2026-10-10', to = '2026-10-11') =>
  new Request(
    `https://app.example.test/_email/campaigns/api?id=${id}&view=trends&from=${from}&to=${to}`
  );
/** Synthetic fixed delivery counters; the historical name includes one sent record. */
const empty = {
  pending: 0,
  claimed: 0,
  sending: 0,
  sent: 1,
  suppressed: 0,
  uncertain: 0,
  rejected: 0,
};
/** Synthetic bounded UTC update-day projection, explicitly not a transition history or snapshot. */
const trend = {
  campaignId: 'fall',
  from: '2026-10-10',
  to: '2026-10-11',
  mode: 'database',
  complete: true,
  deliveryCoverage: 'last-state-update-day',
  providerCoverage: 'not-configured',
  snapshotConsistent: false,
  total: 1,
  providerEvents: null,
  days: [
    {
      day: '2026-10-10',
      counts: empty,
      total: 1,
      provider: null,
      providerEvents: null,
    },
  ],
};
test('trends endpoint protects campaign and excludes PII even when callback returns secret fields', async () => {
  /** Fresh planner and scoped host authorization for this independent test. */
  const base = await setup();
  /** Local authenticated handler fixture; no public server or browser is started. */
  const dashboard = createCampaignDashboard({
    ...base,
    trendsReport: async () => ({
      ...trend,
      recipient: 'secret@example.test',
      days: trend.days.map((d) => ({ ...d, messageId: 'secret-mail' })),
    }),
  });
  /** Local Fetch response inspected for status and bounded redaction. */
  const response = await dashboard.handle(req());
  assert.equal(response.status, 200);
  /** Serialized trend projection checked for stripped private callback fields. */
  const serialized = await response.text();
  assert.equal(serialized.includes('secret'), false);
  assert.equal(JSON.parse(serialized).days[0].counts.sent, 1);
  assert.equal((await dashboard.handle(req('other'))).status, 403);
  assert.equal((await dashboard.handle(req('fall', 'invalid'))).status, 400);
  assert.equal(
    (
      await createCampaignDashboard({
        ...base,
        authorize: async () => null,
        trendsReport: async () => trend,
      }).handle(req())
    ).status,
    403
  );
});
test('invalid callback output and unavailable trends fail closed', async () => {
  /** Fresh planner and scoped host authorization for this independent test. */
  const base = await setup();
  assert.equal((await createCampaignDashboard(base).handle(req())).status, 404);
  /** Handler with a conflicting aggregate total; it must return a redacted unavailable response. */
  const bad = createCampaignDashboard({
    ...base,
    trendsReport: async () => ({ ...trend, total: 4 }),
  });
  assert.equal((await bad.handle(req())).status, 503);
});
