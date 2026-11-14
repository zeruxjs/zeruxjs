import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, cp, mkdir, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApplicationLifecycle } from 'zeruxjs';
import { createProviderToken, defineProvider } from 'zeruxjs/modules';
import { registerGraphQL } from 'zeruxjs/graphql';
/** Fixed authored schema covering field/data authorization, bounded queries and subscriptions. */
const typeDefs =
  'type Query { hello: String secret: String user(id: ID!): User nested: User slow: String } type User { tenant: String name: String child: User } type Mutation { write: String } type Subscription { tick: Int! }';
/** Verify only the explicit synthetic authorization subjects.
 * @param {object} request - Host request context carrying the fixture authorization header.
 * @returns {object | null} Tenant-bound synthetic principal with expiry, or denied identity.
 */
const identity = (request) => {
  /** Candidate fixture authorization subject checked against the fixed allowlist. */
  const subject = request.req.headers.authorization;
  return ['a', 'b'].includes(subject)
    ? { subject, tenant: subject, expiresAt: Date.now() + 10000 }
    : null;
};
/** Create isolated trusted resolver and authorization configuration.
 * @returns {object} Private GraphQL registration with explicit field/data/mutation policies.
 */
const base = () => ({
  name: 'graph',
  path: '/graphql',
  typeDefs,
  resolvers: {
    Query: {
      hello: () => 'hello',
      secret: () => 'PRIVATE',
      user: (_s, { id }, ctx) => ctx.load('users', id, batch),
      nested: () => ({ name: 'nested', child: { name: 'child' } }),
      slow: (_s, _a, { signal }) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () => resolve('late'), {
            once: true,
          })
        ),
    },
    Mutation: { write: () => 'written' },
  },
  authenticate: identity,
  authorizeField: (ctx, info, source) =>
    info.fieldName !== 'secret' &&
    (!source?.tenant || source.tenant === ctx.principal.tenant),
  authorizeData: (principal, _loader, key, row) =>
    key !== 'other' && (!row || row.tenant === principal.tenant),
  protectMutation: (request) => request.req.headers['x-test-csrf'] === 'valid',
  introspection: false,
  persisted: { required: false, operations: {} },
});
/** Batch only authorized fixture loader keys within the initiating principal scope.
 * @param {string[]} keys - Bounded loader keys from the current request.
 * @param {object} ctx - Request context carrying the verified tenant principal.
 * @returns {Promise<object[]>} Tenant-scoped synthetic records in input-key order.
 */
async function batch(keys, ctx) {
  await new Promise((r) => setImmediate(r));
  return keys.map((key) => ({
    tenant: ctx.principal.tenant,
    name: `${ctx.principal.tenant}:${key}`,
  }));
}
/** Register the GraphQL module on an isolated application generation.
 * @param {object} extra - Explicit schema, limits or authorization fixture overrides.
 * @returns {Promise<object>} Application/GraphQL/listener owner with call and close helpers.
 */
