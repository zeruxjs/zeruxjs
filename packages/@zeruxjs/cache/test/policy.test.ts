import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { CacheProducerContext } from '../dist/types.js';
/** Public memory and manager factories loaded from the built entry. */
const {
  createMemoryCacheHelper: createMemory,
  createCacheManagerWithHelper: create,
} = createRequire(import.meta.url)('../dist/index.js');
test('unsupported/unknown requirements and conflicting flags reject before dispatch', async () => {
  /** Memory implementation used beneath an intentionally restricted helper. */
  const memory = createMemory();
  /** Test-local memory provider; ownership is asserted or explicitly released below. */
  const helper = {
    ...memory,
    capabilities: {
      conditionalWrites: 'unsupported',
      counters: 'unsupported',
    },
  };
  let calls = 0;
  helper.set = () => {
    calls++;
  };
  /** Manager enforcing the test-specific policy before helper dispatch. */
  const db = create(helper);
  assert.throws(
    () => db.set('k', 1, { ifAbsent: true, ifPresent: true }),
    /conditions/
  );
  assert.throws(() => db.set('k', 1, { ifAbsent: true }), /unsupported/);
  assert.throws(() => db.increment('k'), /unsupported/);
  assert.equal(calls, 0);
  assert.throws(
    () =>
      create(
        { ...memory, capabilities: undefined },
        { policy: { requireCapabilities: ['conditionalWrites'] } }
      ),
    /unavailable/
  );
  await db.close();
});
test('direct helper/facade bounds and counter eviction', async () => {
  /** Test-local memory provider; ownership is asserted or explicitly released below. */
  const helper = createMemory({
    maxEntries: 2,
    policy: { maxValueBytes: 32, maxDepth: 2, maxBulk: 2 },
  });
  /** Manager enforcing the test-specific policy before helper dispatch. */
  const db = create(helper, {
    policy: { maxBulk: 2, maxValueBytes: 32, maxDepth: 2 },
  });
  assert.throws(() => helper.set('k', 'x'.repeat(40)), /byte/);
  assert.throws(() => db.set('k', { a: { b: { c: 1 } } }), /depth/);
  assert.throws(() => helper.getMany(['a', 'b', 'c']), /bulk/);
  assert.throws(() => db.setMany({ a: 1, b: 2, c: 3 }), /bulk/);
  helper.increment('a');
  helper.increment('b');
  helper.increment('c');
  assert.equal(helper.stats().entries, 2);
  assert.equal(helper.get('a'), undefined);
  await db.close();
  assert.throws(() => helper.get('a'), /closed/);
  assert.throws(() => db.get('a'), /closed/);
  assert.throws(() => db.clear(), /closed/);
  assert.throws(() => db.native(), /closed/);
});
test('producer capacity, failure retry, deadline and close cleanup', async () => {
  /** Test-local memory provider; ownership is asserted or explicitly released below. */
  const helper = createMemory();
  let ends = 0;
  /** Bound original helper close operation used to count disposal exactly once. */
  const close = helper.close.bind(helper);
  /** Manager enforcing the test-specific policy before helper dispatch. */
  const db = create(
    {
      ...helper,
      close() {
        ends++;
        close();
      },
    },
    { policy: { maxPendingProducers: 1 } }
  );
  let release!: () => void;
  let started!: () => void;
  /** Handshake proving producer entry before cancellation or capacity assertions. */
  const ready = new Promise<void>((r) => {
    started = r;
  });
  /** Accepted producer whose actual settlement must retain a capacity slot. */
  const job = db.remember(
    'a',
    async ({ signal }: CacheProducerContext) => {
      started();
      await new Promise<void>((r) => {
        release = () => r();
      });
      assert.equal(signal.aborted, true);
      return 'late';
    },
    { timeoutMs: 5 }
  );
  await ready;
  await assert.rejects(
    db.remember('b', () => 1),
    /capacity/
  );
  await assert.rejects(job, /cancelled/);
  await assert.rejects(
    db.remember('b', () => 1),
    /capacity/
  );
  let closed = false;
  /** Close receipt that must remain pending until accepted work settles. */
  const closing = db.close().then(() => {
    closed = true;
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(closed, false);
  release!();
  await closing;
  await db.close();
  assert.equal(ends, 1);
  /** Independent manager proving a failed producer can be attempted again. */
  const retry = create(createMemory());
  await assert.rejects(
    retry.remember('k', () => {
      throw Error('dependency offline');
    }),
    /offline/
  );
  assert.equal(await retry.remember('k', () => 2), 2);
  await retry.close();
});
test('waiter abort keeps other subscribers/tenants usable; borrowed helper ownership', async () => {
  /** Test-local memory provider; ownership is asserted or explicitly released below. */
  const helper = createMemory();
  /** First tenant manager borrowing the shared helper. */
  const a = create(helper, { prefix: 'a', policy: { ownHelper: false } });
  /** Second tenant manager borrowing the same helper without sharing logical keys. */
  const b = create(helper, { prefix: 'b', policy: { ownHelper: false } });
  let resolve!: (value: string) => void;
  let started!: () => void;
  /** Handshake proving producer entry before cancellation or capacity assertions. */
  const ready = new Promise<void>((r) => {
    started = r;
  });
  /** Caller cancellation detaches only its own waiter. */
  const controller = new AbortController();
  /** First subscriber with a cancellable wait. */
  const first = a.remember(
    'k',
    async () => {
      started();
      return await new Promise<string>((r) => {
        resolve = r;
      });
    },
    { signal: controller.signal }
  );
  await ready;
  /** Joined subscriber that must retain the shared production result. */
  const second = a.remember('k', () => {
    throw Error('duplicate');
  });
  controller.abort();
  await assert.rejects(first, /cancelled/);
  await b.set('k', 'tenant b');
  resolve!('tenant a');
  assert.equal(await second, 'tenant a');
  await a.close();
  assert.equal(await b.get('k'), 'tenant b');
  await b.close();
  helper.close();
});
test('reads and counter results enforce the facade domain; close drains accepted native work', async () => {
  /** Test-local memory provider; ownership is asserted or explicitly released below. */
  const helper = createMemory();
  let release!: (value: string) => void;
  /** Manager enforcing the test-specific policy before helper dispatch. */
  const db = create(
    {
      ...helper,
      get: () =>
        new Promise((r) => {
          release = r;
        }),
    },
    { policy: { maxValueBytes: 8, ownHelper: false } }
  );
  /** Accepted native read deliberately held until close begins. */
  const read = db.get('k');
  /** Attached rejection assertion prevents an unhandled rejected read. */
  const rejected = assert.rejects(read, /byte/);
  let closed = false;
  /** Close receipt that must remain pending until accepted work settles. */
  const closing = db.close().then(() => {
    closed = true;
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(closed, false);
  release!('oversized value');
  await rejected;
  await closing;
  /** Borrowed helper wrapper returning an out-of-domain integer. */
  const unsafe = create(
    { ...helper, increment: () => 9007199254740992 },
    { policy: { ownHelper: false } }
  );
  assert.throws(() => unsafe.increment('k'), /safe integer/);
  await unsafe.close();
  helper.close();
  assert.throws(() => create({}), /required contract/);
});
