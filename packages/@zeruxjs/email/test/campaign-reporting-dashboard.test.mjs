import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCampaignPlanner,
  createMemoryCampaignStore,
  createCampaignDashboard,
} from '../dist/index.js';

/** Synthetic report origin/mount used only for local Fetch handler calls. */
const root = 'https://service.example.test/_email/campaigns';
/**
 * Construct a synthetic Fetch request without any network operation.
 *
 * @param {string} path - Fixed fixture route/query suffix; never a remote endpoint.
 * @returns {Request} Local request for direct handler invocation.
 */
const request = (path) => new Request(root + path);
/** Synthetic fixed session token used only to test write authorization. */
const csrf = 'some-long-session-csrf-token-000000';
/**
 * Create independent planner state and explicit synthetic host policies for each test.
 *
 * @returns {object} Local planner/options pair with no sockets or persistent files.
 */
const make = () => {
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
  /** Explicit fixture session/CSRF/campaign permission callbacks. */
  const opts = {
    planner,
    authorize: async () => ({ id: 'a' }),
    authorizeCampaign: async (_, id) => id !== 'denied',
    verifyCsrf: async () => true,
    csrfToken: async () => csrf,
  };
  return { planner, opts };
};
/** Synthetic bounded delivery snapshot and explicit activity coverage. */
const baseReport = {
  campaignId: 'camp57',
  complete: true,
  scanned: 2,
  counts: {
    pending: 0,
    claimed: 0,
    sending: 0,
    sent: 2,
    suppressed: 0,
    uncertain: 0,
    rejected: 0,
  },
  days: [{ day: '2026-10-13', sent: 2, suppressed: 0, uncertain: 0, other: 0 }],
  sentPercent: 100,
  activity: null,
};
test('report route authenticates, authorizes per campaign, strips provider PII and hidden credentials', async () => {
  /** Fresh local planner and its matching authorization callbacks for this case. */
  const { planner, opts } = make();
  await planner.create({ id: 'camp57', name: 'Fall', sendAt: 1000 });
  /** Opt-in handler fixture; construction does not start a server. */
  const app = createCampaignDashboard({
    ...opts,
    deliveryReport: async () => ({
      ...baseReport,
      recipient: 'private@example.test',
      messageIds: ['private'],
      lease: { token: 'secret' },
      counts: { ...baseReport.counts, extra: 100 },
    }),
  });
  /** Local handler response whose private projection is asserted below. */
  const r = await app.handle(request('/api?id=camp57&view=delivery'));
  assert.equal(r.status, 200);
  /** Serialized private response inspected for accidental secret/recipient leakage. */
  const raw = await r.text();
  assert.equal(raw.includes('private@example.test'), false);
  assert.equal(raw.includes('private'), false);
  assert.equal(raw.includes('secret'), false);
  assert.equal(JSON.parse(raw).counts.sent, 2);
  assert.equal(
    (await app.handle(request('/api?id=denied&view=delivery'))).status,
    403
  );
  assert.equal(
    (
      await createCampaignDashboard({
        ...opts,
        authorize: async () => null,
        deliveryReport: async () => baseReport,
      }).handle(request('/api?id=camp57&view=delivery'))
    ).status,
    403
  );
});
test('unconfigured, incomplete and malformed reports are not silently treated as exact', async () => {
  /** Fresh local planner and its matching authorization callbacks for this case. */
  const { planner, opts } = make();
  await planner.create({ id: 'camp57', name: 'Fall', sendAt: 1000 });
  assert.equal(
    (
      await createCampaignDashboard(opts).handle(
        request('/api?id=camp57&view=delivery')
      )
    ).status,
    404
  );
  /** Local handler response whose private projection is asserted below. */
  const r = await createCampaignDashboard({
    ...opts,
    deliveryReport: async () => ({
      ...baseReport,
      complete: false,
      sentPercent: null,
    }),
  }).handle(request('/api?id=camp57&view=delivery'));
  assert.equal((await r.json()).complete, false);
  /** Handler configured with deliberately inconsistent report metadata; it must fail closed. */
  const invalid = await createCampaignDashboard({
    ...opts,
    deliveryReport: async () => ({
      ...baseReport,
      counts: { ...baseReport.counts, sent: 700 },
    }),
  }).handle(request('/api?id=camp57&view=delivery'));
  assert.equal(invalid.status, 503);
});
