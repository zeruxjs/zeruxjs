import test from 'node:test';
import assert from 'node:assert/strict';
import { shareOrCopy, shareCapabilities, shareLink } from '@zeruxjs/share';
test('browser entry treats noncallable native share as unsupported and preserves copy fallback without Node server import', async () => {
  /** Original navigator descriptor restored in finally, including complete absence. */
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  /** Synthetic clipboard writes; no operating-system clipboard is accessed. */
  const copied = [];
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        share: 'unavailable',
        clipboard: { writeText: async (text) => copied.push(text) },
      },
    });
    assert.equal(shareCapabilities().native, false);
    assert.equal(
      await shareOrCopy({ url: 'https://example.test/a' }),
      'copied'
    );
    assert.deepEqual(copied, ['https://example.test/a']);
    assert.throws(() =>
      shareLink('unknown', { url: 'https://example.test/a' })
    );
  } finally {
    if (original) {
      Object.defineProperty(globalThis, 'navigator', original);
    } else {
      delete globalThis.navigator;
    }
  }
});