async function fixture(extra = {}) {
  /** Temporary GraphQL project removed after application and listener shutdown. */
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'zx097-'));
  /** Application generation owning the GraphQL module and request provider scopes. */
  const app = await createApplicationLifecycle({
    rootDir,
    mode: 'dev',
    config: {},
    providers: { database: async () => null, cache: async () => null },
  });
  /** Generation-owned GraphQL registration exposing actual active-work counters. */
  const graph = await registerGraphQL(app.runtime().asPluginApi(), {
    ...base(),
    ...extra,
  });
  /** Test-owned ephemeral loopback listener for native GraphQL/SSE requests. */
  const server = createServer(
    (req, res) => void app.handle(req, res).catch(() => res.destroy())
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  /** Explicit loopback GraphQL endpoint; no remote provider is used. */
  const url = `http://127.0.0.1:${server.address().port}/graphql`;
  return {
    app,
    graph,
    url,
    /** Send one authored GraphQL POST using explicit synthetic authorization.
     * @param {unknown} body - Operation request or deliberately invalid request fixture.
     * @param {object} headers - Explicit authentication/CSRF header overrides.
     * @returns {Promise<object>} HTTP status and parsed bounded JSON response.
     */
    async call(body, headers = {}) {
      /** Native response checked before parsing JSON or reading the SSE body. */
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'a',
          ...headers,
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    },
    /** Drain the generation before closing native connections and removing fixture files.
     * @returns {Promise<void>} Resolves after all isolated fixture cleanup.
     */
    async close() {
      await app.close();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

test('queries authorize each field/row and concurrent loader caches isolate principals', async () => {
  /** Isolated GraphQL fixture closed after requests and provider disposal settle. */
  const f = await fixture();
  try {
    assert.deepEqual((await f.call({ query: '{ hello }' })).data, {
      data: { hello: 'hello' },
    });
    /** Field-denied response checked for null data and no private cause disclosure. */
    const denied = await f.call({ query: '{ secret }' });
    assert.equal(denied.data.data.secret, null);
    assert.doesNotMatch(JSON.stringify(denied), /PRIVATE|stack|extensions/);
    /** Concurrent tenant-specific loader results checked for principal cache isolation. */
    const results = await Promise.all(
      ['a', 'b'].map((authorization) =>
        f.call({ query: '{ user(id:"1") { name } }' }, { authorization })
      )
    );
    assert.deepEqual(
      results.map((r) => r.data.data.user.name),
      ['a:1', 'b:1']
    );
    assert.equal(
      (await f.call({ query: '{ user(id:"other") { name } }' })).data.data.user,
      null
    );
    assert.equal(
      (await f.call({ query: '{ hello }' }, { authorization: 'forged' }))
        .status,
      403
    );
  } finally {
    await f.close();
  }
});
test('aliases, fragments, depth, complexity, variables, batching and introspection are bounded', async () => {
  /** Isolated GraphQL fixture closed after requests and provider disposal settle. */
  const f = await fixture({
    limits: {
      maxAliases: 1,
      maxDepth: 2,
      maxComplexity: 4,
      maxVariablesBytes: 64,
    },
  });
  try {
    for (const body of [
      { query: '{ a:hello b:hello }' },
      { query: '{ nested { child { child { name } } } }' },
      { query: '{ hello secret slow nested { name } }' },
      { query: '{ __schema { types { name } } }' },
      {
        query: 'query($id:ID!){ user(id:$id){name}}',
        variables: { id: 'x'.repeat(100) },
      },
      [{ query: '{hello}' }],
      {
        query:
          'query { nested { ...A } } fragment A on User { child { child {name} } }',
      },
    ]) {
      assert.equal((await f.call(body)).status, 400);
    }
  } finally {
    await f.close();
  }
});
test('persisted operations are server registered; mutations require explicit CSRF/origin policy', async () => {
  /** Server-authored persisted query registered before request handling. */
  const query = '{ hello }';
  /** SHA-256 identifier of the fixed registered query, not a client-authorized arbitrary operation. */
  const id = createHash('sha256').update(query).digest('hex');
  /** Isolated GraphQL fixture closed after requests and provider disposal settle. */
  const f = await fixture({
    persisted: { required: true, operations: { [id]: query } },
  });
  try {
    assert.equal((await f.call({ query })).status, 400);
    assert.equal(
      (
        await f.call({
          extensions: {
            persistedQuery: { version: 1, sha256Hash: '0'.repeat(64) },
          },
        })
      ).status,
      400
    );
    assert.equal(
      (
        await f.call({
          extensions: { persistedQuery: { version: 1, sha256Hash: id } },
        })
      ).data.data.hello,
      'hello'
    );
  } finally {
    await f.close();
  }
  /** Independent fixture checking explicit mutation CSRF policy. */
  const mutation = await fixture();
  try {
    assert.equal(
      (await mutation.call({ query: 'mutation {write}' })).status,
      403
    );
    assert.equal(
      (
        await mutation.call(
          { query: 'mutation {write}' },
          { 'x-test-csrf': 'valid' }
        )
      ).data.data.write,
      'written'
    );
  } finally {
    await mutation.close();
  }
});
test('resolver timeout aborts cooperative work and sanitizes private failures', async () => {
  /** Private host error-hook receipts kept out of public response JSON. */
  const errors = [];
  /** Fresh resolver/policy fixture modified only for this isolated test. */
  const options = base();
  options.resolvers.Query.hello = () => {
    throw Error('PRIVATE SQL credentials');
  };
  /** Isolated GraphQL fixture closed after requests and provider disposal settle. */
  const f = await fixture({
    ...options,
    limits: { timeoutMs: 25 },
    onError: (error) => errors.push(error),
  });
  try {
    /** Sanitized response to the intentionally private resolver failure. */
    const failed = await f.call({ query: '{hello}' });
    assert.doesNotMatch(JSON.stringify(failed), /PRIVATE|credentials|stack/);
    assert.ok(errors.length);
    assert.equal((await f.call({ query: '{slow}' })).status, 504);
    for (let i = 0; i < 20 && f.graph.activeRequests; i++) {
      await new Promise((r) => setTimeout(r, 1));
    }
    assert.equal(f.graph.activeRequests, 0);
  } finally {
    await f.close();
  }
});
/** Wait cooperatively while removing both timer and abort listener on settlement.
 * @param {AbortSignal} signal - Request-owned cancellation signal.
 * @param {number} ms - Short bounded synthetic delay.
 * @returns {Promise<void>} Completes on elapsed delay or cooperative cancellation.
 */
function wait(signal, ms) {
  return new Promise((resolve) => {
    /** Idempotent wait completion callback removing its timer and abort listener.
     * @returns {void} Resolves the cooperative fixture wait once.
     */
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    /** Owned timer cleared by either elapsed wait or cancellation. */
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    if (signal.aborted) {
      done();
    }
  });
}
test(
  'maintained distinct SSE subscription cancels source on disconnect, expiry and reauthorization denial',
  { timeout: 5000 },
  async () => {
    for (const mode of ['disconnect', 'expiry', 'reauthorize']) {
      let released = 0,
        checks = 0;
      /** Fresh resolver/policy fixture modified only for this isolated test. */
      const options = base();
      options.resolvers.Subscription = {
        tick: {
          /** Produce only bounded fixture ticks until subscription cancellation or expiry.
           * @param {unknown} _s - Unused subscription source.
           * @param {unknown} _a - Unused authored operation arguments.
           * @param {{signal: AbortSignal}} context - Request cancellation context controlling this generator.
           * @returns {AsyncGenerator<{tick: number}>} Cooperative synthetic ticks; finally records source disposal.
           */
          async *subscribe(_s, _a, { signal }) {
            try {
              let n = 0;
              while (!signal.aborted) {
                yield { tick: ++n };
                await wait(signal, 5);
              }
            } finally {
              released++;
            }
          },
          resolve: (source) => source.tick,
        },
      };
      options.authenticate = (request) => {
        /** Verified fixture principal extended only with an explicit test expiry. */
        const principal = identity(request);
        return {
          ...principal,
          expiresAt: Date.now() + (mode === 'expiry' ? 100 : 1000),
        };
      };
      options.subscriptions = {
        maxDurationMs: 500,
        reauthorizeMs: 20,
        /** Recheck the explicit synthetic subscription policy after its configured interval.
         * @returns {boolean} False only for the intentional reauthorization-denial fixture.
         */
        reauthorize() {
          checks++;
          return mode !== 'reauthorize';
        },
      };
      /** Isolated GraphQL fixture closed after requests and provider disposal settle. */
      const f = await fixture(options);
      try {
        /** Native response checked before parsing JSON or reading the SSE body. */
        const response = await fetch(f.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            authorization: 'a',
          },
          body: JSON.stringify({ query: 'subscription {tick}' }),
        });
        assert.equal(response.status, 200);
        /** Owned SSE reader cancelled or drained, then released before fixture close. */
        const reader = response.body.getReader();
        let text = '';
        while (!text.includes('event: next')) {
          /** SSE byte chunk inspected until the first next event is observed. */
          const part = await reader.read();
          assert.equal(part.done, false);
          text += new TextDecoder().decode(part.value);
        }
        if (mode === 'disconnect') {
          await reader.cancel();
        } else {
          try {
            while (!(await reader.read()).done) {
              /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
            }
          } catch {
            /* auth expiry destroys the native stream */
          }
        }
        reader.releaseLock();
        for (let i = 0; i < 100 && released === 0; i++) {
          await new Promise((r) => setTimeout(r, 2));
        }
        assert.equal(released, 1);
        assert.equal(f.graph.activeRequests, 0);
        if (mode === 'reauthorize') {
          assert.ok(checks >= 1);
        }
      } finally {
        await f.close();
      }
    }
  }
);
test('optional dependency failure is explicit and schema validation precedes registration', async () => {
  /** Fresh resolver/policy fixture modified only for this isolated test. */
  const options = base();
  await assert.rejects(
    registerGraphQL({}, { ...options, typeDefs: 'type Query {bad: Missing}' }),
    (e) => e.code === 'GRAPHQL_SCHEMA_INVALID'
  );
  /** Isolated copied package missing optional peers to exercise explicit dependency diagnostics. */
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'zx097-missing-'));
  try {
    /** Copied framework package directory whose export map uses only generated public modules. */
    const pkg = path.join(tmp, 'node_modules/zeruxjs');
    await mkdir(pkg, { recursive: true });
    await cp(path.resolve('dist'), path.join(pkg, 'dist'), { recursive: true });
    await writeFile(
      path.join(pkg, 'package.json'),
      JSON.stringify({
        type: 'module',
        exports: { './graphql': './dist/graphql.js' },
      })
    );
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import{registerGraphQL}from'zeruxjs/graphql';const o={name:'test',path:'/graphql',typeDefs:'type Query {a:Int}',resolvers:{},authenticate(){},authorizeField(){},authorizeData(){},protectMutation(){},introspection:false,persisted:{required:false,operations:{}}};try{await registerGraphQL({},o);process.exitCode=1;}catch(e){if(e.code!=='GRAPHQL_DEPENDENCY_UNAVAILABLE')throw e;}`,
      ],
      { cwd: tmp }
    );
    await symlink(
      path.dirname(fileURLToPath(import.meta.resolve('graphql'))),
      path.join(tmp, 'node_modules/graphql')
    );
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import{registerGraphQL}from'zeruxjs/graphql';const o={name:'test',path:'/graphql',typeDefs:'type Query {a:Int}',resolvers:{},authenticate(){},authorizeField(){},authorizeData(){},protectMutation(){},introspection:false,persisted:{required:false,operations:{}},subscriptions:{maxDurationMs:20,reauthorizeMs:10,reauthorize(){return true;}}};try{await registerGraphQL({},o);process.exitCode=1;}catch(e){if(e.code!=='GRAPHQL_SSE_UNAVAILABLE')throw e;}`,
      ],
      { cwd: tmp }
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('response overflow fails safely and capacity is held until cancelled work settles', async () => {
  /** Fresh private GraphQL configuration used for overflow/provider-lifetime fixtures. */
  const config = base();
  config.resolvers.Query.hello = () => 'x'.repeat(256);
  /** Owned fixture configured with a deliberately small response byte budget. */
  const small = await fixture({ ...config, limits: { maxResponseBytes: 128 } });
  try {
    /** Bounded query response checked for safe overflow or list-budget failures. */
    const result = await small.call({ query: '{hello}' });
    assert.doesNotMatch(JSON.stringify(result), /x{20}/);
  } finally {
    await small.close();
  }
  let started;
  /** Barrier proving a cooperative resolver started before cancellation/capacity checks. */
  const began = new Promise((r) => (started = r));
  /** Fresh resolver/policy fixture modified only for this isolated test. */
  const options = base();
  options.resolvers.Query.slow = (_s, _a, { signal }) =>
    new Promise((resolve) => {
      started();
      signal.addEventListener('abort', () => resolve('done'), { once: true });
    });
  /** Isolated GraphQL fixture closed after requests and provider disposal settle. */
  const f = await fixture({ ...options, limits: { maxConcurrent: 1 } });
  /** Caller cancellation owner explicitly aborted again during teardown. */
  const controller = new AbortController();
  try {
    /** Pending native request cancelled without replaying its resolver. */
    const call = fetch(f.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'a' },
      body: JSON.stringify({ query: '{slow}' }),
      signal: controller.signal,
    });
    /** Expected request rejection attached before aborting the caller signal. */
    const cancelled = assert.rejects(call);
    await began;
    assert.equal((await f.call({ query: '{hello}' })).status, 503);
    controller.abort();
    await cancelled;
    for (let i = 0; i < 50 && f.graph.activeRequests; i++) {
      await new Promise((r) => setTimeout(r, 1));
    }
    assert.equal(f.graph.activeRequests, 0);
  } finally {
    controller.abort();
    await f.close();
  }
});

