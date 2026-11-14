import test from 'node:test';
import assert from 'node:assert/strict';
import { createVueBindings, createVueRef } from '../dist/index.js';
/** Inject a minimal scope/watch runtime without loading native Vue.
 * @returns {object} Isolated synchronous runtime and explicit scope-disposal control.
 */
function harness() {
  /** Synthetic active-scope cleanup registrations. */
  const callbacks = new Set();
  let scope = true;
  let watches = 0;
  return {
    callbacks,
    leave() {
      scope = false;
      for (const stop of [...callbacks]) {
        stop();
      }
      callbacks.clear();
    },
    runtime: {
      shallowRef(value) {
        return { value };
      },
      getCurrentScope() {
        return scope;
      },
      onScopeDispose(stop) {
        callbacks.add(stop);
      },
      readonly(ref) {
        return {
          get value() {
            return ref.value;
          },
        };
      },
      watch(read, notify, options) {
        assert.equal(options.flush, 'sync');
        read();
        watches++;
        return () => {
          watches--;
        };
      },
    },
  };
}
test('Vue scoped store is readonly and updates synchronously, scope cleanup is idempotent', () => {
  /** Isolated injected-runtime harness; no native Vue scope is created. */
  const h = harness();
  /** Inert binding factory using this test's injected runtime. */
  const b = createVueBindings(h.runtime);
  let value = 1;
  /** Borrowed fixture store listeners used to count registrations. */
  const ls = new Set();
  /** Synchronous fixture source or watch-backed adapter under test. */
  const store = {
    getSnapshot: () => value,
    subscribe(fn) {
      ls.add(fn);
      return () => ls.delete(fn);
    },
  };
  /** Readonly-typed scope-owned shallow snapshot. */
  const state = b.useStore(store);
  assert.equal(state.value, 1);
  value = 2;
  for (const fn of ls) {
    fn();
  }
  assert.equal(state.value, 2);
  h.leave();
  h.leave();
  value = 3;
  for (const fn of ls) {
    fn();
  }
  assert.equal(state.value, 2);
  assert.equal(ls.size, 0);
});
test('Vue adapter refuses scope-less subscriptions and manual connections must stop', () => {
  /** Isolated injected-runtime harness; no native Vue scope is created. */
  const h = harness();
  /** Inert binding factory using this test's injected runtime. */
  const b = createVueBindings(h.runtime);
  let value = 1;
  /** Synthetic borrowed store registrations; the manual connection owns removal. */
  const ls = new Set();
  /** Borrowed synchronous snapshot source for manual connection. */
  const source = {
    getSnapshot: () => value,
    subscribe(fn) {
      ls.add(fn);
      return () => ls.delete(fn);
    },
  };
  h.leave();
  assert.throws(() => b.useStore(source), /scope/);
  /** Manual connection whose caller must stop it explicitly. */
  const connected = b.connect(source);
  value = 8;
  for (const fn of ls) {
    fn();
  }
  assert.equal(connected.ref.value, 8);
  connected.stop();
  connected.stop();
  assert.equal(ls.size, 0);
});
test('Vue native watch integration demands explicit watch for changes', () => {
  /** Isolated injected-runtime harness; no native Vue scope is created. */
  const h = harness();
  /** Inert binding factory using this test's injected runtime. */
  const b = createVueBindings(h.runtime);
  /** Standalone mutable holder used by the injected watcher. */
  const ref = createVueRef(1);
  /** Synchronous fixture source or watch-backed adapter under test. */
  const store = b.fromRef(ref);
  // Use an actual synchronous fake Vue watch (not the standalone ref notifications)
  assert.equal(store.getSnapshot(), 1);
  /** Deliberately incomplete runtime proving watch injection is required. */
  const noWatch = createVueBindings({
    shallowRef: (x) => ({ value: x }),
    getCurrentScope: () => true,
    onScopeDispose: () => {},
  });
  assert.throws(() => noWatch.fromRef(ref), /watch/);
});
test('Vue SSR route setup can read a one-shot snapshot without subscribing', () => {
  /** Isolated injected-runtime harness; no native Vue scope is created. */
  const h = harness();
  /** Inert binding factory using this test's injected runtime. */
  const b = createVueBindings(h.runtime);
  let subscribers = 0;
  /** Synchronous fixture source or watch-backed adapter under test. */
  const store = {
    getSnapshot: () => 42,
    subscribe() {
      subscribers++;
      return () => {
        subscribers--;
      };
    },
  };
  /** One-shot SSR snapshot with no source subscription. */
  const value = b.useStore(store, { ssr: true });
  assert.equal(value.value, 42);
  assert.equal(subscribers, 0);
  h.leave();
});
test('real-like Vue ref watch forwards change and unwatch stops notifications', () => {
  /** Standalone mutable holder used by the injected watcher. */
  const ref = createVueRef(1);
  let count = 0;
  /** Injected synchronous watch fixture; never loads native Vue. */
  const runtime = {
    shallowRef: (x) => ({ value: x }),
    getCurrentScope: () => true,
    onScopeDispose: () => {},
    watch(read, notify, opts) {
      assert.equal(opts.flush, 'sync');
      return ref.subscribe(() => notify(read()));
    },
  };
  /** Inert bridge factory using explicit watcher injection. */
  const bridge = createVueBindings(runtime);
  /** Synchronous fixture source or watch-backed adapter under test. */
  const store = bridge.fromRef(ref);
  /** Owned native-like watcher unsubscribe function. */
  const stop = store.subscribe(() => count++);
  ref.value = 2;
  assert.equal(store.getSnapshot(), 2);
  assert.equal(count, 1);
  stop();
  ref.value = 3;
  assert.equal(count, 1);
});
