import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import * as kit from 'zhost/protocols';
import { createDevtoolsModuleHost } from 'zforge/modules';
/** Explicit small endpoint byte/concurrency/deadline budgets for isolated loopback tests. */
const limits = { maxMessageBytes: 1024, maxConcurrent: 4, timeoutMs: 2000 };
/** Exact synthetic browser origin allowlist; it never substitutes for bearer authentication. */
const origins = ['http://dev.example'];
/** Describe explicit SSE/MCP fixtures without opening a listener.
 * @returns {object} Trusted module definition with bounded endpoints and per-tool authorization.
 */
const definition = () => ({
  id: 'requests',
  title: 'Requests',
  endpoints: [
    {
      id: 'events',
      kind: 'sse',
      allowedOrigins: origins,
      limits,
      backlog: 2,
      publicFields: ['count', 'secret'],
    },
    {
      id: 'tools',
      kind: 'mcp',
      allowedOrigins: origins,
      limits,
      publicFields: ['ok', 'subject', 'secret'],
      tools: [
        {
          name: 'read',
          inputSchema: {
            type: 'object',
            properties: { count: { type: 'number' } },
          },
          authorize: (_, c) => c.principal.subject === 'owner',
          handle: (_, c) => ({
            ok: true,
            subject: c.principal.subject,
            secret: 'never-public',
          }),
        },
      ],
    },
  ],
});
/** Create an owned module host with fixed synthetic bearer authentication.
 * @param {object} [transports] - Explicit actual or failure-injected transport kit.
 * @returns {object} Scoped host; callers await close after native requests settle.
 */
const host = (transports = kit) =>
  createDevtoolsModuleHost({
    appId: 'app',
    generationId: 'generation-one',
    transports,
    authorize: async (req) =>
      req.headers.authorization === 'Bearer fixture'
        ? { subject: 'owner', expiresAt: Date.now() + 10000 }
        : null,
  });
/** Call only the explicit bound loopback endpoint returned by the fixture host.
 * @param {object} endpoint - Bound fixture endpoint address; never a caller-controlled external URL.
 * @param {string} path - Fixed protocol path, defaulting to MCP.
 * @param {object} headers - Synthetic authentication/origin/Host override for denial checks.
 * @param {string} body - Authored serialized bounded operation or deliberate oversized fixture.
 * @returns {Promise<object>} Native status, headers and text after response completion.
 */
