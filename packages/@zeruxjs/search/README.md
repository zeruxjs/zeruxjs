# @zeruxjs/search

Dependency-free, Unicode-aware in-memory search index. Separate modules for types, tokenization, query parsing, indexing, and relevance scoring.

```ts
import { createSearchIndex, parseSearchQuery, highlightMatches } from '@zeruxjs/search';
const index = createSearchIndex({ fields: ['text'], maxDocuments: 10000 });
index.add({ id: 'docs/1', text: 'Getting started with ZeruxJS' });
const results = index.search('zeruxjs', { limit: 10, prefix: true });
const terms = parseSearchQuery('Hello ZeruxJS');
const safeHtml = highlightMatches('<Hello ZeruxJS>', terms);
const snapshot = index.snapshot();
index.load(snapshot);
```

Features: BM25-style relevance, weighted text fields, stopwords, prefix suggestions, filtering, pagination, replacement and removal, defensive document cloning, JSON-serializable snapshots. The index is in memory; persistence and cross-process coordination are the application's responsibility. `highlightMatches` escapes untrusted input by default.

## HTTP search and durable snapshots

The core index remains framework-neutral. Its Node-only HTTP and persistence helpers are separate exports to avoid importing filesystem or crypto modules into browser bundles.

```ts
import { createSearchIndex } from '@zeruxjs/search';
import { createSearchHandler } from '@zeruxjs/search/http';
import { saveSearchSnapshot, loadSearchSnapshot } from '@zeruxjs/search/persistence';

const index = createSearchIndex({ fields: ['text'], maxDocuments: 10000 });
index.add({ id: 'docs/1', text: 'ZeruxJS framework search' });
const search = createSearchHandler({index, maxResults: 50, cacheSeconds: 30});
const response = search(new Request('http://localhost/search?q=framework'));
await saveSearchSnapshot('/private/data/search.json', index);
await loadSearchSnapshot('/private/data/search.json', index);
```

HTTP search bounds pagination and query length; supports GET, HEAD, search suggestions, projection, `ETag`/304, and explicit cache lifetimes. **Never use a shared cache with a visibility filter**, and suggestions are disabled for filtered indexes to avoid revealing hidden vocabulary. Authenticated requests use `Cache-Control: no-store`. Without a field projection, the entire matching document is returned; do not index private fields for a public endpoint.

Atomic filesystem snapshots are single-writer and local; the parent directory must exist and must not contain symlinks. They are not distributed transactions or a database replacement.

## Configurable literal algorithms

[The public-import example](examples/analyzers.ts) opts into analyzers, a finite document cap, fuzzy matching and V2 snapshots. Defaults retain NFKC, locale lowercasing, letter/number tokens, exact matching and the existing weighted BM25-style formula. No stemming, semantic model, regex-query language or remote search provider is installed.

`analyzer` configures the index default; `analyzers:{field:...}` overrides individual indexed fields. Options are `normalization:'none'|'NFC'|'NFD'|'NFKC'|'NFKD'`, `caseSensitive`, a canonical Intl `locale`, `diacritics:'preserve'|'fold'`, and `includeMarks`. Defaults are NFKC, case-insensitive, the runtime's effective locale, preserved diacritics and `includeMarks:false`. The effective locale is captured in index configuration; use an explicit locale for reproducibility across hosts. Analysis applies normalization, locale lowercasing unless case-sensitive, optional NFD/Unicode-mark removal, then tokenization. See the [Unicode normalization specification](https://unicode.org/reports/tr15/) and [ECMAScript locale casing](https://tc39.es/ecma402/#sup-string.prototype.tolocalelowercase).

For example, default `Café` matches `CAFÉ` and a canonically equivalent decomposed spelling, but does not equal `cafe`; opt into mark folding for that. Locale `tr` distinguishes dotted/dotless I. `includeMarks:true` keeps combining marks inside tokens, useful for strings such as हिन्दी/العربية; the legacy default may split mark-bearing words. Folding removes **all Unicode marks**, not just Western accents, so it can erase meaningful language distinctions. This is code-point/Unicode-class tokenization, not language segmentation, transliteration or universal linguistic parity. CJK runs are whole tokens, not dictionary words.

