import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitFor } from '../dist/index.js';
test('waitFor retries conditions and supports abort', async () => {
  let tries = 0;
  /** Actual injected predicate result after two controlled false observations. */
  const value = await waitFor(
    () => {
      tries++;
      return tries > 2 ? 'ok' : false;
    },
    { intervalMs: 2, timeoutMs: 100 }
  );
  assert.equal(value, 'ok');
  /** Fixture-owned already-aborted signal proving no new polling work starts. */
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    waitFor(() => false, { signal: controller.signal }),
    /Abort/
  );
  await assert.rejects(
    waitFor(() => false, { timeoutMs: 10, intervalMs: 2 }),
    /timed out/
  );
});
