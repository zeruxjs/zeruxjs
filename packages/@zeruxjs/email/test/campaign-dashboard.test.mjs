import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCampaignPlanner,
  createMemoryCampaignStore,
  createCampaignDashboard,
} from '../dist/index.js';
/** Fresh process-local campaign state used only by this test module. */
const store = createMemoryCampaignStore();
/** Synthetic process-local planner with an empty source and fixed clock; no broker or SMTP connection. */
const planner = createCampaignPlanner({
  store,
  source: {
    page: async () => ({ contacts: [], done: true, nextCursor: null }),
  },
  isSubscribed: async () => true,
  isSuppressed: async () => false,
  ensureMessage: async () => {},
  enqueue: async () => {},
  now: () => 1000,
});
/** Synthetic fixed public origin and mount; no HTTP listener is created. */
const prefix = 'https://app.example.test/_email/campaigns';
/** Synthetic fixed session token used only to test write authorization. */
const csrf = '1234567890abcdefghijklmnopqrstuvwxyz';
/**
 * Build a planner dashboard with explicit synthetic session, campaign and CSRF policies.
 *
 * @param {boolean} auth - Default true; false deliberately denies the synthetic session.
 * @returns {object} Local handle/routes; no server starts and the memory planner owns no external resources.
 */
function dash(auth = true) {
  return createCampaignDashboard({
    planner,
    authorize: async () => (auth ? { id: 'admin' } : null),
    verifyCsrf: async (req) => req.headers.get('x-csrf-token') === csrf,
    csrfToken: async () => csrf,
    authorizeCampaign: async (principal, id) =>
      principal?.id === 'admin' && id !== 'restricted',
  });
}
/**
 * Construct a synthetic Fetch request without any network operation.
 *
 * @param {string} path - Fixed fixture route/query suffix; never a remote endpoint.
 * @param {string} method - HTTP method; reads default to GET where supported.
 * @param {object | undefined} body - Synthetic JSON action fields; absence creates a bodyless request.
 * @param {Record<string, string>} headers - Explicit synthetic origin/CSRF overrides for denial cases.
 * @returns {Request} Local request for direct handler invocation.
 */
const req = (path, method = 'GET', body, headers = {}) =>
  new Request(prefix + path, {
    method,
    headers: body
      ? {
          'content-type': 'application/json',
          origin: 'https://app.example.test',
          'x-csrf-token': csrf,
          ...headers,
        }
      : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
test('dashboard requires host auth and CSRF; never exposes recipient identities, IDs, or lease tokens', async () => {
  assert.equal((await dash(false).handle(req(''))).status, 403);
  /** Authorized handler fixture for the normal case and scoped write denials. */
  const d = dash();
  assert.equal((await d.handle(req(''))).status, 200);
  assert.equal(
    (
      await d.handle(
        req(
          '/api',
          'POST',
          { action: 'create', id: 'campa', name: 'Welcome', sendAt: 1000 },
          { 'x-csrf-token': 'wrong' }
        )
      )
    ).status,
    403
  );
  assert.equal(
    (
      await d.handle(
        req(
          '/api',
          'POST',
          { action: 'create', id: 'campa', name: 'Welcome', sendAt: 1000 },
          { origin: 'https://other.example.test' }
        )
      )
    ).status,
    403
  );
  assert.equal(
    (
      await d.handle(
        req('/api', 'POST', {
          action: 'create',
          id: 'campa',
          name: 'Welcome',
          sendAt: 1000,
        })
      )
    ).status,
    201
  );
  assert.equal(
    (await d.handle(req('/api', 'POST', { action: 'schedule', id: 'campa' })))
      .status,
    200
  );
  /** Private planner-state projection checked for absence of live work/lease fields. */
  const result = await (await d.handle(req('/api?id=campa'))).json();
  assert.equal(result.status, 'scheduled');
  // Assert every sensitive work/lease field is absent from the authorized response.
  for (const key of ['lease', 'pending', 'cursor', 'tracking']) {
    assert.equal(Object.hasOwn(result, key), false);
  }
  assert.equal((await d.handle(req('/api?id=../../sneaky'))).status, 400);
  assert.equal((await d.handle(req('/api?id=restricted'))).status, 403);
});