function request(
  endpoint,
  path = '/mcp',
  headers = {},
  body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'read', arguments: { count: 1 } },
  })
) {
  return new Promise((resolve, reject) => {
    /** Owned native loopback request completed with its authored bounded JSON body. */
    const req = http.request(
      {
        host: '127.0.0.1',
        port: endpoint.address.port,
        path,
        method: 'POST',
        headers: {
          authorization: 'Bearer fixture',
          origin: origins[0],
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...headers,
        },
      },
      (res) => {
        /** Small synthetic response chunks retained only until the native end event. */
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          })
        );
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}
test(
  'real zhost endpoints deny bad auth/origin/Host, bound bodies and retire old SSE connections on reload',
  { timeout: 10000 },
  async () => {
    /** Scoped module host owning every listener and handler acquired in this test. */
    const h = host();
    let client;
    try {
      /** Original loaded module generation retained to assert stale-handle fencing after replacement. */
      const first = await h.load(definition());
      /** Actual bound endpoint addresses returned after native transport startup. */
      const endpoints = first.endpoints();
      /** Explicit bound MCP endpoint selected by its declared implementation kind. */
      const mcp = endpoints.find((e) => e.kind === 'mcp');
      /** Explicit bound SSE endpoint with bounded replay and credential expiry. */
      const sse = endpoints.find((e) => e.kind === 'sse');
      /** Authenticated MCP response checked for no-store and redacted tool output. */
      const normal = await request(mcp);
      assert.equal(normal.status, 200);
      assert.match(normal.headers['cache-control'], /no-store/);
      assert.ok(normal.body.includes('owner'));
      assert.ok(!normal.body.includes('never-public'));
      assert.equal(
        (await request(mcp, '/mcp', { authorization: '' })).status,
        403
      );
      assert.equal(
        (await request(mcp, '/mcp', { origin: 'http://attacker.test' })).status,
        403
      );
      assert.equal(
        (await request(mcp, '/mcp', { host: 'attacker.test' })).status,
        403
      );
      assert.equal(
        (
          await request(mcp, '/mcp', {
            'x-forwarded-for': '127.0.0.1',
            authorization: '',
          })
        ).status,
        403
      );
      assert.equal((await request(mcp, '/events')).status, 403);
      assert.equal(
        (await request(mcp, '/mcp', {}, 'x'.repeat(2000))).status,
        413
      );
      for (let count = 0; count < 5; count++) {
        first.publish('events', { count, secret: 'sensitive' });
      }
      let body = '';
      /** Promise for the initial native SSE replay before triggering module replacement. */
      const opened = new Promise((resolve, reject) => {
        client = http.get(
          {
            host: '127.0.0.1',
            port: sse.address.port,
            path: '/events',
            headers: {
              authorization: 'Bearer fixture',
              origin: origins[0],
              'last-event-id': '0',
            },
          },
          (res) => {
            res.on('data', (chunk) => {
              body += chunk;
              if (body.includes('"count":4')) {
                resolve(res);
              }
            });
            res.on('error', () => {});
          }
        );
        client.on('error', reject);
      });
      /** Native streaming response whose close must complete during replacement. */
      const response = await opened;
      assert.ok(body.includes('"count":3'));
      assert.ok(!body.includes('"count":0'));
      assert.ok(!body.includes('sensitive'));
      /** Terminal response promise attached before replacement drains the old native connection. */
      const ended = new Promise((resolve) => response.once('close', resolve));
      /** New exact module generation that must survive disposal through an old handle. */
      const replacement = await h.load(definition());
      await ended;
      assert.throws(() => first.publish('events', { count: 9 }));
      await first.dispose();
      assert.equal(h.status().modules, 1);
      assert.equal(
        (await request(replacement.endpoints().find((e) => e.kind === 'mcp')))
          .status,
        200
      );
      await replacement.dispose();
      assert.equal(h.status().modules, 0);
    } finally {
      client?.destroy();
      await h.close();
    }
  }
);
test('unavailable gRPC and startup failure release registered cleanups and listeners', async () => {
  /** Scoped module host owning every listener and handler acquired in this test. */
  const h = host();
  try {
    await assert.rejects(
      h.load({
        id: 'grpc-module',
        title: 'gRPC',
        endpoints: [{ id: 'grpc', kind: 'grpc', allowedOrigins: [], limits }],
      }),
      /gRPC/
    );
    assert.equal(h.status().modules, 0);
    let cleaned = 0;
    await assert.rejects(
      h.load({
        ...definition(),
        setup: async (ctx) => {
          ctx.onDispose(() => cleaned++);
          throw Error('dependency failure');
        },
      }),
      /startup/
    );
    assert.equal(cleaned, 1);
    assert.equal(h.status().modules, 0);
  } finally {
    await h.close();
  }
  /** Test-owned listener reserving a port to force deterministic startup rollback. */
  const occupied = http.createServer((_q, s) => s.end());
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  /** Independent scoped host used for the occupied-port failure fixture. */
  const second = host();
  try {
    /** Fresh trusted definition changed only to inject one explicit failure condition. */
    const d = definition();
    d.endpoints[1].bind = { host: '127.0.0.1', port: occupied.address().port };
    await assert.rejects(second.load(d), /startup/);
    assert.equal(second.status().modules, 0);
  } finally {
    await second.close();
    await new Promise((r) => occupied.close(r));
  }
});

test(
  'connection auth expiry closes SSE and MCP failures never expose private causes',
  { timeout: 5000 },
  async () => {
    /** Scoped module host owning every listener and handler acquired in this test. */
    const h = createDevtoolsModuleHost({
      appId: 'app',
      generationId: 'expiry',
      transports: kit,
      authorize: async () => ({
        subject: 'owner',
        expiresAt: Date.now() + 150,
      }),
    });
    let client;
    try {
      /** Fresh trusted definition changed only to inject one explicit failure condition. */
      const d = definition();
      d.endpoints[1].tools[0].handle = () => {
        throw Error('private-credential-detail');
      };
      /** Loaded scoped module owner used to inspect explicit endpoint error/expiry behavior. */
      const m = await h.load(d);
      /** Sanitized MCP response checked without exposing a private trusted handler cause. */
      const result = await request(m.endpoints().find((e) => e.kind === 'mcp'));
      assert.equal(result.status, 200);
      assert.ok(result.body.includes('Tool execution failed'));
      assert.ok(!result.body.includes('private-credential-detail'));
      /** Explicit bound SSE endpoint with bounded replay and credential expiry. */
      const sse = m.endpoints().find((e) => e.kind === 'sse');
      await new Promise((resolve, reject) => {
        client = http.get(
          {
            host: '127.0.0.1',
            port: sse.address.port,
            path: '/events',
            headers: { authorization: 'Bearer fixture', origin: origins[0] },
          },
          (res) => {
            res.resume();
            res.on('error', () => {});
            res.once('close', resolve);
          }
        );
        client.on('error', reject);
      });
    } finally {
      client?.destroy();
      await h.close();
    }
  }
);
