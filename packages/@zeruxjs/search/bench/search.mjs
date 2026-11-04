import { createSearchIndex } from '@zeruxjs/search';
import { performance } from 'node:perf_hooks';
// Deterministic public fixtures; no application files, network or production indexes.
const corpus = Array.from({ length: 600 }, (_, i) => ({
  id: String(i).padStart(4, '0'),
  title: i % 10 ? `Guide ${i}` : 'Cache',
  section: i % 3 ? 'Runtime' : 'Cache',
  text: `Unicode Café 中文 cache runtime transactions tenant section${i}`,
}));
const runs = [];
let digest = '';
for (let run = 0; run < 5; run++) {
  globalThis.gc?.();
  const before = process.memoryUsage().heapUsed,
    start = performance.now();
  const index = createSearchIndex({
    fields: ['title', 'section', 'text'],
    weights: { title: 8, section: 3, text: 1 },
    maxDocuments: 1000,
  });
  index.addMany(corpus);
  const built = performance.now();
  const observed = [];
  for (let n = 0; n < 50; n++)
    for (const query of ['cache', 'runtime', 'café', '中文']) {
      const result = index.search(query, { limit: 10 });
      if (n === 0)
        observed.push(
          query + ':' + result.map((r) => r.document.id + ':' + r.score.toFixed(10)).join('|'),
        );
    }
  digest = observed.join('||');
  const finished = performance.now();
  globalThis.gc?.();
  runs.push({
    buildMs: Number((built - start).toFixed(3)),
    queryMs: Number((finished - built).toFixed(3)),
    heapDeltaBytes: process.memoryUsage().heapUsed - before,
  });
  index.clear();
}
console.log(
  JSON.stringify(
    { node: process.version, documents: corpus.length, queriesPerRun: 200, runs, digest },
    null,
    2,
  ),
);
