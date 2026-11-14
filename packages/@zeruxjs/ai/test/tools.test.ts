import test from 'node:test';
import assert from 'node:assert/strict';
import { object, string } from '@zeruxjs/validator';
import {
  createToolExecutor,
  createZhostToolHandler,
  approvedOpenApiToolOperations,
} from '@zeruxjs/ai/tools';
import { createMcpServer, ToolRegistry } from 'zhost/protocols';
/**
 * Build an explicitly trusted synthetic read-only tool with overrideable denial/failure behavior.
 * @param {object} extra - Test-only definition overrides, default empty.
 * @returns {object} Definition whose authorization and execution remain separate.
 */
const definition = (extra = {}) => ({
  description: 'Approved lookup',
  inputSchema: {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  },
  schema: object({ value: string() }),
  sideEffect: false,
  authorize: async () => true,
  execute: async (args, context) => ({
    value: args.value,
    tenant: context.principal.tenant,
  }),
  ...extra,
});
/**
 * Return a synthetic fixture principal; this is not production authentication.
 * @param {object} value - Opaque fixture tenant/subject provided by the test.
 * @returns {Promise<object>} Fixture principal for tenant-binding assertions.
 */
const auth = async (value) => value;
/** Fixed opaque synthetic tenant/subject, separate from caller-controlled argument fields. */
const principal = { tenant: 'tenant-a', subject: 'owner' };
test('validated registered tools bind verified tenant, deny invalid/unknown/privileged calls, dispose exact entry', async () => {
  /** Captured redacted audit records; assertions forbid argument/tenant values in observations. */
  const audit = [];
  /** Owned tool executor with synthetic authentication; no production principal/store is used. */
  const executor = createToolExecutor({
    authenticate: auth,
    audit: (e) => audit.push(e),
  });
  /** Registration identity lease used to verify disposal cannot remove a replacement. */
  const token = executor.register('lookup', definition());
  /** Authenticated synthetic session; its close drains the fixture handlers. */
  const session = await executor.session(principal);
  try {
    /** Observed fixture result, asserted below without executing any returned strings. */
    const result = await session.execute('lookup', { value: 'hello' });
    assert.equal(result.state, 'succeeded');
    assert.deepEqual(result.value, { value: 'hello', tenant: 'tenant-a' });
    assert.equal(
      (await session.execute('lookup', { value: 2 })).state,
      'invalid'
    );
    assert.equal(
      (await session.execute('missing', { value: 'x' })).state,
      'unknown-tool'
    );
    executor.register('denied', definition({ authorize: async () => false }));
    assert.equal(
      (await session.execute('denied', { value: 'x' })).state,
      'denied'
    );
    executor.register(
      'privileged',
      definition({ privileged: true, reauthorize: async () => false })
    );
    assert.equal(
      (await session.execute('privileged', { value: 'x' })).state,
      'denied'
    );
    assert.throws(() =>
      executor.register('bad', definition({ privileged: true }))
    );
    token.dispose();
    /** New registration lease must survive disposal of the earlier captured identity. */
    const replacement = executor.register('lookup', definition());
    token.dispose();
    assert.equal(
      (await session.execute('lookup', { value: 'new' })).state,
      'succeeded'
    );
    replacement.dispose();
    assert.equal(
      (await session.execute('lookup', { value: 'x' })).state,
      'unknown-tool'
    );
    assert.ok(
      audit.every(
        (e) =>
          !JSON.stringify(e).includes('tenant-a') &&
          !JSON.stringify(e).includes('hello')
      )
    );
  } finally {
    await session.close();
    await executor.close();
  }
});
test('side-effect timeout preserves execution ID/uncertainty, capacity and actual-settlement cleanup', async () => {
  let finish;
  /** Captured bounded fixture events used to check ordering and redaction. */
  const events = [];
  /** Owned tool executor with synthetic authentication; no production principal/store is used. */
  const executor = createToolExecutor({
    authenticate: auth,
    timeoutMs: 15,
    maxConcurrent: 1,
    audit: (e) => events.push(e),
  });
  executor.register(
    'write',
    definition({
      sideEffect: true,
      execute: () => new Promise((r) => (finish = r)),
    })
  );
  /** Authenticated synthetic session; its close drains the fixture handlers. */
  const session = await executor.session(principal);
  try {
    /** Terminal fixed-state receipt; uncertain is never interpreted as safe automatic retry. */
    const outcome = await session.execute('write', { value: 'x' });
    assert.equal(outcome.state, 'uncertain');
    assert.equal(executor.status().pending, 1);
    assert.equal(
      (await session.execute('write', { value: 'x' })).state,
      'overloaded'
    );
    assert.equal(
      events.find((e) => e.phase === 'started').executionId,
      outcome.executionId
    );
    assert.equal(
      events.find((e) => e.phase === 'terminal').executionId,
      outcome.executionId
    );
    let closed = false;
    /** Close promise retained to verify cleanup waits for actual work settlement. */
    const closing = session.close().then(() => (closed = true));
    await new Promise((r) => setImmediate(r));
    assert.equal(closed, false);
    finish({ committed: true });
    await closing;
    assert.equal(executor.status().pending, 0);
    assert.equal(events.find((e) => e.phase === 'settled').state, 'uncertain');
  } finally {
    await session.close();
    await executor.close();
  }
});
test('oversized results and dependency failure are bounded; caller cancellation drains cooperative work', async () => {
  /** Owned tool executor with synthetic authentication; no production principal/store is used. */
  const executor = createToolExecutor({
    authenticate: auth,
    maxResultBytes: 50,
  });
  executor.register(
    'large',
    definition({ execute: () => ({ text: 'x'.repeat(100) }) })
  );
  executor.register(
    'failure',
    definition({
      execute: () => {
        throw Error('private secret');
      },
    })
  );
  let stopped = false;
  executor.register(
    'cancel',
    definition({
      execute: (_, ctx) =>
        new Promise((resolve) =>
          ctx.signal.addEventListener(
            'abort',
            () => {
              stopped = true;
              resolve(null);
            },
            { once: true }
          )
        ),
    })
  );
  /** Authenticated synthetic session; its close drains the fixture handlers. */
  const session = await executor.session(principal);
  try {
    assert.equal(
      (await session.execute('large', { value: 'x' })).state,
      'failed'
    );
    assert.equal(
      (await session.execute('failure', { value: 'x' })).state,
      'failed'
    );
    /** Caller-owned abort controller used to verify cancellation independently of native settlement. */
    const controller = new AbortController();
    /** In-flight tool call remains retained while cooperative cancellation is observed. */
    const work = session.execute('cancel', { value: 'x' }, controller.signal);
    await new Promise((r) => setImmediate(r));
    controller.abort();
    assert.equal((await work).state, 'cancelled');
    assert.equal(stopped, true);
  } finally {
    await session.close();
    await executor.close();
  }
});
test('bounded planner loop, usage enforcement and unknown tools never execute arbitrary instructions', async () => {
  /** Owned tool executor with synthetic authentication; no production principal/store is used. */
  const executor = createToolExecutor({ authenticate: auth });
  executor.register('lookup', definition());
  /** Authenticated synthetic session; its close drains the fixture handlers. */
  const session = await executor.session(principal);
  try {
    let steps = 0;
    /** Explicit local scripted planner; no model generates or executes these operations. */
    const planner = {
      async plan(input) {
        assert.equal(input.principal.tenant, 'tenant-a');
        return ++steps === 1
          ? {
              usage: { totalTokens: 2 },
              calls: [{ name: 'lookup', arguments: { value: 'x' } }],
            }
          : { usage: { totalTokens: 1 }, text: 'done' };
      },
    };
    /** Observed fixture result, asserted below without executing any returned strings. */
    const result = await session.run(planner, { maxTokens: 5 });
    assert.equal(result.text, 'done');
    assert.equal(result.usedTokens, 3);
    await assert.rejects(
      session.run(
        {
          async plan() {
            return {
              usage: { totalTokens: 0 },
              calls: [{ name: 'lookup', arguments: { value: 'x' } }],
            };
          },
        },
        { maxSteps: 1 }
      ),
      /loop budget/
    );
    await assert.rejects(
      session.run(
        {
          async plan() {
            return { usage: { totalTokens: 20 }, text: 'x' };
          },
        },
        { maxTokens: 2 }
      ),
      /loop budget/
    );
    /** Planner loop outcome for an unknown/denied operation, asserted without executing arbitrary code. */
    const denied = await session.run({
      async plan() {
        return {
          usage: { totalTokens: 1 },
          calls: [
            {
              name: 'https://attacker.test/shell',
              arguments: { command: 'bad' },
            },
          ],
        };
      },
    });
    assert.equal(denied.results[0].state, 'unknown-tool');
  } finally {
    await session.close();
    await executor.close();
  }
});
test('fixed authenticated zhost MCP subset integrates without remote discovery or header trust', async () => {
  /** Local zhost MCP tool registry, distinct from the AI executor authorization boundary. */
  const tools = new ToolRegistry();
  tools.register({
    name: 'lookup',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
    handler: (args) => ({ value: args.value }),
  });
  /** In-memory zhost MCP handler; injected Fetch delegates without starting a listening service. */
  const server = createMcpServer({ name: 'fixture', version: '1', tools });
  let calls = 0;
  /** Fixed-origin authenticated transport adapter registered as a trusted test handler. */
  const handler = createZhostToolHandler({
    endpoint: 'https://tools.test/mcp',
    tool: 'lookup',
    allowedOrigins: ['https://tools.test'],
    approveDestination: async () => true,
    credentials: async () => ({ authorization: 'Bearer fixture' }),
    fetch: async (url, init) => {
      calls++;
      assert.equal(String(url), 'https://tools.test/mcp');
      assert.equal(init.headers.get('authorization'), 'Bearer fixture');
      assert.equal(init.redirect, 'error');
      /** Observed fixture result, asserted below without executing any returned strings. */
      const result = await server.handle(JSON.parse(init.body), {
        signal: init.signal,
      });
      return new Response(JSON.stringify(result), {
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  /** Owned tool executor with synthetic authentication; no production principal/store is used. */
  const executor = createToolExecutor({ authenticate: auth });
  executor.register('remote', definition({ execute: handler }));
  /** Authenticated synthetic session; its close drains the fixture handlers. */
  const session = await executor.session(principal);
  try {
    /** Terminal fixed-state receipt; uncertain is never interpreted as safe automatic retry. */
    const outcome = await session.execute('remote', { value: 'ok' });
    assert.equal(outcome.state, 'succeeded');
    assert.match(outcome.value.content[0].text, /ok/);
    assert.equal(calls, 1);
    assert.throws(() =>
      createZhostToolHandler({
        endpoint: 'https://attacker.test/mcp',
        tool: 'lookup',
        allowedOrigins: ['https://tools.test'],
        approveDestination: async () => true,
        credentials: async () => ({ authorization: 'x' }),
        fetch,
      })
    );
  } finally {
    await session.close();
    await executor.close();
  }
});
test('cancelled remote SSE releases its reader and redirect responses fail without replay', async () => {
  let cancelled = 0,
    calls = 0;
  /** Injected remote SSE handler fixture; redirects and cancellation never replay a side effect. */
  const remote = createZhostToolHandler({
    endpoint: 'https://tools.test/mcp',
    tool: 'lookup',
    allowedOrigins: ['https://tools.test'],
    approveDestination: async () => true,
    credentials: async () => ({ authorization: 'Bearer fixture' }),
    fetch: async () => {
      calls++;
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled++;
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      );
    },
  });
  /** Owned tool executor with synthetic authentication; no production principal/store is used. */
  const executor = createToolExecutor({ authenticate: auth });
  executor.register('stream', definition({ execute: remote }));
  /** Authenticated synthetic session; its close drains the fixture handlers. */
  const session = await executor.session(principal);
  try {
    /** Caller-owned abort controller used to verify cancellation independently of native settlement. */
    const controller = new AbortController();
    /** Retained remote execution promise verifies cancellation and reader-drain ownership. */
    const job = session.execute('stream', { value: 'x' }, controller.signal);
    await new Promise((r) => setImmediate(r));
    controller.abort();
    assert.equal((await job).state, 'cancelled');
    await session.close();
    assert.equal(cancelled, 1);
    assert.equal(calls, 1);
  } finally {
    await session.close();
    await executor.close();
  }
});
test('trusted OpenAPI import approves definitions only; refs/parameters/duplicate IDs reject', () => {
  /** Staged synthetic OpenAPI document; no external references or endpoints are fetched. */
  const doc = {
    openapi: '3.1.0',
    paths: {
      '/lookup': {
        post: {
          operationId: 'lookup',
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', properties: {} },
              },
            },
          },
        },
      },
    },
  };
  assert.throws(() =>
    approvedOpenApiToolOperations(doc, { trusted: false, approve: () => true })
  );
  assert.equal(
    approvedOpenApiToolOperations(doc, { trusted: true, approve: () => false })
      .length,
    0
  );
  assert.equal(
    approvedOpenApiToolOperations(doc, {
      trusted: true,
      approve: (o) => o.operationId === 'lookup',
    })[0].method,
    'POST'
  );
  /** Detached negative document copy introduces a forbidden reference without mutating the baseline. */
  const ref = structuredClone(doc);
  ref.paths['/lookup'].post.requestBody.content['application/json'].schema = {
    $ref: 'https://attacker.test/schema',
  };
  assert.throws(() =>
    approvedOpenApiToolOperations(ref, { trusted: true, approve: () => true })
  );
});
test('remote redirect/status/credential denial cancels unconsumed bodies and never replays', async () => {
  let calls = 0,
    cancelled = 0;
  /** Private synthetic configuration; dummy credentials never authorize an external service. */
  const config = {
    endpoint: 'https://tools.test/mcp',
    tool: 'lookup',
    allowedOrigins: ['https://tools.test'],
    approveDestination: async () => true,
    credentials: async () => ({ authorization: 'Bearer private' }),
    fetch: async () => {
      calls++;
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled++;
          },
        }),
        { status: 302, headers: { location: 'https://attacker.test' } }
      );
    },
  };
  /** Owned tool executor with synthetic authentication; no production principal/store is used. */
  const executor = createToolExecutor({ authenticate: auth });
  executor.register(
    'redirect',
    definition({ execute: createZhostToolHandler(config) })
  );
  executor.register(
    'noauth',
    definition({
      execute: createZhostToolHandler({
        ...config,
        credentials: async () => ({}),
      }),
    })
  );
  /** Authenticated synthetic session; its close drains the fixture handlers. */
  const session = await executor.session(principal);
  try {
    assert.equal(
      (await session.execute('redirect', { value: 'x' })).state,
      'failed'
    );
    assert.equal(calls, 1);
    assert.equal(cancelled, 1);
    assert.equal(
      (await session.execute('noauth', { value: 'x' })).state,
      'failed'
    );
    assert.equal(calls, 1);
  } finally {
    await session.close();
    await executor.close();
  }
});
test('forged argument tenant does not replace immutable initiating scope or authorize denied tenants', async () => {
  /** Owned tool executor with synthetic authentication; no production principal/store is used. */
  const executor = createToolExecutor({ authenticate: auth });
  executor.register(
    'scoped',
    definition({
      authorize: async (context) => context.principal.tenant === 'tenant-a',
    })
  );
  /** Tenant-a verified session; forged argument fields cannot change this initiating identity. */
  const a = await executor.session(principal);
  /** Independent tenant-b session tests current policy denial even with similar arguments. */
  const b = await executor.session({ tenant: 'tenant-b', subject: 'owner' });
  try {
    /** Authorized tenant-a result demonstrates tenant identity comes from the session, not arguments. */
    const allowed = await a.execute('scoped', {
      value: 'x',
      tenant: 'tenant-b',
    });
    assert.equal(allowed.value.tenant, 'tenant-a');
    assert.equal(
      (await b.execute('scoped', { value: 'x', tenant: 'tenant-a' })).state,
      'denied'
    );
  } finally {
    await a.close();
    await b.close();
    await executor.close();
  }
});
test('normal remote SSE response matches execution ID and closes reader', async () => {
  let cancelled = 0;
  /** Fixed-origin authenticated transport adapter registered as a trusted test handler. */
  const handler = createZhostToolHandler({
    endpoint: 'https://tools.test/mcp',
    tool: 'lookup',
    allowedOrigins: ['https://tools.test'],
    approveDestination: async () => true,
    credentials: async () => ({ authorization: 'Bearer fixture' }),
    fetch: async (_, init) => {
      /** Parsed outbound JSON-RPC envelope used only to match the fixture execution ID. */
      const request = JSON.parse(init.body);
      return new Response(
        new ReadableStream({
          start(c) {
            /** Encoded synthetic response bytes, never an actual downloaded media file. */
            const data = new TextEncoder().encode(
              'data: ' +
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: request.id,
                  result: { text: '🌟' },
                }) +
                '\n\n'
            );
            for (let i = 0; i < data.length; i += 2) {
              c.enqueue(data.slice(i, i + 2));
            }
          },
          cancel() {
            cancelled++;
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      );
    },
  });
  /** Owned tool executor with synthetic authentication; no production principal/store is used. */
  const executor = createToolExecutor({ authenticate: auth });
  executor.register('remote', definition({ execute: handler }));
  /** Authenticated synthetic session; its close drains the fixture handlers. */
  const session = await executor.session(principal);
  try {
    assert.deepEqual((await session.execute('remote', { value: 'x' })).value, {
      text: '🌟',
    });
    assert.equal(cancelled, 1);
  } finally {
    await session.close();
    await executor.close();
  }
});
test('planner timeout returns receipts while retaining native work until close', async () => {
  let release;
  /** Owned tool executor with synthetic authentication; no production principal/store is used. */
  const executor = createToolExecutor({ authenticate: auth, timeoutMs: 10 });
  /** Authenticated synthetic session; its close drains the fixture handlers. */
  const session = await executor.session(principal);
  try {
    await assert.rejects(
      session.run({ plan: () => new Promise((r) => (release = r)) }),
      (error) => error.code === 'budget' && Array.isArray(error.executions)
    );
    assert.equal(executor.status().pending, 1);
    let closed = false;
    /** Close promise retained to verify cleanup waits for actual work settlement. */
    const closing = session.close().then(() => (closed = true));
    await new Promise((r) => setImmediate(r));
    assert.equal(closed, false);
    release({ usage: { totalTokens: 1 }, text: 'late' });
    await closing;
    assert.equal(executor.status().pending, 0);
  } finally {
    await session.close();
    await executor.close();
  }
});
test('OpenAPI staging rejects late duplicate IDs, path parameters and referenced/non-JSON request bodies', () => {
  /** Minimal valid OpenAPI baseline cloned before each invalid-import mutation. */
  const source = {
    openapi: '3.1.0',
    paths: { '/one': { post: { operationId: 'one' } } },
  };
  /** Explicit synchronous host approval for synthetic operation descriptors only. */
  const policy = { trusted: true, approve: () => true };
  /** Detached import candidate introduces a late duplicate to check all-or-nothing staging. */
  const duplicate = structuredClone(source);
  duplicate.paths['/two'] = { post: { operationId: 'one' } };
  assert.throws(() => approvedOpenApiToolOperations(duplicate, policy));
  // Reject each unsupported OpenAPI body shape without partially publishing imported operations.
  for (const requestBody of [
    { $ref: 'https://attacker.test/body' },
    { content: { 'text/plain': { schema: { type: 'string' } } } },
  ]) {
    /** Staged synthetic OpenAPI document; no external references or endpoints are fetched. */
    const doc = structuredClone(source);
    doc.paths['/one'].post.requestBody = requestBody;
    assert.throws(() => approvedOpenApiToolOperations(doc, policy));
  }
  /** Detached import candidate with unsupported path-level parameters. */
  const parameters = structuredClone(source);
  parameters.paths['/one'].parameters = [];
  assert.throws(() => approvedOpenApiToolOperations(parameters, policy));
});
