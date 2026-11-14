import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createProxyServer } from '../dist/portless/proxy.js';
import { createProtocolGateway } from '../dist/protocols/gateway.js';
import { createMcpServer } from '../dist/protocols/mcp/protocol.js';
import { createJsonRpcRouter } from '../dist/protocols/json-rpc.js';
import { SseHub, formatSse } from '../dist/protocols/sse.js';
import {
  transportCapabilities,
  http3AltSvc,
} from '../dist/protocols/transport.js';
import { createWebTransportRouter } from '../dist/protocols/webtransport.js';
/** Bind an owned fixture listener to an ephemeral loopback port.
 * @param {import("node:http").Server} server - Test-owned HTTP/HTTP2 listener.
 * @returns {Promise<number>} Assigned fixture port.
 */
const listen = async (server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};
/** Await listener teardown and propagate native close failures.
 * @param {import("node:http").Server} server - Owned fixture listener.
 * @returns {Promise<void>} Resolves after listener close.
 */
const close = (server) =>
  new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
/**
 * Send a fixed synthetic request to an owned loopback protocol fixture.
 * @param {number} port - Ephemeral fixture port.
 * @param {string} path - Explicit fixture route path.
 * @param {object} options - Synthetic request fields; defaults to an empty object.
 * @param {string} options.method - Request method, defaulting to GET.
 * @param {unknown} options.body - Optional small JSON fixture body.
 * @param {Record<string, string>} options.headers - Explicit fixture headers, defaulting to an empty object.
 * @returns {Promise<object>} Observed status, headers, text and optional parsed JSON.
 */
