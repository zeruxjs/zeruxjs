/** Public native/library fixture APIs; tests retain explicit ownership of every acquired resource. */
const { test } = require('node:test');
/** Native strict assertions; failures must remain visible after fixture cleanup. */
const assert = require('node:assert/strict');
/** Public native/library fixture APIs; tests retain explicit ownership of every acquired resource. */
const {
  createRateLimiter,
  createMemoryRateLimitStore,
  createDistributedRateLimiter,
  resolveRateLimitIp,
  rateLimitHttpResponse,
} = require('../dist/index.js');
/** Explicit synthetic key material; fixture values are not production credentials. */
const secret = Buffer.alloc(32, 7);
/** Captured fixed synthetic endpoint quota/outage policies. */
const policies = {
  login: { max: 3, windowMs: 1000, failure: 'closed' },
  search: { max: 2, windowMs: 1000, failure: 'open' },
};
/** Synthetic already-verified tenant/subject context; public diagnostics must never echo it. */
const identity = { tenant: 'tenant-a', subject: 'sensitive@example.test' };
/**
 * Explicit process-scoped limiter factory for synthetic clocks/stores; no distributed durability is inferred.
 * @param {object} store - Explicit synthetic atomic accounting store.
 * @param {object} extra - Optional fixture-only policy overrides.
 * @returns {object} Owned process-scoped limiter with close; no durable fallback.
 */
const local = (store, extra = {}) =>
  createDistributedRateLimiter({
    store,
    secret,
    policies,
    requireDistributed: false,
    ...extra,
  });
