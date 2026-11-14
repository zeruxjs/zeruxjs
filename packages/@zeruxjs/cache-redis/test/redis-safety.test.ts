import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
/** Resolve built CommonJS public exports from this ESM fixture. */
const require = createRequire(import.meta.url);
/** Public wrapper and dynamic factory under test. */
const {
  createRedisCacheHelper,
  createCacheHelper,
} = require('../dist/index.js');
/** Actual cache facade consumer used to verify namespace isolation. */
const { createCacheManagerWithHelper } = require('@zeruxjs/cache');
/** Native-shaped in-memory fixture; no Redis connection or timing emulation. */
class FakeRedis {
  values = new Map();
  ttl = new Map();
  flushes = 0;
  scans = 0;
  /** Return one synthetic native value or null.
   * @param {string} k - Exact synthetic key.
   * @returns {Promise<string|null>} Fixture-only outcome; no live server qualification.
   */
  async get(k) {
    return this.values.get(k) ?? null;
  }
  /** Apply native-like NX/XX conditions to the synthetic map.
   * @param {string} k - Exact synthetic key.
   * @param {string} v - Encoded synthetic value.
   * @param {{NX?:boolean,XX?:boolean,EX?:number}} opts - Synthetic native write flags.
   * @returns {Promise<string|null>} Fixture-only outcome; no live server qualification.
   */
  async set(k, v, opts = {}) {
    if (opts.NX && this.values.has(k)) {
      return null;
    }
    if (opts.XX && !this.values.has(k)) {
      return null;
    }
    this.values.set(k, v);
    if (opts.EX) {
      this.ttl.set(k, opts.EX);
    }
    return 'OK';
  }
  /** Count exact synthetic deletions.
   * @param {string|string[]} keys - Synthetic key inventory.
   * @returns {Promise<number>} Fixture-only outcome; no live server qualification.
   */
  async del(keys) {
    let n = 0;
    // Count only existing synthetic keys removed by the native fixture.
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      if (this.values.delete(k)) {
        n++;
      }
    }
    return n;
  }
  /** Report native-like item presence.
   * @param {string} k - Exact synthetic key.
   * @returns {Promise<number>} Fixture-only outcome; no live server qualification.
   */
  async exists(k) {
    return this.values.has(k) ? 1 : 0;
  }
  /** Read synthetic values in requested order.
   * @param {string|string[]} keys - Synthetic key inventory.
   * @returns {Promise<Array<string|null>>} Fixture-only outcome; no live server qualification.
   */
  async mGet(keys) {
    return keys.map((k) => this.values.get(k) ?? null);
  }
  /** Write each prepared string into the synthetic map.
   * @param {Record<string,string>} obj - Prepared string entries.
   * @returns {Promise<void>} Fixture-only outcome; no live server qualification.
   */
  async mSet(obj) {
    // Apply each synthetic prepared native value without networking.
    for (const [k, v] of Object.entries(obj)) {
      this.values.set(k, v);
    }
  }
  /** Update a synthetic decimal counter.
   * @param {string} k - Exact synthetic key.
   * @param {number} n - Native arithmetic delta.
   * @returns {Promise<number>} Fixture-only outcome; no live server qualification.
   */
  async incrBy(k, n) {
    /** Synthetic native counter result, stored as a decimal string. */
    const v = Number(this.values.get(k) || 0) + n;
    this.values.set(k, String(v));
    return v;
  }
  /** Decrement the synthetic native counter.
   * @param {string} k - Exact synthetic key.
   * @param {number} n - Native arithmetic delta.
   * @returns {Promise<number>} Fixture-only outcome; no live server qualification.
   */
  async decrBy(k, n) {
    /** Synthetic native counter result, stored as a decimal string. */
    const v = Number(this.values.get(k) || 0) - n;
    this.values.set(k, String(v));
    return v;
  }
  /** Observe fixture expiry metadata without a real clock/server.
   * @param {string} k - Exact synthetic key.
   * @param {number} t - Native expiry seconds.
   * @returns {Promise<number>} Fixture-only outcome; no live server qualification.
   */
  async expire(k, t) {
    if (!this.values.has(k)) {
      return 0;
    }
    this.ttl.set(k, t);
    return 1;
  }
  /** Yield an intentionally overmatching synthetic inventory.
   * @returns {AsyncGenerator<string[]>} Fixture-only outcome; no live server qualification.
   */
  async *scanIterator() {
    this.scans++;
    /** Detached fixture scan inventory; intentionally overmatches the requested glob. */
    const keys = [...this.values.keys()];
    yield keys.slice(0, 2);
    yield keys.slice(2);
  }
  /** Record a forbidden-or-approved synthetic global flush.
   * @returns {Promise<void>} Fixture-only outcome; no live server qualification.
   */
  async flushDb() {
    this.flushes++;
    this.values.clear();
  }
}
test('namespace scan clears only owned keys, even if SCAN overmatches', async (t) => {
  /** Injected in-memory native client, never a live Redis connection. */
  const db = new FakeRedis();
  /** Owned wrapper around the borrowed synthetic client. */
  const adapter = createRedisCacheHelper(db);
  /** First namespace proving literal wildcard handling. */
  const a = createCacheManagerWithHelper(adapter, { prefix: 'app*' });
  /** Second namespace that must survive the first clear. */
  const b = createCacheManagerWithHelper(adapter, { prefix: 'other' });
  t.after(async () => {
    await a.close();
    await b.close();
  });
  await a.set('id', 1);
  await b.set('id', 2);
  await db.set('app*not-a-child', 'survive');
  assert.deepEqual(
    await a.getMany(['id']),
    Object.assign(Object.create(null), { id: 1 })
  );
  await a.clear();
  assert.equal(await a.get('id'), undefined);
  assert.equal(await b.get('id'), 2);
  assert.equal(await db.get('app*not-a-child'), 'survive');
  assert.equal(db.flushes, 0);
  await assert.rejects(adapter.clear(), /FLUSHDB is disabled/);
});
test('TTL, conditional writes, atomic counters and injected client', async (t) => {
  /** Injected in-memory native client, never a live Redis connection. */
  const db = new FakeRedis();
  /** Owned wrapper around the borrowed synthetic client. */
  const adapter = await createCacheHelper({ client: db });
  t.after(() => adapter.close());
  await adapter.set('v', 1, { ttlSeconds: 1.3 });
  assert.equal(db.ttl.get('v'), 2);
  assert.equal(await adapter.increment('v', 2), 3);
  assert.equal(await adapter.decrement('v', 1), 2);
  await adapter.set('v', 'wrong', { ifAbsent: true });
  assert.equal(await adapter.get('v'), 2);
  await adapter.set('missing', 2, { ifPresent: true });
  assert.equal(await adapter.has('missing'), false);
  assert.equal(await adapter.touch('v', 3), true);
  assert.equal(await adapter.touch('missing', 3), false);
  await adapter.setMany({ hello: { a: 1 }, hi: true }, { ttlSeconds: 3 });
  assert.equal(db.ttl.get('hello'), 3);
  assert.equal(await adapter.deleteMany(['hello', 'hi']), 2);
  await assert.rejects(adapter.clear(), /disabled/);
  await assert.rejects(adapter.set('bad', 1, { ttlSeconds: 1e40 }), /range/);
  await assert.rejects(adapter.increment('v', 0.3), /integer/);
});
