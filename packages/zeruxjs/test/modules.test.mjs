import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createApplicationLifecycle } from 'zeruxjs';
import {
  registerModule,
  defineProvider,
  createProviderToken,
} from 'zeruxjs/modules';
import { object, string } from '@zeruxjs/validator/schemas';
/** Create an isolated generation and loopback listener for provider ownership tests.
 * @returns {Promise<object>} Fixture with call and close; close owns application, sockets and temporary files.
 */
async function fixture() {
  /** Temporary module project removed after runtime and listener shutdown. */
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'zx006-'));
  /** Application lifecycle owning module registrations through its generation API. */
  const app = await createApplicationLifecycle({
    rootDir,
    config: {},
    mode: 'dev',
    providers: { database: async () => null, cache: async () => null },
    drainTimeoutMs: 100,
  });
  /** Ephemeral loopback listener serving only the synthetic module routes. */
  const server = createServer(
    (req, res) => void app.handle(req, res).catch(() => res.destroy())
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    app,
    api: app.runtime().asPluginApi(),
    server,
    /** Send one synthetic request to the isolated module application.
     * @param {string} url - Relative registered route path.
     * @param {unknown} body - Optional JSON body; absence selects GET.
     * @returns {Promise<object>} Response status and text after the native response ends.
     */
    async call(url, body) {
      return new Promise((resolve, reject) => {
        /** Owned native request completed after its authored fixture input is written. */
        const req = request(
          {
            hostname: '127.0.0.1',
            port: server.address().port,
            path: url,
            method: body === undefined ? 'GET' : 'POST',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json',
            },
          },
          (res) => {
            let text = '';
            res.on('data', (x) => (text += x));
            res.on('end', () =>
              resolve({ status: res.statusCode, body: text })
            );
          }
        );
        req.on('error', reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
      });
    },
    /** Close the generation before its listener and remove the temporary project.
     * @returns {Promise<void>} Resolves after all fixture cleanup completes.
     */
    async close() {
      await app.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}
/** Yield one event-loop turn so cooperative construction or disposal can settle.
 * @returns {Promise<void>} Resolves on the next immediate turn.
 */
const tick = () => new Promise((r) => setImmediate(r));
test('concurrent requests share a singleton, isolate request scope and dispose dependents first', async () => {
  /** Isolated module application fixture closed in finally. */
  const f = await fixture();
  /** Singleton provider token shared by concurrent requests within this module. */
  const s = createProviderToken('singleton');
  /** Request-scoped token reused within one request but isolated across requests. */
  const r = createProviderToken('request');
  /** Transient provider token producing a distinct value on each resolution. */
  const t = createProviderToken('transient');
  /** Cleanup evidence retained as ordered receipts or an owned reload-fixture file path. */
  const log = [];
  let singleton = 0,
    requestId = 0,
    transient = 0;
  try {
    await registerModule(f.api, {
      name: 'scopes',
      providers: [
        defineProvider({
          token: s,
          scope: 'singleton',
          dependencies: [],
          create: async () => {
            singleton++;
            await tick();
            return 'shared';
          },
          dispose: () => log.push('singleton'),
        }),
        defineProvider({
          token: r,
          scope: 'request',
          dependencies: [s],
          create: () => ++requestId,
          dispose: (value) => log.push(`request:${value}`),
        }),
        defineProvider({
          token: t,
          scope: 'transient',
          dependencies: [r],
          create: () => ++transient,
          dispose: (value) => log.push(`transient:${value}`),
        }),
      ],
      controllers: [
        {
          path: '/scope',
          /** Resolve only declared providers after route guards and input validation.
           * @param {unknown} _input - Unused input for provider scope fixtures.
           * @param {object} ctx - Request context carrying response and cancellation ownership.
           * @param {object} providers - Request-bound declared provider resolver.
           * @returns {Promise<unknown>} Fixture result or deliberate failure after provider resolution.
           */
          async handle(_input, ctx, providers) {
            /** Paired provider or response values compared for within-request reuse and cross-request isolation. */
            const [a, b] = await Promise.all([
              providers.get(r),
              providers.get(r),
            ]);
            /** First transient resolution, which must not be reused by the next lookup. */
            const x = await providers.get(t);
            /** Second transient resolution proving transient scope creates a distinct value. */
            const y = await providers.get(t);
            await tick();
            return { a, b, x, y };
          },
        },
      ],
    });
    /** Concurrent route responses used to compare request-scoped provider identities. */
    const results = await Promise.all([f.call('/scope'), f.call('/scope')]);
    for (const result of results) {
      assert.equal(result.status, 200);
    }
    /** Paired provider or response values compared for within-request reuse and cross-request isolation. */
    const [a, b] = results.map((x) => JSON.parse(x.body));
    assert.equal(a.a, a.b);
    assert.notEqual(a.a, b.a);
    assert.notEqual(a.x, a.y);
    assert.equal(singleton, 1);
    await tick();
    assert.equal(log.length, 6);
    for (const id of [a.a, b.a]) {
      assert.ok(
        log.indexOf(`request:${id}`) >
          log.indexOf(`transient:${id === a.a ? a.x : b.x}`)
      );
    }
  } finally {
    await f.close();
  }
  assert.equal(log.at(-1), 'singleton');
});
test('guard denial and validation failure do not instantiate privileged providers', async () => {
  /** Isolated module application fixture closed in finally. */
  const f = await fixture();
  /** Privileged request provider token that guards/validation must protect before construction. */
  const p = createProviderToken('privileged');
  let calls = 0;
  /** Ordered guard, middleware and handler receipts proving authorization precedes instantiation. */
  const order = [];
  try {
    await registerModule(f.api, {
      name: 'guard',
      providers: [
        defineProvider({
          token: p,
          scope: 'request',
          dependencies: [],
          create: () => ++calls,
        }),
      ],
      controllers: [
        {
          path: '/denied',
          guards: [() => false],
          handle: (_i, _c, r) => r.get(p),
        },
        {
          path: '/validated',
          method: 'POST',
          guards: [
            () => {
              order.push('guard');
              return true;
            },
          ],
          schema: object({ name: string() }),
          middleware: [
            async (_ctx, next) => {
              order.push('middleware');
              await next();
            },
          ],
          /** Resolve only declared providers after route guards and input validation.
           * @param {unknown} input - Validated fixture input returned by the successful route.
           * @param {object} _c - Unused request context.
           * @param {object} r - Declared provider resolver retained only to test disposed-scope rejection.
           * @returns {Promise<unknown>} Fixture result or deliberate failure after provider resolution.
           */
          async handle(input, _c, r) {
            order.push('handler');
            await r.get(p);
            return input;
          },
        },
      ],
    });
    assert.equal((await f.call('/denied')).status, 403);
    assert.equal((await f.call('/validated', { name: 123 })).status, 400);
    assert.equal(calls, 0);
    /** Successful validated request checked after denied and malformed requests. */
    const valid = await f.call('/validated', { name: 'safe' });
    assert.equal(valid.status, 200);
    assert.equal(calls, 1);
    assert.deepEqual(order, ['guard', 'guard', 'middleware', 'handler']);
    assert.doesNotMatch(
      (await f.call('/validated', { name: 123 })).body,
      /123/
    );
  } finally {
    await f.close();
  }
});
test('cycles, captive scopes and route conflicts fail before constructors or mutation', async () => {
  /** Isolated module application fixture closed in finally. */
  const f = await fixture();
  /** First provider token participating in the cycle or dependency rollback fixture. */
  const a = createProviderToken('a');
  /** Second provider token participating in the cycle or eager construction fixture. */
  const b = createProviderToken('b');
  let calls = 0;
  try {
    /** Build a counted provider for preflight cycle/scope validation.
     * @param {object} token - Typed provider token.
     * @param {object[]} dependencies - Declared provider dependencies.
     * @param {string} [scope] - Explicit lifetime under validation.
     * @returns {object} Provider definition whose constructor increments the fixture counter.
     */
    const provider = (token, dependencies, scope = 'singleton') =>
      defineProvider({ token, scope, dependencies, create: () => ++calls });
    await assert.rejects(
      registerModule(f.api, {
        name: 'cycle',
        providers: [provider(a, [b]), provider(b, [a])],
      }),
      (e) => e.code.includes('PROVIDER_CYCLE:a -> b -> a')
    );
    assert.equal(calls, 0);
    await assert.rejects(
      registerModule(f.api, {
        name: 'captive',
        providers: [provider(a, [b]), provider(b, [], 'request')],
      }),
      (e) => e.code === 'PROVIDER_CAPTIVE_SCOPE'
    );
    f.api.addRoute({
      pattern: '/existing',
      handler: () => ({ existing: true }),
    });
    await assert.rejects(
      registerModule(f.api, {
        name: 'conflict',
        controllers: [{ path: '/existing', handle: () => null }],
      })
    );
    assert.equal((await f.call('/existing')).status, 200);
  } finally {
    await f.close();
  }
});
test('eager dependency failure cleans partial construction and rolls back acquired dependencies', async () => {
  /** Isolated module application fixture closed in finally. */
  const f = await fixture();
  /** First provider token participating in the cycle or dependency rollback fixture. */
  const a = createProviderToken('a');
  /** Second provider token participating in the cycle or eager construction fixture. */
  const b = createProviderToken('b');
  /** Cleanup evidence retained as ordered receipts or an owned reload-fixture file path. */
  const log = [];
  try {
    await assert.rejects(
      registerModule(f.api, {
        name: 'partial',
        providers: [
          defineProvider({
            token: a,
            scope: 'singleton',
            dependencies: [],
            create: () => ({}),
            dispose: () => log.push('dependency'),
          }),
          defineProvider({
            token: b,
            scope: 'singleton',
            dependencies: [a],
            eager: true,
            /** Construct a request-bound fixture value or deliberately fail partial eager startup.
             * @param {object} ctx - Provider scope supplying cancellation and partial-construction cleanup.
             * @returns {number | never} Synthetic value, or the deliberate private startup failure.
             */
            create(ctx) {
              ctx.onDispose(() => log.push('partial'));
              throw Error('PRIVATE failure');
            },
          }),
        ],
        controllers: [{ path: '/not-added', handle: () => null }],
      }),
      /PRIVATE failure/
    );
    assert.deepEqual(log, ['partial', 'dependency']);
    assert.equal(f.api.hasRoute('/not-added', 'GET'), false);
  } finally {
    await f.close();
  }
});
test('module filters use existing sanitized responses and cleanup survives handler failure', async () => {
  /** Isolated module application fixture closed in finally. */
  const f = await fixture();
  /** Privileged request provider token that guards/validation must protect before construction. */
  const p = createProviderToken('resource');
  let closed = 0;
  try {
    await registerModule(f.api, {
      name: 'filter',
      providers: [
        defineProvider({
          token: p,
          scope: 'request',
          dependencies: [],
          create: () => 1,
          dispose: () => closed++,
        }),
      ],
      controllers: [
        {
          path: '/failure',
          /** Resolve only declared providers after route guards and input validation.
           * @param {unknown} _i - Unused fixture input.
           * @param {object} _c - Unused request context.
           * @param {object} r - Declared provider resolver retained only to test disposed-scope rejection.
           * @returns {Promise<unknown>} Fixture result or deliberate failure after provider resolution.
           */
          async handle(_i, _c, r) {
            await r.get(p);
            throw Error('PRIVATE');
          },
          /** Translate the private handler failure into an explicitly authored safe response.
           * @param {Error} error - Private cause visible only to the trusted filter.
           * @param {object} ctx - Response context used to emit the fixed conflict result.
           * @returns {void} Ends the sanitized response without exposing the error message.
           */
          filter(error, ctx) {
            assert.equal(error.message, 'PRIVATE');
            ctx.res.writeHead(409, { 'content-type': 'application/json' });
            ctx.res.end(JSON.stringify({ error: 'conflict' }));
          },
        },
      ],
    });
    /** Sanitized module filter response checked independently of its private error cause. */
    const result = await f.call('/failure');
    assert.equal(result.status, 409);
    assert.equal(result.body, '{"error":"conflict"}');
    await tick();
    assert.equal(closed, 1);
  } finally {
    await f.close();
  }
});

test('stream disconnect aborts request providers and retained resolvers cannot reopen scope', async () => {
  /** Isolated module application fixture closed in finally. */
  const f = await fixture();
  /** Privileged request provider token that guards/validation must protect before construction. */
  const p = createProviderToken('stream');
  let escaped,
    closed = 0,
    signal;
  try {
    await registerModule(f.api, {
      name: 'stream',
      providers: [
        defineProvider({
          token: p,
          scope: 'request',
          dependencies: [],
          /** Construct a request-bound fixture value or deliberately fail partial eager startup.
           * @param {object} ctx - Provider scope supplying cancellation and partial-construction cleanup.
           * @returns {number | never} Synthetic value, or the deliberate private startup failure.
           */
          create(ctx) {
            signal = ctx.signal;
            return 1;
          },
          dispose: () => closed++,
        }),
      ],
      controllers: [
        {
          path: '/stream',
          /** Resolve only declared providers after route guards and input validation.
           * @param {unknown} _i - Unused fixture input.
           * @param {object} ctx - Request context carrying response and cancellation ownership.
           * @param {object} r - Declared provider resolver retained only to test disposed-scope rejection.
           * @returns {Promise<unknown>} Fixture result or deliberate failure after provider resolution.
           */
          async handle(_i, ctx, r) {
            escaped = r;
            await r.get(p);
            ctx.res.writeHead(200, { 'content-type': 'text/event-stream' });
            ctx.res.write('data: first\n\n');
            await new Promise((resolve) =>
              signal.addEventListener('abort', resolve, { once: true })
            );
          },
        },
      ],
    });
    await new Promise((resolve, reject) => {
      /** Owned native request completed after its authored fixture input is written. */
      const req = request(
        {
          hostname: '127.0.0.1',
          port: f.server.address().port,
          path: '/stream',
        },
        (res) =>
          res.once('data', () => {
            req.destroy();
            resolve();
          })
      );
      req.on('error', reject);
      req.end();
    });
    for (let i = 0; i < 20 && closed === 0; i++) {
      await tick();
    }
    assert.equal(signal.aborted, true);
    assert.equal(closed, 1);
    await assert.rejects(
      escaped.get(p),
      (e) => e.code === 'PROVIDER_SCOPE_CLOSED'
    );
  } finally {
    await f.close();
  }
});
test('a later startup error disposes registered modules and preserves the active generation', async () => {
  /** Isolated module application fixture closed in finally. */
  const f = await fixture();
  try {
    f.api.addRoute({ pattern: '/alive', handler: () => ({ alive: true }) });
    /** Current fixture project root receiving the reload candidate module. */
    const root = f.app.runtime().rootDir;
    /** Cleanup evidence retained as ordered receipts or an owned reload-fixture file path. */
    const log = path.join(root, 'cleanup.txt');
    await symlink(
      path.resolve('../../node_modules'),
      path.join(root, 'node_modules'),
      'dir'
    );
    await writeFile(
      path.join(root, 'index.mjs'),
      `import {registerModule,defineProvider,createProviderToken} from 'zeruxjs/modules';\nimport {appendFile} from 'node:fs/promises';\nexport default async function(api){const token=createProviderToken('resource');await registerModule(api,{name:'candidate',providers:[defineProvider({token,scope:'singleton',dependencies:[],eager:true,create:()=>1,dispose:()=>appendFile(${JSON.stringify(log)},'closed')})]});throw Error('candidate failed');}`
    );
    await assert.rejects(f.app.reload({}), /candidate failed/);
    assert.equal(await readFile(log, 'utf8'), 'closed');
    assert.equal((await f.call('/alive')).status, 200);
  } finally {
    await f.close();
  }
});