Fields with identical resolved analyzers share weighted term frequencies as before. With differing analyzers, raw letter/number/mark query clauses are analyzed separately for each group; a group's analyzed subtokens must all match for that clause. A clause can match any field group, and `mode:'all'` requires every non-stopword clause across the result. Clauses blocked by every group's stopwords are ignored. Stopwords follow each field group's analyzer, including its case policy. `matches` reports normalized query terms for a single analyzer and original lexical clauses for mixed analyzers, not fuzzy vocabulary expansions or source offsets.

`weights` remain finite/non-negative (now capped at 1000); zero weight can still match but contributes zero score. `algorithm:'term-frequency'` optionally selects weighted term frequencies without BM25 length/IDF normalization. Default exact scores were checked against the prior implementation on the benchmark fixture. Equal scores now break by UTF-16 document-ID order rather than host-locale collation, and prefix candidates use lexical order rather than insertion order. These deliberate tie/prefix changes make results repeatable across update order/locales; non-ASCII ID ties and ambiguous multi-prefix ranking can therefore differ from older releases. Results/get/values remain defensive clones. Host visibility predicates now receive clones too and must return a synchronous **boolean**; promises or truthy objects fail closed.

### Exact, prefix and fuzzy limits

`match:'exact'|'prefix'|'fuzzy'` is explicit; existing `prefix:true` remains the prefix shorthand. Conflicting options reject. Exact matches analyzed whole tokens, prefix matches token starts, and fuzzy uses bounded Unicode-code-point Levenshtein insertion/deletion/substitution distance (default one, maximum two; transposition is not a special operation). Fuzzy candidates prefer smaller edit distance then lexical order, with a `1/(1+distance)` score factor. One vocabulary candidate contributes per document/query term, preventing repeated expansions from multiplying a single term's score. `mode:'any'` remains default.

Queries default to at most 4096 UTF-16 code units/32 distinct logical terms (configurable maxima 16384/64). Terms are capped at 256 code units; fuzzy terms at 64 code points. `maxVocabularyScan` defaults to 10,000 checked posting keys per entire query/suggestion (maximum 100,000), while `maxExpansions` defaults to 50 matching prefix/fuzzy keys across the query (maximum 256). `fuzzy.maxExpansions` can lower that policy, not raise it. Hitting a limit throws `SearchLimitError` with a stable QUERY_LIMIT/VOCABULARY_LIMIT/EXPANSION_LIMIT code; there is no silently incomplete result page. Large vocabularies or broad/long prefix queries may require a deliberately higher configured budget or narrower query. Suggestions retain frequency ordering with lexical ties and share the scan budget.

The existing HTTP handler still exposes only its documented literal q/mode/prefix/pagination/suggest parameters. Fuzzy options and the filter DSL are programmatic, not arbitrary browser-supplied JSON execution. Its existing parameter/limit handling returns 400, and visibility-filtered suggestions/public caching remain prohibited. `highlightMatches` still escapes HTML and literal regex syntax, with independent text/term budgets; it is not an analyzer-aware fuzzy/diacritic span mapper. A custom wrapper is trusted host HTML.

### Declarative filters and private indexes

`filters:[{field,operator,value?,caseSensitive?}]` is a bounded AND list (maximum 16) over direct **own** document fields. Operators: strict `eq`/`neq`, `in` (at most 32 primitive candidates), numeric-only `gte`/`lte`, `exists` (own value including null), and literal string `contains`/`prefix`. Filter values are finite number/boolean/null/string (strings at most 1024 code units). String comparisons default to case-sensitive original values; `caseSensitive:false` uses ordinary Unicode lowercase, independently of token analyzers/locale/diacritic folding. There are no nested paths, regexes, coercion, SQL operators or callback strings. The existing trusted `filter(document)` callback can be combined with these filters and remains the host's responsibility.

