import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createObservable,
  mapObservable,
  combineObservables,
  toExternalStore,
  fromExternalStore,
  awaitObservable,
} from '../dist/index.js';
test('observable mapping and bridges', (t) => {
  /** Owned mutable source used by the observable and external-store fixtures. */
  const a = createObservable(1);
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => a.destroy());
  /** Owned second source used to check deterministic tuple order. */
  const b = createObservable(4);
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => b.destroy());
  /** Borrowed memoized projection of the first source. */
  const c = mapObservable(a, (v) => v * 2);
  /** Borrowed tuple projection; no subscription is allocated on creation. */
  const combined = combineObservables([a, b]);
  assert.deepEqual(combined.get(), [1, 4]);
  let changes = 0;
  /** Owned projection subscription disposed before destroying its source. */
  const stop = c.subscribe(() => changes++);
  a.set(2);
  assert.equal(c.get(), 4);
  assert.equal(changes, 1);
  assert.equal(fromExternalStore(toExternalStore(a)).get(), 2);
  stop();
  a.destroy();
});
test('await observable resolves and aborts', async (t) => {
  /** Owned mutable source used by the observable and external-store fixtures. */
  const a = createObservable(0);
  // Register failure-path cleanup without transferring ownership of borrowed projections.
  t.after(() => a.destroy());
  /** Bounded wait promise owning only its timer and registration. */
  const future = awaitObservable(a, (v) => v === 2, { timeoutMs: 1000 });
  a.set(2);
  assert.equal(await future, 2);
  await assert.rejects(
    awaitObservable(a, () => false, { timeoutMs: 5 }),
    /timed out/
  );
});