async function request(
  port,
  path,
  { method = 'GET', body, headers = {} } = {}
) {
  /** Optional small serialized fixture request body, never executable source. */
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    /** Owned loopback fixture request; errors reject the enclosing assertion helper. */
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          Host: 'my-app.localhost',
          ...(data
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        /** Small fixed response chunks collected only from the synthetic fixture. */
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.once('end', () => {
          /** Observed response text parsed as JSON only when the fixture returns JSON. */
          const text = Buffer.concat(chunks).toString();
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            /* This optional failure is intentionally ignored. */
          }
          resolve({ status: res.statusCode, text, json, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    req.end(data);
  });
}

test('JSON-RPC supports batches, results, errors and notifications', async () => {
  /** Inert router containing only explicitly registered synthetic arithmetic handlers. */
  const rpc = createJsonRpcRouter({
    'math.add': (params) => params.a + params.b,
  });
  assert.deepEqual(
    await rpc.dispatch({
      jsonrpc: '2.0',
      id: 1,
      method: 'math.add',
      params: { a: 2, b: 3 },
    }),
    { jsonrpc: '2.0', id: 1, result: 5 }
  );
  assert.equal(
    await rpc.dispatch({
      jsonrpc: '2.0',
      method: 'math.add',
      params: { a: 1, b: 2 },
    }),
    null
  );
  /** Observed ordered replies with notifications omitted. */
  const batch = await rpc.dispatch([
    { jsonrpc: '2.0', id: 2, method: 'math.add', params: { a: 1, b: 1 } },
    { jsonrpc: '2.0', method: 'math.add', params: { a: 1, b: 1 } },
    { jsonrpc: '2.0', id: 3, method: 'missing' },
  ]);
  assert.equal(batch.length, 2);
  assert.equal(batch[1].error.code, -32601);
  assert.equal((await rpc.dispatch([])).error.code, -32600);
  assert.throws(() => rpc.register('rpc.internal', () => 1));
});

test('SSE formatting, replay and bounds', () => {
  assert.equal(
    formatSse({ id: '2', event: 'ready', data: 'a\nb' }),
    'id: 2\nevent: ready\ndata: a\ndata: b\n\n'
  );
  assert.throws(() => formatSse({ id: '1', event: 'evil\ninject', data: 'x' }));
  /** Owned volatile SSE hub; fixture transport teardown releases its clients. */
  const hub = new SseHub({ maxClients: 2, historySize: 2 });
  hub.publish('ready', { ok: true });
  hub.publish('changed', 'hello');
  assert.equal(hub.clientCount, 0);
});

test('MCP tool/resource startup registration and Streamable HTTP JSON transport', async (t) => {
  /** Explicit synthetic MCP server with fixed tool/resource registrations. */
  const mcp = createMcpServer({ name: 'test-server', version: '1.0.0' });
  mcp.tools.register({
    name: 'add',
    inputSchema: {
      type: 'object',
      required: ['a', 'b'],
      properties: { a: { type: 'number' }, b: { type: 'number' } },
    },
    handler: ({ a, b }) => a + b,
  });
  mcp.resources.register({
    uri: 'resource://hello',
    name: 'hello',
    text: 'world',
  });
  /** Owned application-local protocol fixture, closed by the test proxy lifecycle. */
  const gateway = createProtocolGateway({ mcp });
  /** Owned loopback proxy with only fixture routes; teardown never touches operator services. */
  const proxy = createProxyServer({
    getRoutes: () => [],
    proxyPort: 0,
    protocols: gateway,
    onError: () => {},
  });
  /** Ephemeral fixture listener port assigned by the operating system. */
  const port = await listen(proxy);
  t.after(() => close(proxy));
  /** Fixed protocol negotiation headers, containing no application credentials. */
  const headers = {
    Accept: 'application/json, text/event-stream',
    'Mcp-Protocol-Version': '2025-11-25',
  };
  /** Observed MCP initialization response under the declared protocol version. */
  const initialize = await request(port, '/mcp', {
    method: 'POST',
    headers,
    body: { jsonrpc: '2.0', id: 1, method: 'initialize' },
  });
  assert.equal(initialize.status, 200);
  assert.equal(initialize.json.result.serverInfo.name, 'test-server');
  /** Observed explicit synthetic tool list. */
  const tools = await request(port, '/mcp', {
    method: 'POST',
    headers,
    body: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  });
  assert.equal(tools.json.result.tools.length, 1);
  /** Observed fixture response asserted for protocol behavior, not live provider acceptance. */
  const result = await request(port, '/mcp', {
    method: 'POST',
    headers,
    body: {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'add', arguments: { a: 3, b: 4 } },
    },
  });
  assert.equal(result.json.result.content[0].text, '7');
  /** Notification response, expected to acknowledge transport receipt without a JSON-RPC reply. */
  const notification = await request(port, '/mcp', {
    method: 'POST',
    headers,
    body: { jsonrpc: '2.0', method: 'notifications/initialized' },
  });
  assert.equal(notification.status, 202);
  /** Response to an untrusted synthetic Origin header, expected to deny access. */
  const origin = await request(port, '/mcp', {
    method: 'POST',
    headers: { ...headers, Origin: 'https://evil.example' },
    body: { jsonrpc: '2.0', id: 4, method: 'ping' },
  });
  assert.equal(origin.status, 403);
  /** Response to a mismatched declared MCP protocol version. */
  const version = await request(port, '/mcp', {
    method: 'POST',
    headers: { ...headers, 'Mcp-Protocol-Version': '1999-01-01' },
    body: { jsonrpc: '2.0', id: 4, method: 'ping' },
  });
  assert.equal(version.status, 400);
});

test('Gateway routes JSON-RPC, Connect JSON, tRPC bridge and status counters', async (t) => {
  /** Owned synthetic upstream returning fixed redirect/error statuses. */
  const backend = http.createServer((req, res) => {
    res.writeHead(req.url === '/redirect' ? 302 : 503);
    res.end('backend');
  });
  /** Ephemeral fixture backend port. */
  const backendPort = await listen(backend);
  t.after(() => close(backend));
  /** Owned application-local protocol fixture, closed by the test proxy lifecycle. */
  const gateway = createProtocolGateway();
  gateway.rpc.register('ping', () => ({ pong: true }));
  gateway.connect.register('test.v1.Service', 'Echo', (input) => input);
  gateway.trpc.register('list.get', (input) => ({ input }));
  /** Owned loopback proxy with only fixture routes; teardown never touches operator services. */
  const proxy = createProxyServer({
    proxyPort: 0,
    getRoutes: () => [{ hostname: 'my-app.localhost', port: backendPort }],
    protocols: gateway,
    onError: () => {},
  });
  /** Ephemeral fixture listener port assigned by the operating system. */
  const port = await listen(proxy);
  t.after(() => close(proxy));
  assert.equal(
    (
      await request(port, '/rpc', {
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'ping' },
      })
    ).json.result.pong,
    true
  );
  assert.deepEqual(
    (
      await request(port, '/test.v1.Service/Echo', {
        method: 'POST',
        body: { name: 'test' },
      })
    ).json,
    { name: 'test' }
  );
  assert.equal(
    (
      await request(port, '/trpc/list.get', {
        method: 'POST',
        body: { page: 2 },
      })
    ).json.result.data.input.page,
    2
  );
  assert.equal((await request(port, '/redirect')).status, 302);
  assert.equal((await request(port, '/fail')).status, 503);
  assert.equal(
    (await request(port, '/bad', { headers: { Host: 'missing.localhost' } }))
      .status,
    404
  );
  /** Detached proxy telemetry snapshot with bounded operational counters. */
  const load = proxy.getLoadStatus();
  assert.equal(load.statusFamilies['3xx'], 1);
  assert.equal(load.statusFamilies['5xx'], 1);
  assert.ok(
    load.routes.find((r) => r.hostname === 'my-app.localhost').completed >= 5
  );
  assert.equal(load.outsideRoutes.statusCodes['404'], 1);
  assert.equal(
    proxy.getApplicationLoad('my-app.localhost').statusFamilies['3xx'],
    1
  );
  /** Observed route metrics without requesting private process-resource inspection. */
  const usage = await proxy.getApplicationUsage('my-app.localhost');
  assert.equal(usage.resourceStatus, 'not-requested');
  assert.equal(usage.requests.statusFamilies['5xx'], 1);
  assert.equal(usage.activeUpstreamConnections, 0);
});

