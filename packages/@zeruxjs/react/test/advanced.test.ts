import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReactStore,
  selectReactStore,
  useReactSelector,
  observableToReactStore,
  reactStoreToObservable,
} from '../dist/index.js';
test('batches notify once; all updates retain snapshot state', (t) => {
  /** Owned synthetic external store; native hooks borrow its subscription contract. */
  const store = createReactStore(0);
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    store.destroy();
  });
  let notifications = 0;
  store.subscribe(() => notifications++);
  store.batch(() => {
    store.set(1);
    store.update((n) => n + 1);
    assert.equal(store.getSnapshot(), 2);
  });
  assert.equal(notifications, 1);
  assert.equal(store.getSnapshot(), 2);
});
test('derived store references are stable and updates are filtered', (t) => {
  /** Owned synthetic external store; native hooks borrow its subscription contract. */
  const store = createReactStore({ visible: 1, hidden: 1 });
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    store.destroy();
  });
  /** Borrowed derived projection; stable equality controls snapshot references. */
  const selected = selectReactStore(
    store,
    (s) => ({ value: s.visible }),
    (a, b) => a.value === b.value
  );
  /** Initial selected reference used to verify identity retention. */
  const first = selected.getSnapshot();
  let count = 0;
  selected.subscribe(() => count++);
  store.set({ visible: 1, hidden: 2 });
  assert.equal(count, 0);
  assert.equal(selected.getSnapshot(), first);
  store.set({ visible: 2, hidden: 2 });
  assert.equal(count, 1);
  assert.notEqual(selected.getSnapshot(), first);
});
test('injected React selector and observable bridges work in SSR', (t) => {
  /** Owned synthetic external store; native hooks borrow its subscription contract. */
  const store = createReactStore({ name: 'a' });
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    store.destroy();
  });
  /** Explicit injected hook result, not native browser qualification. */
  const result = useReactSelector(
    (_sub, get, getServer) => getServer(),
    store,
    (s) => s.name,
    { serverSnapshot: () => ({ name: 'server' }) }
  );
  assert.equal(result, 'server');
  /** Borrowed structural observable projection; it does not acquire a UI runtime. */
  const observable = reactStoreToObservable(store);
  /** Borrowed observable-to-store projection with independently owned subscriptions. */
  const linked = observableToReactStore(observable);
  let count = 0;
  /** Owned unsubscribe callback; release it on fixture teardown. */
  const stop = linked.subscribe(() => count++);
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    stop();
  });
  store.set({ name: 'b' });
  assert.equal(linked.getSnapshot().name, 'b');
  assert.equal(count, 1);
  stop();
});
test('hook bindings use injected React memoization instead of recreating stores on each render', async (t) => {
  /** Public core binding factory loaded without importing a renderer. */
  const { createReactBindings } = await import('../dist/index.js');
  /** Owned synthetic external store; native hooks borrow its subscription contract. */
  const store = createReactStore({ a: 1 });
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    store.destroy();
  });
  let dep = [],
    cached,
    createCount = 0;
  /** Injected memo/hook bindings, not an automatically mounted application. */
  const hooks = createReactBindings({
    useSyncExternalStore: (_subscribe, get) => get(),
    /** Retain one projected fixture value for a stable dependency set, mirroring the injected memo contract.
     * @param {function} create - Explicit synthetic callback/dependency value; not private live data.
     * @param {unknown} next - Explicit synthetic callback/dependency value; not private live data.
     * @returns {unknown} Explicit synthetic fixture result or intentional failure.
     */
    useMemo(create, next) {
      if (!cached || next.some((x, i) => !Object.is(x, dep[i]))) {
        cached = create();
        createCount++;
        dep = next;
      }
      return cached;
    },
  });
  /** Stable pure selector shared across repeated fixture reads.
   * @param {unknown} state - Explicit synthetic source/callback/dependency value; never private live state.
   * @returns {unknown} Result of this documented fixture projection/operation; external acceptance is separate.
   */
  const select = (state) => state.a;
  assert.equal(hooks.useSelector(store, select), 1);
  assert.equal(hooks.useSelector(store, select), 1);
  assert.equal(createCount, 1);
  store.set({ a: 2 });
  assert.equal(hooks.useSelector(store, select), 2);
});
