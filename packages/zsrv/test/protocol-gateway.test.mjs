import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createProxyServer } from '../dist/portless/proxy.js';
import { createProtocolGateway } from '../dist/protocols/gateway.js';
import { createMcpServer } from '../dist/protocols/mcp/protocol.js';
import { createJsonRpcRouter } from '../dist/protocols/json-rpc.js';
import { SseHub, formatSse } from '../dist/protocols/sse.js';
import { transportCapabilities, http3AltSvc } from '../dist/protocols/transport.js';
import { createWebTransportRouter } from '../dist/protocols/webtransport.js';
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; };
const close = server => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
async function request(port, path, { method = 'GET', body, headers = {} } = {}) {
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method,
      headers: { Host: 'my-app.localhost', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.once('end', () => { const text = Buffer.concat(chunks).toString(); let json; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, text, json, headers: res.headers }); });
    }); req.on('error', reject); req.end(data);
  });
}

test('JSON-RPC supports batches, results, errors and notifications', async () => {
  const rpc = createJsonRpcRouter({ 'math.add': params => params.a + params.b });
  assert.deepEqual(await rpc.dispatch({ jsonrpc: '2.0', id: 1, method: 'math.add', params: { a: 2, b: 3 } }), { jsonrpc: '2.0', id: 1, result: 5 });
  assert.equal(await rpc.dispatch({ jsonrpc: '2.0', method: 'math.add', params: { a: 1, b: 2 } }), null);
  const batch = await rpc.dispatch([{ jsonrpc: '2.0', id: 2, method: 'math.add', params: { a: 1, b: 1 } }, { jsonrpc: '2.0', method: 'math.add', params: { a: 1, b: 1 } }, { jsonrpc: '2.0', id: 3, method: 'missing' }]);
  assert.equal(batch.length, 2);
  assert.equal(batch[1].error.code, -32601);
  assert.equal((await rpc.dispatch([])).error.code, -32600);
  assert.throws(() => rpc.register('rpc.internal', () => 1));
});

test('SSE formatting, replay and bounds', () => {
  assert.equal(formatSse({ id: '2', event: 'ready', data: 'a\nb' }), 'id: 2\nevent: ready\ndata: a\ndata: b\n\n');
  assert.throws(() => formatSse({ id: '1', event: 'evil\ninject', data: 'x' }));
  const hub = new SseHub({ maxClients: 2, historySize: 2 });
  hub.publish('ready', { ok: true }); hub.publish('changed', 'hello');
  assert.equal(hub.clientCount, 0);
});

