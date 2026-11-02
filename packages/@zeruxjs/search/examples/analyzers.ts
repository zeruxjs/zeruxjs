import { createSearchIndex } from '@zeruxjs/search';

const options = {
  fields: ['title', 'text'],
  weights: { title: 4 },
  analyzer: { locale: 'en', diacritics: 'fold', includeMarks: true },
  maxDocuments: 1000,
  maxExpansions: 40,
} as const;
// fields is copied explicitly because the compatible public option accepts mutable arrays.
const index = createSearchIndex({ ...options, fields: [...options.fields] });
index.addMany([{ id: 'guide', title: 'Café guide', text: 'Unicode search', category: 'public' }]);
const results = index.search('cafe', {
  filters: [{ field: 'category', operator: 'eq', value: 'public' }],
});
const fuzzy = index.search('searh', { match: 'fuzzy', fuzzy: { maxDistance: 1 } });
const snapshot = index.snapshot({ version: 2 });
const restored = createSearchIndex({ ...options, fields: [...options.fields] });
restored.load(snapshot); // rejects incompatible analyzers/weights before replacing state
console.log(
  results.map((result) => result.document.id),
  fuzzy.length,
);
// Use separate tenant-owned indexes or an authorized host visibility filter; this is not authorization.
