import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSearchIndex,
  tokenize,
  SearchLimitError,
  highlightMatches,
} from '../dist/index.js';
test('normalization/case/diacritics are explicit and per-field analyzers keep query case', () => {
  assert.deepEqual(tokenize('ＣＡＦÉ'), ['café']);
  assert.deepEqual(tokenize('Café', { diacritics: 'fold' }), ['cafe']);
  assert.deepEqual(tokenize('I İ', { locale: 'tr' }), ['ı', 'i']);
  assert.deepEqual(tokenize('हिन्दी 中文 العربية', { includeMarks: true }), [
    'हिन्दी',
    '中文',
    'العربية',
  ]);
  /** Independent bounded in-memory index used only by this example or fixture. */
  const index = createSearchIndex({
    fields: ['title', 'text'],
    analyzers: {
      title: { caseSensitive: true },
      text: { diacritics: 'fold', includeMarks: true },
    },
    maxDocuments: 20,
  });
  index.addMany([
    { id: 'a', title: 'NASA', text: 'Café हिन्दी 中文' },
    { id: 'b', title: 'nasa', text: 'astronomy' },
  ]);
  assert.deepEqual(
    index.search('NASA').map((r) => r.document.id),
    ['a']
  );
  assert.deepEqual(
    index.search('nasa').map((r) => r.document.id),
    ['b']
  );
  assert.deepEqual(
    index.search('cafe').map((r) => r.document.id),
    ['a']
  );
  assert.equal(index.search('NASA हिन्दी', { mode: 'all' }).length, 1);
  assert.equal(index.search('中文').length, 1);
});
test('weighted ranking, deterministic ties and fuzzy distance penalties are explicit', () => {
  /** Synthetic comparison index/result used to verify stable independent behavior. */
  const a = createSearchIndex({
    fields: ['title', 'text'],
    weights: { title: 8 },
    maxDocuments: 20,
  });
  /** Synthetic comparison index/result used to verify stable independent behavior. */
  const b = createSearchIndex({
    fields: ['title', 'text'],
    weights: { title: 8 },
    maxDocuments: 20,
  });
  /** Public synthetic documents; no repository secrets or operator records are read. */
  const docs = [
    { id: 'b', title: 'other', text: 'search' },
    { id: 'a', title: 'search', text: 'other' },
    { id: 'c', title: 'other', text: 'search' },
  ];
  a.addMany(docs);
  b.addMany([...docs].reverse());
  assert.equal(a.search('search')[0].document.id, 'a');
  assert.deepEqual(
    a.search('search').map((r) => [r.document.id, r.score]),
    b.search('search').map((r) => [r.document.id, r.score])
  );
  assert.deepEqual(
    a.search('searh', { match: 'fuzzy' }).map((r) => r.document.id),
    a.search('search').map((r) => r.document.id)
  );
  assert.equal(a.search('search', { algorithm: 'term-frequency' })[0].score, 8);
  assert.equal(a.search('sear').length, 0);
  assert.equal(a.search('sear', { prefix: true }).length, 3);
});
test('atomic batches/replacements survive invalid input, generator failure, capacity and snapshot failures', () => {
  /** Independent bounded in-memory index used only by this example or fixture. */
  const index = createSearchIndex({ maxDocuments: 2 });
  index.add({ id: 'old', text: 'stable' });
  /** Pre-operation state used to assert failed input preserves the previous generation. */
  const before = index.snapshot();
  /** Deliberately invalid synthetic input expected to fail before publication. */
  const invalid = { id: 'old', text: 'changed', callback() {} };
  assert.throws(() => index.update(invalid));
  assert.deepEqual(index.snapshot(), before);
  assert.throws(() =>
    index.addMany([
      { id: 'new', text: 'new' },
      { id: 'bad', text: 3 },
    ])
  );
  assert.deepEqual(index.snapshot(), before);
  /** Fail after yielding one candidate to prove iterable failure cannot publish a partial index.
   * @returns {Generator<object>} Synthetic interrupted document source.
   */
  function* failed() {
    yield { id: 'old', text: 'partial' };
    throw Error('source failed');
  }
  assert.throws(() => index.addMany(failed()), /source failed/);
  assert.deepEqual(index.snapshot(), before);
  assert.throws(() =>
    index.addMany([
      { id: 'new', text: 'new' },
      { id: 'third', text: 'third' },
    ])
  );
  assert.deepEqual(index.snapshot(), before);
  assert.throws(() =>
    index.load({
      version: 1,
      documents: [
        { id: 'dup', text: 'one' },
        { id: 'dup', text: 'two' },
      ],
    })
  );
  assert.deepEqual(index.snapshot(), before);
  index.update({ id: 'old', text: 'updated' });
  assert.equal(index.search('stable').length, 0);
  assert.equal(index.search('updated').length, 1);
  index.remove('old');
  assert.equal(index.vocabularySize, 0);
});
test('V2 pins analyzer/weights; V1 migration intentionally uses receiver settings and invalid loads preserve generation', () => {
  /** Explicit fixture configuration; changes exercise validation without touching application state. */
  const options = {
    analyzer: { locale: 'en', diacritics: 'fold' },
    maxDocuments: 10,
  };
  /** Synthetic comparison index/result used to verify stable independent behavior. */
  const a = createSearchIndex(options);
  a.add({ id: 'a', text: 'Café' });
  /** Independent snapshot fixture; it does not share mutable stored document records. */
  const snapshot = a.snapshot({ version: 2 });
  /** Synthetic comparison index/result used to verify stable independent behavior. */
  const b = createSearchIndex(options);
  b.load(JSON.parse(JSON.stringify(snapshot)));
  assert.equal(b.search('cafe').length, 1);
  /** Deliberately incompatible snapshot/configuration candidate. */
  const wrong = createSearchIndex({
    analyzer: { locale: 'en', caseSensitive: true },
  });
  wrong.add({ id: 'keep', text: 'Keep' });
  assert.throws(() => wrong.load(snapshot), /Incompatible/);
  assert.equal(wrong.size, 1);
  wrong.load(a.snapshot());
  assert.equal(wrong.search('Café').length, 1);
  /** Equivalent configuration with reordered object keys; field order stays significant. */
  const reordered = JSON.parse(JSON.stringify(snapshot));
  reordered.configuration = {
    stopWords: reordered.configuration.stopWords,
    analyzers: reordered.configuration.analyzers,
    weights: reordered.configuration.weights,
    fields: reordered.configuration.fields,
  };
  b.load(reordered);
  assert.equal(b.size, 1);
});
test('filter operators are literal, case-explicit, bounded and cannot mutate stored results', () => {
  /** Independent bounded in-memory index used only by this example or fixture. */
  const index = createSearchIndex();
  index.addMany([
    { id: 'a', text: 'item', category: 'News', n: 2 },
    { id: 'b', text: 'item', category: 'news', n: 5 },
  ]);
  assert.deepEqual(
    index
      .search('item', {
        filters: [{ field: 'category', operator: 'eq', value: 'news' }],
      })
      .map((r) => r.document.id),
    ['b']
  );
  assert.equal(
    index.search('item', {
      filters: [
        {
          field: 'category',
          operator: 'eq',
          value: 'NEWS',
          caseSensitive: false,
        },
      ],
    }).length,
    2
  );
  assert.deepEqual(
    index
      .search('item', { filters: [{ field: 'n', operator: 'gte', value: 4 }] })
      .map((r) => r.document.id),
    ['b']
  );
  index.search('item', {
    filter: (doc) => {
      doc.text = 'mutated';
      doc.category = 'secret';
      return true;
    },
  });
  assert.equal(index.get('a').category, 'News');
  assert.equal(index.search('mutated').length, 0);
  assert.throws(() =>
    index.search('item', {
      filters: [{ field: 'category', operator: 'regex', value: '(a+)+$' }],
    })
  );
  assert.throws(() => index.search('item', { mode: 'bogus' }));
});
test('query/expansion/scan/highlight limits fail explicitly, including direct helper boundaries', () => {
  /** Independent bounded in-memory index used only by this example or fixture. */
  const index = createSearchIndex({ maxExpansions: 2 });
  index.addMany([
    { id: 'a', text: 'apple apply aptly' },
    { id: 'b', text: 'ape' },
  ]);
  assert.throws(
    () => index.search('ap', { prefix: true }),
    (e) => e instanceof SearchLimitError && e.code === 'EXPANSION_LIMIT'
  );
  /** Restricted vocabulary scan fixture used to prove finite expansion. */
  const scan = createSearchIndex({ maxVocabularyScan: 1 });
  scan.add({ id: 'a', text: 'cat dog' });
  assert.throws(() => scan.search('bat', { match: 'fuzzy' }), {
    code: 'VOCABULARY_LIMIT',
  });
  assert.throws(
    () =>
      index.search(Array.from({ length: 65 }, (_, i) => 'word' + i).join(' ')),
    {
      code: 'QUERY_LIMIT',
    }
  );
  assert.throws(() =>
    index.search('a', { match: 'fuzzy', fuzzy: { maxDistance: 3 } })
  );
  assert.throws(() => highlightMatches('x', Array(65).fill('x')));
  assert.equal(highlightMatches('<a+>', ['a+']), '&lt;<mark>a+</mark>&gt;');
});
test('snapshot accessors/serialization callbacks and budget failures never execute or replace state', () => {
  /** Independent bounded in-memory index used only by this example or fixture. */
  const index = createSearchIndex({ maxSnapshotBytes: 256 });
  index.add({ id: 'keep', text: 'stable' });
  let called = false;
  /** Synthetic input or decoded result retained for exact assertions. */
  const value = { version: 1, documents: [{ id: 'other', text: 'new' }] };
  Object.defineProperty(value.documents, 'toJSON', {
    value() {
      called = true;
      return [];
    },
  });
  assert.throws(() => index.load(value));
  assert.equal(called, false);
  assert.equal(index.get('keep').text, 'stable');
  assert.throws(
    () =>
      index.load({
        version: 1,
        documents: [{ id: 'large', text: 'x'.repeat(300) }],
      }),
    { code: 'DOCUMENT_LIMIT' }
  );
  assert.equal(index.size, 1);
});
test('mixed analyzer all-mode ignores clauses blocked in every analyzer', () => {
  /** Independent bounded in-memory index used only by this example or fixture. */
  const index = createSearchIndex({
    fields: ['title', 'text'],
    analyzers: { title: { caseSensitive: true } },
    stopWords: ['the'],
  });
  index.add({ id: 'a', title: 'NASA', text: 'space' });
  assert.equal(index.search('the NASA', { mode: 'all' }).length, 1);
});
test('async or nonboolean visibility filters fail closed instead of exposing matching documents', () => {
  /** Independent bounded in-memory index used only by this example or fixture. */
  const index = createSearchIndex();
  index.add({ id: 'secret', text: 'item' });
  assert.throws(
    () => index.search('item', { filter: async () => false }),
    /synchronous boolean/
  );
  assert.throws(
    () => index.search('item', { filter: () => ({ allowed: false }) }),
    /synchronous boolean/
  );
  assert.equal(index.size, 1);
});

