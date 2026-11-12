import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAnalyticsCollector,
  createEmailTrackingService,
} from '../dist/index.js';

/** Nonsettling injected promise factory used to verify bounded waits and admission.
 * @returns {Promise<never>} Nonsettling injected promise factory used to verify bounded waits and admission. */
const never = () => new Promise(() => {});

test('hung email storage and event callback cannot stall a delivery or click redirect', async () => {
  let trackingAttempts = 0,
    warnings = 0;
  /** Local explicitly opted-in tracking facade; no listening server is started. */
  const service = createEmailTrackingService({
    baseUrl: 'https://events.example',
    secret: 'deadline-test-secret-'.repeat(3),
    analytics: {
      track: () => {
        trackingAttempts++;
        return never();
      },
    },
    onEvent: () => never(),
    telemetryTimeoutMs: 15,
    maxPendingTelemetry: 1,
    onWarning: () => warnings++,
  });
  /** Inert instrumented HTML; no JavaScript or browser execution occurs. */
  const markup = service.instrumentHtml(
    '<a href="https://site.example/product">Product</a>',
    {
      id: 'id-43',
      account: 'transactional',
      message: { tracking: { enabled: true, campaign: 'october' } },
    }
  );
  /** Generated attribute URLs, or an inert fixture-only extraction helper. */
  const urls = [...markup.matchAll(/(?:href|src)="([^"]+)"/g)].map((x) => x[1]);
  /** Generated signed click URL; handled locally by the fixture. */
  const click = urls.find((x) => x.includes('/click/'));
  /** Generated signed pixel URL; no external request is made. */
  const pixel = urls.find((x) => x.includes('/open/'));
  /** Test start time used only for a generous local deadline bound. */
  const start = Date.now();
  await service.onSent({
    id: 'id-43',
    account: 'transactional',
    message: { tracking: { enabled: true } },
  });
  /** Locally handled click response. */
  const clicked = await service.handle(new Request(click));
  /** Locally handled pixel response. */
  const opened = await service.handle(new Request(pixel));
  assert.equal(clicked.status, 302);
  assert.equal(opened.status, 200);
  assert.ok(
    Date.now() - start < 1500,
    'tracked redirects and pixels must have a deadline'
  );
  assert.equal(
    trackingAttempts,
    1,
    'unresolved writes are counted against concurrency cap'
  );
  assert.equal(warnings, 1, 'telemetry warning is deduplicated');
});

test('hung collector writes return 204 and do not create unbounded pending operations', async () => {
  let attempts = 0;
  /** Headless collector bound only to synthetic/injected tracking. */
  const collector = createAnalyticsCollector({
    analytics: {
      track: () => {
        attempts++;
        return never();
      },
    },
    serverToken: 'key',
    storageTimeoutMs: 15,
    maxPendingEvents: 1,
  });
  /** Synthetic Fetch request builder; it performs no outbound network call.
   * @returns {Request} Synthetic Fetch request builder; it performs no outbound network call. */
  const request = () =>
    new Request('https://events.example/_analytics/collect', {
      method: 'POST',
      headers: {
        authorization: 'Bearer key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'page.view' }),
    });
  /** Test start time used only for a generous local deadline bound. */
  const start = Date.now();
  assert.equal((await collector.handler(request())).status, 204);
  assert.equal((await collector.handler(request())).status, 204);
  assert.ok(Date.now() - start < 1500, 'collector responses must be bounded');
  assert.equal(
    attempts,
    1,
    'unresolved storage request cannot spawn unlimited writes'
  );
});
