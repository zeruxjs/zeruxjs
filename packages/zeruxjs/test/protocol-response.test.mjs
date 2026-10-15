import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bootstrapApplication } from '../dist/bootstrap/runtime.js';
import { cached, stream } from '../dist/response.js';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const stop = server => new Promise(resolve => server.close(resolve));
const request = (port, url, options = {}) => new Promise((resolve, reject) => {
  const req = http.request({ hostname: '127.0.0.1', port, path: url, method: options.method ?? 'GET', headers: { Host: 'localhost', ...(options.headers ?? {}) } }, res => {
    const chunks = []; res.on('data', c => chunks.push(c)); res.once('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); res.on('error', reject);
  });
  req.on('error', reject);
  if (options.body) req.write(options.body);
  req.end();
});
test('Zerux entry plugin registers RPC/MCP/Connect and returns cache-controlled and streaming responses', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zerux-proto-'));
  const config = { server: { allowedDomains: ['localhost'] }, protocols: { mcp: { name: 'test', version: '1.0.0' } } };
  const structure = { mode: 'fix', rootDir: dir, serviceName: 'zerux', entryPointName: 'index', appDir: null, middlewareDirs: [], controllerDirs: [], composableDirs: [], pluginDirs: [], envFiles: [], publicDirs: [], outputDir: dir, raw: {} };
  const { runtime } = await bootstrapApplication(dir, 'start', config, structure);
  const api = runtime.asPluginApi();
  api.protocols().rpc('hello', params => params);
  api.protocols().tool('sum', 'sum', { type: 'object', properties: { x: { type: 'number' } } }, args => args.x);
  api.protocols().connect('Service', 'Echo', input => input);
  api.addRoute({ pattern: '/cached', method: 'ALL', handler: () => cached({ ok: true }, { visibility: 'public', maxAge: 60, etag: true }) });
  api.addRoute({ pattern: '/upload', method: 'POST', meta: { streamBody: true }, handler: async ctx => {
    let size = 0; for await (const chunk of ctx.requestStream) size += chunk.length;
    return { size };
  } });
  api.addRoute({ pattern: '/stream', method: 'GET', handler: () => stream((async function*() { yield 'one'; yield 'two'; })(), { contentType: 'text/plain', maxBytes: 16 }) });
  const server = http.createServer(runtime.createHandler());
  const port = await listen(server);
  try {
    const rpc = await request(port, '/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'hello', params: { k: 9 } }) });
    assert.deepEqual(JSON.parse(rpc.body.toString()).result, { k: 9 });
    const mcp = await request(port, '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/list' }) });
    assert.equal(JSON.parse(mcp.body.toString()).result.tools[0].name, 'sum');
    const connect = await request(port, '/Service/Echo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ping: true }) });
    assert.deepEqual(JSON.parse(connect.body.toString()), { ping: true });
    const first = await request(port, '/cached'); assert.match(first.headers['cache-control'], /public/);
    const second = await request(port, '/cached', { headers: { 'if-none-match': first.headers.etag } }); assert.equal(second.status, 304);
    const head = await request(port, '/cached', { method: 'HEAD' }); assert.equal(head.body.length, 0);
    const s = await request(port, '/stream'); assert.equal(s.body.toString(), 'onetwo'); assert.equal(s.headers['cache-control'], 'no-store, no-transform');
    const upload = await request(port, '/upload', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.alloc(1024 * 1024 + 1, 97) });
    assert.equal(JSON.parse(upload.body.toString()).size, 1024 * 1024 + 1);
    const load = runtime.getLoadStatus();
    assert.ok(load.statusFamilies['2xx'] >= 5);
    assert.ok(load.statusFamilies['3xx'] >= 1);
    assert.equal(load.active, 0);
    assert.equal(api.getLoadStatus().completed, load.completed);
  } finally { runtime.closeProtocols(); await stop(server); await rm(dir, { recursive: true, force: true }); }
});
