import { createRequire } from 'node:module';
/** CommonJS bridge retained for the package's existing require-based fixtures. */
const require = createRequire(import.meta.url);
/** Public native/library fixture APIs; tests retain explicit ownership of every acquired resource. */
const { test } = require('node:test');
/** Native strict assertions; failures must remain visible after fixture cleanup. */
const assert = require('node:assert/strict');
/** Public native/library fixture APIs; tests retain explicit ownership of every acquired resource. */
const { sanitizeIdentifier } = require('../dist/core.js');
test(
  'identifier normalization handles long edge runs and keeps stable fallback semantics',
  { timeout: 1000 },
  () => {
    assert.equal(
      sanitizeIdentifier('-'.repeat(100000) + 'name' + '-'.repeat(100000)),
      'name'
    );
    assert.equal(sanitizeIdentifier(' -- a/b -- '), 'a-b');
    assert.equal(sanitizeIdentifier('----', '--fallback--'), 'fallback');
    assert.equal(sanitizeIdentifier('', '---'), 'item');
  }
);
