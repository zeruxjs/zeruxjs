import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createValkeyCacheHelper,
  createCacheHelper,
} from '@zeruxjs/cache-valkey';
import {
  createCacheManagerWithHelper,
  createCacheManager,
} from '@zeruxjs/cache';
/** Explicit safe native options required for every injected fixture. */
const safe = {
  enableOfflineQueue: false,
  autoResendUnfulfilledCommands: false,
  maxRetriesPerRequest: 0,
  reconnectOnError: null,
};
/** Native-shaped in-memory client; transport lifecycle is qualified separately by the RESP fixture. */
class Client extends EventEmitter {
  /** Own safe native-like options and synthetic call/state counters.
   * @param {Record<string,unknown>} options - Explicit safe native settings.
   */
  constructor(options = { ...safe }) {
    super();
    this.options = options;
    this.data = new Map();
    this.calls = [];
    this.quits = 0;
    this.disconnects = 0;
  }
  /** Record explicit connection activation without opening a socket.
   * @returns {Promise<void>} Fixture-only outcome, not live Valkey acceptance.
   */
  async connect() {
    this.calls.push(['connect']);
  }
  /** Read one synthetic native string or null.
   * @param {string} k - Exact synthetic key.
   * @returns {Promise<string|null>} Fixture-only outcome, not live Valkey acceptance.
   */
  async get(k) {
    this.calls.push(['get', k]);
    return this.data.get(k) ?? null;
  }
  /** Apply native-like NX/XX conditions to the synthetic map.
   * @param {string} k - Exact synthetic key.
   * @param {string} v - Prepared native string.
   * @param {Array<string|number>} args - Fixed native command tokens.
   * @returns {Promise<string|null>} Fixture-only outcome, not live Valkey acceptance.
   */
  async set(k, v, ...args) {
    this.calls.push(['set', k, v, ...args]);
    if (
      (args.includes('NX') && this.data.has(k)) ||
      (args.includes('XX') && !this.data.has(k))
    ) {
      return null;
    }
    this.data.set(k, v);
    return 'OK';
  }
  /** Delete one synthetic key and return a decimal status.
   * @param {string} k - Exact synthetic key.
   * @returns {Promise<string>} Fixture-only outcome, not live Valkey acceptance.
   */
  async del(k) {
    this.calls.push(['del', k]);
    return this.data.delete(k) ? '1' : '0';
  }
  /** Return a native-like decimal presence result.
   * @param {string} k - Exact synthetic key.
   * @returns {Promise<string>} Fixture-only outcome, not live Valkey acceptance.
   */
  async exists(k) {
    return this.data.has(k) ? '1' : '0';
  }
  /** Use BigInt fixture arithmetic so unsafe native results remain observable.
   * @param {string} k - Exact synthetic key.
   * @param {number} n - Native arithmetic delta or TTL.
   * @returns {Promise<string>} Fixture-only outcome, not live Valkey acceptance.
   */
  async incrby(k, n) {
    /** Synthetic existing decimal counter string before native-like arithmetic. */
    const old = this.data.get(k) ?? '0';
    if (!/^-?\d+$/.test(old)) {
      throw Error('private backend integer');
    }
    /** BigInt fixture result preserving backend precision before wrapper validation. */
    const next = BigInt(old) + BigInt(n);
    this.data.set(k, String(next));
    return String(next);
  }
  /** Delegate signed fixture decrement to increment.
   * @param {string} k - Exact synthetic key.
   * @param {number} n - Native arithmetic delta or TTL.
   * @returns {Promise<string>} Fixture-only outcome, not live Valkey acceptance.
   */
  async decrby(k, n) {
    return this.incrby(k, -n);
  }
  /** Record the native expiry request without inventing real server TTL behavior.
   * @param {string} k - Exact synthetic key.
   * @param {number} n - Native arithmetic delta or TTL.
   * @returns {Promise<string>} Fixture-only outcome, not live Valkey acceptance.
   */
  async expire(k, n) {
    this.calls.push(['expire', k, n]);
    return this.data.has(k) ? '1' : '0';
  }
  /** Return a complete intentionally overmatching scan page.
   * @param {string} cursor - Synthetic complete-page cursor.
   * @param {Array<string|number>} args - Fixed native command tokens.
   * @returns {Promise<[string,string[]]>} Fixture-only outcome, not live Valkey acceptance.
   */
  async scan(cursor, ...args) {
    this.calls.push(['scan', cursor, ...args]);
    return ['0', [...this.data.keys()]];
  }
  /** Record and clear only synthetic fixture state.
   * @returns {Promise<void>} Fixture-only outcome, not live Valkey acceptance.
   */
  async flushdb() {
    this.calls.push(['flushdb']);
    this.data.clear();
  }
  /** Record native close ownership without a network resource.
   * @returns {Promise<void>} Fixture-only outcome, not live Valkey acceptance.
   */
  async quit() {
    this.quits++;
  }
  /** Record explicit native disconnect without claiming write rollback.
   * @returns {void} Fixture-only outcome, not live Valkey acceptance.
   */
  disconnect() {
    this.disconnects++;
  }
}
test('normal JSON/conditional/TTL/counter/bulk semantics work with scoped manager and no global clear', async () => {
  /** Injected EventEmitter client with no actual network resources. */
  const client = new Client();
  /** Scoped wrapper owning its listener/drain state. */
  const helper = createValkeyCacheHelper(client);
  /** Actual public manager consumer owning its helper shutdown. */
  const manager = createCacheManagerWithHelper(helper, { prefix: 'tenant' });
  try {
    assert.equal(await manager.get('miss'), undefined);
    await manager.set('one', { ok: true }, { ttlSeconds: 0.1, ifAbsent: true });
    await manager.set('one', { ok: false }, { ifAbsent: true });
    assert.deepEqual(await manager.get('one'), { ok: true });
    assert.ok(client.calls.some((c) => c.includes('EX') && c.includes(1)));
    await manager.set('number', 1);
    assert.equal(await manager.increment('number', 2), 3);
    assert.equal(await manager.decrement('number', 5), -2);
    assert.equal(await manager.touch('number', 1), true);
    await manager.setMany({ a: 1, b: 'text' });
    assert.deepEqual(
      { ...(await manager.getMany(['a', 'b', 'missing'])) },
      { a: 1, b: 'text', missing: undefined }
    );
    assert.equal(await manager.deleteMany(['a', 'b']), 2);
    await assert.rejects(
      async () => helper.clear(),
      (e) => e.code === 'VALKEY_GLOBAL_CLEAR_DISABLED'
    );
    /** Native call count before invalid input, proving no dispatch. */
    const before = client.calls.length;
    await assert.rejects(
      async () => helper.set('bad', {}, { ifAbsent: true, ifPresent: true }),
      (e) => e.code === 'VALKEY_INVALID_CONDITION'
    );
    assert.equal(client.calls.length, before);
    await manager.clear();
    assert.equal(await manager.has('one'), false);
  } finally {
    await manager.close();
    await helper.whenClosed();
  }
  assert.equal(client.quits, 0);
  assert.equal(client.listenerCount('error'), 0);
  await assert.rejects(
    async () => helper.get('stale'),
    (e) => e.code === 'VALKEY_CLOSED'
  );
});
test('literal namespace scan filters wildcard keys, scans all Cluster masters and never assumes cross-slot batches', async () => {
  /** First synthetic Cluster primary. */
  const one = new Client();
  /** Second synthetic Cluster primary containing another namespace. */
  const two = new Client();
  /** Injected actual-inventory fixture with replay/redirect policy explicitly disabled. */
  const cluster = new Client({
    redisOptions: { ...safe },
    enableOfflineQueue: false,
    maxRedirections: 0,
    scaleReads: 'master',
  });
  cluster.nodes = () => [one, two];
  cluster.del = async (key) =>
    Number(await one.del(key)) + Number(await two.del(key));
  cluster.get = async (key) => (await one.get(key)) ?? (await two.get(key));
  one.data.set('app[*]:a', '1');
  two.data.set('app[*]:b', '2');
  two.data.set('appZ:private', '3');
  /** Scoped wrapper owning its listener/drain state. */
  const helper = createValkeyCacheHelper(cluster);
  try {
    assert.deepEqual(
      { ...(await helper.getMany(['app[*]:a', 'app[*]:b'])) },
      { 'app[*]:a': 1, 'app[*]:b': 2 }
    );
    await helper.clearPrefix('app[*]');
    assert.equal(two.data.get('appZ:private'), '3');
    assert.equal(one.data.size, 0);
    assert.ok(
      one.calls.some((c) => c[0] === 'scan' && c.includes('app\\[\\*\\]:*'))
    );
    assert.ok(two.calls.some((c) => c[0] === 'scan'));
    await assert.rejects(
      async () => helper.clear(),
      (e) => e.code === 'VALKEY_GLOBAL_CLEAR_DISABLED'
    );
  } finally {
    await helper.close();
  }
});
test('direct helper bounds JSON/bulk/results/precision and rejects unsafe injected policies', async () => {
  /** Injected EventEmitter client with no actual network resources. */
  const client = new Client();
  /** Scoped wrapper owning its listener/drain state. */
  const helper = createValkeyCacheHelper(client, {
    valueLimits: { maxBulk: 2, maxValueBytes: 64, maxDepth: 2 },
  });
  try {
    await assert.rejects(
      async () => helper.set('large', 'é'.repeat(100)),
      (e) => e.code === 'VALKEY_INVALID_VALUE'
    );
    await assert.rejects(
      async () => helper.set('deep', { a: { b: { c: 1 } } }),
      (e) => e.code === 'VALKEY_INVALID_VALUE'
    );
    await assert.rejects(
      async () => helper.setMany({ a: 1, b: 2, c: 3 }),
      (e) => e.code === 'VALKEY_BULK_LIMIT'
    );
    await assert.rejects(
      async () =>
        helper.set('getter', {
          get secret() {
            throw Error('PRIVATE');
          },
        }),
      (e) => !e.message.includes('PRIVATE')
    );
    client.data.set('malformed', 'PRIVATE malformed');
    await assert.rejects(
      async () => helper.get('malformed'),
      (e) => e.code === 'VALKEY_INVALID_VALUE' && !e.message.includes('PRIVATE')
    );
    client.data.set('counter', '9007199254740991');
    await assert.rejects(
      async () => helper.increment('counter'),
      (e) =>
        e.code === 'VALKEY_NUMBER_RANGE' && e.details.writeOutcome === 'unknown'
    );
    assert.equal(client.data.get('counter'), '9007199254740992');
  } finally {
    await helper.close();
  }
  assert.throws(
    () =>
      createValkeyCacheHelper(
        new Client({ ...safe, autoResendUnfulfilledCommands: true })
      ),
    (e) => e.code === 'VALKEY_UNSAFE_CLIENT_POLICY'
  );
  assert.throws(
    () =>
      createValkeyCacheHelper(new Client({ ...safe, keyPrefix: 'hidden:' })),
    (e) => e.code === 'VALKEY_UNSAFE_CLIENT_POLICY'
  );
});
test('deadline/cancellation keep native capacity until settlement, redact hooks and never replay writes', async () => {
  let finish;
  /** Injected EventEmitter client with no actual network resources. */
  const client = new Client();
  /** Redacted fixed-label observations checked for payload exclusion. */
  const records = [];
  client.set = () => new Promise((resolve) => (finish = resolve));
  /** Scoped wrapper owning its listener/drain state. */
  const helper = createValkeyCacheHelper(client, {
    commandTimeoutMs: 5,
    maxPendingCommands: 1,
    shutdownTimeoutMs: 5,
    onOperation: (r) => records.push(r),
  });
  await assert.rejects(
    async () => helper.set('PRIVATE_KEY', 'PRIVATE_VALUE'),
    (e) => e.code === 'VALKEY_DEADLINE' && e.details.writeOutcome === 'unknown'
  );
  assert.equal(helper.getDiagnostics().pending, 1);
  await assert.rejects(
    async () => helper.get('other'),
    (e) => e.code === 'VALKEY_OVERLOAD'
  );
  await assert.rejects(
    async () => helper.close(),
    (e) => e.code === 'VALKEY_SHUTDOWN_DEADLINE'
  );
  assert.equal(client.disconnects, 0);
  finish('OK');
  await helper.whenClosed();
  assert.equal(client.quits, 0);
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE/);
  /** Already-aborted caller signal proving no native mutation is issued. */
  const aborted = new AbortController();
  aborted.abort();
  /** Independent wrapper used for pre-dispatch cancellation. */
  const normal = createValkeyCacheHelper(new Client());
  await assert.rejects(
    async () => normal.set('k', 1, { signal: aborted.signal }),
    (e) => e.code === 'VALKEY_CANCELLED' && !e.details.writeOutcome
  );
  await normal.close();
});
test('owned factory enforces bounded native options and partial startup rollback', async () => {
  /** Acquired synthetic clients retained to assert ownership and startup rollback. */
  const native = [];
  /** Explicit injected constructors; no package discovery or live endpoint. */
  const constructors = {
    /** Acquire and retain a synthetic standalone client for ownership assertions.
     * @param {Record<string,unknown>} options - Explicit safe native settings.
     * @param {string|undefined} url - Validated test URL with synthetic credentials.
     * @returns {Client} Fixture-only outcome, not live Valkey acceptance.
     */
    standalone(options, url) {
      /** Injected EventEmitter client with no actual network resources. */
      const client = new Client(options);
      client.url = url;
      native.push(client);
      return client;
    },
    /** Acquire and retain a synthetic Cluster-shaped client.
     * @param {Array<{host:string,port:number}>} nodes - Explicit synthetic seed inventory.
     * @param {Record<string,unknown>} options - Explicit safe native settings.
     * @returns {Client} Fixture-only outcome, not live Valkey acceptance.
     */
    cluster(nodes, options) {
      /** Injected EventEmitter client with no actual network resources. */
      const client = new Client(options);
      client.nodes = () => [];
      native.push(client);
      return client;
    },
  };
  /** Scoped wrapper owning its listener/drain state. */
  const helper = await createCacheHelper(
    { url: 'rediss://user:PRIVATE@localhost:6380/2' },
    constructors
  );
  assert.equal(native[0].options.autoResendUnfulfilledCommands, false);
  assert.equal(native[0].options.enableOfflineQueue, false);
  assert.equal(native[0].options.maxRetriesPerRequest, 0);
  assert.equal(native[0].options.stringNumbers, true);
  assert.equal(native[0].options.retryStrategy(), null);
  await helper.close();
  await helper.close();
  assert.equal(native[0].quits, 1);
  // Verify each invalid connection/native-policy shape rejects before acquiring another client.
  for (const options of [
    { url: 'http://host' },
    { url: 'redis://host', host: 'other' },
    { host: 'host', tls: { rejectUnauthorized: false } },
    { keyPrefix: 'hidden' },
    { cluster: { nodes: [{ host: 'host', port: 6379 }] }, db: 1 },
  ]) {
    await assert.rejects(createCacheHelper(options, constructors));
  }
  assert.equal(native.length, 1);
  /** Constructor override whose connect rejects to exercise cleanup. */
  const broken = {
    ...constructors,
    /** Acquire and retain a synthetic standalone client for ownership assertions.
     * @param {Record<string,unknown>} options - Explicit safe native settings.
     * @returns {Client} Fixture-only outcome, not live Valkey acceptance.
     */
    standalone(options) {
      /** Injected EventEmitter client with no actual network resources. */
      const client = constructors.standalone(options);
      client.connect = async () => {
        throw Error('PRIVATE backend credentials');
      };
      return client;
    },
  };
  await assert.rejects(
    createCacheHelper({}, broken),
    (e) => e.code === 'VALKEY_CONNECT_FAILED' && !e.message.includes('PRIVATE')
  );
  assert.ok(native[1].disconnects >= 1);
});
test('simultaneous tenant managers isolate namespaces; dynamic public factory negotiation works without native ownership', async () => {
  /** Injected EventEmitter client with no actual network resources. */
  const client = new Client();
  /** First independent wrapper borrowing the same native client. */
  const first = createValkeyCacheHelper(client);
  /** Second independent wrapper borrowing the same native client. */
  const second = createValkeyCacheHelper(client);
  /** First tenant manager with its own wrapper lifetime. */
  const a = createCacheManagerWithHelper(first, { prefix: 'tenant-a' });
  /** Second tenant manager whose namespace must survive clearing. */
  const b = createCacheManagerWithHelper(second, { prefix: 'tenant-b' });
  await a.set('key', 1);
  await b.set('key', 2);
  await a.clear();
  assert.equal(await b.get('key'), 2);
  await a.close();
  await b.close();
  assert.equal(client.quits, 0);
  /** Public factory-loaded manager negotiating actual helper capabilities. */
  const dynamic = await createCacheManager({
    helper: '@zeruxjs/cache-valkey',
    prefix: 'test',
    options: { client },
    policy: { requireCapabilities: ['conditionalWrites', 'counters'] },
  });
  await dynamic.set('key', 3);
  assert.equal(await dynamic.get('key'), 3);
  await dynamic.close();
  assert.equal(client.quits, 0);
});
