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
const root = dirname(dirname(fileURLToPath(import.meta.url)));
let buildDir, createWorkspace, bundleUrl;
before(async () => {
  await mkdir(join(root, '.zerux'), { recursive: true });
  buildDir = await mkdtemp(join(root, '.zerux/workspace-test-'));
  const outfile = join(buildDir, 'application.mjs');
  await build({ entryPoints: [join(root, 'lib/workspace/application.ts')], outfile, bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent' });
  bundleUrl = pathToFileURL(outfile).href;
  ({ createWorkspace } = await import(bundleUrl));
});
after(async () => { if (buildDir) await rm(buildDir, { recursive: true, force: true }); });
const origin = 'http://localhost:3010';
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'zerux-workspace-'));
  const options = { directory, origin, tenant: 'tenantA', site: 'main', username: 'operator', passwordHash: hashPassword('synthetic-test-password'), key: randomBytes(32), migrate: true };
  let app = await createWorkspace(options), jar = new Map();
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const response = await app.handle(new Request(origin + path, { method, headers: { cookie: [...jar].map(([k,v]) => `${k}=${v}`).join('; '), ...(body ? { origin, 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers }, ...(body ? { body: typeof body === 'string' ? body : new URLSearchParams(body) } : {}) }));
    for (const cookie of response.headers.getSetCookie()) { const [name, value] = cookie.split(';')[0].split('='); if (value) jar.set(name, value); else jar.delete(name); }
    return response;
  };
  const csrf = async path => {
    const response = await call(path);
    assert.equal(response.status, 200, await response.clone().text());
    const text = await response.text();
    return text.match(/name="csrf"[^>]*value="([^"]+)"/)?.[1] ?? text.match(/value="([^"]+)" readonly/)?.[1];
  };
  const login = async () => { const token = await csrf('/workspace/login'); assert.ok(token); const response = await call('/workspace/login', { method: 'POST', body: { csrf: token, username: 'operator', password: 'synthetic-test-password' } }); assert.equal(response.status, 303, await response.text()); };
  return { get app() { return app; }, options, call, csrf, login, jar, async reopen() { await app.close(); app = await createWorkspace({ ...options, migrate: false }); }, async close() { await app.close(); await rm(directory, { recursive: true, force: true }); } };
}
test('local forms, SQLite reload, private/public search, feeds, object storage and logout', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call('/workspace')).status, 200);
    assert.equal((await f.call('/workspace/notes')).status, 303);
    await f.login();
    let csrf = await f.csrf('/workspace/notes');
    assert.equal((await f.call('/workspace/save', { method: 'POST', body: { csrf, id: '', title: 'Private secret', body: 'Never publish me', revision: '0', published: 'false' } })).status, 303);
    assert.equal((await f.call('/workspace/save', { method: 'POST', body: { csrf, id: '', title: 'Café notebook', body: '<script>neverExecute()</script>', revision: '0', published: 'true' } })).status, 303);
    const publicPage = await (await f.call('/workspace/search?q=Café')).text();
    assert.match(publicPage, /Café notebook/); assert.doesNotMatch(publicPage, /Private secret/); assert.match(publicPage, /&lt;script&gt;/); assert.doesNotMatch(publicPage, /<script\s*>\s*neverExecute\(\)\s*<\/script\s*>/i);
    await f.reopen();
    const notes = await (await f.call('/workspace/notes')).text(); assert.match(notes, /Private secret/); assert.match(notes, /Café notebook/);
    const id = notes.match(/name="id"[^>]*value="([a-f0-9-]{36})"/)[1]; csrf = await f.csrf('/workspace/notes');
    assert.equal((await f.call('/workspace/save', { method: 'POST', body: { csrf, id, title: 'Stale', body: '', revision: '0', published: 'false' } })).status, 409);
    const feed = await f.call('/workspace/feed.json'); const etag = feed.headers.get('etag'); const data = await feed.json(); assert.equal(data.items.length, 1); assert.equal(data.items[0].title, 'Café notebook');
    assert.equal((await f.call('/workspace/feed.json', { headers: { 'if-none-match': etag } })).status, 304);
    assert.equal(await (await f.call('/workspace/feed.json', { method: 'HEAD' })).text(), '');
    assert.doesNotMatch(await (await f.call('/workspace/sitemap.xml')).text(), /Private secret|workspace\/notes|#/);
    csrf = await f.csrf('/workspace/files');
    assert.equal((await f.call('/workspace/files/create', { method: 'POST', body: { csrf, filename: 'hello.txt', content: 'Private object bytes' } })).status, 303);
    const listing = await (await f.call('/workspace/files')).text(); const href = listing.match(/href="([^"]+download[^"]+)"/)[1].replaceAll('&amp;', '&');
    assert.equal(await (await f.call(href)).text(), 'Private object bytes');
    assert.equal((await f.call('/workspace/files/download?key=tenantB/anything.txt')).status, 403);
    csrf = await f.csrf('/workspace/notes');
    assert.equal((await f.call('/workspace/logout', { method: 'POST', body: { csrf } })).status, 303);
    assert.equal((await f.call(href)).status, 303);
  } finally { await f.close(); }
});
test('denied origin, forged CSRF, duplicate fields, invalid objects and untrusted host', async () => {
  const f = await fixture();
  try {
    const csrf = await f.csrf('/workspace/login');
    const body = { csrf, username: 'operator', password: 'synthetic-test-password' };
    assert.equal((await f.call('/workspace/login', { method: 'POST', body, headers: { origin: 'https://evil.invalid' } })).status, 403);
    assert.equal((await f.call('/workspace/login', { method: 'POST', body: { ...body, csrf: 'forged' } })).status, 403);
    assert.equal((await f.call('/workspace/login', { method: 'POST', body: new URLSearchParams(body).toString() + '&username=other' })).status, 400);
    assert.equal((await f.app.handle(new Request('http://evil.invalid/workspace'))).status, 403);
    await f.login(); const token = await f.csrf('/workspace/files');
    assert.equal((await f.call('/workspace/files/create', { method: 'POST', body: { csrf: token, filename: '../escape.txt', content: 'bad' } })).status, 400);
  } finally { await f.close(); }
});
test('protocol routes enforce session/CSRF and dispatch real JSON-RPC, MCP and Connect', async () => {
  const f = await fixture(); let server;
  try {
    await f.login();
    const page = await (await f.call('/workspace/protocols')).text();
    const token = page.match(/value="([^"]+)" readonly/)[1];
    const routes = new Map(); f.app.install({ addRoute(route) { routes.set(route.pattern, route.handler); } });
    server = createServer((req, res) => {
      const handler = routes.get(new URL(req.url, origin).pathname);
      if (!handler) { res.writeHead(404); res.end(); return; }
      Promise.resolve(handler({ req, res, url: new URL(req.url, origin), method: req.method })).catch(() => { res.destroy(); });
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (path, body, extra = {}, method = 'POST') => new Promise((resolve, reject) => {
      const req = nodeRequest(base + path, { method, headers: { host: 'localhost:3010', origin, cookie: [...f.jar].map(([k,v]) => `${k}=${v}`).join('; '), 'x-csrf-token': token, 'content-type': 'application/json', ...extra } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
      }); req.on('error', reject); req.end(body instanceof Uint8Array ? body : JSON.stringify(body));
    });
    assert.equal((await request('/rpc', { jsonrpc: '2.0', id: 1, method: 'workspace.summary', params: {} }, { cookie: '' })).status, 403);
    assert.equal((await request('/rpc', {}, { 'x-csrf-token': 'forged' })).status, 403);
    const rpc = await (await request('/rpc', { jsonrpc: '2.0', id: 1, method: 'workspace.summary', params: {} })).json(); assert.equal(rpc.error, undefined, JSON.stringify(rpc)); assert.deepEqual(rpc.result.notes, []);
    const connect = await (await request('/workspace.Notebook/Summary', {})).json(); assert.deepEqual(connect.notes, []);
    const mcp = await (await request('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { accept: 'application/json, text/event-stream' })).json(); assert.equal(mcp.result.tools[0].name, 'workspace_summary');
    const trpc = await (await request('/trpc/workspace.summary', {})).json(); assert.deepEqual(trpc.result.data.notes, []);
    const streamResponse = await request('/workspace.Notebook/SummaryStream', encodeConnectEnvelope({}), { 'content-type': 'application/connect+json' });
    const messages = []; for await (const message of readConnectEnvelopes([new Uint8Array(await streamResponse.arrayBuffer())])) messages.push(message);
    assert.equal(messages.length, 1); assert.deepEqual(messages[0].notes, []);
    const compressed = await request('/workspace/measure-response', undefined, { 'accept-encoding': 'gzip' }, 'GET');
    assert.equal(compressed.status, 200); assert.equal(compressed.headers.get('content-encoding'), 'gzip'); assert.match(compressed.headers.get('cache-control'), /private, no-store/); assert.match(compressed.headers.get('vary'), /Accept-Encoding/i);
    const encoded = Buffer.from(await compressed.arrayBuffer()), decoded = gunzipSync(encoded); assert.ok(encoded.length < decoded.length); assert.ok(JSON.parse(decoded).fixture.length > 60000);
    const head = await request('/workspace/measure-response', undefined, { 'accept-encoding': 'gzip' }, 'HEAD'); assert.equal(await head.text(), '');
    const unknown = await (await request('/rpc', { jsonrpc: '2.0', id: 3, method: 'shell.exec', params: {} })).json(); assert.equal(unknown.error.code, -32601);
    const cookie = [...f.jar].map(([k,v]) => `${k}=${v}`).join('; ');
    let eventRequest;
    const eventData = new Promise((resolve, reject) => {
      eventRequest = nodeRequest(base + '/events', { headers: { host: 'localhost:3010', origin, cookie } }, res => {
        assert.equal(res.headers['cache-control'], 'private, no-store, no-transform');
        let text = ''; res.on('data', chunk => { text += chunk; if (text.includes('event: note.saved')) resolve(text); }); res.on('error', error => { if (error.code !== 'ECONNRESET') reject(error); });
      }); eventRequest.on('error', reject); eventRequest.end();
    });
    const opened = once(eventRequest, 'response'); await opened;
    const csrf = await f.csrf('/workspace/notes');
    await f.call('/workspace/save', { method: 'POST', body: { csrf, id: '', title: 'Private event body sentinel', body: 'Do not put me in SSE', revision: '0', published: 'false' } });
    const event = await Promise.race([eventData, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('SSE fixture deadline')), 3000); timer.unref(); })]);
    assert.match(event, /event: note.saved/); assert.doesNotMatch(event, /Private event body sentinel|Do not put me/); eventRequest.destroy();

  } finally { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } await f.close(); }
});
test('initialization/dependency failure and resource cleanup fail closed', async () => {
  const f = await fixture();
  try {
    await f.app.close();
    assert.equal((await f.call('/workspace')).status, 503);
    await assert.rejects(createWorkspace({ ...f.options, origin: 'http://remote.invalid', migrate: false }), /ORIGIN_INVALID/);
    await f.reopen(); assert.equal((await f.call('/workspace')).status, 200);
    const missing = join(f.options.directory, 'missing');
    await assert.rejects(createWorkspace({ ...f.options, directory: missing, migrate: false }));
    const alias = join(f.options.directory, 'alias'); await symlink(f.options.directory, alias);
    await assert.rejects(createWorkspace({ ...f.options, directory: alias }), /DIRECTORY_UNSAFE/);
  } finally { await f.close(); }
});
test('consent-bound analytics, exact report data, immutable assets and durable short links', async () => {
  const f = await fixture();
  try {
    await f.login();
    let csrf = await f.csrf('/workspace/reports');
    assert.equal((await f.call('/workspace/analytics/record', { method: 'POST', body: { csrf, section: 'files', duration: '100', consent: 'denied' } })).status, 303);
    assert.equal((await (await f.call('/workspace/report-data')).json()).total, 0);
    assert.equal((await f.call('/workspace/analytics/record', { method: 'POST', body: { csrf, section: 'files', duration: '100', consent: 'granted' } })).status, 303);
    const report = await (await f.call('/workspace/report-data')).json(); assert.equal(report.total, 1); assert.equal(report.queryMode, 'database'); assert.equal(report.truncated, false);
    csrf = await f.csrf('/workspace/assets');
    const response = await f.call('/workspace/assets/upload', { method: 'POST', body: { csrf, name: 'Local specification', content: 'Verified bytes', revision: '0' } });
    assert.equal(response.status, 303, await response.text());
    const assets = await (await f.call('/workspace/assets')).text();
    assert.match(assets, /Local specification/); const version = assets.match(/download\?version=([a-f0-9]{48})/)[1];
    assert.equal(await (await f.call('/workspace/assets/download?version=' + version)).text(), 'Verified bytes');
    assert.equal((await f.call('/workspace/assets/upload', { method: 'POST', body: { csrf, name: 'Stale', content: 'No commit', revision: '0' } })).status, 409);
    csrf = await f.csrf('/workspace/share');
    const created = await (await f.call('/workspace/share/create', { method: 'POST', body: { csrf } })).text();
    const shortUrl = created.match(/href="(http:\/\/localhost:3010\/workspace\/s\/[^\"]+)"/)[1];
    await f.reopen();
    const redirect = await f.call(new URL(shortUrl).pathname); assert.equal(redirect.status, 302); assert.equal(redirect.headers.get('location'), origin + '/workspace/public');
    assert.equal(await (await f.call('/workspace/assets/download?version=' + version)).text(), 'Verified bytes');
  } finally { await f.close(); }
});
test('local experiment consent/stability and inert email template composition', async () => {
  const f = await fixture();
  try {
    await f.login(); let csrf = await f.csrf('/workspace/experiments');
    assert.match(await (await f.call('/workspace/experiments/evaluate', { method: 'POST', body: { csrf, consent: 'denied' } })).text(), /No assignment/);
    const evaluate = () => f.call('/workspace/experiments/evaluate', { method: 'POST', body: { csrf, consent: 'granted' } });
    const first = await (await evaluate()).text(), second = await (await evaluate()).text();
    const variant = html => html.match(/&quot;variant&quot;: &quot;(\w+)&quot;/)?.[1];
    assert.ok(['comfortable', 'compact', 'focused'].includes(variant(first))); assert.equal(variant(first), variant(second));
    csrf = await f.csrf('/workspace/email');
    const email = await (await f.call('/workspace/email/preview', { method: 'POST', body: { csrf, title: '<script>bad()</script>', body: 'Untrusted <img onerror=bad()>' } })).text();
    assert.doesNotMatch(email, /<script>bad|<img onerror/); assert.match(email, /No SMTP connection or delivery was attempted/);
  } finally { await f.close(); }
});
test('site isolation, concurrent note revisions and tag consent remain authoritative', async () => {
  const f = await fixture(); let other;
  try {
    await f.login(); const csrf = await f.csrf('/workspace/notes');
    const body = { csrf, id: '', title: 'Site-only public sentinel', body: 'Only the configured site', revision: '0', published: 'true' };
    assert.equal((await f.call('/workspace/save', { method: 'POST', body })).status, 303);
    const page = await (await f.call('/workspace/notes')).text(), id = page.match(/name="id"[^>]*value="([a-f0-9-]{36})"/)[1];
    const edits = await Promise.all([1,2].map(index => f.call('/workspace/save', { method: 'POST', body: { ...body, id, revision: '1', title: 'Concurrent ' + index } })));
    assert.deepEqual(edits.map(response => response.status).sort(), [303,409]);
    other = await createWorkspace({ ...f.options, site: 'other-site' });
    assert.doesNotMatch(await (await other.handle(new Request(origin + '/workspace/public'))).text(), /Site-only public sentinel|Concurrent/);
    const token = await f.csrf('/workspace/tags');
    const before = (await (await f.call('/workspace/report-data')).json()).total;
    assert.equal((await f.call('/workspace/tags/dispatch', { method: 'POST', body: { csrf: token, consent: 'denied' } })).status, 200);
    assert.equal((await (await f.call('/workspace/report-data')).json()).total, before);
    const dispatched = await f.call('/workspace/tags/dispatch', { method: 'POST', body: { csrf: token, consent: 'granted' } });
    assert.equal(dispatched.status, 200); assert.match(await dispatched.text(), /local/);
    assert.equal((await (await f.call('/workspace/report-data')).json()).total, before + 1);
  } finally { await other?.close(); await f.close(); }
});
test('public framework lifecycle mounts real routes and preserves durable state through generation reload', { timeout: 15000 }, async () => {
  const f = await fixture(), applicationRoot = await mkdtemp(join(tmpdir(), 'workspace-framework-'));
  const hooks = createServerLifecycleHooks(); let lifecycle, server;
  const warnings = [], onWarning = warning => { if (warning.name === 'MaxListenersExceededWarning') warnings.push(warning); };
  process.on('warning', onWarning);
  try {
    await f.app.close();
    server = createServer((req, res) => { if (lifecycle) void lifecycle.handle(req, res); else { res.writeHead(503); res.end(); } });
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = `http://127.0.0.1:${server.address().port}`;
    await mkdir(join(applicationRoot, 'app')); await mkdir(join(applicationRoot, 'plugins'));
    const { key, ...settings } = { ...f.options, origin: address, migrate: false };
    await writeFile(join(applicationRoot, 'plugins/workspace.mjs'), `import {createWorkspace} from ${JSON.stringify(bundleUrl)}; export default async api=>{const app=await createWorkspace({...${JSON.stringify(settings)},key:Buffer.from(${JSON.stringify([...key])})});api.onDispose(()=>app.close());app.observeLifecycle(api.lifecycleHooks?.());app.install(api);};`, { mode: 0o600 });
    lifecycle = await createApplicationLifecycle({ rootDir: applicationRoot, mode: 'start', config: { type: 'fix', lifecycleHooks: hooks }, drainTimeoutMs: 100 });
    const jar = new Map();
    const call = async (path, body) => {
      const response = await fetch(address + path, { redirect: 'manual', method: body ? 'POST' : 'GET', headers: { cookie: [...jar].map(([k,v]) => `${k}=${v}`).join('; '), ...(body ? { origin: address, 'content-type': 'application/x-www-form-urlencoded' } : {}) }, ...(body ? { body: new URLSearchParams(body) } : {}) });
      for (const cookie of response.headers.getSetCookie()) { const [name, value] = cookie.split(';')[0].split('='); jar.set(name, value); }
      return response;
    };
    const token = async path => { const response = await call(path); assert.equal(response.status, 200, await response.clone().text()); return (await response.text()).match(/name="csrf"[^>]*value="([^"]+)"/)[1]; };
    const csrf = await token('/workspace/login');
    assert.equal((await call('/workspace/login', { csrf, username: 'operator', password: 'synthetic-test-password' })).status, 303);
    assert.equal((await call('/workspace/save', { csrf: await token('/workspace/notes'), id: '', title: 'Framework reload sentinel', body: 'Durable local request', revision: '0', published: 'false' })).status, 303);
    assert.match(await (await call('/workspace/notes')).text(), /Framework reload sentinel/);
    assert.match(await (await call('/workspace/diagnostics')).text(), /request:before/);
    await lifecycle.reload({ type: 'fix', lifecycleHooks: hooks });
    assert.match(await (await call('/workspace/notes')).text(), /Framework reload sentinel/);
  } finally {
    server?.closeAllConnections(); await lifecycle?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    hooks.dispose(); await f.close(); await rm(applicationRoot, { recursive: true, force: true });
    await new Promise(setImmediate); process.off('warning', onWarning);
    assert.equal(warnings.length, 0, 'bounded framework/Fetch ownership must not exceed listener budgets');
  }
});

test('disabled legacy MySQL demo imports safely and rejects before requesting a connection', async () => {
  const outfile = join(buildDir, 'db-demo.mjs');
  await build({ entryPoints: [join(root, 'lib/db-demo.ts')], outfile, bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent' });
  const previous = process.env.ENABLE_MYSQL_DEMO;
  try {
    delete process.env.ENABLE_MYSQL_DEMO;
    const demo = await import(pathToFileURL(outfile).href);
    assert.throws(() => demo.getDbDemoConnection(), error => error.status === 503);
    await assert.rejects(demo.ensureDbDemoTable(), error => error.status === 503);
  } finally {
    if (previous === undefined) delete process.env.ENABLE_MYSQL_DEMO;
    else process.env.ENABLE_MYSQL_DEMO = previous;
  }
});
