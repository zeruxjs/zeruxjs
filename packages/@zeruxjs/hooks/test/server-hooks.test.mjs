import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createServerActions,
  createAsyncServerActions,
  createServerFilters,
  createAsyncServerFilters,
  runWithRequestHooks,
  createContext,
  setContext,
  useContext,
} from '../dist/index.js';

test('priority ties, exact duplicate tokens, once before invocation and idempotent disposal', async (t) => {
  /** Owned explicit action/filter registry; test disposes and drains its own synthetic work. */
  const hooks = createServerActions();
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(async () => {
    hooks.dispose();
    await hooks.whenIdle();
  });
  /** Ordered synthetic notifications proving priority/snapshot/once semantics. */
  const events = [];
  /** Append one inert synthetic marker for each invoked duplicate registration.
   * @returns {number} Array length ignored by the action notification contract. */
  const callback = () => events.push('duplicate');
  /** Exact first duplicate token; removal must not affect its separately registered twin. */
  const first = hooks.register('ready', callback, { priority: 0 });
  hooks.register('ready', callback, { priority: 0 });
  hooks.register('ready', () => events.push('last'), { priority: 20 });
  /** Exact once token checked inside its later callback after pre-invocation removal. */
  const once = hooks.register(
    'ready',
    () => {
      assert.equal(once.active, false);
      events.push('once');
    },
    { priority: -1, once: true }
  );
  assert.equal(first.remove(), true);
  assert.equal(first.remove(), false);
  hooks.dispatch('ready', []);
  hooks.dispatch('ready', []);
  assert.deepEqual(events, ['once', 'duplicate', 'last', 'duplicate', 'last']);
  hooks.dispose();
  hooks.dispose();
  await hooks.whenIdle();
  assert.deepEqual(hooks.getDiagnostics(), {
    disposed: true,
    handlers: 0,
    pending: 0,
  });
  assert.throws(() => hooks.dispatch('ready', []), { code: 'HOOK_CLOSED' });
});
test('mutation snapshot excludes new entries and skips removed handlers before their turn', (t) => {
  /** Owned explicit action/filter registry; test disposes and drains its own synthetic work. */
  const hooks = createServerActions();
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(async () => {
    hooks.dispose();
    await hooks.whenIdle();
  });
  /** Ordered synthetic notifications proving priority/snapshot/once semantics. */
  const events = [];
  hooks.register(
    'event',
    () => {
      events.push('first');
      second.remove();
      hooks.register('event', () => events.push('new'));
    },
    { once: true }
  );
  /** Later token removed by the earlier callback before its snapshot turn. */
  const second = hooks.register('event', () => events.push('removed'));
  hooks.dispatch('event', []);
  assert.deepEqual(events, ['first']);
  hooks.dispatch('event', []);
  assert.deepEqual(events, ['first', 'new']);
  hooks.dispose();
});
test('filters transform serially, preserve extra arguments, and identity when empty', async (t) => {
  /** Owned synchronous registry used for deterministic ordering/type-preserving assertions. */
  const sync = createServerFilters();
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(async () => {
    sync.dispose();
    await sync.whenIdle();
  });
  /** Owned serial async registry; actual pending work must settle before drain completes. */
  const async = createAsyncServerFilters();
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(async () => {
    async.dispose();
    await async.whenIdle();
  });
  assert.equal(sync.apply('title', 'hello', []), 'hello');
  sync.register('title', (_ctx, value, suffix) => value + suffix, {
    priority: 1,
  });
  sync.register('title', (_ctx, value) => value.toUpperCase());
  assert.equal(sync.apply('title', 'hello', ['!']), 'HELLO!');
  async.register('number', async (_ctx, value) => value + 1);
  async.register('number', (_ctx, value) => value * 2);
  assert.equal(await async.apply('number', 2, []), 6);
  assert.equal('dispatch' in sync, false);
  sync.dispose();
  async.dispose();
  await async.whenIdle();
});
test('sync handlers reject async misuse and propagate thrown dependencies without later calls', async (t) => {
  /** Owned explicit action/filter registry; test disposes and drains its own synthetic work. */
  const hooks = createServerActions();
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(async () => {
    hooks.dispose();
    await hooks.whenIdle();
  });
  assert.throws(() => hooks.register('event', async () => {}), {
    code: 'HOOK_ASYNC_IN_SYNC',
  });
  hooks.register('event', () => Promise.reject(Error('dependency failed')));
  assert.throws(() => hooks.dispatch('event', []), {
    code: 'HOOK_ASYNC_IN_SYNC',
  });
  await new Promise((resolve) => setImmediate(resolve));
  hooks.dispose();
  /** Independent synchronous registry used to verify failure propagation without replay. */
  const second = createServerActions();
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(async () => {
    second.dispose();
    await second.whenIdle();
  });
  /** Original synthetic dependency error compared by identity, not relabeled as success. */
  const failure = Error('dependency failure');
  let later = false;
  second.register(
    'event',
    () => {
      throw failure;
    },
    { once: true }
  );
  second.register('event', () => (later = true));
  assert.throws(
    () => second.dispatch('event', []),
    (error) => error === failure
  );
  assert.equal(later, false);
  second.dispatch('event', []);
  assert.equal(later, true);
  second.dispose();
});
test('async failure consumes once, preserves original failure and releases pending slots', async (t) => {
  /** Owned explicit action/filter registry; test disposes and drains its own synthetic work. */
  const hooks = createAsyncServerActions({ maxPending: 1 });
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(async () => {
    hooks.dispose();
    await hooks.whenIdle();
  });
  /** Original injected backend failure expected to stop later callbacks. */
  const error = Error('backend unavailable');
  let count = 0;
  /** Exact registration under test; active state must change before once invocation. */
  const token = hooks.register(
    'event',
    async () => {
      throw error;
    },
    { once: true }
  );
  hooks.register('event', () => {
    count++;
  });
  await assert.rejects(
    hooks.dispatch('event', []),
    (actual) => actual === error
  );
  assert.equal(token.active, false);
  assert.equal(count, 0);
  assert.equal(hooks.getDiagnostics().pending, 0);
  await hooks.dispatch('event', []);
  assert.equal(count, 1);
  hooks.dispose();
  await hooks.whenIdle();
});
test('recursive dispatch is bounded and once handlers cannot recursively invoke themselves', async (t) => {
  /** Owned synchronous registry used for deterministic ordering/type-preserving assertions. */
  const sync = createServerActions({ maxDepth: 3 });
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(async () => {
    sync.dispose();
    await sync.whenIdle();
  });
  let calls = 0;
  sync.register('recursive', () => {
    calls++;
    sync.dispatch('recursive', []);
  });
  assert.throws(() => sync.dispatch('recursive', []), { code: 'HOOK_DEPTH' });
  assert.equal(calls, 3);
  assert.equal(sync.getDiagnostics().pending, 0);
  sync.dispose();
  /** Separate registry proving recursive once removal before nested dispatch. */
  const once = createServerActions();
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(async () => {
    once.dispose();
    await once.whenIdle();
  });
  let count = 0;
  once.register(
    'recursive',
    () => {
      count++;
      once.dispatch('recursive', []);
    },
    { once: true }
  );
  once.dispatch('recursive', []);
  assert.equal(count, 1);
  once.dispose();
  /** Owned serial async registry; actual pending work must settle before drain completes. */
  const async = createAsyncServerActions({ maxDepth: 2 });
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(async () => {
    async.dispose();
    await async.whenIdle();
  });
  async.register('recursive', () => async.dispatch('recursive', []));
  await assert.rejects(async.dispatch('recursive', []), { code: 'HOOK_DEPTH' });
  assert.equal(async.getDiagnostics().pending, 0);
  async.dispose();
});
test('request registries and AsyncLocalStorage context remain isolated during overlapping dispatch', async (t) => {
  /** Explicit synthetic context identity shared only through independent entered stores. */
  const context = createContext('none');
  /** Run an isolated synthetic async-local request with an explicitly owned filter registry.
   * @param {string} value - Synthetic per-request context label.
   * @returns {Promise<string>} Request-local transformed label after actual callback settlement. */
  const request = (value) =>
    runWithRequestHooks(async () => {
      /** Owned explicit action/filter registry; test disposes and drains its own synthetic work. */
      const hooks = createAsyncServerFilters();
      // Keep this exact fixture owner disposable even if a preceding assertion fails.
      t.after(async () => {
        hooks.dispose();
        await hooks.whenIdle();
      });
      setContext(context, value);
      hooks.register('label', async (_ctx, text) => {
        await new Promise((resolve) => setImmediate(resolve));
        return `${text}:${useContext(context)}`;
      });
      try {
        return await hooks.apply('label', value, []);
      } finally {
        hooks.dispose();
        await hooks.whenIdle();
      }
    });
  assert.deepEqual(await Promise.all([request('one'), request('two')]), [
    'one:one',
    'two:two',
  ]);
});
test('cooperative cancellation, disposal drain and registration-signal listener ownership', async (t) => {
  /** Owned explicit action/filter registry; test disposes and drains its own synthetic work. */
  const hooks = createAsyncServerActions({ maxPending: 1 });
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(async () => {
    hooks.dispose();
    await hooks.whenIdle();
  });
  /** Caller-owned registration abort controller; abort removes only its exact handler. */
  const lifetime = new AbortController();
  /** Exact registration under test; active state must change before once invocation. */
  const token = hooks.register('unused', () => {}, { signal: lifetime.signal });
  lifetime.abort();
  assert.equal(token.active, false);
  let started, release, observed;
  /** Start barrier proving an admitted callback holds pending capacity before cancellation. */
  const ready = new Promise((resolve) => (started = resolve));
  hooks.register('event', async ({ signal }) => {
    observed = signal;
    started();
    await new Promise((resolve) => (release = resolve));
  });
  /** Active dispatch promise retained until the held handler actually settles. */
  const work = hooks.dispatch('event', []);
  try {
    await ready;
    await assert.rejects(hooks.dispatch('event', []), {
      code: 'HOOK_CAPACITY',
    });
    hooks.dispose();
    assert.equal(observed.aborted, true);
    assert.equal(hooks.getDiagnostics().handlers, 0);
    let drained = false;
    /** Observed actual-settlement drain, distinct from immediate dispose admission stop. */
    const drain = hooks.whenIdle().then(() => (drained = true));
    await Promise.resolve();
    assert.equal(drained, false);
    release();
    await assert.rejects(work, { code: 'HOOK_ABORTED' });
    await drain;
    assert.equal(hooks.getDiagnostics().pending, 0);
  } finally {
    // Release the synthetic handler before any registered actual-settlement drain.
    hooks.dispose();
    release?.();
    await work.catch(() => {});
  }
});
test('abort before dispatch skips work, abort between handlers skips remaining work, invalid inputs fail', async (t) => {
  /** Owned explicit action/filter registry; test disposes and drains its own synthetic work. */
  const hooks = createServerActions({ maxHandlers: 2 });
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(async () => {
    hooks.dispose();
    await hooks.whenIdle();
  });
  /** Caller-owned dispatch cancellation controller; private abort reasons must remain redacted. */
  const abort = new AbortController();
  let later = false;
  hooks.register('event', () => abort.abort());
  hooks.register('event', () => (later = true));
  assert.throws(() => hooks.dispatch('event', [], { signal: abort.signal }), {
    code: 'HOOK_ABORTED',
  });
  assert.equal(later, false);
  assert.throws(() => hooks.dispatch('event', [], { signal: abort.signal }), {
    code: 'HOOK_ABORTED',
  });
  assert.throws(() => hooks.register('event', () => {}), {
    code: 'HOOK_CAPACITY',
  });
  hooks.dispose();
  for (const options of [
    { maxDepth: 0 },
    { maxDepth: null },
    { maxHandlers: Infinity },
    { maxPending: 257 },
    { unknown: 1 },
  ]) {
    assert.throws(() => createServerActions(options), { code: 'HOOK_INVALID' });
  }
  /** Owned filter registry used for validation-denial assertions. */
  const invalid = createServerFilters();
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(async () => {
    invalid.dispose();
    await invalid.whenIdle();
  });
  assert.throws(() => invalid.register('bad\r\n', () => 0), {
    code: 'HOOK_INVALID',
  });
  assert.throws(() => invalid.register('value', () => 0, { priority: NaN }), {
    code: 'HOOK_INVALID',
  });
  assert.throws(() => invalid.register('value', () => 0, { priority: null }), {
    code: 'HOOK_INVALID',
  });
  assert.throws(() => invalid.apply('value', 0, null), {
    code: 'HOOK_INVALID',
  });
  invalid.dispose();
});
test('equal priorities preserve registration order, including concurrent once dispatch', async (t) => {
  /** Owned synchronous registry used for deterministic ordering/type-preserving assertions. */
  const sync = createServerActions();
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(async () => {
    sync.dispose();
    await sync.whenIdle();
  });
  /** Observed equal-priority insertion order, without an overflowing sequence counter. */
  const order = [];
  for (let i = 0; i < 3; i++) {
    sync.register(
      'event',
      () => {
        order.push(i);
      },
      { priority: 5 }
    );
  }
  sync.dispatch('event', []);
  assert.deepEqual(order, [0, 1, 2]);
  sync.dispose();
  /** Owned serial async registry; actual pending work must settle before drain completes. */
  const async = createAsyncServerActions();
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(async () => {
    async.dispose();
    await async.whenIdle();
  });
  let calls = 0;
  async.register(
    'event',
    async () => {
      calls++;
      await Promise.resolve();
    },
    { once: true }
  );
  await Promise.all([async.dispatch('event', []), async.dispatch('event', [])]);
  assert.equal(calls, 1);
  async.dispose();
  await async.whenIdle();
});
test('async cancellation keeps pending slot and skip remaining handlers until real settlement', async (t) => {
  /** Owned explicit action/filter registry; test disposes and drains its own synthetic work. */
  const hooks = createAsyncServerFilters({ maxPending: 1 });
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(async () => {
    hooks.dispose();
    await hooks.whenIdle();
  });
  /** Caller-owned dispatch cancellation controller; private abort reasons must remain redacted. */
  const abort = new AbortController();
  let release, started;
  /** Start barrier proving an admitted callback holds pending capacity before cancellation. */
  const ready = new Promise((resolve) => (started = resolve));
  let later = false;
  hooks.register('value', async (_ctx, value) => {
    started();
    await new Promise((resolve) => (release = resolve));
    return value + 1;
  });
  hooks.register('value', (_ctx, value) => {
    later = true;
    return value;
  });
  /** Held asynchronous filter result; cancellation must not release its capacity early. */
  const pending = hooks.apply('value', 1, [], { signal: abort.signal });
  try {
    await ready;
    abort.abort('private-reason');
    assert.equal(hooks.getDiagnostics().pending, 1);
    await assert.rejects(hooks.apply('value', 1, []), {
      code: 'HOOK_CAPACITY',
    });
    release();
    await assert.rejects(
      pending,
      (error) =>
        error.code === 'HOOK_ABORTED' &&
        !error.message.includes('private-reason')
    );
    assert.equal(later, false);
    assert.equal(hooks.getDiagnostics().pending, 0);
    hooks.dispose();
    await hooks.whenIdle();
  } finally {
    // Release the synthetic handler before any registered actual-settlement drain.
    abort.abort();
    release?.();
    await pending.catch(() => {});
  }
});
test('argument copying is bounded and failed getters do not acquire pending handles', async (t) => {
  /** Owned explicit action/filter registry; test disposes and drains its own synthetic work. */
  const hooks = createServerActions();
  // Keep this exact fixture owner disposable even if a preceding assertion fails.
  t.after(async () => {
    hooks.dispose();
    await hooks.whenIdle();
  });
  /** Synthetic array with a throwing indexed getter, before any pending handle is acquired. */
  const args = [];
  Object.defineProperty(args, '0', {
    get() {
      throw Error('payload unavailable');
    },
  });
  assert.throws(() => hooks.dispatch('event', args), /payload unavailable/);
  assert.equal(hooks.getDiagnostics().pending, 0);

  let count = 0;
  /** Synthetic positional array with a forbidden custom iterator that must never run. */
  const values = [1];
  // eslint-disable-next-line require-yield -- Negative fixture throws before yielding; bounded argument copying must never run it.
  values[Symbol.iterator] = function* () {
    throw Error('must not run iterator');
  };
  hooks.register('event', (_ctx, value) => {
    count += value;
  });
  hooks.dispatch('event', values);
  assert.equal(count, 1);
  hooks.dispose();
  await hooks.whenIdle();
});
