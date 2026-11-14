import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReactStore,
  selectReactStore,
  useReactStore,
} from '../dist/index.js';
test('stores publish only changes and unsubscribe', (t) => {
  /** Owned synthetic source store; destroyed at fixture teardown. */
  const s = createReactStore(1);
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    s.destroy();
  });
  let n = 0;
  /** Owned unsubscribe callback; release it on fixture teardown. */
  const stop = s.subscribe(() => n++);
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    stop();
  });
  s.set(1);
  s.update((v) => v + 1);
  assert.equal(s.getSnapshot(), 2);
  assert.equal(n, 1);
  stop();
  s.set(3);
  assert.equal(n, 1);
  s.destroy();
  s.set(4);
  assert.equal(s.getSnapshot(), 3);
});
test('selectors preserve snapshots and suppress unrelated notifications', (t) => {
  /** Owned synthetic source store; destroyed at fixture teardown. */
  const s = createReactStore({ a: 1, b: 1 });
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    s.destroy();
  });
  /** Borrowed derived selector store; source ownership stays separate. */
  const d = selectReactStore(s, (v) => v.a);
  let n = 0;
  /** Owned unsubscribe callback; release it on fixture teardown. */
  const stop = d.subscribe(() => n++);
  // Register idempotent fixture ownership before subsequent assertions can fail.
  t.after(() => {
    stop();
  });
  s.set({ a: 1, b: 2 });
  assert.equal(n, 0);
  s.set({ a: 2, b: 2 });
  assert.equal(n, 1);
  assert.equal(d.getSnapshot(), 2);
  stop();
  assert.equal(
    useReactStore((_subscribe, get) => get(), d),
    2
  );
});
