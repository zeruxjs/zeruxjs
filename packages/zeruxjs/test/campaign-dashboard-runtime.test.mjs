import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeRuntimeServices } from '../dist/bootstrap/services.js';
import {
  createCampaignPlanner,
  createMemoryCampaignStore,
} from '@zeruxjs/email';
test('campaign dashboard is opt-in, generation-owned, session and scope guarded', async () => {
  /** Ordered service-close receipts verifying dependency-safe generation teardown. */
  const events = [];
  /** Isolated campaign state; no production campaign or durable store is touched. */
  const store = createMemoryCampaignStore();
  /** Explicit campaign planner over synthetic empty contacts and inert delivery callbacks. */
  const planner = createCampaignPlanner({
    store,
    now: () => 1000,
    source: {
      page: async () => ({ contacts: [], done: true, nextCursor: null }),
    },
    isSubscribed: async () => true,
    isSuppressed: async () => false,
    ensureMessage: async () => {},
    enqueue: async () => {},
  });
  /** Private dashboard registration with host authorization and CSRF fixtures. */
  const config = {
    email: {
      accounts: [],
      campaignDashboard: {
        planner,
        authorize: async () => ({ role: 'operator' }),
        verifyCsrf: async () => true,
        csrfToken: async () => 'abcdefghijklmnopqrstuvwxyz123456',
        authorizeCampaign: async () => true,
      },
    },
  };
  /** Injected service factories whose cleanup order is observable without external connections. */
  const providers = {
    database: async () => ({ close: () => events.push('db') }),
    cache: async () => ({ close: () => events.push('cache') }),
    email: async () => ({ close: () => events.push('email') }),
  };
  /** Generation owner exposing only its explicitly configured email routes. */
  const scope = await initializeRuntimeServices(
    config,
    process.cwd(),
    providers
  );
  assert.equal(config.email, undefined);
  /** Mounted email route selected from the current generation rather than a global router. */
  const route = scope
    .httpRoutes()
    .find((x) => x.pattern === '/_email/campaigns');
  assert.equal(route?.service, 'email');
  /** Synthetic dashboard or feedback response inspected before closing its owner. */
  const response = await route.handler(
    new Request('https://site.test/_email/campaigns')
  );
  assert.equal(response.status, 200);
  assert.doesNotMatch(
    await response.text(),
    /smtpPassword|recipient@example\.test/
  );
  await scope.close();
  assert.equal(scope.httpRoutes().length, 0);
  assert.deepEqual(events, ['email', 'cache', 'db']);
});
test('misconfigured campaign dashboard fails closed on startup', async () => {
  /** Private dashboard registration with host authorization and CSRF fixtures. */
  const config = {
    email: {
      accounts: [],
      campaignDashboard: { planner: {}, authorize: async () => true },
    },
  };
  /** Ordered service-close receipts verifying dependency-safe generation teardown. */
  const events = [];
  /** Injected dependency factories recording partial-startup rollback. */
  const p = {
    database: async () => ({ close: () => events.push('db') }),
    cache: async () => ({ close: () => events.push('cache') }),
    email: async () => ({ close: () => events.push('email') }),
  };
  await assert.rejects(
    initializeRuntimeServices(config, process.cwd(), p),
    /requires session auth/
  );
  assert.deepEqual(events, ['cache', 'db']);
});
test('provider feedback endpoint only mounted when explicitly signed-configured', async () => {
  /** Ordered service-close receipts verifying dependency-safe generation teardown. */
  const events = [];
  /** Injected dependency factories recording partial-startup rollback. */
  const p = {
    database: async () => ({ close: () => events.push('db') }),
    cache: async () => ({ close: () => events.push('cache') }),
    email: async () => ({ close: () => events.push('email') }),
  };
  /** Explicitly enabled feedback parser with a rejecting signature policy. */
  const feedback = {
    enabled: true,
    suppression: { recordFeedback: async () => ({ blocked: true }) },
    verifySignature: async () => false,
    parse: async () => [],
  };
  /** Generation owner exposing only its explicitly configured email routes. */
  const scope = await initializeRuntimeServices(
    { email: { accounts: [], marketingFeedback: feedback } },
    process.cwd(),
    p
  );
  /** Mounted email route selected from the current generation rather than a global router. */
  const route = scope
    .httpRoutes()
    .find((x) => x.pattern === '/_email/feedback');
  assert.ok(route);
  /** Synthetic dashboard or feedback response inspected before closing its owner. */
  const response = await route.handler(
    new Request('https://example.test/_email/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[]',
    })
  );
  assert.equal(response.status, 401);
  await scope.close();
  assert.equal(scope.httpRoutes().length, 0);
});
