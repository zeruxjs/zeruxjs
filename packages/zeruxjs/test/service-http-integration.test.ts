import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  createServiceScope,
  initializeRuntimeServices,
} from '../dist/bootstrap/services.js';
import {
  registerServiceHttpRoutes,
  serviceRouteOverlaps,
} from '../dist/bootstrap/service-http.js';

/** Create explicit optional tracking settings using a synthetic signing secret.
 * @returns {object} Opted-in fixture settings, never production credentials.
 */
const trackingSettings = () => ({
  enabled: true,
  baseUrl: 'https://events.example',
  secret: 'development-test-secret-'.repeat(3),
});
/** Inject inert dependencies while exercising real optional analytics/tracking factories.
 * @returns {object} Private service factory overrides for isolated integration tests.
 */
const providers = () => ({
  database: async () => null,
  cache: async () => null,
  // The default Analytics and tracking factories are exercised against the real package.
  email: async (_config, _files, _analytics, tracking) => ({
    tracking,
    /** Inert injected email close; this fixture acquires no SMTP transport.
     * @returns {void} No external resource needs release in this injected facade.
     */
    close() {},
  }),
});

/** Adapt generation service routes through the actual framework HTTP registrar.
 * @param {object} scope - Current service generation exposing authorized handlers.
 * @param {string[]} patterns - Existing application patterns checked for conflicts.
 * @returns {object[]} Registered Node-compatible route descriptors.
 */
function registeredHandlers(scope, patterns = []) {
  /** Generation route registrations projected through the real Node/Fetch adapter. */
  const routes = [];
  registerServiceHttpRoutes(
    {
      /** Retain the route produced by the real framework HTTP adapter.
       * @param {object} route - Adapted service route descriptor.
       * @returns {void} Appends only this fixture registration receipt.
       */
      addRoute(route) {
        routes.push(route);
      },
    },
    scope,
    patterns
  );
  return routes;
}
/** Match literal/parameter segments for the small isolated HTTP server fixture.
 * @param {object[]} routes - Explicit already validated fixture registrations.
 * @param {string} path - Relative request pathname.
 * @returns {object | undefined} First matching fixture route, if present.
 */
function match(routes, path) {
  return routes.find((route) => {
    /** Registered fixture route segments used for the small literal/parameter matcher. */
    const segments = route.pattern.split('/').filter(Boolean);
    /** Requested fixture path segments compared without evaluating route expressions. */
    const actual = path.split('/').filter(Boolean);
    return (
      actual.length === segments.length &&
      segments.every((part, i) => part[0] === ':' || part === actual[i])
    );
  });
}
/** Run a callback against an ephemeral loopback listener and always close native connections.
 * @param {object[]} routes - Explicit synthetic route descriptors to serve.
 * @param {(origin: string) => Promise<void>} callback - Authored integration assertions receiving the listener origin.
 * @returns {Promise<void>} Resolves after callback and native listener cleanup settle.
 */
