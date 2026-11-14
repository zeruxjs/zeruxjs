import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '@zeruxjs/auth';
import { createServer, request as nodeRequest } from 'node:http';
import { once } from 'node:events';
import { gunzipSync } from 'node:zlib';
import { createApplicationLifecycle } from 'zeruxjs';
import { createServerLifecycleHooks } from '@zeruxjs/hooks/lifecycle';
import { encodeConnectEnvelope, readConnectEnvelopes } from 'zhost/protocols';
/** Actual app source root; only owned .zerux/workspace-test-* candidates are compiled/removed. */
const root = dirname(dirname(fileURLToPath(import.meta.url)));
let buildDir, createWorkspace, bundleUrl;
before(async () => {
  await mkdir(join(root, '.zerux'), { recursive: true });
  buildDir = await mkdtemp(join(root, '.zerux/workspace-test-'));
  /** Owned isolated test bundle, never the operator’s production build output. */
  const outfile = join(buildDir, 'application.ts');
  await build({
    entryPoints: [join(root, 'lib/workspace/application.ts')],
    outfile,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  bundleUrl = pathToFileURL(outfile).href;
  ({ createWorkspace } = await import(bundleUrl));
});
after(async () => {
  if (buildDir) {
    await rm(buildDir, { recursive: true, force: true });
  }
});
/** Fixed synthetic host identity for unit Fetch/session/CSRF checks, not a user service URL. */
const origin = 'http://localhost:3010';
/** Acquire actual local services over synthetic private SQLite/files, with explicit teardown.
 * @returns {Promise<object>} Actual app/cookie/form helpers plus reopen and close; no live provider credentials are used.
 */
async function fixture() {
  /** Owned disposable private SQLite/files root; no operator records or configured external database are used. */
  const directory = await mkdtemp(join(tmpdir(), 'zerux-workspace-'));
  /** Fixed synthetic tenant/site/operator/key with explicit schema initialization in this isolated fixture only. */
  const options = {
    directory,
    origin,
    tenant: 'tenantA',
    site: 'main',
    username: 'operator',
    passwordHash: hashPassword('synthetic-test-password'),
    key: randomBytes(32),
    migrate: true,
  };
  let app = await createWorkspace(options);
  /** Fixture-local cookie jar is retained across explicit generation reopen without reassignment. */
  const jar = new Map();
  /** Fixture request helper preserves cookies and origin while allowing explicit denial cases. */
  /** Invoke the actual Fetch handler with per-fixture proofs and explicit overrideable denial inputs.
   * @param {string} path - Fixed local path for this synthetic request.
   * @param {object} root0 - Explicit request inputs; no automatic side-effect retry.
   * @param {string} root0.method - Actual method, default GET.
   * @param {unknown} root0.body - Intentional synthetic form or malformed input.
   * @param {object} root0.headers - Extra native headers, including explicit forged cases.
   * @returns {Promise<Response>} Actual application response, consumed by the test owner.
   */
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    /** Actual response from the tested owner; assertions consume bodies rather than inventing success. */
    const response = await app.handle(
      new Request(origin + path, {
        method,
        headers: {
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
          ...(body
            ? { origin, 'content-type': 'application/x-www-form-urlencoded' }
            : {}),
          ...headers,
        },
        ...(body
          ? {
              body: typeof body === 'string' ? body : new URLSearchParams(body),
            }
          : {}),
      })
    );
    for (const cookie of response.headers.getSetCookie()) {
      /** Synthetic cookie pair from the actual response, retained only within this fixture’s jar. */
      const [name, value] = cookie.split(';')[0].split('=');
      if (value) {
        jar.set(name, value);
      } else {
        jar.delete(name);
      }
    }
    return response;
  };
  /** Actual session-bound challenge obtained from a native form, never a fabricated privileged proof. */
  /** Obtain the actual challenge and cookie from a native progressive form.
   * @param {string} path - Known synthetic form route.
   * @returns {Promise<string | undefined>} Actual challenge; callers assert presence before use.
   */
  const csrf = async (path) => {
    /** Actual response from the tested owner; assertions consume bodies rather than inventing success. */
    const response = await call(path);
    assert.equal(response.status, 200, await response.clone().text());
    /** Actual local response text inspected as data, never evaluated as JavaScript. */
    const text = await response.text();
    return (
      text.match(/name="csrf"[^>]*value="([^"]+)"/)?.[1] ??
      text.match(/value="([^"]+)" readonly/)?.[1]
    );
  };
  /** Fixture-only credential submission through the actual origin/CSRF/admission boundary. */
  /** Authenticate only the synthetic operator through the actual login form boundary.
   * @returns {Promise<void>} Verifies the actual redirect/session outcome without bypassing CSRF.
   */
  const login = async () => {
    /** Actual challenge from the current fixture session, not a browser-declared tenant or role. */
    const token = await csrf('/workspace/login');
    assert.ok(token);
    /** Actual response from the tested owner; assertions consume bodies rather than inventing success. */
    const response = await call('/workspace/login', {
      method: 'POST',
      body: {
        csrf: token,
        username: 'operator',
        password: 'synthetic-test-password',
      },
    });
    assert.equal(response.status, 303, await response.text());
  };
  return {
    /** Expose only this fixture’s current generation, including after explicit reopen.
     * @returns {object} Actual owned application handle; never a global operator instance.
     */
    get app() {
      return app;
    },
    options,
    call,
    csrf,
    login,
    jar,
    /** Close this generation and reopen the same private fixture without migrations.
     * @returns {Promise<void>} Actual durable reload settlement; in-memory success is insufficient.
     */
    async reopen() {
      await app.close();
      app = await createWorkspace({ ...options, migrate: false });
    },
    /** Drain the actual fixture services before deleting its owned private directory.
     * @returns {Promise<void>} Cleanup settlement; no unrelated path is removed.
     */
    async close() {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
test('local forms, SQLite reload, private/public search, feeds, object storage and logout', async () => {
  /** Owned integration fixture; every case closes its actual services and disposable state in finally. */
  const f = await fixture();
  try {
    assert.equal((await f.call('/workspace')).status, 200);
    assert.equal((await f.call('/workspace/notes')).status, 303);
    await f.login();
    let csrf = await f.csrf('/workspace/notes');
    assert.equal(
      (
        await f.call('/workspace/save', {
          method: 'POST',
          body: {
            csrf,
            id: '',
            title: 'Private secret',
            body: 'Never publish me',
            revision: '0',
            published: 'false',
          },
        })
      ).status,
      303
    );
    assert.equal(
      (
        await f.call('/workspace/save', {
          method: 'POST',
          body: {
            csrf,
            id: '',
            title: 'Café notebook',
            body: '<script>neverExecute()</script>',
            revision: '0',
            published: 'true',
          },
        })
      ).status,
      303
    );
    /** Actual anonymous public-note search output; private text and executable markup must be absent. */
    const publicPage = await (await f.call('/workspace/search?q=Café')).text();
    assert.match(publicPage, /Café notebook/);
    assert.doesNotMatch(publicPage, /Private secret/);
    assert.match(publicPage, /&lt;script&gt;/);
    assert.doesNotMatch(
      publicPage,
      /<script\s*>\s*neverExecute\(\)\s*<\/script\s*>/i
    );
    await f.reopen();
    /** Actual authenticated note output after durable reopen proves persistence rather than cache reuse. */
    const notes = await (await f.call('/workspace/notes')).text();
    assert.match(notes, /Private secret/);
    assert.match(notes, /Café notebook/);
    /** Persisted synthetic record identity extracted from the actual progressive edit form. */
    const id = notes.match(/name="id"[^>]*value="([a-f0-9-]{36})"/)[1];
    csrf = await f.csrf('/workspace/notes');
    assert.equal(
      (
        await f.call('/workspace/save', {
          method: 'POST',
          body: {
            csrf,
            id,
            title: 'Stale',
            body: '',
            revision: '0',
            published: 'false',
          },
        })
      ).status,
      409
    );
    /** Actual generated public feed response, retaining representation-specific validators. */
    const feed = await f.call('/workspace/feed.json');
    /** Actual feed representation validator used for conditional response assertions. */
    const etag = feed.headers.get('etag');
    /** Parsed actual JSON feed, not a prefilled provider fixture. */
    const data = await feed.json();
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].title, 'Café notebook');
    assert.equal(
      (
        await f.call('/workspace/feed.json', {
          headers: { 'if-none-match': etag },
        })
      ).status,
      304
    );
    assert.equal(
      await (await f.call('/workspace/feed.json', { method: 'HEAD' })).text(),
      ''
    );
    assert.doesNotMatch(
      await (await f.call('/workspace/sitemap.xml')).text(),
      /Private secret|workspace\/notes|#/
    );
    csrf = await f.csrf('/workspace/files');
    assert.equal(
      (
        await f.call('/workspace/files/create', {
          method: 'POST',
          body: {
            csrf,
            filename: 'hello.txt',
            content: 'Private object bytes',
          },
        })
      ).status,
      303
    );
    /** Actual private object listing; download links still require a fresh authenticated session. */
    const listing = await (await f.call('/workspace/files')).text();
    /** Actual scoped download URL decoded only for the fixture request; cross-tenant keys are tested separately. */
    const href = listing
      .match(/href="([^"]+download[^"]+)"/)[1]
      .replaceAll('&amp;', '&');
    assert.equal(await (await f.call(href)).text(), 'Private object bytes');
    assert.equal(
      (await f.call('/workspace/files/download?key=tenantB/anything.txt'))
        .status,
      403
    );
    csrf = await f.csrf('/workspace/notes');
    assert.equal(
      (await f.call('/workspace/logout', { method: 'POST', body: { csrf } }))
        .status,
      303
    );
    assert.equal((await f.call(href)).status, 303);
  } finally {
    await f.close();
  }
});
test('denied origin, forged CSRF, duplicate fields, invalid objects and untrusted host', async () => {
  /** Owned integration fixture; every case closes its actual services and disposable state in finally. */
  const f = await fixture();
  try {
    /** Actual session-bound challenge obtained from a native form, never a fabricated privileged proof. */
    const csrf = await f.csrf('/workspace/login');
    /** Explicit synthetic form data; forged CSRF/origin and malformed inputs are intentional denial cases. */
    const body = {
      csrf,
      username: 'operator',
      password: 'synthetic-test-password',
    };
    assert.equal(
      (
        await f.call('/workspace/login', {
          method: 'POST',
          body,
          headers: { origin: 'https://evil.invalid' },
        })
      ).status,
      403
    );
    assert.equal(
      (
        await f.call('/workspace/login', {
          method: 'POST',
          body: { ...body, csrf: 'forged' },
        })
      ).status,
      403
    );
    assert.equal(
      (
        await f.call('/workspace/login', {
          method: 'POST',
          body: new URLSearchParams(body).toString() + '&username=other',
        })
      ).status,
      400
    );
    assert.equal(
      (await f.app.handle(new Request('http://evil.invalid/workspace'))).status,
      403
    );
    await f.login();
    /** Actual challenge from the current fixture session, not a browser-declared tenant or role. */
    const token = await f.csrf('/workspace/files');
    assert.equal(
      (
        await f.call('/workspace/files/create', {
          method: 'POST',
          body: { csrf: token, filename: '../escape.txt', content: 'bad' },
        })
      ).status,
      400
    );
  } finally {
    await f.close();
  }
});
test('protocol routes enforce session/CSRF and dispatch real JSON-RPC, MCP and Connect', async () => {
  /** Owned integration fixture; every case closes its actual services and disposable state in finally. */
  const f = await fixture();
  let server;
  try {
    await f.login();
    /** Actual rendered fixture HTML; token/record references are inspected only in this isolated test. */
    const page = await (await f.call('/workspace/protocols')).text();
    /** Actual challenge from the current fixture session, not a browser-declared tenant or role. */
    const token = page.match(/value="([^"]+)" readonly/)[1];
    /** Actual application-installed route handlers captured for an owned ephemeral native HTTP server. */
    const routes = new Map();
    f.app.install({
      addRoute(route) {
        routes.set(route.pattern, route.handler);
      },
    });
    server = createServer((req, res) => {
      /** Exact installed route for the synthetic request path, not a dynamically imported operation. */
      const handler = routes.get(new URL(req.url, origin).pathname);
      if (!handler) {
        res.writeHead(404);
        res.end();
        return;
      }
      Promise.resolve(
        handler({ req, res, url: new URL(req.url, origin), method: req.method })
      ).catch(() => {
        res.destroy();
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    /** Owned ephemeral loopback listener URL; requests cannot select external services. */
    const base = `http://127.0.0.1:${server.address().port}`;
    /** Native fixture helper invokes real installed handlers, with explicit headers for authentication/denial tests. */
    /** Call the owned ephemeral native server with actual cookie/origin/CSRF headers.
     * @param {string} path - Explicit local protocol path.
     * @param {unknown} body - Synthetic JSON or framed bytes, never executable source.
     * @param {object} extra - Explicit header overrides for positive and denial cases.
     * @param {string} method - Actual HTTP method, default POST.
     * @returns {Promise<Response>} Actual native response assembled for assertions; no broker/browser acceptance is inferred.
     */
    const request = (path, body, extra = {}, method = 'POST') =>
      new Promise((resolve, reject) => {
        /** Owned synthetic native client request; no automatic replay occurs after uncertain outcomes. */
        const req = nodeRequest(
          base + path,
          {
            method,
            headers: {
              host: 'localhost:3010',
              origin,
              cookie: [...f.jar].map(([k, v]) => `${k}=${v}`).join('; '),
              'x-csrf-token': token,
              'content-type': 'application/json',
              ...extra,
            },
          },
          (res) => {
            /** Actual finite endpoint response bytes; the server adapter owns its runtime response budgets. */
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () =>
              resolve(
                new Response(Buffer.concat(chunks), {
                  status: res.statusCode,
                  headers: res.headers,
                })
              )
            );
          }
        );
        req.on('error', reject);
        req.end(body instanceof Uint8Array ? body : JSON.stringify(body));
      });
    assert.equal(
      (
        await request(
          '/rpc',
          { jsonrpc: '2.0', id: 1, method: 'workspace.summary', params: {} },
          { cookie: '' }
        )
      ).status,
      403
    );
    assert.equal(
      (await request('/rpc', {}, { 'x-csrf-token': 'forged' })).status,
      403
    );
    /** Actual correlated JSON-RPC response; a protocol envelope alone does not authorize a call. */
    const rpc = await (
      await request('/rpc', {
        jsonrpc: '2.0',
        id: 1,
        method: 'workspace.summary',
        params: {},
      })
    ).json();
    assert.equal(rpc.error, undefined, JSON.stringify(rpc));
    assert.deepEqual(rpc.result.notes, []);
    /** Actual unary Connect response from the registered local summary. */
    const connect = await (
      await request('/workspace.Notebook/Summary', {})
    ).json();
    assert.deepEqual(connect.notes, []);
    /** Actual MCP tool inventory from the owned authenticated gateway. */
    const mcp = await (
      await request(
        '/mcp',
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        { accept: 'application/json, text/event-stream' }
      )
    ).json();
    assert.equal(mcp.result.tools[0].name, 'workspace_summary');
    /** Actual tRPC-style summary, not a complete vendor compatibility assertion. */
    const trpc = await (await request('/trpc/workspace.summary', {})).json();
    assert.deepEqual(trpc.result.data.notes, []);
    /** Actual framed Connect response, decoded through the public zhost helper. */
    const streamResponse = await request(
      '/workspace.Notebook/SummaryStream',
      encodeConnectEnvelope({}),
      { 'content-type': 'application/connect+json' }
    );
    /** Decoded finite native framing results; arbitrary payloads are never executed. */
    const messages = [];
    for await (const message of readConnectEnvelopes([
      new Uint8Array(await streamResponse.arrayBuffer()),
    ])) {
      messages.push(message);
    }
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].notes, []);
    /** Actual gzip representation from the single hosting compression owner. */
    const compressed = await request(
      '/workspace/measure-response',
      undefined,
      { 'accept-encoding': 'gzip' },
      'GET'
    );
    assert.equal(compressed.status, 200);
    assert.equal(compressed.headers.get('content-encoding'), 'gzip');
    assert.match(compressed.headers.get('cache-control'), /private, no-store/);
    assert.match(compressed.headers.get('vary'), /Accept-Encoding/i);
    /** Measured encoded/decoded fixture bytes; no general production speedup is inferred. */
    const encoded = Buffer.from(await compressed.arrayBuffer()),
      decoded = gunzipSync(encoded);
    assert.ok(encoded.length < decoded.length);
    assert.ok(JSON.parse(decoded).fixture.length > 60000);
    /** Actual HEAD response must retain protocol headers while exposing no body. */
    const head = await request(
      '/workspace/measure-response',
      undefined,
      { 'accept-encoding': 'gzip' },
      'HEAD'
    );
    assert.equal(await head.text(), '');
    /** Actual unknown-operation denial proves that shell-like names never become executable handlers. */
    const unknown = await (
      await request('/rpc', {
        jsonrpc: '2.0',
        id: 3,
        method: 'shell.exec',
        params: {},
      })
    ).json();
    assert.equal(unknown.error.code, -32601);
    /** Current synthetic session proof serialized only into the owned loopback request. */
    const cookie = [...f.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let eventRequest;
    /** Actual SSE data wait, bounded by the separate fixture deadline and server connection lifetime. */
    const eventData = new Promise((resolve, reject) => {
      eventRequest = nodeRequest(
        base + '/events',
        { headers: { host: 'localhost:3010', origin, cookie } },
        (res) => {
          assert.equal(
            res.headers['cache-control'],
            'private, no-store, no-transform'
          );
          let text = '';
          res.on('data', (chunk) => {
            text += chunk;
            if (text.includes('event: note.saved')) {
              resolve(text);
            }
          });
          res.on('error', (error) => {
            if (error.code !== 'ECONNRESET') {
              reject(error);
            }
          });
        }
      );
      eventRequest.on('error', reject);
      eventRequest.end();
    });
    /** Native response event proves the SSE connection exists before publishing a note. */
    const opened = once(eventRequest, 'response');
    await opened;
    /** Actual session-bound challenge obtained from a native form, never a fabricated privileged proof. */
    const csrf = await f.csrf('/workspace/notes');
    await f.call('/workspace/save', {
      method: 'POST',
      body: {
        csrf,
        id: '',
        title: 'Private event body sentinel',
        body: 'Do not put me in SSE',
        revision: '0',
        published: 'false',
      },
    });
    /** Actual metadata-only SSE payload; private title/body sentinels must stay excluded. */
    const event = await Promise.race([
      eventData,
      new Promise((_, reject) => {
        /** Owned unrefed fixture deadline; it cannot keep the process alive after native cleanup. */
        const timer = setTimeout(
          () => reject(Error('SSE fixture deadline')),
          3000
        );
        timer.unref();
      }),
    ]);
    assert.match(event, /event: note.saved/);
    assert.doesNotMatch(event, /Private event body sentinel|Do not put me/);
    eventRequest.destroy();
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await f.close();
  }
});
test('initialization/dependency failure and resource cleanup fail closed', async () => {
  /** Owned integration fixture; every case closes its actual services and disposable state in finally. */
  const f = await fixture();
  try {
    await f.app.close();
    assert.equal((await f.call('/workspace')).status, 503);
    await assert.rejects(
      createWorkspace({
        ...f.options,
        origin: 'http://remote.invalid',
        migrate: false,
      }),
      /ORIGIN_INVALID/
    );
    await f.reopen();
    assert.equal((await f.call('/workspace')).status, 200);
    /** Deliberately absent private directory; ordinary startup must not silently initialize it. */
    const missing = join(f.options.directory, 'missing');
    await assert.rejects(
      createWorkspace({ ...f.options, directory: missing, migrate: false })
    );
    /** Synthetic symlink alias exercises directory rejection without touching unrelated paths. */
    const alias = join(f.options.directory, 'alias');
    await symlink(f.options.directory, alias);
    await assert.rejects(
      createWorkspace({ ...f.options, directory: alias }),
      /DIRECTORY_UNSAFE/
    );
  } finally {
    await f.close();
  }
});
test('consent-bound analytics, exact report data, immutable assets and durable short links', async () => {
  /** Owned integration fixture; every case closes its actual services and disposable state in finally. */
  const f = await fixture();
  try {
    await f.login();
    let csrf = await f.csrf('/workspace/reports');
    assert.equal(
      (
        await f.call('/workspace/analytics/record', {
          method: 'POST',
          body: { csrf, section: 'files', duration: '100', consent: 'denied' },
        })
      ).status,
      303
    );
    assert.equal(
      (await (await f.call('/workspace/report-data')).json()).total,
      0
    );
    assert.equal(
      (
        await f.call('/workspace/analytics/record', {
          method: 'POST',
          body: { csrf, section: 'files', duration: '100', consent: 'granted' },
        })
      ).status,
      303
    );
    /** Actual persisted aggregate; consent denial and exact database coverage are independently asserted. */
    const report = await (await f.call('/workspace/report-data')).json();
    assert.equal(report.total, 1);
    assert.equal(report.queryMode, 'database');
    assert.equal(report.truncated, false);
    csrf = await f.csrf('/workspace/assets');
    /** Actual response from the tested owner; assertions consume bodies rather than inventing success. */
    const response = await f.call('/workspace/assets/upload', {
      method: 'POST',
      body: {
        csrf,
        name: 'Local specification',
        content: 'Verified bytes',
        revision: '0',
      },
    });
    assert.equal(response.status, 303, await response.text());
    /** Actual immutable catalog output; version references are verified after durable reopen. */
    const assets = await (await f.call('/workspace/assets')).text();
    assert.match(assets, /Local specification/);
    /** Actual immutable asset version extracted from the authenticated catalog response. */
    const version = assets.match(/download\?version=([a-f0-9]{48})/)[1];
    assert.equal(
      await (
        await f.call('/workspace/assets/download?version=' + version)
      ).text(),
      'Verified bytes'
    );
    assert.equal(
      (
        await f.call('/workspace/assets/upload', {
          method: 'POST',
          body: { csrf, name: 'Stale', content: 'No commit', revision: '0' },
        })
      ).status,
      409
    );
    csrf = await f.csrf('/workspace/share');
    /** Actual short-link creation output; redirect state must survive generation reopen. */
    const created = await (
      await f.call('/workspace/share/create', {
        method: 'POST',
        body: { csrf },
      })
    ).text();
    /** Server-created same-origin short link, never an arbitrary supplied redirect target. */
    const shortUrl = created.match(
      /href="(http:\/\/localhost:3010\/workspace\/s\/[^"]+)"/
    )[1];
    await f.reopen();
    /** Actual durable short-link response with explicit temporary status/destination policy. */
    const redirect = await f.call(new URL(shortUrl).pathname);
    assert.equal(redirect.status, 302);
    assert.equal(
      redirect.headers.get('location'),
      origin + '/workspace/public'
    );
    assert.equal(
      await (
        await f.call('/workspace/assets/download?version=' + version)
      ).text(),
      'Verified bytes'
    );
  } finally {
    await f.close();
  }
});
test('local experiment consent/stability and inert email template composition', async () => {
  /** Owned integration fixture; every case closes its actual services and disposable state in finally. */
  const f = await fixture();
  try {
    await f.login();
    let csrf = await f.csrf('/workspace/experiments');
    assert.match(
      await (
        await f.call('/workspace/experiments/evaluate', {
          method: 'POST',
          body: { csrf, consent: 'denied' },
        })
      ).text(),
      /No assignment/
    );
    /** Explicit consented assignment request against the fixed authenticated experiment. */
    /** Submit one explicitly consented fixed experiment request.
     * @returns {Promise<Response>} Actual assignment page, independent of statistical claims.
     */
    const evaluate = () =>
      f.call('/workspace/experiments/evaluate', {
        method: 'POST',
        body: { csrf, consent: 'granted' },
      });
    /** Actual repeated assignment pages must expose a stable named variant. */
    const first = await (await evaluate()).text(),
      second = await (await evaluate()).text();
    /** Read only the escaped public variant field from actual rendered output; never execute response text. */
    /** Read the escaped public variant from actual output without evaluating its text.
     * @param {string} html - Actual synthetic assignment response.
     * @returns {string | undefined} Named variant when the expected field is present.
     */
    const variant = (html) =>
      html.match(/&quot;variant&quot;: &quot;(\w+)&quot;/)?.[1];
    assert.ok(['comfortable', 'compact', 'focused'].includes(variant(first)));
    assert.equal(variant(first), variant(second));
    csrf = await f.csrf('/workspace/email');
    /** Actual inert template preview; untrusted title/body must remain escaped and no SMTP is contacted. */
    const email = await (
      await f.call('/workspace/email/preview', {
        method: 'POST',
        body: {
          csrf,
          title: '<script>bad()</script>',
          body: 'Untrusted <img onerror=bad()>',
        },
      })
    ).text();
    assert.doesNotMatch(email, /<script>bad|<img onerror/);
    assert.match(email, /No SMTP connection or delivery was attempted/);
  } finally {
    await f.close();
  }
});
test('site isolation, concurrent note revisions and tag consent remain authoritative', async () => {
  /** Owned integration fixture; every case closes its actual services and disposable state in finally. */
  const f = await fixture();
  let other;
  try {
    await f.login();
    /** Actual session-bound challenge obtained from a native form, never a fabricated privileged proof. */
    const csrf = await f.csrf('/workspace/notes');
    /** Explicit synthetic form data; forged CSRF/origin and malformed inputs are intentional denial cases. */
    const body = {
      csrf,
      id: '',
      title: 'Site-only public sentinel',
      body: 'Only the configured site',
      revision: '0',
      published: 'true',
    };
    assert.equal(
      (await f.call('/workspace/save', { method: 'POST', body })).status,
      303
    );
    /** Actual rendered fixture HTML; token/record references are inspected only in this isolated test. */
    const page = await (await f.call('/workspace/notes')).text(),
      id = page.match(/name="id"[^>]*value="([a-f0-9-]{36})"/)[1];
    /** Concurrent actual revision writes must produce one success and one conflict. */
    const edits = await Promise.all(
      [1, 2].map((index) =>
        f.call('/workspace/save', {
          method: 'POST',
          body: { ...body, id, revision: '1', title: 'Concurrent ' + index },
        })
      )
    );
    assert.deepEqual(
      edits.map((response) => response.status).sort(),
      [303, 409]
    );
    other = await createWorkspace({ ...f.options, site: 'other-site' });
    assert.doesNotMatch(
      await (
        await other.handle(new Request(origin + '/workspace/public'))
      ).text(),
      /Site-only public sentinel|Concurrent/
    );
    /** Actual challenge from the current fixture session, not a browser-declared tenant or role. */
    const token = await f.csrf('/workspace/tags');
    /** Persisted consented-event baseline before denied dispatch, not a sampled guess. */
    const before = (await (await f.call('/workspace/report-data')).json())
      .total;
    assert.equal(
      (
        await f.call('/workspace/tags/dispatch', {
          method: 'POST',
          body: { csrf: token, consent: 'denied' },
        })
      ).status,
      200
    );
    assert.equal(
      (await (await f.call('/workspace/report-data')).json()).total,
      before
    );
    /** Actual explicitly consented local tag result; no remote destination is configured. */
    const dispatched = await f.call('/workspace/tags/dispatch', {
      method: 'POST',
      body: { csrf: token, consent: 'granted' },
    });
    assert.equal(dispatched.status, 200);
    assert.match(await dispatched.text(), /local/);
    assert.equal(
      (await (await f.call('/workspace/report-data')).json()).total,
      before + 1
    );
  } finally {
    await other?.close();
    await f.close();
  }
});
test(
  'public framework lifecycle mounts real routes and preserves durable state through generation reload',
  { timeout: 15000 },
  async () => {
    /** Owned integration fixture; every case closes its actual services and disposable state in finally. */
    const f = await fixture(),
      applicationRoot = await mkdtemp(join(tmpdir(), 'workspace-framework-'));
    /** Owned lifecycle bus for the synthetic framework generation, explicitly disposed after reload. */
    const hooks = createServerLifecycleHooks();
    let lifecycle, server;
    /** Observed process listener-budget warnings, removed from global observation during cleanup. */
    const warnings = [],
      /** Observe only listener-budget warnings during this bounded fixture.
       * @param {Error} warning - Native process warning, never an application payload.
       * @returns {void} Records matching warning identity for the final cleanup assertion.
       */
      onWarning = (warning) => {
        if (warning.name === 'MaxListenersExceededWarning') {
          warnings.push(warning);
        }
      };
    process.on('warning', onWarning);
    try {
      await f.app.close();
      server = createServer((req, res) => {
        if (lifecycle) {
          void lifecycle.handle(req, res);
        } else {
          res.writeHead(503);
          res.end();
        }
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      /** Actual owned ephemeral listener origin used by the copied synthetic framework fixture. */
      const address = `http://127.0.0.1:${server.address().port}`;
      await mkdir(join(applicationRoot, 'app'));
      await mkdir(join(applicationRoot, 'plugins'));
      /** Synthetic-only private settings copied into a mode-0600 temporary plugin; never operator secrets. */
      const { key, ...settings } = {
        ...f.options,
        origin: address,
        migrate: false,
      };
      await writeFile(
        join(applicationRoot, 'plugins/workspace.mjs'),
        `import {createWorkspace} from ${JSON.stringify(bundleUrl)}; export default async api=>{const app=await createWorkspace({...${JSON.stringify(settings)},key:Buffer.from(${JSON.stringify([...key])})});api.onDispose(()=>app.close());app.observeLifecycle(api.lifecycleHooks?.());app.install(api);};`,
        { mode: 0o600 }
      );
      lifecycle = await createApplicationLifecycle({
        rootDir: applicationRoot,
        mode: 'start',
        config: { type: 'fix', lifecycleHooks: hooks },
        drainTimeoutMs: 100,
      });
      /** Per-fixture synthetic cookies retained only for actual same-origin requests. */
      const jar = new Map();
      /** Fixture request helper preserves cookies and origin while allowing explicit denial cases. */
      /** Exercise actual copied framework routes on the owned loopback listener.
       * @param {string} path - Fixed local test route.
       * @param {object | undefined} body - Optional synthetic URL-encoded form values.
       * @returns {Promise<Response>} Actual native response with redirects left explicit.
       */
      const call = async (path, body) => {
        /** Actual response from the tested owner; assertions consume bodies rather than inventing success. */
        const response = await fetch(address + path, {
          redirect: 'manual',
          method: body ? 'POST' : 'GET',
          headers: {
            cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
            ...(body
              ? {
                  origin: address,
                  'content-type': 'application/x-www-form-urlencoded',
                }
              : {}),
          },
          ...(body ? { body: new URLSearchParams(body) } : {}),
        });
        for (const cookie of response.headers.getSetCookie()) {
          /** Synthetic cookie pair from the actual response, retained only within this fixture’s jar. */
          const [name, value] = cookie.split(';')[0].split('=');
          jar.set(name, value);
        }
        return response;
      };
      /** Actual challenge from the current fixture session, not a browser-declared tenant or role. */
      /** Read an actual framework-rendered form challenge and retain its cookie.
       * @param {string} path - Known fixture form route.
       * @returns {Promise<string>} Actual challenge after asserting a successful native page response.
       */
      const token = async (path) => {
        /** Actual response from the tested owner; assertions consume bodies rather than inventing success. */
        const response = await call(path);
        assert.equal(response.status, 200, await response.clone().text());
        return (await response.text()).match(
          /name="csrf"[^>]*value="([^"]+)"/
        )[1];
      };
      /** Actual session-bound challenge obtained from a native form, never a fabricated privileged proof. */
      const csrf = await token('/workspace/login');
      assert.equal(
        (
          await call('/workspace/login', {
            csrf,
            username: 'operator',
            password: 'synthetic-test-password',
          })
        ).status,
        303
      );
      assert.equal(
        (
          await call('/workspace/save', {
            csrf: await token('/workspace/notes'),
            id: '',
            title: 'Framework reload sentinel',
            body: 'Durable local request',
            revision: '0',
            published: 'false',
          })
        ).status,
        303
      );
      assert.match(
        await (await call('/workspace/notes')).text(),
        /Framework reload sentinel/
      );
      assert.match(
        await (await call('/workspace/diagnostics')).text(),
        /request:before/
      );
      await lifecycle.reload({ type: 'fix', lifecycleHooks: hooks });
      assert.match(
        await (await call('/workspace/notes')).text(),
        /Framework reload sentinel/
      );
    } finally {
      server?.closeAllConnections();
      await lifecycle?.close();
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
      hooks.dispose();
      await f.close();
      await rm(applicationRoot, { recursive: true, force: true });
      await new Promise(setImmediate);
      process.off('warning', onWarning);
      assert.equal(
        warnings.length,
        0,
        'bounded framework/Fetch ownership must not exceed listener budgets'
      );
    }
  }
);

test('disabled legacy MySQL demo imports safely and rejects before requesting a connection', async () => {
  /** Owned isolated test bundle, never the operator’s production build output. */
  const outfile = join(buildDir, 'db-demo.mjs');
  await build({
    entryPoints: [join(root, 'lib/db-demo.ts')],
    outfile,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  /** Preserve and restore the operator’s optional-demo flag without opening an external connection. */
  const previous = process.env.ENABLE_MYSQL_DEMO;
  try {
    delete process.env.ENABLE_MYSQL_DEMO;
    /** Actual disabled-module import; invoking it must reject before requesting a connection. */
    const demo = await import(pathToFileURL(outfile).href);
    assert.throws(
      () => demo.getDbDemoConnection(),
      (error) => error.status === 503
    );
    await assert.rejects(
      demo.ensureDbDemoTable(),
      (error) => error.status === 503
    );
  } finally {
    if (previous === undefined) {
      delete process.env.ENABLE_MYSQL_DEMO;
    } else {
      process.env.ENABLE_MYSQL_DEMO = previous;
    }
  }
});
