import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createCms, cmsRolePermissions } from '@zenixjs/core/cms';
import { createConnector } from '@zeruxjs/db-sqlite';
import { createZenixApplication } from 'zenixjs/application';
import { createSqliteSetupStore } from 'zenixjs/setup-store';
import { JSDOM } from 'jsdom';
import { validateComponentProps } from '@zeruxjs/accessibility';
/** Fixed synthetic transport origin, never a live deployment host. */
const origin = 'http://localhost:3000';
/** Fixed synthetic tenant/site scope used by isolated SQLite fixtures. */
const scope = { tenant: 'tenantA', site: 'siteA' };
/** Synthetic server-verified operator principal; not browser-supplied roles. */
const admin = {
  userId: 'operator',
  tenantId: scope.tenant,
  siteIds: [scope.site],
  permissions: cmsRolePermissions.administrator,
};
/** Synthetic least-privilege public reader distinct from operator write authority. */
const reader = {
  ...admin,
  userId: 'service-reader',
  permissions: cmsRolePermissions.reader,
};
/** Explicit synthetic opaque session bindings; no real credentials are used. */
const sessions = {
  admin: { principal: admin, key: 'admin-binding' },
  other: { principal: admin, key: 'other-binding' },
};
/** Own an isolated native SQLite core/application using synthetic host policies only.
 * @returns {Promise<object>} Fixture app/core/connector and explicit dependent-order close callback.
 */
