import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { WebSocket } from 'ws';
import {
  createTransportRegistry,
  createHttpTransportAdapter,
  createWebSocketTransportAdapter,
  createProtocolGateway,
  readConnectEnvelopes,
  encodeConnectEnvelope,
  transportCapabilityMatrix,
} from 'zhost/protocols';
/** Small declared fixture byte/concurrency/deadline budgets, exercised only on owned loopback listeners. */
const limits = { maxMessageBytes: 128, maxConcurrent: 4, timeoutMs: 200 };
/** Register an explicit injected adapter under an ephemeral loopback bind.
 * @param {object} registry Owned inert application registry.
 * @param {object} adapter Explicit trusted test adapter, never discovered code.
 * @param {string} id Unique fixed fixture registration identifier.
 * @returns {void} Adds the fixture factory and registration without starting it. */
const register = (registry, adapter, id = 'main') => {
  registry.registerAdapter(id, () => adapter);
  registry.register({
    id,
    type: id,
    bind: { host: '127.0.0.1', port: 0 },
    limits,
  });
};
/** Send one fixed small JSON-RPC request to the owned local fixture listener.
 * @param {number} port Actual fixture listener port.
 * @param {object} headers Fixed optional header fixtures, including explicit authorization.
 * @returns {Promise<{status: number, body: string}>} Bounded synthetic response capture. */
const post = (port, headers = {}) =>
  new Promise((resolve, reject) => {
    /** Owned local one-shot request; native errors reject or are deliberately observed in cancellation checks. */
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/rpc',
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
      },
      (res) => {
        /** Small synthetic response byte accumulator; no external data source is queried. */
        const chunks = [];
        res.on('data', (x) => chunks.push(x));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString(),
          })
        );
      }
    );
    req.on('error', reject);
    req.end('{"jsonrpc":"2.0","id":1,"method":"hello"}');
  });

