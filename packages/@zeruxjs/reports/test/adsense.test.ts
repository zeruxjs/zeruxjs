import { createFixtureCleanup } from './fixture-cleanup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReportSourceRegistry } from '../dist/sources.js';
import {
  createAdSenseReportSource,
  createGoogleReportCredentials,
  ADSENSE_READONLY_SCOPE,
} from '../dist/adsense.js';
/** Synthetic verified grant tuple, never an operator identity. */
const binding = {
  tenant: 'tenant',
  site: 'shop',
  principal: 'reader',
  credentialPartition: 'adsense-grant',
};
/** Explicit finite fixture field/unit catalog, not provider discovery. */
const schema = {
  version: 1,
  fields: [
    { name: 'DATE', kind: 'dimension', type: 'string' },
    {
      name: 'ESTIMATED_EARNINGS',
      kind: 'metric',
      type: 'decimal',
      unit: 'currency:USD',
    },
  ],
};
/** Finite fixture query plan; no arbitrary provider URL or identity fields. */
const query = {
  source: 'ads',
  schemaVersion: 1,
  dimensions: ['DATE'],
  metrics: ['ESTIMATED_EARNINGS'],
  from: '2026-01-01',
  to: '2026-01-02',
  limit: 10,
};
/** Synthetic provider response builder retaining decimal precision.
 * @returns {unknown} Result of this documented fixture projection or explicit failure.
 */
const payload = () => ({
  headers: [
    { name: 'DATE', type: 'DIMENSION' },
    {
      name: 'ESTIMATED_EARNINGS',
      type: 'METRIC_CURRENCY',
      currencyCode: 'USD',
    },
  ],
  totalMatchedRows: '12',
  startDate: { year: 2026, month: 1, day: 1 },
  endDate: { year: 2026, month: 1, day: 2 },
  rows: [
    { cells: [{ value: '2026-01-01' }, { value: '12.0123456789012345' }] },
  ],
});
/** Borrowed synthetic short-lived token provider; no real grant is loaded. */
const credentials = {
  /** Return only the synthetic fixed-scope token; no OAuth network grant is acquired.
   * @returns {Promise<object>} Explicit fixture result or intentional failure; no live-provider qualification.
   */
  async getAccessToken() {
    return {
      accessToken: 'fixture-only',
      expiresAt: Date.now() + 60000,
      scopes: [ADSENSE_READONLY_SCOPE],
    };
  },
};
/** Create an explicit synthetic fixed-account adapter using the injected transport.
 * @param {function} fetch - Explicit synthetic query/callback/options value, never a live credential or arbitrary source.
 * @returns {object} Explicit fixture result or intentional failure; no live-provider qualification.
 */
