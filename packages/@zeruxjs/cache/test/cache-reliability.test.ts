import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
/** Resolve the built CommonJS public entry from this ESM fixture. */
const require = createRequire(import.meta.url);
/** Public factories under test; no external provider is configured. */
const {
  createMemoryCacheHelper,
  createCacheManagerWithHelper,
  createCacheManager,
} = require('../dist/index.js');

test('TTL, LRU, copy isolation, namespace clear and counters', async (t) => {
  let now = 10000;
  /** Bounded memory storage with a deterministic test clock. */
  const adapter = createMemoryCacheHelper({ maxEntries: 3, now: () => now });
  /** First scoped manager, closed by the test cleanup hook. */
  const a = createCacheManagerWithHelper(adapter, { prefix: 'tenantA' });
  /** Second namespace used to detect cross-tenant clearing. */
  const b = createCacheManagerWithHelper(adapter, { prefix: 'tenantB' });
  t.after(async () => {
    await a.close();
    await b.close();
  });
  /** Mutable input used to prove defensive cache copying. */
  const value = { children: [1] };
  await a.set('v', value, { ttlSeconds: 1 });
  value.children.push(2);
  assert.deepEqual(await a.get('v'), { children: [1] });
  (await a.get('v')).children.push(3);
  assert.deepEqual(await a.get('v'), { children: [1] });
  await b.set('v', 'keep');
  /** Logical-key lookup results, including a prototype-like key. */
  const values = await a.getMany(['v', 'absent', '__proto__']);
  assert.deepEqual(values.v, { children: [1] });
  assert.ok(Object.hasOwn(values, '__proto__'));
  await a.clear();
  assert.equal(await a.get('v'), undefined);
  assert.equal(await b.get('v'), 'keep');
  assert.equal(await a.increment('count', 4), 4);
  assert.equal(await a.decrement('count', 3), 1);
  await a.touch('count', 2);
  now += 2100;
  assert.equal(await a.get('count'), undefined);
  await a.set('exp', 1, { ttlSeconds: 1 });
  now += 1001;
  assert.equal(await a.has('exp'), false);
  assert.ok(adapter.stats().misses > 0);
});

test('conditional writes, LRU eviction and invalid inputs', async (t) => {
  /** First scoped manager, closed by the test cleanup hook. */
  const a = createCacheManagerWithHelper(
    createMemoryCacheHelper({ maxEntries: 2 })
  );
  t.after(() => a.close());
  await a.set('k', 'first', { ifAbsent: true });
  await a.set('k', 'second', { ifAbsent: true });
  assert.equal(await a.get('k'), 'first');
  await a.set('not-yet', 'bad', { ifPresent: true });
  assert.equal(await a.get('not-yet'), undefined);
  await a.set('k', 'second', { ifPresent: true });
  await a.set('l', 2);
  await a.get('k');
  await a.set('m', 3);
  assert.equal(await a.get('l'), undefined);
  assert.throws(() => a.increment('k', 0.2), /integer/);
  assert.throws(() => a.set('x', 1, { ttlSeconds: 0 }), /ttlSeconds/);
});

test('remember coalesces concurrent misses but not failed producers', async (t) => {
  /** Owned manager used to exercise producer and namespace safety. */
  const manager = createCacheManagerWithHelper(createMemoryCacheHelper());
  t.after(() => manager.close());
  let calls = 0;
  /** One delayed producer shared by concurrent callers.
   * @returns {Promise<{works: boolean}>} Synthetic cacheable value after one short delay. */
  const producer = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 8));
    return { works: true };
  };
  /** All coalesced caller results; production must run once. */
  const result = await Promise.all(
    Array.from({ length: 12 }, () => manager.remember('id', producer))
  );
  assert.equal(calls, 1);
  assert.equal(result.length, 12);
  assert.deepEqual(await manager.get('id'), { works: true });
  await assert.rejects(
    manager.remember('err', () => {
      throw Error('offline');
    }),
    /offline/
  );
  assert.equal(await manager.remember('err', () => 5), 5);
});

test('namespace clearing fails closed when helper lacks clearPrefix', async (t) => {
  /** Memory helper whose namespace operation is deliberately omitted. */
  const stub = createMemoryCacheHelper();
  /** Adapter shape without namespace clearing; global clearing must not substitute. */
  const { clearPrefix: _clearPrefix, ...unsafe } = stub;
  /** Owned manager used to exercise producer and namespace safety. */
  const manager = createCacheManagerWithHelper(unsafe, { prefix: 'safe' });
  t.after(() => manager.close());
  assert.throws(() => manager.clear(), /cannot safely clear/);
});

test('built-in memory helper works through normal cache config', async (t) => {
  /** First scoped manager, closed by the test cleanup hook. */
  const a = await createCacheManager({
    helper: 'memory',
    prefix: 'project',
    options: { maxEntries: 2 },
  });
  t.after(() => a.close());
  await a.set('message', 'cached');
  assert.equal(await a.get('message'), 'cached');
  await a.clear();
  assert.equal(await a.get('message'), undefined);
});