async function fixture() {
  /** Owned temporary file-backed SQLite fixture root removed during close. */
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zx084-'));
  /** Owned native fixture connector; disconnect occurs after app/core drain. */
  const db = await createConnector({
    filename: path.join(dir, 'cms.sqlite'),
    driver: 'node',
  });
  let csrfAllowed = true,
    recoveryAllowed = false,
    setupSecret = true;
  /** Owned fixture CMS core with only synthetic principal verification. */
  const cms = await createCms({
    adapter: 'sqlite',
    connection: db,
    migrate: true,
    resolvePrincipal: async (p) => (p === admin || p === reader ? p : null),
    authorizeMedia: async () => false,
  });
  /** Borrowed setup journal over the owned fixture connector. */
  const setupStore = createSqliteSetupStore({ connection: db, migrate: true });
  /** Trusted synthetic host policies; deliberately permissive fixtures are not production auth. */
  const options = {
    cms,
    scope,
    setupStore,
    origin,
    basePath: '/cms',
    entryId: 'home',
    publicPrincipal: reader,
    authenticate: async (req) =>
      sessions[(req.headers.get('cookie') ?? '').replace('sid=', '')] ?? null,
    login: async (input) =>
      input.username === 'operator' && input.password === 'fixture-password'
        ? { cookie: 'sid=admin; HttpOnly; SameSite=Strict' }
        : null,
    logout: async () => ({
      cookie: 'sid=; Max-Age=0; HttpOnly; SameSite=Strict',
    }),
    authorize: async (_action, s) => s.key === 'admin-binding',
    csrf: {
      issue: async () => ({ token: 'csrf-fixture' }),
      verify: async (_r, _s, token) => csrfAllowed && token === 'csrf-fixture',
    },
    verifySetupSecret: async (secret) =>
      setupSecret && secret === 'host-secret',
    authorizeRecovery: async () => recoveryAllowed,
    admit: async () => true,
  };
  /** Owned application under test; await close before borrowed core/store shutdown. */
  const app = createZenixApplication(options);
  /** Build only synthetic requests to the fixture's fixed origin and mount.
   * @param {string} route - Authored synthetic route suffix.
   * @param {object} options - Fixture-only request transport choices.
   * @param {string} options.method - Native request method, default GET.
   * @param {string | object} options.body - Synthetic form content; never real credentials.
   * @param {string} options.cookie - Opaque synthetic session selection.
   * @param {object} options.headers - Explicit fixture header overrides for denial checks.
   * @returns {Request} Isolated in-memory request; construction starts no network operation.
   */
  function request(
    route,
    { method = 'GET', body, cookie = 'sid=admin', headers = {} } = {}
  ) {
    return new Request(options.origin + '/cms' + route, {
      method,
      headers: {
        cookie,
        ...(method === 'POST'
          ? {
              origin: options.origin,
              'content-type': 'application/x-www-form-urlencoded',
            }
          : {}),
        ...headers,
      },
      ...(body !== undefined
        ? {
            body:
              typeof body === 'string'
                ? body
                : new URLSearchParams({ csrf: 'csrf-fixture', ...body }),
          }
        : {}),
    });
  }
  /** Dispatch only a synthetic request into the owned application.
   * @param {string} route - Authored fixture route suffix.
   * @param {object} init - Synthetic request choices.
   * @returns {Promise<Response>} Actual fixture application response.
   */
  const call = (route, init) => app.handle(request(route, init));
  return {
    filename: path.join(dir, 'cms.sqlite'),
    app,
    cms,
    db,
    setupStore,
    options,
    request,
    call,
    setCsrf: (v) => (csrfAllowed = v),
    setRecovery: (v) => (recoveryAllowed = v),
    setSecret: (v) => (setupSecret = v),
    async close() {
      await app.close();
      await cms.close();
      await db.disconnect();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
/** Complete setup through the actual fixture application using synthetic operator proof.
 * @param {object} f - Owned isolated synthetic CMS fixture.
 * @returns {Promise<void>} Resolves only after checking the real setup response status.
 */
async function setup(f) {
  /** Completed synthetic response inspected without logging private content. */
  const response = await f.call('/setup', {
    method: 'POST',
    body: { secret: 'host-secret' },
  });
  assert.equal(response.status, 303, await response.text());
}
test('authenticated durable setup is single-use under concurrency; no role/origin/CSRF bypass', async () => {
  /** Owned isolated CMS fixture; every test closes it in finally. */
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.call('/setup', {
          method: 'POST',
          cookie: '',
          body: { secret: 'host-secret' },
        })
      ).status,
      303
    );
    assert.equal(
      (
        await f.call('/setup', {
          method: 'POST',
          body: { secret: 'host-secret' },
          headers: { origin: 'http://attacker.test' },
        })
      ).status,
      403
    );
    f.setCsrf(false);
    assert.equal(
      (
        await f.call('/setup', {
          method: 'POST',
          body: { secret: 'host-secret' },
        })
      ).status,
      403
    );
    f.setCsrf(true);
    f.setSecret(false);
    assert.equal(
      (
        await f.call('/setup', {
          method: 'POST',
          body: { secret: 'host-secret' },
        })
      ).status,
      403
    );
    f.setSecret(true);
    /** Concurrent synthetic setup responses; only one durable claim may succeed. */
    const results = await Promise.all([
      f.call('/setup', { method: 'POST', body: { secret: 'host-secret' } }),
      f.call('/setup', { method: 'POST', body: { secret: 'host-secret' } }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [303, 409]);
    assert.equal(
      (
        await f.call('/setup', {
          method: 'POST',
          body: { secret: 'host-secret' },
        })
      ).status,
      409
    );
    /** Second owned application borrowing the same durable setup state to test replay denial. */
    const replacement = createZenixApplication(f.options);
    try {
      assert.equal(
        (
          await replacement.handle(
            f.request('/setup', {
              method: 'POST',
              body: { secret: 'host-secret' },
            })
          )
        ).status,
        409
      );
    } finally {
      await replacement.close();
    }
  } finally {
    await f.close();
  }
});
test('login, denied editor, private session-bound previews, stored XSS and published-only page', async () => {
  /** Owned isolated CMS fixture; every test closes it in finally. */
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.call('/login', {
          method: 'POST',
          cookie: '',
          body: { username: 'operator', password: 'wrong' },
        })
      ).status,
      401
    );
    /** Synthetic successful login response checked for reviewed cookie policy. */
    const login = await f.call('/login', {
      method: 'POST',
      cookie: '',
      body: { username: 'operator', password: 'fixture-password' },
    });
    assert.equal(login.status, 303);
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    await setup(f);
    assert.equal(
      (await f.call('/editor', { cookie: 'sid=other' })).status,
      403
    );
    assert.equal(
      (
        await f.call('/save', {
          method: 'POST',
          body: 'csrf=csrf-fixture&expected=0&title=a&title=b&body=x',
        })
      ).status,
      400
    );
    /** Inert script-breaking content fixture; renderer must escape it as text. */
    const text = '<script>alert("stored")</script>';
    assert.equal(
      (
        await f.call('/save', {
          method: 'POST',
          body: { expected: '0', title: text, body: 'Draft only' },
        })
      ).status,
      303
    );
    assert.equal((await f.call('/page', { cookie: '' })).status, 404);
    assert.equal(
      (await f.call('/preview?token=guessed', { cookie: '' })).status,
      303
    );
    assert.equal((await f.call('/preview?token=guessed')).status, 404);
    /** Synthetic saved-preview issuance receipt. */
    const p = await f.call('/preview', {
      method: 'POST',
      body: { expected: '1' },
    });
    /** Private fixture-only preview URL kept out of diagnostics. */
    const previewPath = p.headers.get('location').replace('/cms', '');
    /** Completed synthetic response inspected without logging private content. */
    const response = await f.call(previewPath);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.doesNotMatch(await response.text(), /<script>/i);
    assert.equal(
      (await f.call(previewPath, { cookie: 'sid=other' })).status,
      403
    );
    assert.equal(
      (await f.call('/publish', { method: 'POST', body: { expected: '1' } }))
        .status,
      303
    );
    /** Synthetic published-only response checked for privacy and output escaping. */
    const page = await f.call('/page', { cookie: '' });
    assert.equal(page.status, 200);
    /** Completed public HTML inspected in memory without leaking private form tokens. */
    const html = await page.text();
    assert.match(html, /&lt;script&gt;/i);
    assert.match(html, /Draft only/);
    assert.doesNotMatch(html, /csrf-fixture|sid=|host-secret/);
    assert.match(page.headers.get('content-security-policy'), /default-src/);
    assert.equal(
      (await f.call('/page', { method: 'HEAD', cookie: '' })).body,
      null
    );
    assert.equal(
      (
        await f.call('/save', {
          method: 'POST',
          body: { expected: '2', title: 'Unpublished', body: 'New draft' },
        })
      ).status,
      303
    );
    assert.doesNotMatch(
      await (await f.call('/page', { cookie: '' })).text(),
      /New draft/
    );
    /** Synthetic authorized editor response used for label/control checks. */
    const editor = await f.call('/editor');
    /** Owned jsdom realm; finally closes it after accessibility assertions. */
    const dom = new JSDOM(await editor.text());
    try {
      for (const control of dom.window.document.querySelectorAll(
        'input:not([type=hidden]),textarea'
      )) {
        assert.ok(
          dom.window.document.querySelector('label[for="' + control.id + '"]')
        );
        assert.equal(
          validateComponentProps(
            control,
            { label: control.getAttribute('aria-label') },
            { root: dom.window.document, requireLabel: true }
          ).length,
          0
        );
      }
      assert.equal(
        dom.window.document.querySelector('textarea').value,
        'New draft'
      );
    } finally {
      dom.window.close();
    }
  } finally {
    await f.close();
  }
});
test('interrupted setup remains claimed and needs trusted operator recovery', async () => {
  /** Owned isolated CMS fixture; every test closes it in finally. */
  const f = await fixture();
  let fail = true;
  /** Borrowed core function restored only through fixture teardown after fault injection. */
  const original = f.cms.registerContentType;
  f.cms.registerContentType = (...args) =>
    fail ? Promise.reject(Error('private-db-secret')) : original(...args);
  try {
    /** Synthetic setup failure response; private dependency cause must remain redacted. */
    const broken = await f.call('/setup', {
      method: 'POST',
      body: { secret: 'host-secret' },
    });
    assert.equal(broken.status, 503);
    assert.doesNotMatch(await broken.text(), /private-db-secret/);
    assert.equal(
      (
        await f.call('/setup', {
          method: 'POST',
          body: { secret: 'host-secret' },
        })
      ).status,
      409
    );
    await assert.rejects(f.app.recoverSetup(sessions.admin, 'untrusted'));
    fail = false;
    f.setRecovery(true);
    await f.app.recoverSetup(sessions.admin, 'operator-proof');
    assert.equal((await f.call('/admin')).status, 200);
    await assert.rejects(f.app.recoverSetup(sessions.admin, 'operator-proof'));
  } finally {
    await f.close();
  }
});
test('actual Zerux Fetch registration binds reviewed origin rather than its neutral URL', async () => {
  /** Owned isolated CMS fixture; every test closes it in finally. */
  const f = await fixture();
  /** Fixture-only route registrations used to exercise real Fetch transport binding. */
  const routes = [];
  /** Owned ephemeral loopback fixture server closed in finally; no user app starts. */
  const server = http.createServer(async (req, res) => {
    try {
      /** Exact fixture handler selected from this application's explicit registrations. */
      const route = routes.find(
        (r) => r.pattern === new URL(req.url, 'http://localhost').pathname
      );
      if (!route) {
        res.writeHead(404).end();
        return;
      }
      await route.handler({
        req,
        res,
        url: new URL(req.url, 'http://localhost'),
        method: req.method,
      });
    } catch {
      res.destroy();
    }
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    f.options.origin = 'http://127.0.0.1:' + server.address().port;
    /** Owned application under test; await close before borrowed core/store shutdown. */
    const app = createZenixApplication(f.options);
    try {
      app.install({ addRoute: (r) => routes.push(r) });
      /** Completed synthetic response inspected without logging private content. */
      const response = await fetch(f.options.origin + '/cms/login');
      assert.equal(response.status, 200);
      assert.match(await response.text(), /<form/);
      /** Synthetic untrusted Host request result; forwarded claims grant no authority. */
      const denied = await new Promise((resolve, reject) => {
        /** Owned synthetic loopback request; response bytes are drained before settlement. */
        const request = http.get(
          {
            host: '127.0.0.1',
            port: server.address().port,
            path: '/cms/login',
            headers: { host: 'evil.test' },
          },
          (r) => {
            r.resume();
            r.on('end', () => resolve(r.statusCode));
          }
        );
        request.on('error', reject);
      });
      assert.equal(denied, 403);
    } finally {
      await app.close();
    }
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await f.close();
  }
});
test('close cancels cooperative host authentication, clears previews and leaves borrowed core/store open', async () => {
  /** Owned isolated CMS fixture; every test closes it in finally. */
  const f = await fixture();
  let started;
  /** Barrier proving cooperative host authentication started before application close. */
  const began = new Promise((r) => (started = r));
  /** Owned application under test; await close before borrowed core/store shutdown. */
  const app = createZenixApplication({
    ...f.options,
    authenticate: (request) =>
      new Promise((resolve, reject) => {
        started();
        request.signal.addEventListener(
          'abort',
          () => reject(Error('private cancellation cause')),
          { once: true }
        );
      }),
  });
  try {
    /** Completed synthetic response inspected without logging private content. */
    const response = app.handle(f.request('/admin'));
    await began;
    await app.close();
    assert.equal((await response).status, 503);
    assert.equal((await app.handle(f.request('/login'))).status, 503);
    assert.equal(await f.cms.readSite(scope, admin), null);
    assert.equal(await f.setupStore.read('a'.repeat(64)), null);
  } finally {
    await app.close();
    await f.close();
  }
});
test('completed setup survives closing/reopening the durable native connection', async () => {
  /** Owned isolated CMS fixture; every test closes it in finally. */
  const f = await fixture();
  let db, cms, app;
  try {
    await setup(f);
    await f.app.close();
    await f.cms.close();
    await f.db.disconnect();
    db = await createConnector({ filename: f.filename, driver: 'node' });
    cms = await createCms({
      adapter: 'sqlite',
      connection: db,
      migrate: false,
      resolvePrincipal: (p) => (p === admin || p === reader ? p : null),
      authorizeMedia: () => false,
    });
    /** Borrowed setup journal on a reopened owned native fixture connection. */
    const store = createSqliteSetupStore({ connection: db, migrate: false });
    app = createZenixApplication({ ...f.options, cms, setupStore: store });
    /** Completed synthetic response inspected without logging private content. */
    const response = await app.handle(
      f.request('/setup', { method: 'POST', body: { secret: 'host-secret' } })
    );
    assert.equal(response.status, 409);
    assert.equal((await app.handle(f.request('/admin'))).status, 200);
  } finally {
    await app?.close();
    await cms?.close();
    await db?.disconnect();
    await f.close();
  }
});
test('expired preview fails closed and unreviewed plugin configuration rejects', async () => {
  /** Owned isolated CMS fixture; every test closes it in finally. */
  const f = await fixture();
  /** Borrowed host clock restored in finally after preview-expiry simulation. */
  const clock = Date.now;
  try {
    assert.throws(
      () => createZenixApplication({ ...f.options, plugins: ['unreviewed'] }),
      /Unknown/
    );
    await setup(f);
    await f.call('/save', {
      method: 'POST',
      body: { expected: '0', title: 'Private', body: 'Draft' },
    });
    /** Synthetic preview issuance response before the clock advances. */
    const receipt = await f.call('/preview', {
      method: 'POST',
      body: { expected: '1' },
    });
    /** Private fixture preview path, never published or logged. */
    const preview = receipt.headers.get('location').replace('/cms', '');
    /** Fixed fixture time captured before deterministic expiry simulation. */
    const now = clock();
    Date.now = () => now + 60001;
    assert.equal((await f.call(preview)).status, 404);
  } finally {
    Date.now = clock;
    await f.close();
  }
});
