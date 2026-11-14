import { createSearchIndex } from '@zeruxjs/search';

/** Explicit English analyzer and finite local-index budgets; no remote service is required. */
const options = {
  fields: ['title', 'text'],
  weights: { title: 4 },
  analyzer: { locale: 'en', diacritics: 'fold', includeMarks: true },
  maxDocuments: 1000,
  maxExpansions: 40,
} as const;
// fields is copied explicitly because the compatible public option accepts mutable arrays.
/** Independent bounded in-memory index used only by this example or fixture. */
const index = createSearchIndex({ ...options, fields: [...options.fields] });
index.addMany([
  {
    id: 'guide',
    title: 'Café guide',
    text: 'Unicode search',
    category: 'public',
  },
]);
/** Independent result clones used for public behavior assertions. */
const results = index.search('cafe', {
  filters: [{ field: 'category', operator: 'eq', value: 'public' }],
});
/** Explicit bounded fuzzy result; no unbounded expansion is enabled. */
const fuzzy = index.search('searh', {
  match: 'fuzzy',
  fuzzy: { maxDistance: 1 },
});
/** Independent snapshot fixture; it does not share mutable stored document records. */
const snapshot = index.snapshot({ version: 2 });
/** Independent index used to validate explicit V2 snapshot migration. */
const restored = createSearchIndex({ ...options, fields: [...options.fields] });
restored.load(snapshot); // rejects incompatible analyzers/weights before replacing state
console.log(
  results.map((result) => result.document.id),
  fuzzy.length
);
// Use separate tenant-owned indexes or an authorized host visibility filter; this is not authorization.