async function withHttpServer(routes, callback) {
  /** Test-owned ephemeral loopback listener closed after its callback completes. */
  const server = createServer((req, res) => {
    /** Matched explicitly registered service route; absence returns the fixture 404. */
    const route = match(routes, new URL(req.url, 'http://localhost').pathname);
    if (!route) {
      res.writeHead(404);
      res.end();
      return;
    }
    /** Parsed explicit loopback request URL passed through the route adapter. */
    const url = new URL(req.url, 'http://localhost');
    Promise.resolve(route.handler({ req, res, url, method: req.method })).catch(
      (error) => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end(String(error));
        }
      }
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('configured analytics collector and email pixel/click routes mount and stream through Node HTTP', async () => {
  /** Private analytics/email settings consumed by service initialization. */
  const config = {
    analytics: {
      analytics: 'offline-connector',
      collector: {
        prefix: '/metrics',
        allowedOrigins: ['https://site.example'],
        serverToken: 'server-key',
      },
    },
    email: {
      accounts: [{ name: 'transactional' }],
      tracking: trackingSettings(),
    },
  };
  /** Service generation owner closed after its route/consent assertions settle. */
  const scope = await initializeRuntimeServices(
    config,
    process.cwd(),
    providers()
  );
  try {
    assert.equal(config.analytics, undefined);
    assert.equal(config.email, undefined);
    assert.deepEqual(
      scope
        .httpRoutes()
        .map((r) => r.pattern)
        .sort(),
      [
        '/_analytics/email/click/:token',
        '/_analytics/email/open/:token',
        '/metrics/collect',
      ]
    );
    /** Generation route registrations projected through the real Node/Fetch adapter. */
    const routes = registeredHandlers(scope);
    /** Borrowed email facade with explicit tracking or preference integration. */
    const email = scope.get('email');
    /** Instrumented authored email markup inspected for signed pixel/click URLs. */
    const html = email.tracking.instrumentHtml(
      '<a href="https://site.example/docs">Docs</a>',
      {
        id: 'mail-43',
        account: 'transactional',
        message: {
          tracking: { enabled: true, campaign: 'tracking-integration' },
        },
      }
    );
    /** Signed fixture pixel URL extracted from generated email markup; never fetched remotely. */
    const pixel = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
      .map((x) => x[1])
      .find((url) => url.includes('/open/'));
    /** Signed fixture redirect URL exercised only through its local mounted route. */
    const click = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
      .map((x) => x[1])
      .find((url) => url.includes('/click/'));
    assert.ok(pixel && click);
    await withHttpServer(routes, async (base) => {
      /** Explicit local collector endpoint URL used for origin/token authorization checks. */
      const collect = base + '/metrics/collect';
      /** Same-origin collector response preserving best-effort ingestion outage semantics. */
      const allowed = await fetch(collect, {
        method: 'POST',
        headers: {
          origin: 'https://site.example',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'page.view' }),
      });
      assert.equal(
        allowed.status,
        204,
        'analytics failures do not return server errors'
      );
      /** Unauthenticated collector response required to reject before ingestion. */
      const forbidden = await fetch(collect, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(forbidden.status, 403);
      /** Server-token-authorized collector response, independent of browser origin consent. */
      const server = await fetch(collect, {
        method: 'POST',
        headers: {
          authorization: 'Bearer server-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'purchase', source: 'server' }),
      });
      assert.equal(server.status, 204);
      /** Local signed pixel response checked for the expected image representation. */
      const opened = await fetch(base + new URL(pixel).pathname);
      assert.equal(opened.status, 200);
      assert.equal(opened.headers.get('content-type'), 'image/gif');
      /** Local signed click response inspected without following its external destination. */
      const clicked = await fetch(base + new URL(click).pathname, {
        redirect: 'manual',
      });
      assert.equal(clicked.status, 302);
      assert.equal(
        clicked.headers.get('location'),
        'https://site.example/docs'
      );
      /** Invalid token response required to reveal no private message data. */
      const invalid = await fetch(base + '/_analytics/email/open/bad');
      assert.equal(invalid.status, 404);
    });
  } finally {
    await scope.close();
  }
  assert.deepEqual(scope.httpRoutes(), []);
});

test('optional telemetry bootstrap failures do not break email and no tracking is implicit', async () => {
  /** Injected email dependency arguments proving optional analytics failure stays isolated. */
  const messages = [];
  /** Service generation with intentionally unavailable analytics and independently usable email. */
  const failed = await initializeRuntimeServices(
    {
      analytics: {
        analytics: 'events',
        collector: { allowedOrigins: ['https://site.example'] },
      },
      email: { accounts: [{ name: 'test' }], tracking: trackingSettings() },
    },
    process.cwd(),
    {
      ...providers(),
      analytics: async () => {
        throw Error('DB offline');
      },
      email: async (_config, _files, analytics, tracking) => {
        messages.push([analytics, tracking]);
        return { send: async () => 'delivered' };
      },
    }
  );
  try {
    assert.equal(messages[0][0], undefined);
    assert.ok(
      messages[0][1],
      'signed redirect remains usable even if analytics service failed'
    );
    assert.equal(await failed.get('email').send(), 'delivered');
    assert.equal(failed.httpRoutes().length, 2);
    assert.equal(
      failed.status().find((s) => s.name === 'analytics').state,
      'degraded'
    );
  } finally {
    await failed.close();
  }
  /** Explicitly disabled analytics/tracking generation that must mount no tracking routes. */
  const inactive = await initializeRuntimeServices(
    {
      analytics: {
        analytics: 'events',
        enabled: false,
        collector: { serverToken: 'token' },
      },
      email: {
        accounts: [{ name: 'test' }],
        tracking: { ...trackingSettings(), enabled: false },
      },
    },
    process.cwd(),
    providers()
  );
  try {
    assert.equal(inactive.httpRoutes().length, 0);
    assert.equal(inactive.get('email').tracking, undefined);
  } finally {
    await inactive.close();
  }
});

test('invalid tracking configuration emits a warning and leaves email service usable', async () => {
  /** Original console warning sink restored after bounded diagnostic capture. */
  const original = console.warn;
  /** Captured startup diagnostics checked without logging private configuration. */
  const warnings = [];
  console.warn = (...msg) => warnings.push(msg.join(' '));
  try {
    /** Service generation owner closed after its route/consent assertions settle. */
    const scope = await initializeRuntimeServices(
      {
        email: {
          accounts: [{ name: 'test' }],
          tracking: { ...trackingSettings(), secret: 'short' },
        },
      },
      process.cwd(),
      providers()
    );
    try {
      assert.equal(scope.get('email').tracking, undefined);
      assert.equal(scope.httpRoutes().length, 0);
      assert.equal(
        scope.status().find((s) => s.name === 'email').state,
        'degraded'
      );
    } finally {
      await scope.close();
    }
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = original;
  }
});

test('reserved routes cannot be intercepted by static, dynamic or catch-all paths', async () => {
  assert.equal(
    serviceRouteOverlaps('/metrics/collect', '/metrics/:name'),
    true
  );
  assert.equal(
    serviceRouteOverlaps('/metrics/collect', '/metrics/:name*'),
    true
  );
  assert.equal(serviceRouteOverlaps('/metrics/collect', '/docs/:name'), false);
  assert.equal(
    serviceRouteOverlaps('/metrics/collect', '/metrics/{collect}'),
    true
  );
  assert.equal(
    serviceRouteOverlaps(
      '/_analytics/email/click/:token',
      '/_analytics/email/click/:other'
    ),
    true
  );
  /** Service generation owner closed after its route/consent assertions settle. */
  const scope = createServiceScope();
  scope.addHttpRoutes('analytics', [
    {
      pattern: '/metrics/collect',
      handler: () => new Response(null, { status: 204 }),
    },
  ]);
  assert.throws(
    () =>
      scope.addHttpRoutes('email', [
        { pattern: '/a', handler: () => new Response(null) },
        { pattern: '/a', handler: () => new Response(null) },
      ]),
    /Duplicate/
  );
  assert.equal(
    scope.httpRoutes().length,
    1,
    'duplicate batch does not partially register routes'
  );
  for (const conflicting of [
    '/metrics/collect',
    '/metrics/:other',
    '/metrics/:rest*',
  ]) {
    assert.throws(() => registeredHandlers(scope, [conflicting]), /conflicts/);
  }
  /** Generation route registrations projected through the real Node/Fetch adapter. */
  const routes = registeredHandlers(scope, ['/unrelated']);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].source, 'service:analytics');
  assert.equal(routes[0].meta.streamBody, true);
  await scope.close();
});

test('invalid tracking endpoint registration disables link instrumentation instead of emitting broken URLs', async () => {
  /** Captured startup diagnostics checked without logging private configuration. */
  const warnings = [];
  /** Original console warning sink restored after bounded diagnostic capture. */
  const original = console.warn;
  console.warn = (...msg) => warnings.push(msg.join(' '));
  try {
    /** Service generation owner closed after its route/consent assertions settle. */
    const scope = await initializeRuntimeServices(
      {
        analytics: {
          analytics: 'missing',
          collector: { prefix: '/_analytics/email', serverToken: 'token' },
        },
        email: { accounts: [{ name: 'test' }], tracking: trackingSettings() },
      },
      process.cwd(),
      {
        ...providers(),
        analyticsCollector: async () => ({
          routes: () => [
            {
              pattern: '/_analytics/email/open/:token',
              handler: () => new Response(),
            },
          ],
        }),
      }
    );
    try {
      assert.equal(scope.get('email').tracking, undefined);
      assert.equal(
        scope.httpRoutes().length,
        1,
        'collector registration persists; conflicting email routes are rejected'
      );
      assert.equal(
        scope.status().find((s) => s.name === 'email').state,
        'degraded'
      );
    } finally {
      await scope.close();
    }
    assert.ok(warnings.some((w) => w.includes('Tracking routes unavailable')));
  } finally {
    console.warn = original;
  }
});

test('real application bootstrap automatically exposes collector and signed email tracking routes', async () => {
  /** Actual runtime bootstrap loaded only for the isolated HTTP fixture. */
  const { bootstrapApplication } = await import('../dist/bootstrap/runtime.js');
  /** Native temporary-file helpers confined to this synthetic runtime root. */
  const fs = await import('node:fs/promises');
  /** Native temporary-directory locator; no operator application path is used. */
  const os = await import('node:os');
  /** Native path helper constructing only isolated fixture paths. */
  const path = await import('node:path');
  /** Temporary runtime project removed after service and listener shutdown. */
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zerux-telemetry-'));
  /** Synthetic transport receipts; no SMTP provider or real recipient is contacted. */
  const emailMessages = [];
  /** Private analytics/email settings consumed by service initialization. */
  const config = {
    server: { allowedDomains: ['localhost'] },
    analytics: {
      analytics: 'missing',
      collector: { prefix: '/metrics', serverToken: 'server-key' },
    },
    email: {
      accounts: [
        {
          name: 'transactional',
          transport: {
            sendMail: async (message) => {
              emailMessages.push(message);
              return {
                messageId: 'test-mail',
                accepted: ['recipient@example.net'],
                rejected: [],
              };
            },
          },
        },
      ],
      tracking: trackingSettings(),
    },
  };
  /** Explicit fixed project layout preventing implicit source or app discovery. */
  const structure = {
    mode: 'fix',
    rootDir,
    serviceName: 'zerux',
    entryPointName: 'index',
    appDir: null,
    middlewareDirs: [],
    controllerDirs: [],
    composableDirs: [],
    pluginDirs: [],
    envFiles: [],
    publicDirs: [],
    outputDir: rootDir,
    raw: {},
  };
  let runtime;
  try {
    ({ runtime } = await bootstrapApplication(
      rootDir,
      'start',
      config,
      structure
    ));
    /** Test-owned ephemeral loopback listener closed after its callback completes. */
    const server = createServer(runtime.createHandler());
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    /** Ephemeral loopback origin of the isolated application handler. */
    const address = `http://127.0.0.1:${server.address().port}`;
    try {
      /** Borrowed email facade with explicit tracking or preference integration. */
      const email = runtime.serviceScope.get('email');
      /** Synthetic email transport receipt checked independently of optional analytics storage. */
      const send = await email.send(
        {
          from: 'author@example.net',
          to: 'recipient@example.net',
          subject: 'Integration message',
          html: '<a href="https://site.example/docs">Docs</a>',
          text: 'Docs',
          tracking: { enabled: true, campaign: 'launch' },
        },
        { htmlMode: 'trusted' }
      );
      assert.equal(send.messageId, 'test-mail');
      assert.equal(emailMessages.length, 1);
      /** Authored email markup or form payload inspected without executing embedded content. */
      const body = emailMessages[0].html;
      assert.match(body, /\/_analytics\/email\/open\//);
      assert.match(body, /\/_analytics\/email\/click\//);
      /** Extracted signed fixture URLs; requests replace only their origin with the loopback fixture. */
      const links = [...body.matchAll(/(?:href|src)="([^"]+)"/g)].map(
        (x) => x[1]
      );
      /** Signed fixture pixel URL extracted from generated email markup; never fetched remotely. */
      const pixel = links.find((x) => x.includes('/open/'));
      /** Signed fixture redirect URL exercised only through its local mounted route. */
      const click = links.find((x) => x.includes('/click/'));
      /** Mounted pixel route response proving configured tracking integration is reachable. */
      const pixelResult = await fetch(address + new URL(pixel).pathname, {
        headers: { host: 'localhost' },
      });
      assert.equal(pixelResult.status, 200);
      /** Mounted click response inspected with redirect following disabled. */
      const redirect = await fetch(address + new URL(click).pathname, {
        headers: { host: 'localhost' },
        redirect: 'manual',
      });
      assert.equal(redirect.status, 302);
      /** Authorized collector response preserving nonthrowing best-effort semantics. */
      const collected = await fetch(address + '/metrics/collect', {
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'application/json',
          authorization: 'Bearer server-key',
        },
        body: JSON.stringify({ name: 'page.view' }),
      });
      assert.equal(collected.status, 204);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await runtime?.closeServices();
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('collector read-timeout and concurrency limits flow from runtime config to HTTP service', async () => {
  /** Service generation owner closed after its route/consent assertions settle. */
  const scope = await initializeRuntimeServices(
    {
      analytics: {
        analytics: 'disconnected',
        collector: {
          serverToken: 'token',
          bodyTimeoutMs: 20,
          maxConcurrentReads: 1,
        },
      },
    },
    process.cwd(),
    providers()
  );
  try {
    /** Explicit generation collector route with request read/concurrency budgets. */
    const collector = scope
      .httpRoutes()
      .find((r) => r.pattern.endsWith('/collect'));
    assert.ok(collector);
    /** Controlled incomplete JSON body held open to exercise reader deadline ownership. */
    const stream = new ReadableStream({
      /** Produce one incomplete JSON fragment and retain the read until its deadline.
       * @param {ReadableStreamDefaultController} c - Injected collector request-body controller.
       * @returns {void} Enqueues only the controlled fragment.
       */
      start(c) {
        c.enqueue(new TextEncoder().encode('{'));
      },
    });
    /** Native-shaped collector POST whose incomplete stream must time out. */
    const request = new Request('https://events.example/_analytics/collect', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer token',
      },
      body: stream,
      duplex: 'half',
    });
    /** First active collector read retaining the configured single-reader slot. */
    const first = collector.handler(request);
    await new Promise((resolve) => setTimeout(resolve, 5));
    /** Concurrent collector request rejected before exceeding the reader budget. */
    const rejected = await collector.handler(
      new Request('https://events.example/_analytics/collect', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token',
        },
        body: '{"name":"sample"}',
      })
    );
    assert.equal(rejected.status, 429);
    assert.equal((await first).status, 408);
  } finally {
    await scope.close();
  }
});

test('framework tracking key rotation retains already-sent v2 and v3 links across service generations', async () => {
  /** Fixed synthetic retired signing key used only to verify historical link acceptance. */
  const oldSecret = 'old-email-tracking-secret-'.repeat(3);
  /** Explicit active fixture signing key with a validated public key identifier. */
  const current = {
    id: 'current_45',
    secret: 'new-email-tracking-secret-'.repeat(3),
  };
  /** Retired tracking generation used to issue the historical signed link. */
  const original = await initializeRuntimeServices(
    {
      email: {
        accounts: [{ name: 'marketing' }],
        tracking: {
          enabled: true,
          baseUrl: 'https://events.example',
          secret: oldSecret,
        },
      },
    },
    process.cwd(),
    providers()
  );
  /** Synthetic message/account metadata bound into generated tracking links. */
  const context = {
    id: 'm45',
    account: 'marketing',
    message: { tracking: { enabled: true, campaign: 'october' } },
  };
  /** Extract one signed authored link using the supplied generation tracking owner.
   * @param {object} scope - Active service scope with explicit email tracking.
   * @returns {string} Signed fixture link without exposing key material.
   */
  const linkFrom = (scope) => {
    /** Authored email markup or form payload inspected without executing embedded content. */
    const body = scope
      .get('email')
      .tracking.instrumentHtml(
        '<a href="https://site.example/goods">Goods</a>',
        context
      );
    return [...body.matchAll(/href="([^"]+)"/g)][0][1];
  };
  /** Historical signed link retained across service-generation key rotation. */
  const previouslySent = linkFrom(original);
  assert.match(previouslySent, /\/v2\./);
  await original.close();
  /** New generation accepting only its explicit current/previous tracking key policy. */
  const rotated = await initializeRuntimeServices(
    {
      email: {
        accounts: [{ name: 'marketing' }],
        tracking: {
          enabled: true,
          baseUrl: 'https://events.example',
          keyRing: { current, previous: [{ id: 'old_44', secret: oldSecret }] },
          acceptLegacyHmac: false,
        },
      },
    },
    process.cwd(),
    providers()
  );
  try {
    /** Generation route registrations projected through the real Node/Fetch adapter. */
    const routes = registeredHandlers(rotated);
    /** New versioned signed link emitted using the active key identifier. */
    const replacement = linkFrom(rotated);
    assert.match(replacement, /\/v3\.current_45\./);
    await withHttpServer(routes, async (base) => {
      for (const url of [previouslySent, replacement]) {
        /** Mounted historical/current signed link response checked without following redirects. */
        const response = await fetch(base + new URL(url).pathname, {
          redirect: 'manual',
        });
        assert.equal(response.status, 302);
        assert.equal(
          response.headers.get('location'),
          'https://site.example/goods'
        );
      }
    });
  } finally {
    await rotated.close();
  }
  // An invalid optional ring is fail-soft, not a reason to block delivery.
  /** Generation with an invalid optional tracking ring; delivery remains available without instrumentation. */
  const bad = await initializeRuntimeServices(
    {
      email: {
        accounts: [{ name: 'marketing' }],
        tracking: {
          enabled: true,
          baseUrl: 'https://events.example',
          keyRing: { current: { id: 'bad.id', secret: oldSecret } },
        },
      },
    },
    process.cwd(),
    providers()
  );
  try {
    assert.equal(bad.get('email').tracking, undefined);
    assert.deepEqual(bad.httpRoutes(), []);
  } finally {
    await bad.close();
  }
});

test('managed one-click unsubscribe route enforces consent for marketing mail across HTTP requests', async () => {
  /** Actual consent APIs explicitly loaded for synthetic cross-request marketing checks. */
  const { createMemoryConsentStore, createEmailPreferenceService } =
    await import('../../@zeruxjs/email/dist/index.js');
  /** Isolated shared consent fixture; no real contact or production persistence is touched. */
  const store = createMemoryConsentStore();
  /** Explicit private unsubscribe policy shared across the synthetic preference/service facades. */
  const preferencesConfig = {
    enabled: true,
    baseUrl: 'https://mail.example',
    secret: 'shared-unsubscribe-test-secret-'.repeat(3),
    store,
  };
  /** Injected transport receipts proving unsubscribe prevents later marketing sends. */
  const sent = [];
  /** Service generation owner closed after its route/consent assertions settle. */
  const scope = await initializeRuntimeServices(
    {
      email: {
        accounts: [
          {
            name: 'news',
            defaults: { from: 'news@example.com' },
            transport: {
              /** Record a synthetic transport acceptance without sending real mail.
               * @param {object} content - Prepared message after consent enforcement.
               * @returns {Promise<object>} Synthetic message ID and accepted-recipient receipt.
               */
              async sendMail(content) {
                sent.push(content);
                return { messageId: String(sent.length), accepted: content.to };
              },
            },
          },
        ],
        preferences: preferencesConfig,
      },
    },
    process.cwd(),
    {
      database: async () => null,
      cache: async () => null,
    }
  );
  try {
    /** Managed one-click unsubscribe route required to exist before consent assertions. */
    const endpoint = scope
      .httpRoutes()
      .find((r) => r.pattern === '/_zerux/email/unsubscribe/:token');
    assert.ok(endpoint, 'service route should be registered as email endpoint');
    /** Explicit preference facade sharing only the isolated synthetic consent store. */
    const external = createEmailPreferenceService(preferencesConfig);
    await assert.rejects(
      scope.get('email').send({
        to: 'reader@example.com',
        subject: 'Campaign',
        text: 'Hello',
        purpose: 'marketing',
      }),
      { code: 'EMAIL_CONSENT_REQUIRED' }
    );
    await external.subscribe('reader@example.com', {
      source: 'form',
      proof: 'verified-event',
    });
    await scope.get('email').send({
      to: 'reader@example.com',
      subject: 'Campaign',
      text: 'Hello',
      purpose: 'marketing',
    });
    /** Generated List-Unsubscribe header containing an opaque signed URL rather than recipient identity. */
    const header = sent[0].headers['List-Unsubscribe'];
    /** Opaque signed unsubscribe URL whose path is exercised only against loopback. */
    const link = header.slice(1, -1);
    assert.match(link, /https:\/\/mail\.example\/_zerux\/email\/unsubscribe\//);
    assert.doesNotMatch(link, /reader@example.com/);
    /** Generation route registrations projected through the real Node/Fetch adapter. */
    const routes = registeredHandlers(scope);
    await withHttpServer(routes, async (base) => {
      /** Parsed explicit loopback request URL passed through the route adapter. */
      const url = base + new URL(link).pathname;
      /** Scanner-style unsubscribe GET response that must preserve subscription state. */
      const get = await fetch(url);
      assert.equal(get.status, 200);
      assert.equal(
        await external.isSubscribed('reader@example.com'),
        true,
        'GET scanner must not unsubscribe'
      );
      /** Explicit one-click POST response checked before asserting suppression. */
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      });
      assert.equal(res.status, 200);
    });
    assert.equal(await external.isSubscribed('reader@example.com'), false);
    await assert.rejects(
      scope.get('email').send({
        to: 'reader@example.com',
        subject: 'Later',
        text: 'No',
        purpose: 'marketing',
      }),
      { code: 'EMAIL_CONSENT_REQUIRED' }
    );
    assert.equal(sent.length, 1);
  } finally {
    await scope.close();
  }
});

test('invalid preference route or configuration cannot silently enable marketing sends', async () => {
  /** Valid private preference settings reused by the malformed/conflicting policy fixtures. */
  const prefs = {
    enabled: true,
    baseUrl: 'https://mail.example',
    secret: 'preference-secret-for-integration-'.repeat(3),
  };
  await assert.rejects(
    initializeRuntimeServices(
      {
        email: {
          accounts: [{ name: 'news' }],
          preferences: { ...prefs, secret: 'short' },
        },
      },
      process.cwd(),
      providers()
    ),
    /32 bytes/
  );
  /** Startup promise required to reject duplicate unsubscribe route ownership. */
  const conflict = initializeRuntimeServices(
    {
      email: {
        accounts: [{ name: 'news' }],
        preferences: prefs,
        tracking: trackingSettings(),
      },
    },
    process.cwd(),
    {
      ...providers(),
      emailTracking: async () => ({
        routes: () => [
          {
            pattern: '/_zerux/email/unsubscribe/:token',
            handler: () => new Response(),
          },
        ],
      }),
    }
  );
  await assert.rejects(conflict, /Duplicate service HTTP route/);
});