test('fixed-window boundary, burst, tenant/endpoint separation and redacted HMAC keys', async () => {
  let now = 1000;
  /** Owned process-local reference store under a synthetic trusted clock. */
  const base = createMemoryRateLimitStore({ now: () => now, maxKeys: 10 });
  /** Synthetic opaque-key ledger used to prove raw identity redaction. */
  const keys = [];
  /** Injected synthetic atomic/replay store; persistence/atomicity claims extend only to this fixture. */
  const store = {
    ...base,
    claim(input, options) {
      keys.push(input.key);
      return base.claim(input, options);
    },
  };
  /** Owned admission scope; close must drain actual work before store/key cleanup. */
  const limiter = local(store);
  try {
    /** Independent synthetic outcomes used to assert finite accounting and denial semantics. */
    const results = await Promise.all(
      Array.from({ length: 8 }, () => limiter.check('login', identity))
    );
    assert.equal(results.filter((r) => r.allowed).length, 3);
    assert.equal(results[3].status, 429);
    assert.equal(results[3].retryAfterSeconds, 1);
    /** Synthetic Fetch admission response checked without starting a listener. */
    const response = rateLimitHttpResponse(results[3]);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '1');
    assert.deepEqual(await response.json(), {
      error: { code: 'RATE_LIMITED' },
    });
    assert.equal(results[3].resetAt, 2000);
    now = 1999;
    assert.equal((await limiter.check('login', identity)).allowed, false);
    now = 2000;
    assert.equal((await limiter.check('login', identity)).allowed, true);
    assert.equal(
      (await limiter.check('login', { ...identity, tenant: 'tenant-b' }))
        .allowed,
      true
    );
    assert.equal((await limiter.check('search', identity)).allowed, true);
    assert.match(keys[0], /^[A-Za-z0-9_-]{43}$/);
    assert.equal(JSON.stringify(keys).includes('sensitive'), false);
    assert.notEqual(keys.at(-1), keys[0]);
  } finally {
    await limiter.close();
    base.close();
  }
});
test('memory capacity never evicts live counters, expires keys and requires explicit local scope', async () => {
  let now = 0;
  /** Injected synthetic atomic/replay store; persistence/atomicity claims extend only to this fixture. */
  const store = createMemoryRateLimitStore({ maxKeys: 1, now: () => now });
  assert.throws(
    () => createDistributedRateLimiter({ store, secret, policies }),
    /distributed/
  );
  /** Owned admission scope; close must drain actual work before store/key cleanup. */
  const limiter = local(store);
  await limiter.check('login', identity);
  /** Synthetic capacity denial proving live counters are not evicted. */
  const full = await limiter.check('login', {
    tenant: 'other',
    subject: 'subject',
  });
  assert.equal(full.status, 503);
  assert.equal(store.size, 1);
  now = 1000;
  assert.equal(store.size, 0);
  assert.equal(
    (await limiter.check('login', { tenant: 'other', subject: 'subject' }))
      .allowed,
    true
  );
  await limiter.close();
  store.close();
  await assert.rejects(limiter.check('login', identity));
});
test('store outage is explicit open/closed, hooks never receive identities and exceptions isolate', async () => {
  let calls = 0;
  /** Redacted fixed-label hook ledger; identities and raw backend causes must stay excluded. */
  const metrics = [];
  /** Injected synthetic atomic/replay store; persistence/atomicity claims extend only to this fixture. */
  const store = {
    capability: 'atomic-fixed-window-v1',
    scope: 'distributed',
    async claim() {
      calls++;
      throw Error('private backend cause');
    },
  };
  /** Owned admission scope; close must drain actual work before store/key cleanup. */
  const limiter = createDistributedRateLimiter({
    store,
    secret,
    policies,
    onDecision(metric) {
      metrics.push(metric);
      throw Error('hook failed');
    },
  });
  /** Synthetic fail-closed result, distinct from an explicit fail-open outage decision. */
  const closed = await limiter.check('login', identity);
  /** Synthetic explicit degraded fail-open result; never proof of authorization. */
  const open = await limiter.check('search', identity);
  assert.equal(closed.status, 503);
  assert.equal(open.allowed, true);
  assert.equal(open.degraded, true);
  assert.equal(calls, 2);
  assert.equal(JSON.stringify(metrics).includes('sensitive'), false);
  assert.equal(limiter.getDiagnostics().hookErrors, 2);
  /** Synthetic Fetch admission response checked without starting a listener. */
  const response = rateLimitHttpResponse(closed);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '1');
  assert.deepEqual(await response.json(), {
    error: { code: 'RATE_LIMIT_UNAVAILABLE' },
  });
  await limiter.close();
});
test('forged forwarding is ignored unless direct peer is explicitly trusted', () => {
  assert.equal(
    resolveRateLimitIp('192.0.2.1', { forwardedFor: 'attacker, invalid' }),
    '192.0.2.1'
  );
  assert.equal(
    resolveRateLimitIp('127.0.0.1', {
      trustedProxies: ['127.0.0.1'],
      forwardedFor: '192.0.2.2',
    }),
    '192.0.2.2'
  );
  assert.throws(() =>
    resolveRateLimitIp('127.0.0.1', {
      trustedProxies: ['127.0.0.1'],
      forwardedFor: '192.0.2.2, 192.0.2.3',
    })
  );
});
test('pending bounds/deadline retain uncooperative jobs and close owns cleanup', async (t) => {
  let settle,
    ready,
    closed = 0;
  /** Owned fixture readiness promise; settle held work before attempting final drain. */
  const started = new Promise((r) => {
    ready = r;
  });
  /** Injected synthetic atomic/replay store; persistence/atomicity claims extend only to this fixture. */
  const store = {
    capability: 'atomic-fixed-window-v1',
    scope: 'distributed',
    claim() {
      ready();
      return new Promise((r) => {
        settle = r;
      });
    },
    close() {
      closed++;
    },
  };
  /** Owned admission scope; close must drain actual work before store/key cleanup. */
  const limiter = createDistributedRateLimiter({
    store,
    secret,
    policies,
    maxPending: 1,
    timeoutMs: 5,
    ownStore: true,
  });
  /** Observed actual operation promise; teardown must release its deliberately held dependency. */
  // Release held native work on assertion failure before attempting limiter drain.
  t.after(async () => {
    settle?.({
      allowed: true,
      remaining: 2,
      now: 1000,
      resetAt: 2000,
      reason: 'allowed',
    });
    await limiter.close();
  });
  /** Observed actual operation promise; teardown must release its deliberately held dependency. */
  const work = limiter.check('login', identity);
  await started;
  assert.equal((await limiter.check('login', identity)).status, 503);
  assert.equal((await work).status, 503);
  assert.equal(limiter.getDiagnostics().pending, 1);
  let done = false;
  /** Owned drain promise; cancellation does not make unsettled native work disappear. */
  const closing = limiter.close().then(() => {
    done = true;
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(done, false);
  settle({
    allowed: true,
    remaining: 2,
    now: 1000,
    resetAt: 2000,
    reason: 'allowed',
  });
  await closing;
  assert.equal(closed, 1);
  await limiter.close();
  assert.equal(closed, 1);
});
test('invalid subjects/weights and malformed store results fail safely; legacy limiter remains local', async () => {
  /** Injected synthetic atomic/replay store; persistence/atomicity claims extend only to this fixture. */
  const store = createMemoryRateLimitStore();
  /** Owned admission scope; close must drain actual work before store/key cleanup. */
  const limiter = local(store);
  await assert.rejects(limiter.check('unknown', identity));
  await assert.rejects(
    limiter.check('login', { tenant: 'a', subject: 'x'.repeat(513) })
  );
  await assert.rejects(limiter.check('login', identity, { weight: 0 }));
  await limiter.close();
  store.close();
  /** Independent process-local compatibility limiter; reset clears only this fixture state. */
  const legacy = createRateLimiter({ windowMs: 1000, max: 1, now: () => 1000 });
  assert.equal(legacy.check('a').allowed, true);
  assert.equal(legacy.check('a').allowed, false);
  assert.throws(() => legacy.check(123));
  /** Synthetic malformed/failing dependency wrapper whose failure must remain explicit. */
  const bad = local({
    capability: 'atomic-fixed-window-v1',
    scope: 'process',
    claim: async () => ({
      allowed: true,
      remaining: 99,
      now: 0,
      resetAt: 1000,
      reason: 'allowed',
    }),
  });
  assert.equal((await bad.check('login', identity)).status, 503);
  await bad.close();
});

test('public decisions strip custom store fields and caller cancellation never fails open', async () => {
  /** Injected synthetic atomic/replay store; persistence/atomicity claims extend only to this fixture. */
  const store = {
    capability: 'atomic-fixed-window-v1',
    scope: 'distributed',
    claim: async () => ({
      allowed: true,
      remaining: 1,
      now: 1000,
      resetAt: 2000,
      reason: 'allowed',
      privateSubject: 'PRIVATE',
    }),
  };
  /** Owned admission scope; close must drain actual work before store/key cleanup. */
  const limiter = createDistributedRateLimiter({ store, secret, policies });
  assert.equal(
    JSON.stringify(await limiter.check('login', identity)).includes('PRIVATE'),
    false
  );
  /** Owned initiating cancellation controller; signals cannot force arbitrary JavaScript settlement. */
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    limiter.check('search', identity, { signal: controller.signal }),
    /cancelled/
  );
  await limiter.close();
});