function source(fetch) {
  return createAdSenseReportSource({
    binding,
    credentials,
    account: 'pub-123',
    domain: 'shop.example.com',
    schema,
    fetch,
    maxAttempts: 1,
  });
}
test('AdSense fixed account/domain, explicit timezone/currency, truncated precise decimals', async (t) => {
  /** Ordered ownership for this isolated fixture, never a live provider lifecycle. */
  const cleanup = createFixtureCleanup(t);

  /** Owned explicit source registry drained/disposed by ordered fixture cleanup. */
  const registry = createReportSourceRegistry({ authorize: () => true });
  // Register fixture ownership before later assertions can fail.
  cleanup('source', () => registry.close());
  registry.register(
    'ads',
    source(async (url, init) => {
      /** Parsed code-owned provider URL checked against exact fixture expectations. */
      const u = new URL(url);
      assert.equal(u.origin, 'https://adsense.googleapis.com');
      assert.equal(u.pathname, '/v2/accounts/pub-123/reports:generate');
      assert.equal(
        u.searchParams.get('filters'),
        'DOMAIN_CODE==shop.example.com'
      );
      assert.equal(u.searchParams.get('reportingTimeZone'), 'GOOGLE_TIME_ZONE');
      assert.equal(u.searchParams.get('currencyCode'), 'USD');
      assert.equal(init.redirect, 'error');
      return Response.json(payload());
    })
  );
  /** Explicit tested projection/receipt; unknown or missing data must not become fake zeroes. */
  const result = await registry.query(query, binding);
  assert.equal(result.rows[0][1], '12.0123456789012345');
  assert.equal(result.timeZone, 'America/Los_Angeles');
  assert(result.coverage.truncated);
  await assert.rejects(
    registry.query(query, { ...binding, credentialPartition: 'other' }),
    { code: 'DENIED' }
  );
  await registry.close();
});
test('mixed source schemas reject a GA field in AdSense and invalid currency', async (t) => {
  /** Ordered ownership for this isolated fixture, never a live provider lifecycle. */
  const cleanup = createFixtureCleanup(t);

  /** Owned explicit source registry drained/disposed by ordered fixture cleanup. */
  const registry = createReportSourceRegistry({ authorize: () => true });
  // Register fixture ownership before later assertions can fail.
  cleanup('source', () => registry.close());
  registry.register(
    'ads',
    source(async () => {
      /** Fresh mutable synthetic response/page used only to inject a validation failure. */
      const p = payload();
      p.headers[1].currencyCode = 'EUR';
      return Response.json(p);
    })
  );
  assert.throws(
    () => registry.validatePlan([{ ...query, metrics: ['eventCount'] }]),
    { code: 'INVALID_QUERY' }
  );
  await assert.rejects(registry.query(query, binding), {
    code: 'INVALID_RESULT',
  });
  await registry.close();
  assert.throws(
    () =>
      createAdSenseReportSource({
        binding,
        credentials,
        account: '../other',
        domain: 'shop.example.com',
        schema,
      }),
    { code: 'INVALID_QUERY' }
  );
});
test('on-demand OAuth refresh is fixed-host and bounded; secrets stay out of errors and disposal prevents refresh', async (t) => {
  /** Ordered ownership for this isolated fixture, never a live provider lifecycle. */
  const cleanup = createFixtureCleanup(t);

  let calls = 0;
  /** Owned on-demand synthetic credential helper, disposed after registry work. */
  const credential = createGoogleReportCredentials({
    clientId: 'fixture-id',
    clientSecret: 'fixture-secret',
    refreshToken: 'fixture-refresh',
    scope: ADSENSE_READONLY_SCOPE,
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, 'https://oauth2.googleapis.com/token');
      assert.equal(init.redirect, 'error');
      assert.equal(
        new URLSearchParams(init.body).get('grant_type'),
        'refresh_token'
      );
      return Response.json({
        access_token: 'fixture-access',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: ADSENSE_READONLY_SCOPE,
      });
    },
  });
  // Register fixture ownership before later assertions can fail.
  cleanup('credentials', () => credential.dispose());
  assert.equal(calls, 0);
  /** Private synthetic token receipt; never a log label. */
  const token = await credential.getAccessToken({
    scope: ADSENSE_READONLY_SCOPE,
    signal: new AbortController().signal,
  });
  assert(token.expiresAt > Date.now());
  assert.equal(calls, 1);
  await credential.dispose();
  assert.throws(
    () =>
      credential.getAccessToken({
        scope: ADSENSE_READONLY_SCOPE,
        signal: new AbortController().signal,
      }),
    { code: 'CLOSED' }
  );
  /** Owned deliberately failing synthetic credential helper. */
  const failed = createGoogleReportCredentials({
    clientId: 'fixture-id',
    clientSecret: 'fixture-secret',
    refreshToken: 'fixture-refresh',
    scope: ADSENSE_READONLY_SCOPE,
    fetch: async () => {
      throw Error('fixture-secret');
    },
  });
  // Register fixture ownership before later assertions can fail.
  cleanup('credentials', () => failed.dispose());
  await assert.rejects(
    failed.getAccessToken({
      scope: ADSENSE_READONLY_SCOPE,
      signal: new AbortController().signal,
    }),
    (e) =>
      e.code === 'UNAVAILABLE' && !JSON.stringify(e).includes('fixture-secret')
  );
  await failed.dispose();
});
test('source disposal aborts in-flight credential refresh before any provider request', async (t) => {
  /** Ordered ownership for this isolated fixture, never a live provider lifecycle. */
  const cleanup = createFixtureCleanup(t);

  let ready;
  /** Observed injected transport-start barrier; actual owner cancellation remains separate. */
  const started = new Promise((r) => (ready = r));
  let cancelled = false;
  /** Owned on-demand synthetic credential helper, disposed after registry work. */
  const credential = createGoogleReportCredentials({
    clientId: 'fixture-id',
    clientSecret: 'fixture-secret',
    refreshToken: 'fixture-refresh',
    scope: ADSENSE_READONLY_SCOPE,
    fetch: async (_url, { signal }) => {
      ready();
      return new Promise((_, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            cancelled = true;
            reject(Error('cancelled'));
          },
          { once: true }
        )
      );
    },
  });
  // Register fixture ownership before later assertions can fail.
  cleanup('credentials', () => credential.dispose());
  /** Owned explicit source registry drained/disposed by ordered fixture cleanup. */
  const registry = createReportSourceRegistry({ authorize: () => true });
  // Register fixture ownership before later assertions can fail.
  cleanup('source', () => registry.close());
  registry.register(
    'ads',
    createAdSenseReportSource({
      binding,
      credentials: credential,
      account: 'pub-123',
      domain: 'shop.example.com',
      schema,
      fetch: async () => {
        throw Error('must not call report');
      },
    })
  );
  /** Observed in-flight query/handler result; test teardown settles its owner before awaiting it. */
  const job = registry.query(query, binding);
  // Register fixture ownership before later assertions can fail.
  void job.catch(() => {});
  cleanup('pending', async () => {
    await Promise.allSettled([job]);
  });
  await started;
  await registry.close();
  await assert.rejects(job, { code: 'CANCELLED' });
  await credential.dispose();
  assert(cancelled);
});
