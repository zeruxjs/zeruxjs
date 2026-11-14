import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCacheHelper,
  createBullMQRedisOptions,
  createIORedisCacheHelper,
} from '../dist/index.js';
/** Lowercase native command fixture; only wrapper behavior is under test. */
class FakeIO {
  values = new Map();
  closed = 0;
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
   * @param {Array<string|number>} args - Explicit native condition tokens.
   * @returns {Promise<string|null>} Fixture-only outcome; no live server qualification.
   */
  async set(k, v, ...args) {
    if (args.includes('NX') && this.values.has(k)) {
      return null;
    }
    if (args.includes('XX') && !this.values.has(k)) {
      return null;
    }
    this.values.set(k, v);
    return 'OK';
  }
  /** Count exact synthetic deletions.
   * @param {string|string[]} keys - Synthetic key inventory.
   * @returns {Promise<number>} Fixture-only outcome; no live server qualification.
   */
  async del(...keys) {
    let count = 0;
    // Count only deleted synthetic items.
    for (const key of keys) {
      if (this.values.delete(key)) {
        count++;
      }
    }
    return count;
  }
  /** Report native-like item presence.
   * @param {string} k - Exact synthetic key.
   * @returns {Promise<number>} Fixture-only outcome; no live server qualification.
   */
  async exists(k) {
    return this.values.has(k) ? 1 : 0;
  }
  /** Read synthetic lowercase-command values in order.
   * @param {string|string[]} keys - Synthetic key inventory.
   * @returns {Promise<Array<string|null>>} Fixture-only outcome; no live server qualification.
   */
  async mget(...keys) {
    return keys.map((k) => this.values.get(k) ?? null);
  }
  /** Write lowercase-command synthetic string entries.
   * @param {Record<string,string>} items - Prepared lowercase-command entries.
   * @returns {Promise<void>} Fixture-only outcome; no live server qualification.
   */
  async mset(items) {
    // Apply prepared synthetic native writes in order.
    for (const [key, value] of Object.entries(items)) {
      this.values.set(key, value);
    }
  }
  /** Update a synthetic decimal counter.
   * @param {string} k - Exact synthetic key.
   * @param {number} n - Native arithmetic delta.
   * @returns {Promise<number>} Fixture-only outcome; no live server qualification.
   */
  async incrby(k, n) {
    /** Synthetic native integer result persisted in decimal form. */
    const value = Number(this.values.get(k) ?? 0) + n;
    this.values.set(k, String(value));
    return value;
  }
  /** Delegate negative arithmetic to the fixture increment.
   * @param {string} k - Exact synthetic key.
   * @param {number} n - Native arithmetic delta.
   * @returns {Promise<number>} Fixture-only outcome; no live server qualification.
   */
  async decrby(k, n) {
    return this.incrby(k, -n);
  }
  /** Observe fixture expiry metadata without a real clock/server.
   * @returns {Promise<number>} Fixture-only outcome; no live server qualification.
   */
  async expire() {
    return 1;
  }
  /** Return one complete synthetic scan page.
   * @param {string} _cursor - Unused complete-page fixture cursor.
   * @param {Array<string|number>} _options - Unused native scan hints.
   * @returns {Promise<[string,string[]]>} Fixture-only outcome; no live server qualification.
   */
  async scan(_cursor, ..._options) {
    return ['0', [...this.values.keys()]];
  }
  /** Clear only this injected fixture map.
   * @returns {Promise<void>} Fixture-only outcome; no live server qualification.
   */
  async flushdb() {
    this.values.clear();
  }
  /** Record native ownership cleanup without networking.
   * @returns {Promise<void>} Fixture-only outcome; no live server qualification.
   */
  async quit() {
    this.closed++;
  }
  /** Return this structural fixture without opening a connection.
   * @returns {FakeIO} Fixture-only outcome; no live server qualification.
   */
  on() {
    return this;
  }
}
test('ioredis adapter handles JSON, SET NX, mget and safe SCAN namespacing', async () => {
  /** Injected lowercase-command client; no external endpoint. */
  const db = new FakeIO();
  /** Owned wrapper around the borrowed native fixture. */
  const adapter = await createCacheHelper({ driver: 'ioredis', client: db });
  await adapter.set('shop:1', { stock: 3 });
  await adapter.set('shop:1', { stock: 4 }, { ifAbsent: true });
  assert.deepEqual(await adapter.get('shop:1'), { stock: 3 });
  await adapter.setMany({ 'shop:2': false, 'other:2': 9 });
  assert.deepEqual(
    { ...(await adapter.getMany(['shop:2', 'missing'])) },
    { 'shop:2': false, missing: undefined }
  );
  await adapter.clearPrefix('shop');
  assert.equal(await adapter.get('shop:1'), undefined);
  assert.equal(await adapter.get('other:2'), 9);
  await assert.rejects(adapter.clear(), /disabled/);
  await adapter.close();
  assert.equal(db.closed, 0);
  /** Separate wrapper explicitly owning native quit, used to verify one close. */
  const owned = createIORedisCacheHelper(db, { ownClient: true });
  await owned.close();
  assert.equal(db.closed, 1);
});
test('BullMQ connection options reject keyPrefix and separate producer and worker retry policies', () => {
  /** Independent BullMQ producer/worker options with synthetic credentials. */
  const pair = createBullMQRedisOptions({
    url: 'redis://:secret@cache:6379/0',
  });
  assert.equal(pair.producer.password, 'secret');
  assert.equal(pair.producer.maxRetriesPerRequest, 1);
  assert.equal(pair.worker.maxRetriesPerRequest, null);
  assert.equal(pair.worker.enableOfflineQueue, true);
  assert.throws(
    () => createBullMQRedisOptions({ host: 'localhost', keyPrefix: 'queue:' }),
    /keyPrefix/
  );
  assert.throws(
    () => createBullMQRedisOptions({ url: 'http://localhost' }),
    /redis:/
  );
  assert.throws(
    () => createBullMQRedisOptions({ url: 'redis://localhost/xyz' }),
    /Invalid Redis database/
  );
});
