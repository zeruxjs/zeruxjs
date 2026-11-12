import { createSearchIndex } from '@zeruxjs/search';
import { performance } from 'node:perf_hooks';
// Deterministic public fixtures; no application files, network or production indexes.
/** Deterministic public synthetic corpus; no application files or private data are scanned. */
const corpus = Array.from({ length: 600 }, (_, i) => ({
  id: String(i).padStart(4, '0'),
  title: i % 10 ? `Guide ${i}` : 'Cache',
  section: i % 3 ? 'Runtime' : 'Cache',
  text: `Unicode Café 中文 cache runtime transactions tenant section${i}`,
}));
/** Bounded measurement records; these timings do not imply a universal performance gain. */
const runs = [];
let digest = '';
for (let run = 0; run < 5; run++) {
  globalThis.gc?.();
  /** Pre-operation state used to assert failed input preserves the previous generation. */
  const before = process.memoryUsage().heapUsed;
  /** Monotonic timestamp before constructing and indexing this synthetic corpus. */
  const start = performance.now();
  /** Independent bounded in-memory index used only by this example or fixture. */
  const index = createSearchIndex({
    fields: ['title', 'section', 'text'],
    weights: { title: 8, section: 3, text: 1 },
    maxDocuments: 1000,
  });
  index.addMany(corpus);
  /** Monotonic timestamp after the entire synthetic index batch commits. */
  const built = performance.now();
  /** Deterministic first-iteration ranking digest used to compare repeated runs. */
  const observed = [];
  for (let n = 0; n < 50; n++) {
    for (const query of ['cache', 'runtime', 'café', '中文']) {
      /** Independent query result or synthetic response used for exact checks. */
      const result = index.search(query, { limit: 10 });
      if (n === 0) {
        observed.push(
          query +
            ':' +
            result
              .map((r) => r.document.id + ':' + r.score.toFixed(10))
              .join('|')
        );
      }
    }
  }
  digest = observed.join('||');
  /** Monotonic timestamp after the same bounded query workload. */
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
    {
      node: process.version,
      documents: corpus.length,
      queriesPerRun: 200,
      runs,
      digest,
    },
    null,
    2
  )
);