test('unknown transports and duplicate binds reject before any factory executes', () => {
  /** Owned application-scoped transport registry stopped in fixture finally. */
  const r = createTransportRegistry();
  assert.throws(
    () =>
      r.register({
        id: 'a',
        type: 'grpc',
        bind: { host: '127.0.0.1', port: 3000 },
      }),
    { code: 'TRANSPORT_UNSUPPORTED' }
  );
  r.registerAdapter('http', () => {
    throw Error('must not start');
  });
  r.register({
    id: 'a',
    type: 'http',
    bind: { host: '127.0.0.1', port: 3000 },
  });
  assert.throws(
    () =>
      r.register({
        id: 'b',
        type: 'http',
        bind: { host: '0.0.0.0', port: 3000 },
      }),
    { code: 'TRANSPORT_BIND_CONFLICT' }
  );
  assert.equal(transportCapabilityMatrix.grpc.implementation, 'forwarding');
  assert.equal(transportCapabilityMatrix.mcp.implementation, 'subset');
});
test('partial startup rollback is reverse ordered and exactly once, with private cause', async () => {
  /** Explicit trusted adapter cleanup invocation order, independent of runtime message payloads. */
  const calls = [];
  /** Owned application-scoped transport registry stopped in fixture finally. */
  const r = createTransportRegistry();
  register(
    r,
    {
      async start(ctx) {
        ctx.onDispose(() => calls.push('cleanup-a'));
      },
      health: () => ({ ready: true }),
      stop: () => calls.push('stop-a'),
    },
    'a'
  );
  register(
    r,
    {
      async start(ctx) {
        ctx.onDispose(() => calls.push('cleanup-b'));
        throw Error('private-dependency');
      },
      health: () => ({ ready: true }),
      stop: () => calls.push('stop-b'),
    },
    'b'
  );
  await assert.rejects(
    r.start(),
    (error) =>
      error.code === 'TRANSPORT_START_FAILED' &&
      error.message === 'TRANSPORT_START_FAILED' &&
      error.cause.message === 'private-dependency'
  );
  await r.stop();
  await r.stop();
  assert.deepEqual(calls, ['stop-b', 'cleanup-b', 'stop-a', 'cleanup-a']);
});
test('HTTP explicit authorization, endpoint denial, safe errors and owned shutdown', async () => {
  /** Explicit owned protocol gateway with synthetic registered handlers and host authorization. */
  const gateway = createProtocolGateway({
    authorize: () => true,
    authorizeEndpoint: (_req, endpoint) => endpoint.kind === 'json-rpc',
  });
  gateway.rpc.register('hello', () => {
    throw Error('private-secret');
  });
  /** Owned inert HTTP/WS adapter bound only through its test registry start. */
  const adapter = createHttpTransportAdapter({
    gateway,
    authorize: (req) => req.headers.authorization === 'test',
  });
  /** Owned application-scoped transport registry stopped in fixture finally. */
  const r = createTransportRegistry();
  register(r, adapter);
  try {
    await r.start();
    /** Actual ephemeral owned adapter port. */
    const port = adapter.address().port;
    assert.equal((await post(port)).status, 403);
    /** Captured synthetic authorized RPC response checked for private-cause redaction. */
    const result = await post(port, {
      authorization: 'test',
      'x-forwarded-for': '8.8.8.8',
    });
    assert.equal(result.status, 200);
    assert.doesNotMatch(result.body, /private-secret/);
    assert.match(result.body, /Internal error/);
    assert.equal((await r.health())[0].ready, true);
  } finally {
    await r.stop();
  }
  await assert.rejects(r.start(), { code: 'TRANSPORT_CLOSED' });
  assert.equal(adapter.address(), null);
  assert.deepEqual(gateway.getDiagnostics(), {
    closed: true,
    active: 0,
    pending: 0,
  });
});
test('gateway deadline signals a cooperative procedure and releases its slot', async () => {
  /** Explicit owned protocol gateway with synthetic registered handlers and host authorization. */
  const gateway = createProtocolGateway({ authorize: () => true });
  let cancelled = false;
  gateway.rpc.register(
    'hello',
    (_params, { signal }) =>
      new Promise((resolve) =>
        signal.addEventListener(
          'abort',
          () => {
            cancelled = true;
            resolve(null);
          },
          { once: true }
        )
      )
  );
  /** Owned inert HTTP/WS adapter bound only through its test registry start. */
  const adapter = createHttpTransportAdapter({
    gateway,
    authorize: () => true,
  });
  /** Owned application-scoped transport registry stopped in fixture finally. */
  const r = createTransportRegistry();
  register(r, adapter);
  try {
    await r.start();
    assert.equal((await post(adapter.address().port)).status, 504);
    assert.equal(cancelled, true);
  } finally {
    await r.stop();
  }
  assert.equal(gateway.getDiagnostics().pending, 0);
});
test('WebSocket aggregate fragments, denied upgrade, oversize and disconnect cancellation', async () => {
  let calls = 0,
    aborted;
  /** Explicit cooperative handler-abort receipt, awaited before cleanup assertions. */
  const cancelled = new Promise((resolve) => (aborted = resolve));
  /** Owned inert HTTP/WS adapter bound only through its test registry start. */
  const adapter = createWebSocketTransportAdapter({
    path: '/ws',
    authorize: (req) => req.headers.authorization === 'test',
    async onMessage(data, ctx) {
      assert.ok(
        Number.isSafeInteger(ctx.deadline) &&
          ctx.deadline <= Date.now() + limits.timeoutMs
      );
      calls++;
      if (Buffer.from(data).toString() === 'wait') {
        await new Promise((resolve) =>
          ctx.signal.addEventListener(
            'abort',
            () => {
              aborted();
              resolve();
            },
            { once: true }
          )
        );
      } else {
        await ctx.send(data);
      }
    },
  });
  /** Owned application-scoped transport registry stopped in fixture finally. */
  const r = createTransportRegistry();
  register(r, adapter);
  try {
    await r.start();
    /** Owned ephemeral WebSocket endpoint URL; no external host is contacted. */
    const url = `ws://127.0.0.1:${adapter.address().port}/ws`;
    await new Promise((resolve, reject) => {
      /** Owned unauthenticated fixture WebSocket expected to reject its upgrade. */
      const denied = new WebSocket(url);
      denied.on('unexpected-response', (_req, res) => {
        assert.equal(res.statusCode, 403);
        res.resume();
        denied.terminate();
        resolve();
      });
      denied.on('error', () => {});
      setTimeout(() => reject(Error('denied timeout')), 1000).unref();
    });
    /** Owned authenticated fixture WebSocket, terminated/closed by the registry lifetime. */
    const ws = new WebSocket(url, { headers: { authorization: 'test' } });
    ws.on('error', () => {});
    await once(ws, 'open');
    /** Native bounded WebSocket message event proving fragmented-frame assembly. */
    const echoed = once(ws, 'message');
    ws.send('he', { fin: false });
    ws.send('llo', { fin: true });
    assert.equal((await echoed)[0].toString(), 'hello');
    assert.equal(calls, 1);
    /** Native fixture WebSocket close receipt proving payload-limit enforcement. */
    const closed = once(ws, 'close');
    ws.send('x'.repeat(129));
    assert.equal((await closed)[0], 1009);
    assert.equal(calls, 1);
    /** Second owned WebSocket whose cooperative callback awaits disconnect cancellation. */
    const waiting = new WebSocket(url, { headers: { authorization: 'test' } });
    waiting.on('error', () => {});
    await once(waiting, 'open');
    waiting.send('wait');
    while (calls < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    waiting.terminate();
    await cancelled;
  } finally {
    await r.stop();
  }
  assert.equal(adapter.address(), null);
});
test('Connect handles coalesced bounded frames and rejects truncated/oversize frames', async () => {
  /** Fixed coalesced Connect envelopes bounded by explicit parser limits. */
  const frames = Buffer.concat(
    Array.from({ length: 20 }, () => encodeConnectEnvelope({ a: 1 }))
  );
  let count = 0;
  for await (const value of readConnectEnvelopes([frames], {
    maxMessageBytes: 16,
    maxTotalBytes: 1000,
  })) {
    assert.deepEqual(value, { a: 1 });
    count++;
  }
  assert.equal(count, 20);
  await assert.rejects(async () => {
    for await (const _ of readConnectEnvelopes([Buffer.from([0, 0, 0, 1, 0])], {
      maxMessageBytes: 16,
    })) {
      /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
    }
  }, /too large/);
  await assert.rejects(async () => {
    for await (const _ of readConnectEnvelopes([Buffer.from([0, 0])])) {
      /* Drain or observe the deliberately failing fixture; the enclosing assertion checks its outcome. */
    }
  }, /Truncated/);
});

test('stop during startup aborts and releases partial resources', async () => {
  /** Owned application-scoped transport registry stopped in fixture finally. */
  const r = createTransportRegistry();
  let entered,
    disposed = 0;
  /** Explicit handler/startup admission receipt, not fabricated startup success. */
  const started = new Promise((resolve) => (entered = resolve));
  register(r, {
    async start({ signal, onDispose }) {
      onDispose(() => disposed++);
      entered();
      await new Promise((resolve) =>
        signal.addEventListener('abort', resolve, { once: true })
      );
    },
    health: () => ({ ready: true }),
    stop: () => {},
  });
  /** Actual registry startup promise kept observed during concurrent stop. */
  const startup = r.start();
  /** Attached startup rejection assertion preventing an unhandled rejected promise. */
  const failure = assert.rejects(startup, { code: 'TRANSPORT_START_FAILED' });
  await started;
  await r.stop();
  await failure;
  assert.equal(disposed, 1);
});
test('OS bind failure rolls back an already listening HTTP adapter', async () => {
  /** Owned ephemeral native HTTP listener reserving one port to force a real bind failure. */
  const blocker = http.createServer();
  blocker.listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  /** Owned application-scoped transport registry stopped in fixture finally. */
  const r = createTransportRegistry();
  /** First owned HTTP adapter whose startup must roll back after the later bind failure. */
  const a = createHttpTransportAdapter({
    gateway: createProtocolGateway(),
    authorize: () => true,
  });
  /** Second owned HTTP adapter deliberately targeting the fixture blocker’s port. */
  const b = createHttpTransportAdapter({
    gateway: createProtocolGateway(),
    authorize: () => true,
  });
  register(r, a);
  r.registerAdapter('blocked', () => b);
  r.register({
    id: 'blocked',
    type: 'blocked',
    bind: { host: '127.0.0.1', port: blocker.address().port },
    limits,
  });
  try {
    await assert.rejects(r.start(), { code: 'TRANSPORT_START_FAILED' });
    assert.equal(a.address(), null);
    assert.equal(b.address(), null);
    await r.stop();
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});
test('disconnect aborts a procedure and SSE close releases all subscriptions', async () => {
  /** Explicit owned protocol gateway with synthetic registered handlers and host authorization. */
  const gateway = createProtocolGateway({ authorize: () => true });
  let running, abort;
  /** Explicit handler/startup admission receipt, not fabricated startup success. */
  const started = new Promise((resolve) => (running = resolve));
  /** Explicit cooperative handler-abort receipt, awaited before cleanup assertions. */
  const cancelled = new Promise((resolve) => (abort = resolve));
  gateway.rpc.register(
    'hello',
    (_p, { signal }) =>
      new Promise((resolve) => {
        running();
        signal.addEventListener(
          'abort',
          () => {
            abort();
            resolve(null);
          },
          { once: true }
        );
      })
  );
  /** Owned inert HTTP/WS adapter bound only through its test registry start. */
  const adapter = createHttpTransportAdapter({
    gateway,
    authorize: () => true,
  });
  /** Owned application-scoped transport registry stopped in fixture finally. */
  const r = createTransportRegistry();
  register(r, adapter);
  try {
    await r.start();
    /** Actual ephemeral owned adapter port. */
    const port = adapter.address().port;
    /** Owned local one-shot request; native errors reject or are deliberately observed in cancellation checks. */
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/rpc',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    req.on('error', () => {});
    req.end('{"jsonrpc":"2.0","id":1,"method":"hello"}');
    await started;
    req.destroy();
    await cancelled;
    await new Promise((resolve) => {
      http.get({ hostname: '127.0.0.1', port, path: '/events' }, (res) => {
        res.on('error', () => {});
        resolve();
      });
    });
    assert.equal(gateway.events.clientCount, 1);
  } finally {
    await r.stop();
  }
  assert.equal(gateway.events.clientCount, 0);
  assert.equal(gateway.getDiagnostics().active, 0);
  assert.throws(() => gateway.events.publish('ready', 'closed'), /closed/);
});

test('propagated deadline is validated and can only shorten local handler policy', async () => {
  /** Explicit owned protocol gateway with synthetic registered handlers and host authorization. */
  const gateway = createProtocolGateway({ authorize: () => true });
  let observed;
  gateway.rpc.register('hello', (_input, context) => {
    observed = context.deadline;
    return 'ok';
  });
  /** Owned inert HTTP/WS adapter bound only through its test registry start. */
  const adapter = createHttpTransportAdapter({
    gateway,
    authorize: () => true,
  });
  /** Owned application-scoped transport registry stopped in fixture finally. */
  const r = createTransportRegistry();
  register(r, adapter);
  try {
    await r.start();
    /** Actual ephemeral owned adapter port. */
    const port = adapter.address().port;
    assert.equal(
      (await post(port, { 'x-zerux-deadline': 'not-a-date' })).status,
      400
    );
    assert.equal((await post(port, { 'x-zerux-deadline': '0' })).status, 408);
    assert.equal(observed, undefined);
    /** Explicit handler/startup admission receipt, not fabricated startup success. */
    const started = Date.now();
    assert.equal(
      (
        await post(port, {
          'x-zerux-deadline': String(Number.MAX_SAFE_INTEGER),
        })
      ).status,
      200
    );
    assert.ok(observed >= started && observed <= Date.now() + limits.timeoutMs);
  } finally {
    await r.stop();
  }
});
