import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRedisRateLimitStore,
  createRedisCacheHelper,
  createIORedisCacheHelper,
} from '../dist/index.js';
/** Build an EVAL-optional native fixture; each test supplies explicit script outcomes.
 * @returns {object} Synthetic driver, not native Lua/atomicity acceptance.
 */
function client() {
  return {
    async get() {
      return null;
    },
    async set() {},
    async del() {
      return 0;
    },
    async exists() {
      return 0;
    },
    async mGet() {
      return [];
    },
    async mSet() {},
    async incrBy() {
      return 0;
    },
    async decrBy() {
      return 0;
    },
    async expire() {
      return 1;
    },
    async *scanIterator() {},
    async close() {},
  };
}
/** Synthetic opaque fixed-window claim; no raw subject identity. */
const input = { key: 'x'.repeat(43), max: 3, windowMs: 1000, weight: 1 };
test('reviewed script has bounded cleanup, server time, shared Cluster tag and opaque arguments', async () => {
  /** Injected native client with test-specific EVAL behavior. */
  const raw = client();
  /** Captured trusted script/arguments checked without live Lua execution. */
  const seen = [];
  raw.eval = async (script, options) => {
    seen.push({ script, options });
    return [1, 2, 2000, 1000, 0];
  };
  /** Scoped wrapper around the borrowed native fixture. */
  const helper = createRedisCacheHelper(raw);
  /** Atomic-store facade; advertised strategy is not live Redis qualification. */
  const store = createRedisRateLimitStore(helper, {
    namespace: 'tenant_app',
    maxKeys: 10,
    maxWindowMs: 1000,
  });
  assert.equal(store.scope, 'distributed');
  assert.deepEqual(await store.claim(input), {
    allowed: true,
    remaining: 2,
    resetAt: 2000,
    now: 1000,
    reason: 'allowed',
  });
  assert.deepEqual(seen[0].options.keys, [
    'zerux:rl:{tenant_app}:counts',
    'zerux:rl:{tenant_app}:expires',
  ]);
  assert.deepEqual(seen[0].options.arguments, [
    input.key,
    '1000',
    '3',
    '1',
    '10',
    '1000',
  ]);
  assert.match(seen[0].script, /'TIME'/);
  assert.match(seen[0].script, /'LIMIT',0,128/);
  assert.match(seen[0].script, /'PEXPIRE'/);
  assert.match(seen[0].script, /LIMITER_STATE_INCOMPLETE/);
  await store.close();
  await assert.rejects(store.claim(input));
  assert.equal(await helper.get('still-open'), undefined);
  await helper.close();
});
test('unsupported EVAL, malformed state, limits and deadline are not local fallback', async () => {
  /** Injected native client with test-specific EVAL behavior. */
  const raw = client();
  /** Scoped wrapper around the borrowed native fixture. */
  const helper = createRedisCacheHelper(raw);
  assert.throws(() => createRedisRateLimitStore(helper, { namespace: 'app' }));
  raw.eval = async () => [9, 2, 2000, 1000, 0];
  /** Atomic-store facade; advertised strategy is not live Redis qualification. */
  const store = createRedisRateLimitStore(helper, {
    namespace: 'app',
    maxWindowMs: 1000,
  });
  await assert.rejects(
    store.claim(input),
    (error) => error.code === 'REDIS_INVALID_LIMITER_RESULT'
  );
  await assert.rejects(store.claim({ ...input, windowMs: 1001 }));
  await assert.rejects(store.claim({ ...input, key: 'raw subject' }));
  assert.throws(() =>
    createRedisRateLimitStore(helper, { namespace: 'bad{tag}' })
  );
  await store.close();
  await helper.close();
  /** Native EVAL fixture deliberately held past the caller deadline. */
  const slow = client();
  let settle;
  slow.eval = () =>
    new Promise((r) => {
      settle = r;
    });
  /** Helper retaining timed-out native work until explicit settlement. */
  const bounded = createRedisCacheHelper(slow, { commandTimeoutMs: 5 });
  /** Borrowing store used to verify unknown mutation outcomes. */
  const limited = createRedisRateLimitStore(bounded, { namespace: 'app' });
  await assert.rejects(
    limited.claim(input),
    (error) =>
      error.code === 'REDIS_COMMAND_DEADLINE' &&
      error.details.writeOutcome === 'unknown'
  );
  assert.equal(bounded.getDiagnostics().pending, 1);
  settle([1, 2, 2000, 1000, 0]);
  await limited.close();
  await bounded.close();
});
test('ioredis EVAL bridge uses explicit two-key placement and store owns only opted-in wrapper', async () => {
  /** Injected native client with test-specific EVAL behavior. */
  const raw = client();
  let args,
    closed = 0;
  /** Lowercase EVAL bridge fixture recording explicit key-count placement. */
  const io = {
    get: raw.get,
    set: raw.set,
    del: raw.del,
    exists: raw.exists,
    mget: raw.mGet,
    mset: raw.mSet,
    incrby: raw.incrBy,
    decrby: raw.decrBy,
    expire: raw.expire,
    scan: async () => ['0', []],
    quit: async () => {
      closed++;
    },
    on() {},
    eval: async (...values) => {
      args = values;
      return [0, 0, 2000, 1000, 0];
    },
  };
  /** Scoped wrapper around the borrowed native fixture. */
  const helper = createIORedisCacheHelper(io);
  /** Atomic-store facade; advertised strategy is not live Redis qualification. */
  const store = createRedisRateLimitStore(helper, {
    namespace: 'app',
    ownHelper: true,
  });
  assert.equal((await store.claim(input)).reason, 'rate');
  assert.equal(args[1], 2);
  assert.equal(args[2], 'zerux:rl:{app}:counts');
  await store.close();
  assert.equal(closed, 0);
  await assert.rejects(
    helper.get('closed'),
    (error) => error.code === 'REDIS_CACHE_CLOSED'
  );
});