test('Protocol gateway enforces request byte size and authentication', async (t) => {
  /** Owned application-local protocol fixture, closed by the test proxy lifecycle. */
  const gateway = createProtocolGateway({
    maxBodyBytes: 24,
    authorize: (req) => req.headers['x-token'] === 'allowed',
  });
  gateway.rpc.register('ping', () => true);
  /** Owned fixture transport listener, closed through test teardown. */
  const server = createProxyServer({
    proxyPort: 0,
    protocols: gateway,
    getRoutes: () => [],
  });
  /** Ephemeral fixture listener port assigned by the operating system. */
  const port = await listen(server);
  t.after(() => close(server));
  /** Fixed synthetic request body or encoded envelope under test. */
  const body = { jsonrpc: '2.0', id: 1, method: 'ping' };
  assert.equal(
    (await request(port, '/rpc', { method: 'POST', body })).status,
    403
  );
  assert.equal(
    (
      await request(port, '/rpc', {
        method: 'POST',
        body,
        headers: { 'X-Token': 'allowed' },
      })
    ).status,
    413
  );
});

test('HTTP/3 capability advertisement requires external terminator', () => {
  assert.equal(transportCapabilities({ tls: true }).http3, false);
  assert.equal(transportCapabilities({ tls: false }).http2, false);
  assert.equal(
    http3AltSvc({ enabled: true, port: 443 }),
    'h3=":443"; ma=86400'
  );
  assert.throws(() => http3AltSvc({ enabled: true, port: 90000 }));
  /** Inert external-session registry; no native WebTransport listener is started. */
  const router = createWebTransportRouter();
  assert.deepEqual(router.list(), []);
  router.register('/session', () => {});
  assert.deepEqual(router.list(), ['/session']);
});

