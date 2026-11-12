import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  createEmailTrackingService,
  createAnalyticsCollector,
} from '../dist/index.js';

/** Synthetic shared test secret; never read from application state. */
const secret = 'Section44-secret-'.repeat(4);
/** Create a local encrypted-tracking handler and capture its synthetic events.
 * @returns {object} Isolated fixture values for the following assertions.
 */
function tracking() {
  /** Synthetic source events or captured telemetry; no real recipient data. */
  const events = [];
  return {
    events,
    service: createEmailTrackingService({
      analytics: {
        track: async (event) => {
          events.push(event);
          return 'id';
        },
      },
      baseUrl: 'https://events.example.com',
      secret,
    }),
  };
}
/** Synthetic message/account/tracking policy with opaque labels. */
const htmlContext = {
  id: 'message-44',
  account: 'marketing',
  message: { tracking: { enabled: true, campaign: 'campaign-44' } },
};
/** Generated attribute URLs, or an inert fixture-only extraction helper.
 * @param {string} html - Inert authored fixture markup.
 * @returns {string[]} Generated attribute URLs, or an inert fixture-only extraction helper. */
const urls = (html) =>
  [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((x) => x[1]);

test('new signed tracking tokens encrypt destinations and metadata, and remain tamper-resistant', async () => {
  /** Local tracking fixture and captured synthetic observations. */
  const { events, service } = tracking();
  /** Synthetic HTTPS destination used to assert encrypted payload privacy. */
  const destination =
    'https://shop.example/orders?secretCustomerToken=private-in-query';
  /** Authored inert HTML fixture; tests verify wrapping/escaping without a browser. */
  const html = service.instrumentHtml(
    `<body><a href="${destination}">View</a></body>`,
    htmlContext
  );
  /** Generated signed click URL; handled locally by the fixture. */
  const click = urls(html).find((u) => u.includes('/click/'));
  /** Generated local open URL; no remote resource is fetched. */
  const open = urls(html).find((u) => u.includes('/open/'));
  assert.ok(click && open);
  /** Generated or deliberately malformed tracking/correlation token. */
  const token = click.split('/click/')[1];
  assert.match(token, /^v2\.[A-Za-z0-9_-]+$/);
  /** Decoded fixture ciphertext bytes; assertions ensure private labels are not readable. */
  const bytes = Buffer.from(token.split('.')[1], 'base64url').toString('utf8');
  assert.ok(
    !bytes.includes('secretCustomerToken') &&
      !bytes.includes('message-44') &&
      !bytes.includes('campaign-44')
  );
  /** Locally handled click response. */
  const clicked = await service.handle(new Request(click));
  assert.equal(clicked.status, 302);
  assert.equal(clicked.headers.get('location'), destination);
  assert.equal((await service.handle(new Request(open))).status, 200);
  assert.deepEqual(
    events.map((e) => e.name),
    ['email.click', 'email.open']
  );
  /** Deliberately altered wire token. */
  const corrupted = token.slice(0, -1) + (token.at(-1) === 'a' ? 'b' : 'a');
  assert.equal(
    (await service.handle(new Request(click.replace(token, corrupted)))).status,
    404
  );
});

test('previous-generation signed HMAC tokens remain valid until their original expiry', async () => {
  /** Local headless tracking fixture; no listening server. */
  const { service } = tracking();
  /** Inert legacy signed-token fixture, never executed as code. */
  const payload = Buffer.from(
    JSON.stringify({
      kind: 'click',
      id: 'legacy-1',
      account: 'marketing',
      campaign: 'old',
      url: 'https://shop.example/old?query=one',
      expires: Date.now() + 60000,
      nonce: 'legacy',
    })
  ).toString('base64url');
  /** Synthetic expected HMAC signature used for legacy compatibility. */
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  /** Actual operation receipt checked by the following assertions. */
  const result = await service.handle(
    new Request(
      `https://events.example.com/_analytics/email/click/${payload}.${mac}`
    )
  );
  assert.equal(result.status, 302);
  assert.equal(
    result.headers.get('location'),
    'https://shop.example/old?query=one'
  );
});

test('email instrumentation is idempotent and never rewrites unsubscribe or excluded anchors', () => {
  /** Local headless tracking fixture; no listening server. */
  const { service } = tracking();
  /** Borrowed original method or inert original HTML retained for comparison. */
  const original =
    '<html><body><a href="https://shop.example/normal">Normal</a>' +
    '<a href="https://shop.example/manage?unsubscribe=1">Unsubscribe query</a>' +
    '<a href="https://shop.example/manage?opt_out=true">Opt-out query</a>' +
    '<a href="https://shop.example/no" rel="noopener unsubscribe">Unsubscribe rel</a>' +
    '<a href="https://shop.example/no-track" data-no-track>Excluded</a>' +
    '<a data-tracking="off" href="https://shop.example/disabled">Disabled</a></body></html>';
  /** Instrumented HTML; fixtures verify opt-out preservation and idempotence. */
  const marked = service.instrumentHtml(original, htmlContext);
  assert.equal(urls(marked).filter((u) => u.includes('/click/')).length, 1);
  assert.equal(urls(marked).filter((u) => u.includes('/open/')).length, 1);
  assert.match(marked, /href="https:\/\/shop\.example\/manage\?unsubscribe=1"/);
  assert.match(marked, /href="https:\/\/shop\.example\/manage\?opt_out=true"/);
  assert.match(
    marked,
    /href="https:\/\/shop\.example\/no" rel="noopener unsubscribe"/
  );
  /** Second fixture receipt, service, key or lease for replay/rotation/isolation checks. */
  const second = service.instrumentHtml(marked, htmlContext);
  assert.equal(
    second,
    marked,
    'renderer retries must not add tracking layers or multiple pixels'
  );
});

/** Local request builder with explicit body and policy headers.
 * @param {string|ReadableStream} body - Local request body, never fetched remotely.
 * @param {object} headers - Explicit synthetic request headers.
 * @returns {Request} Local request builder with explicit body and policy headers. */
const collectorRequest = (body, headers = {}) =>
  new Request('https://events.example.com/_analytics/collect', {
    method: 'POST',
    headers: {
      origin: 'https://app.example.com',
      'content-type': 'application/json',
      ...headers,
    },
    body,
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  });
/** Create a local collector with explicit finite parsing limits and no real storage.
 * @param {object} options - Explicit fixture options.
 * @returns {object} Isolated fixture values for the following assertions.
 */
function collector(options = {}) {
  return createAnalyticsCollector({
    analytics: { track: async () => undefined },
    allowedOrigins: ['https://app.example.com'],
    bodyTimeoutMs: 25,
    ...options,
  });
}

test('slow request body times out with 408, keeps CORS response readable and releases the concurrency slot', async () => {
  let cancelCalls = 0;
  /** Deliberately nonsettling stream exercising parser timeout/cancellation. */
  const stuck = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('{'));
    },
    cancel() {
      cancelCalls++;
    },
  });
  /** Collector instance with explicit finite parser limits. */
  const instance = collector({ maxConcurrentReads: 1 });
  /** Outstanding local handler response promise. */
  const processing = instance.handler(collectorRequest(stuck));
  await new Promise((r) => setTimeout(r, 5));
  /** Admission-rejected response while the fixture parser slot is occupied. */
  const throttled = await instance.handler(
    collectorRequest(JSON.stringify({ name: 'page.view' }))
  );
  assert.equal(throttled.status, 429);
  assert.equal(
    throttled.headers.get('access-control-allow-origin'),
    'https://app.example.com'
  );
  /** Bounded parser deadline response. */
  const timedOut = await processing;
  assert.equal(timedOut.status, 408);
  assert.equal(
    timedOut.headers.get('access-control-allow-origin'),
    'https://app.example.com'
  );
  assert.equal(cancelCalls, 1);
  assert.equal(
    (await instance.handler(collectorRequest('{"name":"ok"}'))).status,
    204
  );
});

