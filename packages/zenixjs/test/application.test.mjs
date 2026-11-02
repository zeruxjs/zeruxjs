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
const origin = 'http://localhost:3000',
  scope = { tenant: 'tenantA', site: 'siteA' };
const admin = {
  userId: 'operator',
  tenantId: scope.tenant,
  siteIds: [scope.site],
  permissions: cmsRolePermissions.administrator,
};
const reader = {
  ...admin,
  userId: 'service-reader',
  permissions: cmsRolePermissions.reader,
};
const sessions = {
  admin: { principal: admin, key: 'admin-binding' },
  other: { principal: admin, key: 'other-binding' },
};
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zx084-'));
  const db = await createConnector({
    filename: path.join(dir, 'cms.sqlite'),
    driver: 'node',
  });
  let csrfAllowed = true,
    recoveryAllowed = false,
    setupSecret = true;
  const cms = await createCms({
    adapter: 'sqlite',
    connection: db,
    migrate: true,
    resolvePrincipal: async (p) => (p === admin || p === reader ? p : null),
    authorizeMedia: async () => false,
  });
  const setupStore = createSqliteSetupStore({ connection: db, migrate: true });
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
  const app = createZenixApplication(options);
  function request(
    route,
    { method = 'GET', body, cookie = 'sid=admin', headers = {} } = {},
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
async function setup(f) {
  const response = await f.call('/setup', {
    method: 'POST',
    body: { secret: 'host-secret' },
  });
  assert.equal(response.status, 303, await response.text());
}
test('authenticated durable setup is single-use under concurrency; no role/origin/CSRF bypass', async () => {
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
      303,
    );
    assert.equal(
      (
        await f.call('/setup', {
          method: 'POST',
          body: { secret: 'host-secret' },
          headers: { origin: 'http://attacker.test' },
        })
      ).status,
      403,
    );
    f.setCsrf(false);
    assert.equal(
      (
        await f.call('/setup', {
          method: 'POST',
          body: { secret: 'host-secret' },
        })
      ).status,
      403,
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
      403,
    );
    f.setSecret(true);
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
      409,
    );
    const replacement = createZenixApplication(f.options);
    try {
      assert.equal(
        (
          await replacement.handle(
            f.request('/setup', {
              method: 'POST',
              body: { secret: 'host-secret' },
            }),
          )
        ).status,
        409,
      );
    } finally {
      await replacement.close();
    }
  } finally {
    await f.close();
  }
});
test('login, denied editor, private session-bound previews, stored XSS and published-only page', async () => {
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
      401,
    );
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
      403,
    );
    assert.equal(
      (
        await f.call('/save', {
          method: 'POST',
          body: 'csrf=csrf-fixture&expected=0&title=a&title=b&body=x',
        })
      ).status,
      400,
    );
    const text = '<script>alert("stored")</script>';
    assert.equal(
      (
        await f.call('/save', {
          method: 'POST',
          body: { expected: '0', title: text, body: 'Draft only' },
        })
      ).status,
      303,
    );
    assert.equal((await f.call('/page', { cookie: '' })).status, 404);
    assert.equal(
      (await f.call('/preview?token=guessed', { cookie: '' })).status,
      303,
    );
    assert.equal((await f.call('/preview?token=guessed')).status, 404);
    const p = await f.call('/preview', {
      method: 'POST',
      body: { expected: '1' },
    });
    const previewPath = p.headers.get('location').replace('/cms', '');
    const response = await f.call(previewPath);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.doesNotMatch(await response.text(), /<script>/);
    assert.equal(
      (await f.call(previewPath, { cookie: 'sid=other' })).status,
      403,
    );
    assert.equal(
      (await f.call('/publish', { method: 'POST', body: { expected: '1' } }))
        .status,
      303,
    );
    const page = await f.call('/page', { cookie: '' });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /Draft only/);
    assert.doesNotMatch(html, /csrf-fixture|sid=|host-secret/);
    assert.match(page.headers.get('content-security-policy'), /default-src/);
    assert.equal(
      (await f.call('/page', { method: 'HEAD', cookie: '' })).body,
      null,
    );
    assert.equal(
      (
        await f.call('/save', {
          method: 'POST',
          body: { expected: '2', title: 'Unpublished', body: 'New draft' },
        })
      ).status,
      303,
    );
    assert.doesNotMatch(
      await (await f.call('/page', { cookie: '' })).text(),
      /New draft/,
    );
    const editor = await f.call('/editor');
    const dom = new JSDOM(await editor.text());
    try {
      for (const control of dom.window.document.querySelectorAll(
        'input:not([type=hidden]),textarea',
      )) {
        assert.ok(
          dom.window.document.querySelector('label[for="' + control.id + '"]'),
        );
        assert.equal(
          validateComponentProps(
            control,
            { label: control.getAttribute('aria-label') },
            { root: dom.window.document, requireLabel: true },
          ).length,
          0,
        );
      }
      assert.equal(
        dom.window.document.querySelector('textarea').value,
        'New draft',
      );
    } finally {
      dom.window.close();
    }
  } finally {
    await f.close();
  }
});
test('interrupted setup remains claimed and needs trusted operator recovery', async () => {
  const f = await fixture();
  let fail = true;
  const original = f.cms.registerContentType;
  f.cms.registerContentType = (...args) =>
    fail ? Promise.reject(Error('private-db-secret')) : original(...args);
  try {
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
      409,
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
  const f = await fixture();
  const routes = [];
  const server = http.createServer(async (req, res) => {
    try {
      const route = routes.find(
        (r) => r.pattern === new URL(req.url, 'http://localhost').pathname,
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
    const app = createZenixApplication(f.options);
    try {
      app.install({ addRoute: (r) => routes.push(r) });
      const response = await fetch(f.options.origin + '/cms/login');
      assert.equal(response.status, 200);
      assert.match(await response.text(), /<form/);
      const denied = await new Promise((resolve, reject) => {
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
          },
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
  const f = await fixture();
  let started;
  const began = new Promise((r) => (started = r));
  const app = createZenixApplication({
    ...f.options,
    authenticate: (request) =>
      new Promise((resolve, reject) => {
        started();
        request.signal.addEventListener(
          'abort',
          () => reject(Error('private cancellation cause')),
          { once: true },
        );
      }),
  });
  try {
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
    const store = createSqliteSetupStore({ connection: db, migrate: false });
    app = createZenixApplication({ ...f.options, cms, setupStore: store });
    const response = await app.handle(
      f.request('/setup', { method: 'POST', body: { secret: 'host-secret' } }),
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
  const f = await fixture();
  const clock = Date.now;
  try {
    assert.throws(
      () => createZenixApplication({ ...f.options, plugins: ['unreviewed'] }),
      /Unknown/,
    );
    await setup(f);
    await f.call('/save', {
      method: 'POST',
      body: { expected: '0', title: 'Private', body: 'Draft' },
    });
    const receipt = await f.call('/preview', {
      method: 'POST',
      body: { expected: '1' },
    });
    const preview = receipt.headers.get('location').replace('/cms', '');
    const now = clock();
    Date.now = () => now + 60001;
    assert.equal((await f.call(preview)).status, 404);
  } finally {
    Date.now = clock;
    await f.close();
  }
});