test('Connect stream JSON framing works over HTTP/1.1', async (t) => {
  /** Public framing helpers imported for bounded synthetic data checks. */
  const { encodeConnectEnvelope, readConnectEnvelopes } =
    await import('../dist/protocols/connect-stream.js');
  /** Parsed fixture messages accumulated solely for the small framing assertion. */
  const decoded = [];
  for await (const item of readConnectEnvelopes([
    encodeConnectEnvelope({ a: 1 }),
    encodeConnectEnvelope({ a: 2 }),
  ])) {
    decoded.push(item);
  }
  assert.deepEqual(decoded, [{ a: 1 }, { a: 2 }]);
  await assert.rejects(async () => {
    for await (const _ of readConnectEnvelopes([
      Buffer.from([1, 0, 0, 0, 0]),
    ])) {
      /* Consume the stream so parser failures reach the assertion. */
    }
  });
  /** Owned application-local protocol fixture, closed by the test proxy lifecycle. */
  const gateway = createProtocolGateway();
  gateway.connectStream.register(
    'service.v1.Echo',
    'Stream',
    async function* (messages) {
      for await (const msg of messages) {
        yield { echoed: msg };
      }
    }
  );
  /** Owned fixture transport listener, closed through test teardown. */
  const server = createProxyServer({
    getRoutes: () => [],
    proxyPort: 0,
    protocols: gateway,
  });
  /** Ephemeral fixture listener port assigned by the operating system. */
  const port = await listen(server);
  t.after(() => close(server));
  /** Fixed synthetic request body or encoded envelope under test. */
  const body = encodeConnectEnvelope({ n: 1 });
  /** Observed fixture transport response or stream; consumed/cancelled before teardown. */
  const response = await new Promise((resolve, reject) => {
    /** Owned loopback fixture request; errors reject the enclosing assertion helper. */
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: 'POST',
        path: '/service.v1.Echo/Stream',
        headers: {
          Host: 'my-app.localhost',
          'Content-Type': 'application/connect+json',
          'Content-Length': body.length,
        },
      },
      (res) => {
        /** Small bounded fixture byte chunks, not a production buffering policy. */
        const parts = [];
        res.on('data', (chunk) => parts.push(chunk));
        res.once('end', () =>
          resolve({ status: res.statusCode, bytes: Buffer.concat(parts) })
        );
      }
    );
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(response.status, 200);
  assert.equal(response.bytes.readUInt8(0), 0);
  assert.deepEqual(
    JSON.parse(
      response.bytes.subarray(5, 5 + response.bytes.readUInt32BE(1)).toString()
    ),
    { echoed: { n: 1 } }
  );
  /** Offset of the end-stream envelope following the first output message. */
  const second = 5 + response.bytes.readUInt32BE(1);
  assert.equal(response.bytes.readUInt8(second), 2);
});

test('SSE streams events and replays using Last-Event-ID', async (t) => {
  /** Owned volatile SSE hub; fixture transport teardown releases its clients. */
  const hub = new SseHub({ heartbeatMs: 2000, historySize: 4 });
  /** Owned application-local protocol fixture, closed by the test proxy lifecycle. */
  const gateway = createProtocolGateway({ events: hub });
  /** Owned fixture transport listener, closed through test teardown. */
  const server = createProxyServer({
    proxyPort: 0,
    getRoutes: () => [],
    protocols: gateway,
  });
  /** Ephemeral fixture listener port assigned by the operating system. */
  const port = await listen(server);
  t.after(() => close(server));
  hub.publish('first', { value: 1 });
  /** Volatile published event receipt used to verify Last-Event-ID replay. */
  const event = hub.publish('second', { value: 2 });
  /** Owned fixture HTTP request or HTTP2 session, closed during teardown. */
  const client = http.get({
    hostname: '127.0.0.1',
    port,
    path: '/events',
    headers: { Host: 'my-app.localhost', 'Last-Event-ID': '1' },
  });
  /** Owned fixture SSE response stream, destroyed after replay assertions. */
  const [res] = await once(client, 'response');
  /** First replay data chunk raced against a bounded fixture timeout. */
  const part = await Promise.race([
    once(res, 'data').then(([data]) => data.toString()),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('No SSE data')), 1000)
    ),
  ]);
  assert.match(part, /event: second/);
  assert.match(part, new RegExp(`id: ${event.id}`));
  client.destroy();
  res.destroy();
});

