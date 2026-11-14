import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSearchIndex,
  parseSearchQuery,
  highlightMatches,
} from '../dist/index.js';
test('modular search defensively clones documents and supports query helpers', () => {
  /** Independent document clone whose mutation must not alter retained index state. */
  const doc = { id: 'a', text: 'Vue and React', nested: { score: 1 } };
  /** Index retains the actual authored document shape, including the cloned metadata. */
  const index = createSearchIndex<typeof doc>();
  /** Require the document before each independent clone mutation.
   * @returns {typeof doc} New defensive clone of the indexed fixture.
   */
  const read = (): typeof doc => {
    /** Each call observes a fresh detached fixture record. */
    const value = index.get('a');
    assert.ok(value);
    return value;
  };
  index.add(doc);
  doc.nested.score = 10;
  assert.equal(read().nested.score, 1);
  read().nested.score = 100;
  assert.equal(read().nested.score, 1);
  /** Independent query result or synthetic response used for exact checks. */
  const result = index.search('Vue');
  result[0].document.nested.score = 200;
  assert.equal(read().nested.score, 1);
  assert.deepEqual(parseSearchQuery('React react Vue', ['vue']), ['react']);
  assert.equal(
    highlightMatches('<React>', ['React']),
    '&lt;<mark>React</mark>&gt;'
  );
});