test('oversized indicated bodies and invalid collector limits fail without storage access', async () => {
  /** Collector instance with explicit finite parser limits. */
  const instance = collector({ maxBodyBytes: 256 });
  assert.equal(
    (
      await instance.handler(
        collectorRequest('{"name":"view"}', { 'content-length': '10000' })
      )
    ).status,
    413
  );
  assert.equal((await instance.handler(collectorRequest('{oops'))).status, 400);
  assert.throws(
    () => collector({ bodyTimeoutMs: 0 }),
    /Invalid collection limits/
  );
  assert.throws(
    () => collector({ maxConcurrentReads: 0 }),
    /Invalid collection limits/
  );
});

test('links too long to decode remain unwrapped and do not break mail rendering', () => {
  /** Local headless tracking fixture; no listening server. */
  const { service } = tracking();
  /** Oversized inert URL fixture expected to remain unwrapped. */
  const huge =
    'https://shop.example/docs?state=' + encodeURIComponent('x'.repeat(3900));
  /** Authored inert HTML fixture; tests verify wrapping/escaping without a browser. */
  const html = `<body><a href="${huge}">Docs</a></body>`;
  /** Actual instrumentation output checked for size-safe fallback. */
  const output = service.instrumentHtml(html, htmlContext);
  assert.ok(output.includes(`href="${huge}"`));
  assert.equal(urls(output).filter((u) => u.includes('/click/')).length, 0);
  assert.equal(urls(output).filter((u) => u.includes('/open/')).length, 1);
});
