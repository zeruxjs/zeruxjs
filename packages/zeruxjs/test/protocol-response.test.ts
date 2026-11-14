import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bootstrapApplication } from '../dist/bootstrap/runtime.js';
import { cached, stream } from '../dist/response.js';
/** Bind only an ephemeral loopback listener for the protocol fixture.
 * @param {http.Server} server - Test-owned HTTP server.
 * @returns {Promise<number>} Assigned port after listening succeeds.
 */
const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  );
/** Close the test-owned loopback server after protocol requests settle.
 * @param {http.Server} server - Listener owned by this test.
 * @returns {Promise<void>} Resolves when server close completes.
 */
const stop = (server) => new Promise((resolve) => server.close(resolve));
/** Send one bounded synthetic request to the loopback fixture.
 * @param {number} port - Ephemeral fixture port.
 * @param {string} url - Relative request path.
 * @param {object} [options] - Authored method, headers and body.
 * @returns {Promise<object>} Status, headers and buffered small fixture response.
 */
const request = (port, url, options = {}) =>
  new Promise((resolve, reject) => {
    /** Owned native request completed after the optional authored body is written. */
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: url,
        method: options.method ?? 'GET',
        headers: { Host: 'localhost', ...(options.headers ?? {}) },
      },
      (res) => {
        /** Small fixture response chunks collected until the native end event. */
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.once('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          })
        );
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
test('Zerux entry plugin registers RPC/MCP/Connect and returns cache-controlled and streaming responses', async () => {
  /** Temporary framework root removed after protocol and listener teardown. */
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zerux-proto-'));
  /** Explicit local protocol settings; no public deployment or remote transport is opened. */
  const config = {
    server: { allowedDomains: ['localhost'] },
    protocols: { mcp: { name: 'test', version: '1.0.0' } },
  };
  /** Fixed project structure pointing every generated output at the temporary root. */
  const structure = {
    mode: 'fix',
    rootDir: dir,
    serviceName: 'zerux',
    entryPointName: 'index',
    appDir: null,
    middlewareDirs: [],
    controllerDirs: [],
    composableDirs: [],
    pluginDirs: [],
    envFiles: [],
    publicDirs: [],
    outputDir: dir,
    raw: {},
  };
  /** Synthetic runtime owning the protocol registrations used by this fixture. */
  const { runtime } = await bootstrapApplication(
    dir,
    'start',
    config,
    structure
  );
  /** Generation plugin API registering the authored RPC, MCP and Connect handlers. */
  const api = runtime.asPluginApi();
  api.protocols().rpc('hello', (params) => params);
  api
    .protocols()
    .tool(
      'sum',
      'sum',
      { type: 'object', properties: { x: { type: 'number' } } },
      (args) => args.x
    );
  api.protocols().connect('Service', 'Echo', (input) => input);
  api.addRoute({
    pattern: '/cached',
    method: 'ALL',
    handler: () =>
      cached({ ok: true }, { visibility: 'public', maxAge: 60, etag: true }),
  });
  api.addRoute({
    pattern: '/upload',
    method: 'POST',
    meta: { streamBody: true },
    handler: async (ctx) => {
      let size = 0;
      for await (const chunk of ctx.requestStream) {
        size += chunk.length;
      }
      return { size };
    },
  });
  api.addRoute({
    pattern: '/stream',
    method: 'GET',
    handler: () =>
      stream(
        (async function* () {
          yield 'one';
          yield 'two';
        })(),
        { contentType: 'text/plain', maxBytes: 16 }
      ),
  });
  /** Test-owned ephemeral HTTP server running only the synthetic runtime handler. */
  const server = http.createServer(runtime.createHandler());
  /** Assigned loopback port used for all fixture requests. */
  const port = await listen(server);
  try {
    /** JSON-RPC response checked for the registered echo result. */
    const rpc = await request(port, '/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'hello',
        params: { k: 9 },
      }),
    });
    assert.deepEqual(JSON.parse(rpc.body.toString()).result, { k: 9 });
    /** MCP discovery response checked for the explicitly registered sum tool. */
    const mcp = await request(port, '/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/list' }),
    });
    assert.equal(JSON.parse(mcp.body.toString()).result.tools[0].name, 'sum');
    /** Connect-style echo response proving the registered protocol path is mounted. */
    const connect = await request(port, '/Service/Echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ping: true }),
    });
    assert.deepEqual(JSON.parse(connect.body.toString()), { ping: true });
    /** Initial cacheable representation carrying the validator used by the next request. */
    const first = await request(port, '/cached');
    assert.match(first.headers['cache-control'], /public/);
    /** Conditional response expected to omit a body after validator agreement. */
    const second = await request(port, '/cached', {
      headers: { 'if-none-match': first.headers.etag },
    });
    assert.equal(second.status, 304);
    /** HEAD response checked independently of the corresponding GET body. */
    const head = await request(port, '/cached', { method: 'HEAD' });
    assert.equal(head.body.length, 0);
    /** Bounded streamed representation checked for order and no-transform cache policy. */
    const s = await request(port, '/stream');
    assert.equal(s.body.toString(), 'onetwo');
    assert.equal(s.headers['cache-control'], 'no-store, no-transform');
    /** Synthetic streamed upload response proving the runtime counts the full input. */
    const upload = await request(port, '/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.alloc(1024 * 1024 + 1, 97),
    });
    assert.equal(JSON.parse(upload.body.toString()).size, 1024 * 1024 + 1);
    /** Fixed-label runtime load counters checked after all requests have completed. */
    const load = runtime.getLoadStatus();
    assert.ok(load.statusFamilies['2xx'] >= 5);
    assert.ok(load.statusFamilies['3xx'] >= 1);
    assert.equal(load.active, 0);
    assert.equal(api.getLoadStatus().completed, load.completed);
  } finally {
    runtime.closeProtocols();
    await stop(server);
    await rm(dir, { recursive: true, force: true });
  }
});