Filters are **not authorization**. Ranking statistics and expansion budgets describe the whole index, even when result documents are filtered. For strong tenant/private-vocabulary isolation use separate tenant-owned indexes, not one shared private index with public visibility predicates. The HTTP helper's projection/cache controls are unchanged; do not expose private metadata just because indexing ignores it.

## Staged updates and snapshot migration

Document metadata must be inert, finite, plain JSON: no functions, accessors, class instances, symbols, bigint, prototype keys, cyclic values or sparse arrays. Array subclasses and class-based snapshot envelopes are rejected before traversal/serialization; inherited `toJSON` hooks are not accepted as data. This boundary assumes ordinary JavaScript data and does not sandbox hostile proxies or modified platform intrinsics. IDs are nonempty strings up to 512 code units and text is required. This tightens formerly structured-cloneable metadata (such as Date/Map) so snapshots have a real serializable contract; convert such metadata explicitly before indexing. Default limits are 1 MiB per document (maximum 16 MiB), 100,000 analyzed tokens per document, depth 16 and 20,000 visited document nodes. `maxVocabulary` defaults to 100,000 analyzer/term posting keys (maximum one million). `maxDocuments` keeps its existing default Infinity for compatibility: production hosts should set a finite cap.

`add`/`update` validate, clone and tokenize before replacing postings. `addMany` stages all its own changes and swaps once; invalid documents, source-iterator failure, capacity or vocabulary overflow leave that batch uncommitted. Default batch bounds are 1000 documents/16 MiB (configurable maxima 100,000/64 MiB). Duplicate IDs within a valid batch retain last-write replacement semantics. Chunking a large ingest intentionally creates separate commits; it does not make the entire stream atomic. Arbitrary side effects performed by trusted input iterators/filters are not a transaction the library can roll back. `remove` drops obsolete postings, while `clear` releases the current generation; referenced iterators/results remain caller-owned memory.

`snapshot()` still returns V1 `{version:1,documents}`. V1 load is an explicit migration using the receiving index's current analyzers/weights/limits, as historically; it cannot prove the original analysis policy. `snapshot({version:2})` additionally records fields, weights, fully resolved analyzers/locale and stopwords. V2 load requires compatible configuration and never weakens receiver limits or executes serialized callbacks. Object-key order is canonicalized for comparison; field order remains significant. Cross-host replay still requires a compatible JavaScript/Intl Unicode runtime; V2 does not certify identical ICU/Unicode tables across runtime versions. Unknown versions, duplicate snapshot IDs, malformed data, accessors or incompatible V2 configuration reject before replacing state. Default snapshot byte budget is 16 MiB (configurable up to 256 MiB).

Node persistence helpers accept `{snapshotVersion:2}` for V2 saves; omission keeps V1 saves. Loads validate either version through the receiving index. Existing private-directory/symlink checks, staged atomic file replacement, handle/temporary-file cleanup and last-good-index behavior remain intact. Local synchronous swaps and single-writer filesystem publication are not cross-process locks, database transactions or authenticated snapshot provenance.

## Repeatable measurements and qualification

After building, run `npm run bench` from this package (or `node --expose-gc bench/search.mjs`). The deterministic fixture uses 600 public synthetic documentation-shaped records, weighted title/section/text fields, four exact queries, 200 queries/run and five fresh-index runs. It reports build/query wall times, GC-assisted heap deltas and result/score digests. Heap delta is not peak RSS or a memory ceiling, and timings are machine/runtime/workload dependent.

On Node 24.15.0 in this workspace, a comparison with the prior source produced median build/query times of 4.421/47.565 ms and heap delta 1,122,136 bytes; the updated implementation measured 21.541/62.345 ms and 1,324,568 bytes on the same fixture. All four exact result/score digests matched. Validation and atomic staging add cost; this is **not a performance-gain claim**. Profiling motivated eliminating duplicate single-analyzer score maps and long repeated analyzer prefixes; no unprofiled trie/regex/backend rewrite was added. Re-run the authored harness before drawing deployment conclusions.

