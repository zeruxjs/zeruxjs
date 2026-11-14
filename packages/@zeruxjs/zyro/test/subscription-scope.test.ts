import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createObservable,
  createZyroSubscriptionScope,
  toExternalStore,
} from '../dist/index.js';
test('route mount/unmount owns exactly one observable subscription and unmount is idempotent', (t) => {
  /** Owned synthetic observable whose lifetime is independent of the scope. */
  const state = createObservable(1);
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => state.destroy());
  /** Owned route subscription group; destroy drains all transferred registrations. */
  const scope = createZyroSubscriptionScope();
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => scope.destroy());
  /** Synthetic delivered values used to verify teardown fencing. */
  const received = [];
  /** Idempotent manual disposer for one scope-owned registration. */
  const stop = scope.observe(state, (value) => received.push(value));
  assert.deepEqual(received, [1]);
  state.set(2);
  assert.deepEqual(received, [1, 2]);
  stop();
  stop();
  state.set(3);
  assert.deepEqual(received, [1, 2]);
  scope.destroy();
  scope.destroy();
  assert.equal(scope.destroyed, true);
  assert.throws(() => scope.observe(state, () => {}), /destroyed/);
});
test('Zyro scope closes when the initial listener throws', (t) => {
  /** Owned synthetic observable whose lifetime is independent of the scope. */
  const state = createObservable(1);
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => state.destroy());
  /** Owned route subscription group; destroy drains all transferred registrations. */
  const scope = createZyroSubscriptionScope();
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => scope.destroy());
  let count = 0;
  assert.throws(
    () =>
      scope.observe(
        state,
        () => {
          count++;
          throw new Error('bad');
        },
        { immediate: true }
      ),
    /bad/
  );
  assert.doesNotThrow(() => state.set(2));
  assert.equal(count, 1);
  scope.destroy();
});
test('bridge works with external-store snapshots and reactive cleanup', (t) => {
  /** Owned synthetic observable whose lifetime is independent of the scope. */
  const state = createObservable('initial');
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => state.destroy());
  /** Borrowed external-store projection of the owned source. */
  const store = toExternalStore(state);
  /** Owned route subscription group; destroy drains all transferred registrations. */
  const scope = createZyroSubscriptionScope();
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => scope.destroy());
  /** Synthetic snapshot delivery trace without private application data. */
  const read = [];
  scope.observe(
    {
      get: store.getSnapshot,
      subscribe(fn) {
        return store.subscribe(() => fn(store.getSnapshot()));
      },
    },
    (v) => read.push(v)
  );
  state.set('ready');
  scope.destroy();
  state.set('done');
  assert.deepEqual(read, ['initial', 'ready']);
});
test('synchronous source emission during subscribe does not double-fire initial notification', (t) => {
  /** Synthetic delivery trace proving synchronous initial emission is not duplicated. */
  const events = [];
  /** Owned route subscription group; destroy drains all transferred registrations. */
  const scope = createZyroSubscriptionScope();
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => scope.destroy());
  /** Borrowed fixture with a synchronous initial notification. */
  const source = {
    get: () => 42,
    subscribe(fn) {
      fn(42);
      return () => {};
    },
  };
  scope.observe(source, (v) => events.push(v));
  assert.deepEqual(events, [42]);
  scope.destroy();
});
test('destroy drains other route disposers even when one fails', (t) => {
  /** Owned route subscription group; destroy drains all transferred registrations. */
  const scope = createZyroSubscriptionScope();
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => scope.destroy());
  /** Synthetic reverse-order disposal trace including a throwing disposer. */
  const calls = [];
  scope.add(() => calls.push('first'));
  scope.add(() => {
    calls.push('second');
    throw Error('cleanup failed');
  });
  scope.add(() => calls.push('third'));
  assert.throws(() => scope.destroy(), AggregateError);
  assert.deepEqual(calls, ['third', 'second', 'first']);
  assert.doesNotThrow(() => scope.destroy());
});