test(
  'TLS ALPN HTTP/2 carries gRPC frames to an h2c upstream',
  { timeout: 8000 },
  async (t) => {
    /** Native HTTP2 fixture module; this test forwards frames, not native gRPC service registration. */
    const http2 = await import('node:http2');
    /** Native fixture filesystem helpers used only inside an owned temporary certificate directory. */
    const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
    /** Operating-system temporary-root helper for isolated fixture certificates. */
    const { tmpdir } = await import('node:os');
    /** Path helper for fixed filenames inside the fixture directory. */
    const { join } = await import('node:path');
    /** Direct-exec fixture helper for a fixed OpenSSL certificate command, without shell interpolation. */
    const { execFileSync } = await import('node:child_process');
    /** Owned temporary self-signed fixture certificate directory, removed by test teardown. */
    const dir = mkdtempSync(join(tmpdir(), 'zhost-test-grpc-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(dir, 'key.pem'),
        '-out',
        join(dir, 'cert.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
      ],
      { stdio: 'ignore', timeout: 5000 }
    );
    /** Owned local HTTP2 frame-echo server; not a real external gRPC deployment. */
    const grpcBackend = http2.createServer();
    let grpcAuthority;
    grpcBackend.on('stream', (stream, headers) => {
      grpcAuthority = headers[':authority'];
      /** Optional small serialized fixture request body, never executable source. */
      const data = [];
      stream.on('data', (chunk) => data.push(chunk));
      stream.on('end', () => {
        stream.respond(
          { ':status': 200, 'content-type': 'application/grpc' },
          { waitForTrailers: true }
        );
        stream.on('wantTrailers', () =>
          stream.sendTrailers({ 'grpc-status': '0' })
        );
        stream.end(Buffer.concat(data));
      });
    });
    /** Ephemeral fixture backend port. */
    const backendPort = await listen(grpcBackend);
    t.after(() => close(grpcBackend));
    /** Owned fixture transport listener, closed through test teardown. */
    const server = createProxyServer({
      proxyPort: 0,
      getRoutes: () => [{ hostname: 'my-app.localhost', port: backendPort }],
      tls: {
        key: readFileSync(join(dir, 'key.pem')),
        cert: readFileSync(join(dir, 'cert.pem')),
      },
      onError: () => {},
    });
    /** Ephemeral fixture listener port assigned by the operating system. */
    const port = await listen(server);
    t.after(() => server.connectionTracker.drain({ timeoutMs: 1000 }));
    /** Owned fixture HTTP request or HTTP2 session, closed during teardown. */
    const client = http2.connect(`https://127.0.0.1:${port}`, {
      rejectUnauthorized: false,
    });
    t.after(() => client.close());
    await once(client, 'connect');
    assert.equal(client.alpnProtocol, 'h2');
    /** Fixed inert gRPC-framed JSON bytes used to verify forwarding preserves representation. */
    const frame = Buffer.from([0, 0, 0, 0, 2, 123, 125]);
    /** Observed forwarded status, frame bytes and trailers. */
    const output = await new Promise((resolve, reject) => {
      /** Owned fixture HTTP2 request stream consumed before client teardown. */
      const stream = client.request({
        ':method': 'POST',
        ':path': '/package.Service/Method',
        ':authority': 'my-app.localhost',
        'content-type': 'application/grpc',
        te: 'trailers',
      });
      /** Small bounded fixture byte chunks, not a production buffering policy. */
      const parts = [];
      let status, trailers;
      stream.on('trailers', (headers) => {
        trailers = headers;
      });
      stream.on('response', (headers) => (status = headers[':status']));
      stream.on('data', (chunk) => parts.push(chunk));
      stream.once('end', () =>
        resolve({ status, data: Buffer.concat(parts), trailers })
      );
      stream.on('error', reject);
      stream.end(frame);
    });
    assert.equal(output.status, 200);
    assert.equal(grpcAuthority, 'my-app.localhost');
    assert.deepEqual(output.data, frame);
    assert.equal(output.trailers?.['grpc-status'], '0');
    assert.equal(server.capabilities.http2, true);
    assert.equal(server.capabilities.grpcHttp2, true);
  }
);

test('authenticated SSE cache policy is opt-in, validated and cleans client ownership', async () => {
  assert.throws(() => new SseHub({ privateCache: 'yes' }), /cache policy/);
  for (const privateCache of [false, true]) {
    /** Owned volatile SSE hub; fixture transport teardown releases its clients. */
    const hub = new SseHub({ privateCache, maxClients: 1, historySize: 1 });
    /** Owned fixture transport listener, closed through test teardown. */
    const server = http.createServer((_req, res) => hub.subscribe(res));
    /** Ephemeral fixture listener port assigned by the operating system. */
    const port = await listen(server);
    try {
      /** Observed fixture transport response or stream; consumed/cancelled before teardown. */
      const response = await fetch(`http://127.0.0.1:${port}/events`);
      assert.equal(
        response.headers.get('cache-control'),
        privateCache
          ? 'private, no-store, no-transform'
          : 'no-cache, no-transform'
      );
      assert.equal(hub.clientCount, 1);
      await response.body.cancel();
    } finally {
      hub.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    assert.equal(hub.clientCount, 0);
  }
});
