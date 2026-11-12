import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createMemcacheHelper } from '../dist/index.js';
import { MemcacheTextClient, validateKey } from '../dist/protocol.js';
import { createCacheManagerWithHelper } from '@zeruxjs/cache';
/** Match a fixed error code without depending on private causes.
 * @param {string} name - Expected public classification.
 * @returns {(error: {code: string}) => boolean} Predicate used by assertions. */
const code = (name) => (error) => error.code === name;
/** Own an ephemeral loopback fixture and all accepted sockets until test cleanup.
 * @param {import("node:test").TestContext} t - Test cleanup owner.
 * @param {(socket: import("node:net").Socket) => void} handler - Synthetic connection behavior, never an external delegation.
 * @returns {Promise<{host: string, port: number, connections: () => number}>} Owned local endpoint and connection counter.
 */
async function server(t, handler) {
  /** Fixture-owned accepted sockets, destroyed by test cleanup. */
  const sockets = new Set();
  let connections = 0;
  /** Loopback-only synthetic protocol server; not live broker acceptance. */
  const server = net.createServer((socket) => {
    connections++;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    handler(socket);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    // Destroy every accepted fixture socket before closing its server.
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    host: '127.0.0.1',
    port: server.address().port,
    connections: () => connections,
  };
}
/** Implement only the synthetic commands needed by these framing/helper checks.
 * @param {import("node:test").TestContext} t - Owner of the local server and socket teardown.
 * @returns {Promise<object>} Loopback endpoint plus observable synthetic state; not broker qualification.
 */
async function fixture(t) {
  /** Synthetic key/body map used by the byte-level fixture. */
  const data = new Map();
  /** Observed command headers used for expiry and dispatch assertions. */
  const commands = [];
  /** Ephemeral loopback address whose lifetime belongs to this test. */
  const endpoint = await server(t, (socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      /** First complete command header boundary in the buffered fixture request. */
      const end = buffer.indexOf('\r\n');
      if (end < 0) {
        return;
      }
      /** ASCII request header fields interpreted only by the fixture. */
      const fields = buffer.toString('ascii', 0, end).split(' ');
      /** Fixture command selector and exact item key. */
      const [op, key] = fields;
      /** Declared synthetic storage body size before framing completion. */
      const length = Number(fields[4]);
      if (
        ['set', 'add', 'replace'].includes(op) &&
        buffer.length < end + length + 4
      ) {
        return;
      }
      commands.push(fields);
      if (['set', 'add', 'replace'].includes(op)) {
        if (
          (op === 'add' && data.has(key)) ||
          (op === 'replace' && !data.has(key))
        ) {
          socket.write('NOT_STORED\r\n');
        } else {
          data.set(
            key,
            Buffer.from(buffer.subarray(end + 2, end + 2 + length))
          );
          socket.write('STORED\r\n');
        }
      } else if (op === 'get') {
        /** Fixture bytes returned without JSON conversion by the transport. */
        const value = data.get(key);
        socket.write(
          value
            ? Buffer.concat([
                Buffer.from(`VALUE ${key} 0 ${value.length}\r\n`),
                value,
                Buffer.from('\r\nEND\r\n'),
              ])
            : 'END\r\n'
        );
      } else if (op === 'incr' || op === 'decr') {
        if (!data.has(key)) {
          socket.write('NOT_FOUND\r\n');
        } else {
          /** Existing fixture counter value. */
          const n = Number(data.get(key).toString());
          /** Requested fixture counter delta. */
          const amount = Number(fields[2]);
          /** Synthetic counter result matching native decrement clamping. */
          const next = op === 'incr' ? n + amount : Math.max(0, n - amount);
          data.set(key, Buffer.from(String(next)));
          socket.write(`${next}\r\n`);
        }
      } else if (op === 'delete') {
        socket.write(data.delete(key) ? 'DELETED\r\n' : 'NOT_FOUND\r\n');
      } else if (op === 'touch') {
        socket.write(data.has(key) ? 'TOUCHED\r\n' : 'NOT_FOUND\r\n');
      } else if (op === 'flush_all') {
        data.clear();
        socket.write('OK\r\n');
      }
    });
  });
  return { ...endpoint, data, commands };
}
test('fragmented byte-exact binary framing and handle cleanup', async (t) => {
  /** Byte-exact test payload containing control and non-UTF-8 bytes. */
  const body = Buffer.from([0, 13, 10, 255, 195, 169]);
  /** Ephemeral loopback address whose lifetime belongs to this test. */
  const endpoint = await server(t, (socket) =>
    socket.once('data', () => {
      /** Complete synthetic VALUE framing split across writes. */
      const response = Buffer.concat([
        Buffer.from(`VALUE key 0 ${body.length}\r\n`),
        body,
        Buffer.from('\r\nEND\r\n'),
      ]);
      let offset = 0;
      /** Write one byte per event-loop turn to exercise incomplete frames.

 * @returns {void} Stops after the response or peer destruction. */
      const send = () => {
        if (socket.destroyed) {
          return;
        }
        if (offset < response.length) {
          socket.write(response.subarray(offset, ++offset));
          setImmediate(send);
        }
      };
      send();
    })
  );
  /** Owned protocol client; cleanup observes actual socket close. */
  const client = new MemcacheTextClient(endpoint);
  try {
    /** Completed raw protocol reply checked against original bytes. */
    const result = await client.request('get key\r\n');
    assert.deepEqual(result.values[0].value, body);
    assert.equal(client.activeSocketCount, 0);
  } finally {
    client.close();
    await client.whenClosed();
  }
});
test('exact UTF-8/escape budgets, depth and legacy config reject before sockets', async (t) => {
  /** Local fixture with connection/command observations and synthetic state. */
  const f = await fixture(t);
  /** Owned direct helper disposed after assertions. */
  const helper = createMemcacheHelper({
    host: f.host,
    port: f.port,
    maxBytes: 4,
    maxDepth: 2,
  });
  try {
    await assert.rejects(helper.set('k', 'éé'), code('MEMCACHE_PAYLOAD_LIMIT'));
    await assert.rejects(
      helper.set('k', '\\n\\n'),
      code('MEMCACHE_PAYLOAD_LIMIT')
    );
    await assert.rejects(
      helper.set('k', { a: { b: { c: 1 } } }),
      code('MEMCACHE_PAYLOAD_LIMIT')
    );
    await assert.rejects(
      helper.touch('k', undefined),
      code('MEMCACHE_INVALID_TTL')
    );
    assert.equal(f.connections(), 0);
    // Prove legacy and malformed configuration cannot open connections.
    for (const options of [
      { servers: ['localhost:11211'] },
      { options: { host: 'localhost' } },
      { allowFlushAll: 'true' },
      { maxDepth: 0 },
    ]) {
      assert.throws(() => createMemcacheHelper(options));
    }
    await helper.set('k', 'é');
    assert.equal(f.data.get('k').length, 4);
    assert.equal(await helper.get('k'), 'é');
  } finally {
    await helper.close();
  }
  /** Separate helper proving depth/key rejection before opening sockets. */
  const deep = createMemcacheHelper({
    host: f.host,
    port: f.port,
    maxDepth: 2,
  });
  try {
    /** Pre-operation clock or connection baseline for boundary assertions. */
    const before = f.connections();
    await assert.rejects(
      deep.set('k', { a: { b: { c: 1 } } }),
      code('MEMCACHE_DEPTH_LIMIT')
    );
    await assert.rejects(
      deep.setMany({ a: 'ok', 'bad key': 'bad' }),
      code('MEMCACHE_INVALID_KEY')
    );
    assert.equal(f.connections(), before);
  } finally {
    await deep.close();
  }
});
test('conditional writes, TTL boundary, missing counters/clamp and namespace clear', async (t) => {
  /** Local fixture with connection/command observations and synthetic state. */
  const f = await fixture(t);
  /** Owned direct helper disposed after assertions. */
  const helper = createMemcacheHelper({
    host: f.host,
    port: f.port,
    maxConcurrent: 1,
  });
  /** First tenant namespace borrowing the helper wrapper. */
  const a = createCacheManagerWithHelper(helper, {
    prefix: 'a',
    policy: {
      ownHelper: false,
      requireCapabilities: ['conditionalWrites', 'counters'],
    },
  });
  /** Second tenant namespace proving clear cannot cross scopes. */
  const b = createCacheManagerWithHelper(helper, {
    prefix: 'b',
    policy: { ownHelper: false },
  });
  try {
    await a.set('key', 'first', { ifAbsent: true, ttlSeconds: 2592000 });
    await a.set('key', 'second', { ifAbsent: true });
    assert.equal(await a.get('key'), 'first');
    await a.set('missing', 'no', { ifPresent: true });
    assert.equal(await a.get('missing'), undefined);
    await b.set('key', 'keep');
    /** Pre-operation clock or connection baseline for boundary assertions. */
    const before = Math.floor(Date.now() / 1000);
    await helper.set('long', 'v', { ttlSeconds: 2592001 });
    /** Recorded long-TTL command header checked for absolute expiry. */
    const header = f.commands.find((c) => c[1] === 'long');
    assert.ok(Number(header[3]) >= before + 2592001);
    assert.equal(f.commands[0][3], '2592000');
    assert.throws(() => a.clear(), /unsupported/);
    assert.throws(
      () => helper.clearPrefix('a'),
      code('MEMCACHE_NAMESPACE_CLEAR_UNSUPPORTED')
    );
    await assert.rejects(
      helper.clear(),
      code('MEMCACHE_GLOBAL_CLEAR_DISABLED')
    );
    assert.equal(await b.get('key'), 'keep');
    assert.equal(await a.get('key'), 'first');
    await assert.rejects(
      helper.increment('missing'),
      code('MEMCACHE_COUNTER_MISSING')
    );
    await helper.set('count', 2);
    assert.equal(await helper.decrement('count', 4), 0);
    assert.equal(await helper.increment('count', 3), 3);
    await assert.rejects(
      helper.set('k', 1, { ifAbsent: true, ifPresent: true }),
      code('MEMCACHE_CONDITION_CONFLICT')
    );
    // Exercise unsafe protocol keys before interpolation.
    for (const key of ['with space', 'cr\nlf', 'é', 'x'.repeat(251)]) {
      assert.throws(() => validateKey(key), code('MEMCACHE_INVALID_KEY'));
    }
  } finally {
    await a.close();
    await b.close();
    await helper.close();
    await helper.close();
  }
  await assert.rejects(helper.get('key'), code('MEMCACHE_CLOSED'));
});
test('deadline, AbortSignal, overload and close release actual sockets', async (t) => {
  /** Ephemeral loopback address whose lifetime belongs to this test. */
  const endpoint = await server(t, () => {});
  /** Owned protocol client; cleanup observes actual socket close. */
  const client = new MemcacheTextClient({
    host: endpoint.host,
    port: endpoint.port,
    timeoutMs: 10,
    maxConcurrent: 1,
  });
  await assert.rejects(client.request('get k\r\n'), code('MEMCACHE_DEADLINE'));
  assert.equal(client.activeSocketCount, 0);
  /** Caller-owned cancellation signal for one pending request. */
  const controller = new AbortController();
  /** Accepted request with an attached cancellation assertion. */
  const pending = client.request('get k\r\n', { signal: controller.signal });
  /** Attached assertion owns cancellation rejection until settlement. */
  const aborted = assert.rejects(pending, code('MEMCACHE_CANCELLED'));
  await assert.rejects(
    client.request('get k\r\n'),
    code('MEMCACHE_CONCURRENCY_LIMIT')
  );
  controller.abort();
  await aborted;
  assert.equal(client.activeSocketCount, 0);
  /** Request deliberately cancelled by client close. */
  const work = client.request('get k\r\n');
  /** Attached close-rejection assertion prevents unhandled failures. */
  const closed = assert.rejects(work, code('MEMCACHE_CLOSED'));
  client.close();
  await closed;
  await client.whenClosed();
  assert.equal(client.activeSocketCount, 0);
  await assert.rejects(client.request('get k\r\n'), code('MEMCACHE_CLOSED'));
});
test('redacted server/disconnect failures, malformed framing, JSON and reply key mismatch', async (t) => {
  // Check redacted failures against independently owned loopback fixtures.
  for (const [response, expected] of [
    ['SERVER_ERROR private-payload\r\n', 'MEMCACHE_SERVER_ERROR'],
    ['VALUE k 0 1\r\nx!!END\r\n', 'MEMCACHE_PROTOCOL_ERROR'],
    ['VALUE k 0 10000000\r\n', 'MEMCACHE_PAYLOAD_LIMIT'],
  ]) {
    /** Ephemeral loopback address whose lifetime belongs to this test. */
    const endpoint = await server(t, (socket) =>
      socket.once('data', () => socket.write(response))
    );
    /** Owned protocol client; cleanup observes actual socket close. */
    const client = new MemcacheTextClient({
      host: endpoint.host,
      port: endpoint.port,
    });
    try {
      await assert.rejects(
        client.request('get k\r\n'),
        (error) => error.code === expected && !error.message.includes('private')
      );
    } finally {
      client.close();
      await client.whenClosed();
    }
  }
  /** Loopback fixture closing without a reply. */
  const disconnected = await server(t, (socket) =>
    socket.once('data', () => socket.end())
  );
  /** Owned protocol client; cleanup observes actual socket close. */
  const client = new MemcacheTextClient({
    host: disconnected.host,
    port: disconnected.port,
  });
  await assert.rejects(
    client.request('get k\r\n'),
    code('MEMCACHE_DISCONNECTED')
  );
  client.close();
  await client.whenClosed();
  /** Loopback fixture returning a different retrieval key. */
  const wrong = await server(t, (socket) =>
    socket.once('data', () => socket.write('VALUE other 0 1\r\n1\r\nEND\r\n'))
  );
  /** Owned helper that must reject the mismatched server key. */
  const wrongHelper = createMemcacheHelper({
    host: wrong.host,
    port: wrong.port,
  });
  try {
    await assert.rejects(wrongHelper.get('k'), code('MEMCACHE_PROTOCOL_ERROR'));
  } finally {
    await wrongHelper.close();
  }
  /** Local fixture with connection/command observations and synthetic state. */
  const f = await fixture(t);
  /** Owned direct helper disposed after assertions. */
  const helper = createMemcacheHelper({ host: f.host, port: f.port });
  try {
    f.data.set('k', Buffer.from('{bad'));
    await assert.rejects(helper.get('k'), code('MEMCACHE_INVALID_JSON'));
  } finally {
    await helper.close();
  }
});
test('MemcacheQ transport consumer still uses the public protocol export', async (t) => {
  /** Actual public protocol consumer, loaded without starting an external broker. */
  const { createMemcacheQ } = await import('@zeruxjs/queue-memcacheq');
  /** Local fixture with connection/command observations and synthetic state. */
  const f = await fixture(t);
  /** Borrowing queue facade used only with the synthetic byte fixture. */
  const queue = createMemcacheQ({ host: f.host, port: f.port });
  try {
    await queue.add('jobs', 'example', { id: 'one' });
    assert.deepEqual(await queue.take('jobs'), {
      name: 'example',
      data: { id: 'one' },
    });
  } finally {
    queue.close();
  }
});
test('public dynamic cache factory negotiates Memcached capabilities and validates read depth', async (t) => {
  /** Public dynamic loader used to verify declared capability negotiation. */
  const { createCacheManager } = await import('@zeruxjs/cache');
  /** Local fixture with connection/command observations and synthetic state. */
  const f = await fixture(t);
  await assert.rejects(
    createCacheManager({
      helper: '@zeruxjs/cache-memcache',
      policy: { requireCapabilities: ['namespaceClear'] },
      options: { host: f.host, port: f.port },
    }),
    (error) => error.details.code === 'CACHE_CAPABILITY_REQUIRED'
  );
  assert.equal(f.connections(), 0);
  /** Explicitly configured manager owning its helper cleanup. */
  const manager = await createCacheManager({
    helper: '@zeruxjs/cache-memcache',
    prefix: 'scoped',
    policy: { requireCapabilities: ['conditionalWrites', 'counters'] },
    options: { host: f.host, port: f.port },
  });
  try {
    await manager.set('key', { ok: true });
    assert.deepEqual(await manager.get('key'), { ok: true });
  } finally {
    await manager.close();
  }
  /** Owned direct helper disposed after assertions. */
  const helper = createMemcacheHelper({
    host: f.host,
    port: f.port,
    maxDepth: 1,
  });
  try {
    f.data.set('deep', Buffer.from('{"a":{"b":1}}'));
    await assert.rejects(helper.get('deep'), code('MEMCACHE_DEPTH_LIMIT'));
  } finally {
    await helper.close();
  }
});