test('nonplain arrays and snapshot containers cannot execute serialization hooks or replace staged state', () => {
  /** Owned synthetic index; failed metadata/snapshot inputs must preserve its previous generation. */
  const index = createSearchIndex();
  index.add({ id: 'keep', text: 'stable' });
  /** Immutable comparison fixture, never persisted or sent to a real backend. */
  const before = index.snapshot();
  let invoked = 0;
  /** Untrusted data can provide inherited serialization/iteration behavior; the boundary must reject it. */
  class PayloadArray extends Array {
    /** Represent an inherited callback that must never be invoked by validation/serialization.
     * @returns {unknown[]} Synthetic callback result; invocation would violate the inert-data contract.
     */
    toJSON() {
      invoked++;
      return [];
    }
  }
  /** A class-based envelope is outside the public plain-JSON snapshot contract. */
  class SnapshotEnvelope {
    /** Construct synthetic data fields without any I/O or external side effects. */
    constructor() {
      this.version = 1;
      this.documents = [{ id: 'replace', text: 'unexpected' }];
    }
    /** This inherited hook must not run before snapshot shape/prototype checks.
     * @returns {object} Synthetic envelope that would otherwise serialize successfully.
     */
    toJSON() {
      invoked++;
      return { version: this.version, documents: this.documents };
    }
  }
  assert.throws(() =>
    index.add({ id: 'bad', text: 'unsafe', metadata: new PayloadArray() })
  );
  assert.throws(() => index.load(new SnapshotEnvelope()));
  assert.throws(() =>
    index.load({
      version: 1,
      documents: new PayloadArray({ id: 'bad', text: 'unsafe' }),
    })
  );
  assert.equal(invoked, 0);
  assert.deepEqual(index.snapshot(), before);
  index.add({ id: 'plain', text: 'safe', metadata: ['inert'] });
  assert.deepEqual(index.get('plain').metadata, ['inert']);
  index.clear();
});
