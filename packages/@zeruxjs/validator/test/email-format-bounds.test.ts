import test from 'node:test';
import assert from 'node:assert/strict';
import { string, pipe, email, ajvSafeParse } from '../dist/index.js';
test(
  'JSON-schema email format rejects long ambiguous domains and preserves ordinary addresses',
  { timeout: 1000 },
  async () => {
    /** Explicit string/email schema shared by ordinary and adversarial local format fixtures. */
    const schema = pipe(string(), email());
    assert.equal(
      (await ajvSafeParse(schema, 'reader@example.test')).success,
      true
    );
    assert.equal(
      (await ajvSafeParse(schema, 'reader@' + 'a.'.repeat(20000) + '@invalid'))
        .success,
      false
    );
    // Exercise distinct malformed local parts/domains without contacting any mail provider.
    for (const input of [
      '@example.test',
      'a@example',
      'a@.test',
      'a@example.',
      'a@space .test',
    ]) {
      assert.equal((await ajvSafeParse(schema, input)).success, false);
    }
  }
);