test('operation capacity includes asynchronous provider disposal', async () => {
  /** Request provider token whose asynchronous disposal retains operation capacity. */
  const token = createProviderToken('held');
  let release, entered;
  /** Controlled provider-disposal wait released explicitly during cleanup. */
  const barrier = new Promise((r) => (release = r));
  /** Barrier proving request provider disposal began before overload is asserted. */
  const disposing = new Promise((r) => (entered = r));
  /** Fresh private GraphQL configuration used for overflow/provider-lifetime fixtures. */
  const config = base();
  config.providers = [
    defineProvider({
      token,
      scope: 'request',
      dependencies: [],
      create: () => 1,
      /** Retain operation capacity until the controlled provider cleanup barrier settles.
       * @returns {Promise<void>} Completes only when the fixture explicitly releases provider disposal.
       */
      async dispose() {
        entered();
        await barrier;
      },
    }),
  ];
  config.resolvers.Query.hello = async (_s, _a, ctx) => {
    await ctx.providers.get(token);
    return 'hello';
  };
  /** Isolated GraphQL fixture closed after requests and provider disposal settle. */
  const f = await fixture({ ...config, limits: { maxConcurrent: 1 } });
  try {
    assert.equal((await f.call({ query: '{hello}' })).status, 200);
    await disposing;
    assert.equal(f.graph.activeRequests, 1);
    assert.equal((await f.call({ query: '{hello}' })).status, 503);
    release();
    for (let i = 0; i < 50 && f.graph.activeRequests; i++) {
      await new Promise((r) => setTimeout(r, 1));
    }
    assert.equal(f.graph.activeRequests, 0);
  } finally {
    release();
    await f.close();
  }
});

test('nested list limits and non-array iterables cannot bypass result budgets', async () => {
  let iterated = 0;
  /** Isolated GraphQL fixture closed after requests and provider disposal settle. */
  const f = await fixture({
    typeDefs: 'type Query { values:[Int] nested:[[Int]] }',
    resolvers: {
      Query: {
        values: () => ({
          /** Represent an unbounded untrusted iterable that result validation must reject without entering.
           * @returns {Generator<number>} Infinite synthetic values only if the result-budget boundary is violated.
           */
          *[Symbol.iterator]() {
            iterated++;
            while (true) {
              yield 1;
            }
          },
        }),
        nested: () => [[1, 2, 3]],
      },
    },
    limits: { maxListItems: 2 },
  });
  try {
    /** Bounded query response checked for safe overflow or list-budget failures. */
    const result = await f.call({ query: '{values nested}' });
    assert.equal(result.data.data.values, null);
    assert.equal(result.data.data.nested, null);
    assert.equal(iterated, 0);
    assert.equal(result.data.errors.length, 2);
  } finally {
    await f.close();
  }
});