Focused checks cover multilingual/case/diacritic analysis, ranking/ties, fuzzy budgets, filters, failed batches/updates, V1/V2 staged loads, filesystem failures/cleanup and the existing public docs search consumer against a compact fixture. The docs application was neither rebuilt nor started. No live/browser/large-production-corpus qualification is implied, and the package has no live-provider prerequisite; applications still own persistence directories, index caps and tenant authorization.

## Explicit external adapters and named services

`@zeruxjs/search/adapters` is opt-in; core imports never load a remote SDK, open a
connection or change the standalone index. See the runnable public-import
[service example](examples/service.ts). `registerSearchService` snapshots explicit
named connections and factory selections. It returns an inert registration for
`zeruxjs` configuration: `search: { enabled: true, registration }`. The resulting
manager is available as `serviceScope.get('search')`; no public HTTP route is
created. This built-in service is required when enabled: startup failure rolls
back acquired resources. Config, credentials and authorizers never enter public
manifests. Custom services may declare `search` as a dependency.

A trusted factory returns `SearchAdapter`: search, health, close and explicitly
advertised index/update/delete methods. Capabilities declare supported filter
operators, sort fields, offset pagination, tenant enforcement, persistence and
immediate/eventual consistency. Unsupported operations fail before dispatch.
`mutate(name, context, operation, values)` returns `completed` or `accepted` with
an opaque backend task ID; accepted does not mean searchable or durable completion.
Task monitoring is backend-specific. Scores, relevance and consistency are not
interchangeable across engines. Engine failures become redacted `UNAVAILABLE`
errors with a private cause for host diagnostics; never send that cause to clients.

Every read/write calls the host `authorize(context, name, operation)` callback.
It must verify the session and permission, returning `{ tenant }` or null. The
adapter receives that tenant separately in `SearchCall`, and MUST apply it as an
immutable conjunctive scope to reads, writes, deletes and IDs. Query text and
user filters cannot replace it. `tenantIsolation: true` is a required adapter
contract, not an audit of arbitrary host code. Do not register an engine adapter
that cannot enforce it. Index documents are inert bounded JSON; batches cap at
100 items/1 MiB, queries at 4096 characters, pages at 100 hits/1 MiB and offsets at
10000. Filter validation reuses the local index contract. Controls accept
`signal` and a timeout no longer than the configured 1–60000 ms default deadline.

Remote connections require an HTTPS endpoint exactly present in `allowedEndpoints`
(no URL credentials, query or fragment). The trusted factory owns SDK/transport,
private credentials, connection-time DNS/egress validation, redirect denial and
credential refresh. This release supplies the contract, not a vendor client or
HTTP proxy. The factory must propagate `SearchCall.signal` and deadline, bound its
native resources and close only resources it owns. Shared injected clients remain
host-owned. Close invalidates calls, aborts work, waits for actual factory/operation
settlement, then closes adapters in reverse acquisition order. Noncooperative
work can delay close; cancellation cannot force JavaScript or prove rollback.
Cancelled/deadline writes report an unknown outcome; nothing is transparently
replayed. Pending native work retains a bounded slot (default 64, maximum 1024).
Authorization occupies that same deadline/slot, before backend dispatch.

`createLocalSearchFactory({ maxTenants, maxDocumentsPerTenant })` explicitly selects
bounded process-memory storage with a distinct physical index per verified tenant,
including separate vocabulary/ranking statistics. It supports index/upsert and
delete, existing local filters and offset pages; sort/update reject. It borrows no
external client and clears its own indices on close. `requirePersistent: true`
rejects this factory. There is no automatic runtime fallback: explicitly selecting
local storage is an application decision and cannot satisfy remote durability.
Health is an internal host API, not an authorization-free public endpoint.