test('MCP tool/resource startup registration and Streamable HTTP JSON transport', async t => {
  const mcp = createMcpServer({ name: 'test-server', version: '1.0.0' });
  mcp.tools.register({ name: 'add', inputSchema: { type: 'object', required: ['a', 'b'], properties: { a: { type: 'number' }, b: { type: 'number' } } }, handler: ({ a, b }) => a + b });
  mcp.resources.register({ uri: 'resource://hello', name: 'hello', text: 'world' });
  const gateway = createProtocolGateway({ mcp });
  const proxy = createProxyServer({ getRoutes: () => [], proxyPort: 0, protocols: gateway, onError: () => {} });
  const port = await listen(proxy); t.after(() => close(proxy));
  const headers = { Accept: 'application/json, text/event-stream', 'Mcp-Protocol-Version': '2025-11-25' };
  const initialize = await request(port, '/mcp', { method: 'POST', headers, body: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
  assert.equal(initialize.status, 200); assert.equal(initialize.json.result.serverInfo.name, 'test-server');
  const tools = await request(port, '/mcp', { method: 'POST', headers, body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
  assert.equal(tools.json.result.tools.length, 1);
  const result = await request(port, '/mcp', { method: 'POST', headers, body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'add', arguments: { a: 3, b: 4 } } } });
  assert.equal(result.json.result.content[0].text, '7');
  const notification = await request(port, '/mcp', { method: 'POST', headers, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(notification.status, 202);
  const origin = await request(port, '/mcp', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: { jsonrpc: '2.0', id: 4, method: 'ping' } });
  assert.equal(origin.status, 403);
  const version = await request(port, '/mcp', { method: 'POST', headers: { ...headers, 'Mcp-Protocol-Version': '1999-01-01' }, body: { jsonrpc: '2.0', id: 4, method: 'ping' } });
  assert.equal(version.status, 400);
});

test('Gateway routes JSON-RPC, Connect JSON, tRPC bridge and status counters', async t => {
  const backend = http.createServer((req, res) => { res.writeHead(req.url === '/redirect' ? 302 : 503); res.end('backend'); });
  const backendPort = await listen(backend); t.after(() => close(backend));
  const gateway = createProtocolGateway();
  gateway.rpc.register('ping', () => ({ pong: true }));
  gateway.connect.register('test.v1.Service', 'Echo', input => input);
  gateway.trpc.register('list.get', input => ({ input }));
  const proxy = createProxyServer({ proxyPort: 0, getRoutes: () => [{ hostname: 'my-app.localhost', port: backendPort }], protocols: gateway, onError: () => {} });
  const port = await listen(proxy); t.after(() => close(proxy));
  assert.equal((await request(port, '/rpc', { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).json.result.pong, true);
  assert.deepEqual((await request(port, '/test.v1.Service/Echo', { method: 'POST', body: { name: 'test' } })).json, { name: 'test' });
  assert.equal((await request(port, '/trpc/list.get', { method: 'POST', body: { page: 2 } })).json.result.data.input.page, 2);
  assert.equal((await request(port, '/redirect')).status, 302);
  assert.equal((await request(port, '/fail')).status, 503);
  assert.equal((await request(port, '/bad', { headers: { Host: 'missing.localhost' } })).status, 404);
  const load = proxy.getLoadStatus();
  assert.equal(load.statusFamilies['3xx'], 1);
  assert.equal(load.statusFamilies['5xx'], 1);
  assert.ok(load.routes.find(r => r.hostname === 'my-app.localhost').completed >= 5);
  assert.equal(load.outsideRoutes.statusCodes['404'], 1);
  assert.equal(proxy.getApplicationLoad('my-app.localhost').statusFamilies['3xx'], 1);
  const usage = await proxy.getApplicationUsage('my-app.localhost');
  assert.equal(usage.resourceStatus, 'not-requested');
  assert.equal(usage.requests.statusFamilies['5xx'], 1);
  assert.equal(usage.activeUpstreamConnections, 0);
});

test('Protocol gateway enforces request byte size and authentication', async t => {
  const gateway = createProtocolGateway({ maxBodyBytes: 24, authorize: req => req.headers['x-token'] === 'allowed' });
  gateway.rpc.register('ping', () => true);
  const server = createProxyServer({ proxyPort: 0, protocols: gateway, getRoutes: () => [] });
  const port = await listen(server); t.after(() => close(server));
  const body = { jsonrpc: '2.0', id: 1, method: 'ping' };
  assert.equal((await request(port, '/rpc', { method: 'POST', body })).status, 403);
  assert.equal((await request(port, '/rpc', { method: 'POST', body, headers: { 'X-Token': 'allowed' } })).status, 413);
});

test('HTTP/3 capability advertisement requires external terminator', () => {
  assert.equal(transportCapabilities({ tls: true }).http3, false);
  assert.equal(transportCapabilities({ tls: false }).http2, false);
  assert.equal(http3AltSvc({ enabled: true, port: 443 }), 'h3=":443"; ma=86400');
  assert.throws(() => http3AltSvc({ enabled: true, port: 90000 }));
  const router = createWebTransportRouter();
  assert.deepEqual(router.list(), []);
  router.register('/session', () => {});
  assert.deepEqual(router.list(), ['/session']);
});

test('Connect stream JSON framing works over HTTP/1.1', async t => {
  const { encodeConnectEnvelope, readConnectEnvelopes } = await import('../dist/protocols/connect-stream.js');
  const decoded = [];
  for await (const item of readConnectEnvelopes([encodeConnectEnvelope({ a: 1 }), encodeConnectEnvelope({ a: 2 })])) decoded.push(item);
  assert.deepEqual(decoded, [{ a: 1 }, { a: 2 }]);
  await assert.rejects(async () => { for await (const _ of readConnectEnvelopes([Buffer.from([1, 0, 0, 0, 0])])) {} });
  const gateway = createProtocolGateway();
  gateway.connectStream.register('service.v1.Echo', 'Stream', async function* (messages) {
    for await (const msg of messages) yield { echoed: msg };
  });
  const server = createProxyServer({ getRoutes: () => [], proxyPort: 0, protocols: gateway });
  const port = await listen(server); t.after(() => close(server));
  const body = encodeConnectEnvelope({ n: 1 });
  const response = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, method: 'POST', path: '/service.v1.Echo/Stream', headers: { Host: 'my-app.localhost', 'Content-Type': 'application/connect+json', 'Content-Length': body.length } }, res => {
      const parts = []; res.on('data', chunk => parts.push(chunk)); res.once('end', () => resolve({ status: res.statusCode, bytes: Buffer.concat(parts) }));
    }); req.on('error', reject); req.end(body);
  });
  assert.equal(response.status, 200);
  assert.equal(response.bytes.readUInt8(0), 0);
  assert.deepEqual(JSON.parse(response.bytes.subarray(5, 5 + response.bytes.readUInt32BE(1)).toString()), { echoed: { n: 1 } });
  const second = 5 + response.bytes.readUInt32BE(1);
  assert.equal(response.bytes.readUInt8(second), 2);
});

test('SSE streams events and replays using Last-Event-ID', async t => {
  const hub = new SseHub({ heartbeatMs: 2000, historySize: 4 });
  const gateway = createProtocolGateway({ events: hub });
  const server = createProxyServer({ proxyPort: 0, getRoutes: () => [], protocols: gateway });
  const port = await listen(server); t.after(() => close(server));
  hub.publish('first', { value: 1 });
  const event = hub.publish('second', { value: 2 });
  const client = http.get({ hostname: '127.0.0.1', port, path: '/events', headers: { Host: 'my-app.localhost', 'Last-Event-ID': '1' } });
  const [res] = await once(client, 'response');
  const part = await Promise.race([once(res, 'data').then(([data]) => data.toString()), new Promise((_, reject) => setTimeout(() => reject(new Error('No SSE data')), 1000))]);
  assert.match(part, /event: second/);
  assert.match(part, new RegExp(`id: ${event.id}`));
  client.destroy(); res.destroy();
});

test('TLS ALPN HTTP/2 carries gRPC frames to an h2c upstream', { timeout: 8000 }, async t => {
  const http2 = await import('node:http2');
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'zsrv-test-grpc-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore', timeout: 5000 });
  const grpcBackend = http2.createServer();
  grpcBackend.on('stream', stream => {
    const data = [];
    stream.on('data', chunk => data.push(chunk));
    stream.on('end', () => {
      stream.respond({ ':status': 200, 'content-type': 'application/grpc' }, { waitForTrailers: true });
      stream.on('wantTrailers', () => stream.sendTrailers({ 'grpc-status': '0' }));
      stream.end(Buffer.concat(data));
    });
  });
  const backendPort = await listen(grpcBackend); t.after(() => close(grpcBackend));
  const server = createProxyServer({ proxyPort: 0, getRoutes: () => [{ hostname: 'my-app.localhost', port: backendPort }], tls: { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, onError: () => {} });
  const port = await listen(server); t.after(() => server.connectionTracker.drain({ timeoutMs: 1000 }));
  const client = http2.connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false });
  t.after(() => client.close());
  await once(client, 'connect');
  assert.equal(client.alpnProtocol, 'h2');
  const frame = Buffer.from([0, 0, 0, 0, 2, 123, 125]);
  const output = await new Promise((resolve, reject) => {
    const stream = client.request({ ':method': 'POST', ':path': '/package.Service/Method', ':authority': 'my-app.localhost', 'content-type': 'application/grpc', te: 'trailers' });
    const parts = []; let status, trailers;
    stream.on('trailers', headers => { trailers = headers; });
    stream.on('response', headers => status = headers[':status']);
    stream.on('data', chunk => parts.push(chunk)); stream.once('end', () => resolve({ status, data: Buffer.concat(parts), trailers }));
    stream.on('error', reject); stream.end(frame);
  });
  assert.equal(output.status, 200);
  assert.deepEqual(output.data, frame);
  assert.equal(output.trailers?.['grpc-status'], '0');
  assert.equal(server.capabilities.http2, true);
  assert.equal(server.capabilities.grpcHttp2, true);
});
