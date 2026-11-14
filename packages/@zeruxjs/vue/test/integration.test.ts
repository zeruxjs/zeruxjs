import test from 'node:test';
import assert from 'node:assert/strict';
import { createVueRef, mapVueRef, toVueReadable } from '../dist/index.js';
test('refs and derived refs notify and detach', () => {
  /** Borrowed standalone input for the derived ref. */
  const a = createVueRef(2);
  /** Owned projection whose stop method detaches its source. */
  const b = mapVueRef(a, (n) => n * 2);
  let count = 0;
  /** Local listener unsubscribe function, independent of projection teardown. */
  const stop = b.subscribe(() => count++);
  a.value = 3;
  assert.equal(b.value, 6);
  assert.equal(count, 1);
  b.stop();
  a.value = 4;
  assert.equal(b.value, 6);
  stop();
});
test('subscribe bridge stops', () => {
  let notify: ((value: number) => void) | undefined;
  let stopped = false;
  /** Owned readable cache with explicit source stop. */
  const v = toVueReadable(
    (fn) => {
      notify = fn;
      return () => {
        stopped = true;
      };
    },
    () => 1
  );
  if (!notify) {
    throw new Error('Readable bridge did not initialize');
  }
  notify(4);
  assert.equal(v.value, 4);
  v.stop();
  notify(5);
  assert.equal(v.value, 4);
  assert.equal(stopped, true);
});
