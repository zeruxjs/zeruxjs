import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  createTagManager,
  createMemoryTagStore,
  emptyTagContainer,
} from '../dist/index.js';
import { createMemoryRequestIdStore } from '@zeruxjs/analytics';
import {
  createTagAdminClient,
  TagAdminClientError,
} from '../dist/admin-client.js';
import { mountTagAdmin } from '../dist/admin-view.js';
import { validateComponentProps } from '../../accessibility/dist/index.js';
/** Create isolated in-memory routes and an owned runtime with synthetic host authorization.
 * @param {object} administration - Explicit fixture-only dependency/policy overrides; no production credentials.
 * @returns {object} Borrowed fixture stores/route helpers and owned runtime requiring close.
 */
function app(administration = {}) {
  /** Borrowed process-local CAS fixture store; memory is not durable cross-replica persistence. */
  const store = createMemoryTagStore({
    ...emptyTagContainer(),
    name: '<img src=x onerror=evil()>',
  });
  /** Synthetic value-free audit event log; no durable remote audit acceptance is implied. */
  const audit = [];
  /** Owned synthetic tag runtime; stores and analytics remain borrowed. */
  const runtime = createTagManager({
    analytics: { track: async () => true },
    requestIds: createMemoryRequestIdStore(),
    store,
    site: 'shop',
    authorizeAdmin: (r) =>
      ['editor', 'publisher'].includes(r.headers.get('role')),
    authorizePublish: (r) => r.headers.get('role') === 'publisher',
    administration: {
      basePath: '/control/tags',
      uiPath: '/console/tags',
      publicOrigin: 'https://api.example.test',
      allowedOrigins: ['https://ui.example.test'],
      verifyCsrf: (r) => r.headers.get('x-zerux-csrf') === 'session-token',
      issueCsrfToken: () => 'session-token',
      auditContext: () => ({ tenant: 'shop', actor: 'opaque-user' }),
      audit: (e) => audit.push(e),
      ...administration,
    },
  });
  /** In-memory exact-path route map; no dynamic endpoint discovery. */
  const routes = new Map(runtime.routes().map((r) => [r.pattern, r.handler]));
  /** Invoke a declared in-memory route; synthetic role headers are fixture-only trusted host policy.
   * @param {string} path - Exact declared fixture route path.
   * @param {object} options - Explicit synthetic request controls.
   * @param {string} options.method - Request method, default GET.
   * @param {unknown} options.body - Optional JSON fixture payload.
   * @param {string} options.role - Synthetic host role, default publisher.
   * @param {string} options.origin - Explicit synthetic UI origin.
   * @param {string} options.csrf - Synthetic session-bound CSRF token.
   * @param {object} options.headers - Additional explicit fixture protocol headers.
   * @returns {Promise<Response>} Protected in-memory handler response; no listener starts.
   */
  const request = (
    path,
    {
      method = 'GET',
      body,
      role = 'publisher',
      origin = 'https://ui.example.test',
      csrf = 'session-token',
      headers = {},
    } = {}
  ) =>
    routes.get(path)(
      new Request('https://api.example.test' + path, {
        method,
        headers: {
          role,
          origin,
          'content-type': 'application/json',
          'x-zerux-csrf': csrf,
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    );
  return { store, runtime, routes, request, audit };
}
test('independent mount/assets and exact authenticated CORS/CSRF policy', async (t) => {
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app({
    styleHref: '/brand/tags.css',
    scriptSrc: '/assets/tag-editor.js',
  });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.runtime.close();
  });
  try {
    assert(!a.routes.has('/_tags/admin/api'));
    /** Synthetic exact-origin CORS preflight response; real operations still require authorization. */
    const pre = await a.request('/control/tags/api', {
      method: 'OPTIONS',
      role: '',
      headers: {
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type,x-zerux-csrf',
      },
    });
    assert.equal(pre.status, 204);
    assert.equal(
      pre.headers.get('access-control-allow-origin'),
      'https://ui.example.test'
    );
    assert.equal(pre.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(
      (
        await a.request('/control/tags/api', {
          origin: 'https://evil.example.test',
        })
      ).status,
      403
    );
    assert.equal(
      (await a.request('/control/tags/api', { role: 'none' })).status,
      403
    );
    /** Independent draft candidate with explicit optimistic next revision. */
    const candidate = { ...(await a.store.load()), version: 2 };
    assert.equal(
      (
        await a.request('/control/tags/api', {
          method: 'PUT',
          body: candidate,
          csrf: 'forged',
        })
      ).status,
      403
    );
    assert.equal(
      (await a.request('/control/tags/api', { method: 'PUT', body: candidate }))
        .status,
      200
    );
    /** Private synthetic HTML response with independent API and asset paths. */
    const ui = await a.request('/console/tags', {
      origin: 'https://api.example.test',
    });
    /** Serialized authenticated dashboard fixture; assertions check safe stored text and explicit mount. */
    const html = await ui.text();
    assert(html.includes('href="/brand/tags.css"'));
    assert(html.includes('src="/assets/tag-editor.js"'));
    assert(html.includes('content="https://api.example.test/control/tags"'));
    assert(
      ui.headers.get('content-security-policy').includes("script-src  'self'")
    );
    assert.equal(ui.headers.get('cache-control'), 'private, no-store');
    assert(!html.includes('<img src=x'));
  } finally {
    await a.runtime.close();
  }
  assert.throws(
    () =>
      app({
        allowedOrigins: ['https://ui.example.test'],
        verifyCsrf: undefined,
      }),
    /CSRF/
  );
  assert.throws(() => app({ uiPath: '/control/tags/api' }), /Conflicting/);
});
test('validate/save/publish/rollback remain authorized, revision conflicts are explicit and audit is value-free', async (t) => {
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app();
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.runtime.close();
  });
  try {
    /** Independent candidate definition validated before any draft or publish transition. */
    const c = { ...(await a.store.load()), version: 2, name: 'Changed' };
    assert.equal(
      (await a.request('/control/tags/validate', { method: 'POST', body: c }))
        .status,
      200
    );
    assert.equal((await a.store.load()).version, 1);
    /** Concurrent draft-save observations checked for one success and one conflict. */
    const saved = await Promise.all([
      a.request('/control/tags/api', { method: 'PUT', body: c }),
      a.request('/control/tags/api', { method: 'PUT', body: c }),
    ]);
    assert.deepEqual(saved.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      (
        await a.request('/control/tags/publish', {
          method: 'POST',
          body: { expectedVersion: 2 },
          role: 'editor',
        })
      ).status,
      403
    );
    assert.equal(
      (
        await a.request('/control/tags/publish', {
          method: 'POST',
          body: { expectedVersion: 2 },
        })
      ).status,
      200
    );
    assert.equal((await a.runtime.published()).name, 'Changed');
    assert.equal(
      (
        await a.request('/control/tags/rollback', {
          method: 'POST',
          body: { expectedVersion: 3, releaseId: 1 },
        })
      ).status,
      200
    );
    assert.equal(
      (await a.runtime.published()).name,
      '<img src=x onerror=evil()>'
    );
    assert.deepEqual(
      a.audit.map((e) => e.phase),
      ['intent', 'committed', 'intent', 'committed']
    );
    assert(!JSON.stringify(a.audit).includes('<img'));
    assert(a.audit.every((e) => /^[a-f0-9]{64}$/.test(e.definitionHash)));
  } finally {
    await a.runtime.close();
  }
});
test('audit outages distinguish uncommitted intent from committed post-write failure', async () => {
  // Distinguish precommit prevention from postcommit audit failure for each phase.
  for (const phase of ['intent', 'committed']) {
    /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
    const a = app({
      audit: (e) => {
        if (e.phase === phase) {
          throw Error('private sink credential');
        }
      },
    });
    try {
      /** Bounded declared dispatch/HTTP result whose fields are compared explicitly. */
      const result = await a.request('/control/tags/publish', {
        method: 'POST',
        body: { expectedVersion: 1 },
      });
      assert.equal(result.status, 503);
      /** Parsed redacted response or scalar fixture payload; assertions reject private causes. */
      const data = await result.json();
      assert.equal(data.committed, phase === 'committed');
      assert.equal(
        (await a.store.load()).version,
        phase === 'committed' ? 2 : 1
      );
      assert(!JSON.stringify(data).includes('credential'));
    } finally {
      await a.runtime.close();
    }
  }
});
test('headless client preserves 409/committed receipts and never retries mutation', async (t) => {
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app();
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.runtime.close();
  });
  let calls = 0;
  /** Owned headless client with explicit injected transport; await close after observations. */
  const client = createTagAdminClient({
    apiBaseUrl: 'https://api.example.test/control/tags',
    csrfToken: () => 'session-token',
    fetch: async (url, init) => {
      calls++;
      assert.equal(init.credentials, 'include');
      /** Construct a synthetic protected request with explicit method/origin/role controls. */
      const req = new Request(url, {
        ...init,
        headers: {
          ...init.headers,
          role: 'publisher',
          origin: 'https://ui.example.test',
        },
      });
      return a.routes.get(new URL(url).pathname)(req);
    },
  });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await client.close();
  });
  try {
    /** Independent candidate definition validated before any draft or publish transition. */
    const c = await client.load();
    /** Independent next-revision draft proposal; save must not implicitly publish. */
    const next = { ...c, version: c.version + 1 };
    await client.validate(next);
    await client.save(next);
    /** Captured pre-operation script or request count used to detect implicit publication/retry. */
    const before = calls;
    await assert.rejects(
      client.save(next),
      (e) =>
        e instanceof TagAdminClientError &&
        e.code === 'conflict' &&
        e.status === 409
    );
    assert.equal(calls, before + 1);
    await client.publish(2);
    await client.rollback(3, 1);
    assert.equal((await client.status()).publishedRelease, 3);
  } finally {
    await client.close();
    await a.runtime.close();
  }
});
test('replaceable view keeps stored XSS inert, native labels, conflicts and slot teardown (DOM emulation)', async (t) => {
  /** Owned jsdom window; close after removing view resources and outstanding observations. */
  const dom = new JSDOM('<main></main>');
  /** Owned synthetic DOM mount for the replaceable view. */
  const host = dom.window.document.querySelector('main');
  let disposed = 0;
  /** Borrowed explicit UI client double; no real authentication/network request occurs. */
  const fake = {
    load: async () => ({
      ...emptyTagContainer(),
      name: '<script>evil()</script>',
    }),
    validate: async () => ({ ok: true }),
    save: async () => {
      throw new TagAdminClientError('conflict', 409);
    },
    publish: async () => {},
    rollback: async () => {},
  };
  /** Owned replaceable UI subtree/listeners; destroy before closing an owned client/window. */
  const view = mountTagAdmin(host, fake, {
    slots: {
      toolbar(node) {
        /** Host-slot synthetic native element removed by its explicit returned disposer. */
        const custom = dom.window.document.createElement('button');
        custom.textContent = 'Host action';
        node.append(custom);
        return () => {
          disposed++;
          custom.remove();
        };
      },
    },
  });
  // Release deliberately held synthetic dependencies before draining on failed assertions.
  t.after(async () => {
    try {
      view.destroy();
    } finally {
      dom.window.close();
    }
  });
  await view.reload();
  assert.equal(host.querySelector('script'), null);
  assert(host.querySelector('textarea').value.includes('<script>'));
  assert.deepEqual(
    validateComponentProps(
      host.querySelector('section'),
      { label: 'Tag container administration' },
      { requireLabel: true }
    ),
    []
  );
  /** Owned synthetic textarea retaining edits after a conflict. */
  const text = host.querySelector('textarea');
  text.value = '{"myEdit":true}';
  text.dispatchEvent(new dom.window.Event('input'));
  [...host.querySelectorAll('button')]
    .find((b) => b.textContent === 'Save draft')
    .click();
  await new Promise((r) => setImmediate(r));
  assert(host.textContent.includes('Revision conflict'));
  assert.equal(text.value, '{"myEdit":true}');
  view.destroy();
  view.destroy();
  assert.equal(disposed, 1);
  assert.equal(host.children.length, 0);
  dom.window.close();
});
test('client deadline retains pending native capacity and close drains actual settlement', async (t) => {
  let finish;
  /** Owned headless client with explicit injected transport; await close after observations. */
  const client = createTagAdminClient({
    apiBaseUrl: 'https://api.example.test/control/tags',
    maxConcurrent: 1,
    timeoutMs: 5,
    fetch: async () => {
      await new Promise((r) => (finish = r));
      return Response.json({ version: 1 });
    },
  });
  // Release deliberately held synthetic dependencies before draining on failed assertions.
  t.after(async () => {
    finish?.();
    await client.close();
  });
  await assert.rejects(client.load(), { code: 'cancelled' });
  assert.equal(client.statusOfClient().pending, 1);
  await assert.rejects(client.load(), { code: 'overload' });
  finish();
  await client.close();
  assert.equal(client.statusOfClient().pending, 0);
  await assert.rejects(client.load(), { code: 'closed' });
});
test('mounted built-in dashboard uses explicit API path and stored titles remain inert (DOM emulation)', async (t) => {
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app();
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await a.runtime.close();
  });
  /** Synthetic authenticated HTML response for DOM-emulation assertions. */
  const page = await a.request('/console/tags', {
    origin: 'https://api.example.test',
  });
  /** Owned jsdom window; close after removing view resources and outstanding observations. */
  const dom = new JSDOM(await page.text(), {
    url: 'https://api.example.test/console/tags',
    runScripts: 'outside-only',
  });
  try {
    /** Injected transport call log; no real Google/webhook/browser delivery occurs. */
    const calls = [];
    dom.window.fetch = async (url, init = {}) => {
      /** Fixed parsed route path used by injected in-memory Fetch routing. */
      const pathname = new URL(url, dom.window.location.href).pathname;
      calls.push(pathname);
      return a.routes.get(pathname)(
        new Request(new URL(url, dom.window.location.href), {
          ...init,
          headers: {
            ...init.headers,
            role: 'publisher',
            origin: 'https://api.example.test',
          },
        })
      );
    };
    dom.window.eval(dom.window.document.querySelector('script').textContent);
    await new Promise((r) => setTimeout(r, 25));
    assert(calls.includes('/control/tags/api'));
    assert(calls.includes('/control/tags/status'));
    assert.equal(
      dom.window.document.querySelector('#name').value,
      '<img src=x onerror=evil()>'
    );
    assert.equal(dom.window.document.querySelector('img'), null);
  } finally {
    dom.window.close();
    await a.runtime.close();
  }
});
test('custom slot setup failure removes owned view and close waits for in-flight audit settlement', async (t) => {
  /** Owned jsdom window; close after removing view resources and outstanding observations. */
  const dom = new JSDOM('<main></main>');
  /** Owned synthetic DOM mount for the replaceable view. */
  const host = dom.window.document.querySelector('main');
  assert.throws(
    () =>
      mountTagAdmin(
        host,
        { load: async () => emptyTagContainer() },
        {
          slots: {
            toolbar() {
              throw Error('slot failed');
            },
          },
        }
      ),
    /slot failed/
  );
  assert.equal(host.children.length, 0);
  dom.window.close();
  let ready, finish;
  /** Synthetic handshake promise ensuring assertions occur after native work begins. */
  const started = new Promise((r) => (ready = r));
  /** Owned synthetic manager fixture; its stores/authorization are test doubles, not production identity. */
  const a = app({
    maxConcurrent: 1,
    audit: async (e) => {
      if (e.phase === 'intent') {
        ready();
        await new Promise((r) => (finish = r));
      }
    },
  });
  // Release deliberately held synthetic dependencies before draining on failed assertions.
  t.after(async () => {
    finish?.();
    await a.runtime.close();
  });
  /** Observed protected transition promise retained through actual audit settlement. */
  const job = a.request('/control/tags/publish', {
    method: 'POST',
    body: { expectedVersion: 1 },
  });
  await started;
  assert.equal((await a.request('/control/tags/status')).status, 503);
  assert.equal(a.runtime.status().adminPending, 1);
  let closed = false;
  /** Observed close promise used to verify actual handler/audit settlement. */
  const close = a.runtime.close().then(() => (closed = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(closed, false);
  finish();
  await job;
  await close;
  assert.equal(closed, true);
});
test('unknown mutation acknowledgement is not mislabeled as a conflict or safe retry', async (t) => {
  let calls = 0;
  /** Owned headless client with explicit injected transport; await close after observations. */
  const client = createTagAdminClient({
    apiBaseUrl: 'https://api.example.test/control/tags',
    csrfToken: () => 'token',
    fetch: async () => {
      calls++;
      return Response.json(
        { error: 'Transition unavailable', committed: 'unknown' },
        { status: 503 }
      );
    },
  });
  // Drain this owned synthetic wrapper even when an assertion fails.
  t.after(async () => {
    await client.close();
  });
  try {
    await assert.rejects(
      client.publish(1),
      (e) =>
        e.code === 'unavailable' &&
        e.uncertain === true &&
        e.committed === false
    );
    assert.equal(calls, 1);
  } finally {
    await client.close();
  }
});
