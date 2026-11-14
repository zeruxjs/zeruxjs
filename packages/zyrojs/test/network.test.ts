import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import {
  createProtocolClient,
  createQueryCache,
  readEventStream,
} from '../dist/network/index.js';
import { connectJsonStream } from '../dist/network/connect-stream.js';
/**
 * Test helper listen.
 * @param {unknown} server - Test input for this helper.
 * @returns {unknown} Result produced by this test helper.
 */
const listen = (server: http.Server): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      /** Bound TCP address used to return the ephemeral fixture port. */
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Test server did not expose a TCP address'));
        return;
      }
      resolve(address.port);
    });
  });
/**
 * Test helper stop.
 * @param {unknown} server - Test input for this helper.
 * @returns {unknown} Result produced by this test helper.
 */
const stop = (server: http.Server): Promise<void> =>
  new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
test('browser-independent RPC, MCP, Connect, tRPC clients check response identity and failure', async () => {
  /**
   * Test fixture server.
   */
  const server = http.createServer(async (req, res) => {
    /**
     * Test fixture parts.
     */
    const parts = [];
    for await (const c of req) {
      parts.push(c);
    }
    /**
     * Test fixture input.
     */
    const input = JSON.parse(Buffer.concat(parts).toString());
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/rpc') {
      return res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: input.id,
          result: input.params.value,
        })
      );
    }
    if (req.url === '/mcp') {
      return res.end(
        JSON.stringify({ jsonrpc: '2.0', id: input.id, result: { ok: true } })
      );
    }
    if (req.url === '/Service/Method') {
      return res.end(JSON.stringify({ echoed: input }));
    }
    if (req.url === '/trpc/api') {
      return res.end(JSON.stringify({ result: { data: input } }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  /**
   * Test fixture port.
   */
  const port = await listen(server);
  try {
    /**
     * Test fixture client.
     */
    const client = createProtocolClient({
      baseUrl: `http://127.0.0.1:${port}`,
      timeoutMs: 1000,
    });
    assert.equal(await client.rpc('square', { value: 4 }), 4);
    assert.deepEqual(await client.mcp('tools/list'), { ok: true });
    assert.deepEqual(await client.connect('Service', 'Method', { num: 2 }), {
      echoed: { num: 2 },
    });
    assert.deepEqual(await client.trpc('api', { num: 3 }), { num: 3 });
    await assert.rejects(
      client.connect('Invalid/Service', 'Method', 1),
      TypeError
    );
  } finally {
    await stop(server);
  }
});
test('query cache de-duplicates successful computations, respects TTL and tag invalidation', async () => {
  /**
   * Test fixture cache.
   */
  const cache = createQueryCache({ maxEntries: 2, defaultTtlMs: 5000 });
  let calls = 0;
  /**
   * Test helper load.
   * @returns {unknown} Result produced by this test helper.
   */
  const load = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 15));
    return 11;
  };
  assert.deepEqual(
    await Promise.all([
      cache.query('x', load, { tags: ['api'] }),
      cache.query('x', load),
    ]),
    [11, 11]
  );
  assert.equal(calls, 1);
  assert.equal(cache.get('x'), 11);
  assert.equal(cache.invalidateTag('api'), 1);
  assert.equal(cache.get('x'), undefined);
  await assert.rejects(
    cache.query('bad', async () => {
      throw new Error('oops');
    }),
    /oops/
  );
  assert.equal(cache.get('bad'), undefined);
});
test('SSE streaming parses UTF-8 chunks and bounded event records', async () => {
  /**
   * Test fixture body.
   */
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('id: 4\nevent: update\ndata: hel'));
      c.enqueue(new TextEncoder().encode('lo\ndata: world\n\n'));
      c.close();
    },
  });
  /**
   * Test helper fetchMock.
   * @returns {unknown} Result produced by this test helper.
   */
  const fetchMock = async () =>
    new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  /**
   * Test fixture received.
   */
  const received = [];
  for await (const item of readEventStream('https://example.com/events', {
    fetch: fetchMock,
  })) {
    received.push(item);
  }
  assert.deepEqual(received, [
    { event: 'update', data: 'hello\nworld', id: '4' },
  ]);
});
test('Connect framing parses fragmented envelopes', async () => {
  /**
   * Test fixture message.
   */
  const message = Buffer.from(JSON.stringify({ hello: 1 }));
  /**
   * Test fixture frame.
   */
  const frame = Buffer.alloc(5 + message.length);
  frame.writeUInt32BE(message.length, 1);
  message.copy(frame, 5);
  /**
   * Test fixture tail.
   */
  const tail = Buffer.from([128, 0, 0, 0, 2, 123, 125]);
  /**
   * Test fixture body.
   */
  const body = new ReadableStream({
    start(c) {
      c.enqueue(frame.subarray(0, 3));
      c.enqueue(frame.subarray(3));
      c.enqueue(tail);
      c.close();
    },
  });
  /**
   * Test helper fetchMock.
   * @returns {unknown} Result produced by this test helper.
   */
  const fetchMock = async () =>
    new Response(body, {
      headers: { 'Content-Type': 'application/connect+json' },
    });
  /**
   * Test fixture output.
   */
  const output = [];
  for await (const value of connectJsonStream(
    'Service',
    'Stream',
    [{ test: true }],
    { baseUrl: 'https://example.com', fetch: fetchMock }
  )) {
    output.push(value);
  }
  assert.deepEqual(output, [{ hello: 1 }]);
});

test('reactive remote resource ignores stale responses and handles disposal', async () => {
  /**
   * Test fixture { createRemoteResource }.
   */
  const { createRemoteResource } = await import('../dist/network/reactive.js');
  let complete: ((value: number) => void) | undefined;
  /**
   * Test fixture resource.
   */
  const resource = createRemoteResource(
    async () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  /**
   * Test fixture older.
   */
  const older = resource.refresh();
  await Promise.resolve();
  assert.equal(resource.loading.value, true);
  /**
   * Test fixture next.
   */
  const next = resource.refresh();
  await Promise.resolve();
  if (!complete) {
    throw new Error('Remote resource loader was not initialized');
  }
  complete(4);
  assert.equal(await next, 4);
  assert.equal(resource.data.value, 4);
  assert.equal(resource.loading.value, false);
  resource.dispose();
  await assert.rejects(resource.refresh(), /disposed/);
  void older;
});

test('cancelled stale resources reject even if a loader ignores AbortSignal', async () => {
  /**
   * Test fixture { createRemoteResource }.
   */
  const { createRemoteResource } = await import('../dist/network/index.js');
  /**
   * Test fixture tasks.
   */
  const tasks: Array<(value: string) => void> = [];
  /**
   * Test fixture state.
   */
  const state = createRemoteResource(
    () => new Promise((resolve) => tasks.push(resolve))
  );
  /**
   * Test fixture old.
   */
  const old = state.refresh();
  /**
   * Test fixture next.
   */
  const next = state.refresh();
  /** Resolver for the newer refresh, which must win the race. */
  const nextTask = tasks[1];
  /** Resolver for the older refresh, which must be rejected as stale. */
  const oldTask = tasks[0];
  if (!nextTask || !oldTask) {
    throw new Error('Remote resource tasks were not registered');
  }
  nextTask('new');
  assert.equal(await next, 'new');
  oldTask('stale');
  await assert.rejects(old, { name: 'AbortError' });
  assert.equal(state.data.value, 'new');
  state.dispose();
});
