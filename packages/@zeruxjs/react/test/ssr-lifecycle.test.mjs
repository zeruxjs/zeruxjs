import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReactStore,
  selectReactStore,
  createReactBindings,
  useReactStore,
} from '../dist/index.js';

test('server snapshot stays deterministic while the browser snapshot changes', (t) => {
  /** Synthetic source/store value scoped to this fixture, never a user singleton. */
  const source = createReactStore(
    { count: 1 },
    { serverSnapshot: { count: 0 } }
  );
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    source.destroy();
  });
  source.set({ count: 5 });
  assert.equal(source.getSnapshot().count, 5);
  assert.equal(source.getServerSnapshot().count, 0);
  /** Borrowed selected store with separate client/server reference caches. */
  const derived = selectReactStore(source, (s) => s.count);
  assert.equal(derived.getServerSnapshot(), 0);
  assert.equal(derived.getSnapshot(), 5);
  assert.equal(
    useReactStore((_sub, _get, server) => server(), source).count,
    0
  );
  source.destroy();
});
test('React hooks never substitute client snapshots for an absent SSR contract', () => {
  /** Injected no-subscription callback verifying absent server-read behavior.
   * @param {unknown} _sub - Explicit synthetic source/callback/dependency value; never private live state.
   * @param {unknown} _get - Explicit synthetic source/callback/dependency value; never private live state.
   * @param {unknown} server - Explicit synthetic source/callback/dependency value; never private live state.
   * @returns {unknown} Result of this documented fixture projection/operation; external acceptance is separate.
   */
  const fakeHook = (_sub, _get, server) => Boolean(server);
  /** Owned synthetic external store; native hooks borrow its subscription contract. */
  const store = { getSnapshot: () => 1, subscribe: () => () => {} };
  assert.equal(useReactStore(fakeHook, store), false);
});
test('strict-mode subscription unmount/remount never duplicates listeners', (t) => {
  /** Synthetic source/store value scoped to this fixture, never a user singleton. */
  const source = createReactStore(0);
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    source.destroy();
  });
  let count = 0;
  /** First owned unsubscribe; idempotent repeated calls must remain safe. */
  const stop1 = source.subscribe(() => count++);
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    stop1();
  });
  stop1();
  stop1();
  /** Second owned unsubscribe proving remount does not duplicate listeners. */
  const stop2 = source.subscribe(() => count++);
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    stop2();
  });
  source.set(1);
  assert.equal(count, 1);
  stop2();
  source.set(2);
  assert.equal(count, 1);
});
test('memoized selector binding supports hydration and committed updates', (t) => {
  /** Synthetic source/store value scoped to this fixture, never a user singleton. */
  const source = createReactStore(
    { count: 1, hidden: 0 },
    { serverSnapshot: { count: 0, hidden: 0 } }
  );
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    source.destroy();
  });
  let memo,
    memoDeps = [];
  /** Injected hook memoization fixture, not a substitute for native React acceptance. */
  const runtime = {
    useSyncExternalStore: (_subscribe, get, server) => ({
      client: get(),
      server: server?.(),
    }),
    /** Retain one projected fixture value for a stable dependency set, mirroring the injected memo contract.
     * @param {function} factory - Explicit synthetic callback/dependency value; not private live data.
     * @param {unknown} deps - Explicit synthetic callback/dependency value; not private live data.
     * @returns {unknown} Explicit synthetic fixture result or intentional failure.
     */
    useMemo(factory, deps) {
      if (!memo || deps.some((x, i) => !Object.is(x, memoDeps[i]))) {
        memo = factory();
        memoDeps = deps;
      }
      return memo;
    },
  };
  /** Stateless actual/injected React hook bindings; per-user stores remain request-owned. */
  const bindings = createReactBindings(runtime);
  /** Stable pure fixture selector; no business side effect.
   * @param {unknown} s - Explicit synthetic source/callback/dependency value; never private live state.
   * @returns {unknown} Result of this documented fixture projection/operation; external acceptance is separate.
   */
  const selector = (s) => s.count;
  assert.deepEqual(bindings.useSelector(source, selector), {
    client: 1,
    server: 0,
  });
  source.set({ count: 2, hidden: 1 });
  assert.deepEqual(bindings.useSelector(source, selector), {
    client: 2,
    server: 0,
  });
});
test('SSR selected objects are referentially stable across repeated reads', (t) => {
  /** Synthetic source/store value scoped to this fixture, never a user singleton. */
  const source = createReactStore({ value: 1 });
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    source.destroy();
  });
  /** Borrowed derived projection; stable equality controls snapshot references. */
  const selected = selectReactStore(
    source,
    (s) => ({ n: s.value }),
    (a, b) => a.n === b.n
  );
  /** First stable selected/server snapshot reference. */
  const a = selected.getServerSnapshot();
  /** Repeated selected/server snapshot reference. */
  const b = selected.getServerSnapshot();
  assert.equal(a, b);
  source.set({ value: 2 });
  assert.equal(selected.getServerSnapshot(), a);
});
