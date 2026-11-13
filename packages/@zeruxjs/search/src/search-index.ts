import { jsonBytes } from './json-budget.js';
import { tokenize, normalizeAnalyzer } from './tokenize.js';
import { matchesSearchFilters, validateSearchFilters } from './query.js';
import {
  SearchLimitError,
  type SearchDocument,
  type SearchResult,
  type SearchOptions,
  type SearchIndexOptions,
  type SearchSnapshot,
  type SearchSnapshotV2,
  type SearchConfiguration,
  type SearchAnalyzer,
} from './types.js';
/** Stable UTF-16 lexical ordering independent of locale collation.
 * @param {string} a - First comparison operand.
 * @param {string} b - Second comparison operand.
 * @returns {number} Negative, positive or zero ordering result.
 */
const compare = (a: string, b: string) => {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
};
/** Canonical configuration serialization; callers first validate inert bounded JSON.
 * @param {any} value - Previously validated configuration subtree.
 * @returns {string} Deterministic JSON text with sorted object keys and preserved array order.
 */
const canonical = (value: any): string => {
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort(compare)
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
};
type State<T> = {
  /** Owned document clones for this published or candidate generation. */
  documents: Map<string, T>;
  /** Analyzer-prefixed term maps of document IDs to weighted frequencies. */
  postings: Map<string, Map<string, number>>;
  /** Weighted document lengths used by the unchanged scoring formula. */
  lengths: Map<string, number>;
  /** Posting keys owned by each document, enabling consistent replacement/removal. */
  termsById: Map<string, Set<string>>;
};
/** Fresh independent posting/document maps for a new generation; no global state is shared.
 * @returns {State<T>} Empty independent state with no borrowed mutable maps.
 */
const empty = <T>(): State<T> => ({
  documents: new Map(),
  postings: new Map(),
  lengths: new Map(),
  termsById: new Map(),
});
/** Compute bounded Unicode edit distance with row-minimum early exit; oversize candidates return the out-of-budget sentinel.
 * @param {string} a - First literal term.
 * @param {string} b - Second literal term.
 * @param {number} max - Maximum accepted edit distance.
 * @returns {number} Exact bounded distance or max plus one when the candidate cannot qualify.
 */
function distance(a: string, b: string, max: number): number {
  if (a.length > 128 || b.length > 128) {
    return max + 1;
  }
  /** Bounded Unicode code points from the first fuzzy candidate. */
  const x = Array.from(a);
  /** Bounded Unicode code points from the second fuzzy candidate. */
  const y = Array.from(b);
  if (x.length > 64 || y.length > 64 || Math.abs(x.length - y.length) > max) {
    return max + 1;
  }
  let row = Array.from({ length: y.length + 1 }, (_, i) => i);
  // Advance one bounded edit-distance row and stop early when no candidate can qualify.
  for (let i = 1; i <= x.length; i++) {
    /** Candidate state or edit-distance row; updates remain separate from the currently published generation. */
    const next = [i];
    let minimum = i;
    // Compare insertion, deletion and substitution without allocating a full distance matrix.
    for (let j = 1; j <= y.length; j++) {
      next[j] = Math.min(
        (next[j - 1] ?? Infinity) + 1,
        (row[j] ?? Infinity) + 1,
        (row[j - 1] ?? Infinity) +
          (x[i - 1] === y[j - 1] ? 0 : 1)
      );
      minimum = Math.min(minimum, next[j] ?? Infinity);
    }
    if (minimum > max) {
      return max + 1;
    }
    row = next;
  }
  return row[y.length] ?? max + 1;
}
/** Standalone bounded local index with staged writes and immutable-by-copy results. */
export class SearchIndex<T extends SearchDocument = SearchDocument> {
  private state = empty<T>();
  private readonly options: SearchIndexOptions<T>;
  private readonly configuration: SearchConfiguration;
  private readonly groups: Array<{
    /** Canonical analyzer configuration identity. */
    key: string;
    /** Stable group prefix preventing incompatible analyzer vocabularies from mixing. */
    prefix: string;
    /** Resolved analyzer applied to this group. */
    analyzer: SearchAnalyzer;
    /** Analyzer-normalized bounded stopwords. */
    stop: Set<string>;
  }>;
  private readonly limits: {
    /** Per-document serialized byte ceiling. */
    document: number;
    /** Per-operation staged document count ceiling. */
    batch: number;
    /** Aggregate staged document byte ceiling. */
    batchBytes: number;
    /** Maximum retained analyzer/term posting keys. */
    vocabulary: number;
    /** Maximum inspected vocabulary keys per expansion query. */
    scan: number;
    /** Maximum analyzed query clauses. */
    terms: number;
    /** Maximum query UTF-16 code units. */
    query: number;
    /** Maximum accepted expanded terms. */
    expansions: number;
    /** Maximum complete serialized snapshot bytes. */
    snapshot: number;
  };
  private readonly maxDocuments: number;
  /** Create an independent in-memory index after validating field, analyzer, weight and resource policy. No network, filesystem or background resource is acquired.
   * @param {SearchIndexOptions<T>} options - Optional analysis/ranking/resource settings; defaults preserve the legacy text BM25 behavior.
   */
  constructor(options: SearchIndexOptions<T> = {}) {
    if (options.fields !== undefined && !Array.isArray(options.fields)) {
      throw new TypeError('Search fields must be an array');
    }
    /** Distinct ordered searchable fields; omitted or empty fields retain the text default. */
    const fields = options.fields?.length
      ? [...new Set(options.fields)]
      : ['text'];
    if (
      !Array.isArray(fields) ||
      fields.length > 16 ||
      fields.some(
        (f) =>
          typeof f !== 'string' ||
          !/^[A-Za-z_][A-Za-z0-9_-]{0,95}$/.test(f) ||
          ['__proto__', 'constructor', 'prototype'].includes(f)
      )
    ) {
      throw new TypeError('Invalid search fields');
    }
    if (
      (options.analyzers &&
        Object.keys(options.analyzers).some((k) => !fields.includes(k))) ||
      (options.weights &&
        Object.keys(options.weights).some((k) => !fields.includes(k)))
    ) {
      throw new TypeError('Unknown weighted/analyzed field');
    }
    /** Resolved field analysis policy, captured before indexing or query expansion. */
    const analyzer = normalizeAnalyzer(options.analyzer);
    /** Validated nonnegative field weights; zero deliberately contributes no frequency. */
    const weights: Record<string, number> = {};
    /** Resolved per-field analyzers retained for V2 compatibility checks. */
    const analyzers: SearchConfiguration['analyzers'] = {};
    // Resolve each searchable field deterministically; field order remains part of V2 compatibility.
    for (const field of fields) {
      weights[field] = Number(
        options.weights?.[field as keyof T & string] ?? 1
      );
      if (
        !Number.isFinite(weights[field]) ||
        weights[field] < 0 ||
        weights[field] > 1000
      ) {
        throw new RangeError(
          'Weights must be finite non-negative numbers <=1000'
        );
      }
      analyzers[field] = normalizeAnalyzer({
        ...analyzer,
        ...options.analyzers?.[field as keyof T & string],
      });
    }
    /** Bounded original stopwords captured independently of caller iterators. */
    const stops: string[] = [];
    // Capture a bounded caller iterable once; later queries never reread host mutable input.
    for (const word of options.stopWords ?? []) {
      if (
        stops.length >= 10000 ||
        typeof word !== 'string' ||
        word.length > 256
      ) {
        throw new RangeError('Stopword limit');
      }
      stops.push(word);
    }
    this.configuration = {
      fields,
      weights,
      analyzers,
      stopWords: [...new Set(stops)].sort(compare),
    };
    /** Analyzer groups share postings only when their normalized configuration is identical. */
    const configs = new Map<
      string,
      {
        /** Canonical analyzer configuration identity. */
        key: string;
        /** Stable group prefix preventing incompatible analyzer vocabularies from mixing. */
        prefix: string;
        /** Resolved analyzer applied to this group. */
        analyzer: SearchAnalyzer;
        /** Analyzer-normalized bounded stopwords. */
        stop: Set<string>;
      }
    >();
    // Resolve each searchable field deterministically; field order remains part of V2 compatibility.
    for (const field of fields) {
      /** Analyzer-prefixed posting identity, or exact serialized analyzer identity during grouping. */
      const analyzer = analyzers[field];
      if (!analyzer) {
        throw new TypeError(`Missing analyzer for field ${field}`);
      }
      /** Stable serialized analyzer identity used to group compatible field postings. */
      const key = JSON.stringify(analyzer);
      if (!configs.has(key)) {
        configs.set(key, {
          key,
          prefix: String(configs.size),
          analyzer,
          stop: new Set(stops.flatMap((s) => tokenize(s, analyzer))),
        });
      }
    }
    this.groups = [...configs.values()];
    /** Validate an index resource ceiling before any document is accepted.
     * @param {number | undefined} v - Optional explicit limit.
     * @param {number} fallback - Default used when no limit is supplied.
     * @param {number} max - Absolute supported maximum.
     * @returns {number} Positive safe integer; invalid settings throw.
     */
    const limit = (v: number | undefined, fallback: number, max: number) => {
      /** Resolved finite bounded numeric setting or page limit. */
      const n = v ?? fallback;
      if (!Number.isSafeInteger(n) || n < 1 || n > max) {
        throw new RangeError('Invalid search resource limit');
      }
      return n;
    };
    this.maxDocuments = options.maxDocuments ?? Infinity;
    if (
      this.maxDocuments !== Infinity &&
      (!Number.isSafeInteger(this.maxDocuments) || this.maxDocuments < 1)
    ) {
      throw new RangeError('maxDocuments must be positive');
    }
    this.limits = {
      document: limit(options.maxDocumentBytes, 1048576, 16777216),
      batch: limit(options.maxBatchSize, 1000, 100000),
      batchBytes: limit(options.maxBatchBytes, 16777216, 67108864),
      vocabulary: limit(options.maxVocabulary, 100000, 1000000),
      scan: limit(options.maxVocabularyScan, 10000, 100000),
      terms: limit(options.maxQueryTerms, 32, 64),
      query: limit(options.maxQueryLength, 4096, 16384),
      expansions: limit(options.maxExpansions, 50, 256),
      snapshot: limit(options.maxSnapshotBytes, 16777216, 268435456),
    };
    this.options = {
      ...options,
      fields: fields as (keyof T & string)[],
      weights: weights as Partial<Record<keyof T & string, number>>,
      analyzer,
      analyzers: analyzers as SearchIndexOptions<T>['analyzers'],
      stopWords: stops,
    };
  }
  /** Validate and clone one inert document, then calculate weighted analyzer-specific postings without touching published state.
   * @param {T} doc - Caller-owned document with nonempty ID and required text.
   * @returns {{stored: T, frequencies: Map<string, number>, length: number, bytes: number}} Isolated document and posting data; malformed values or exhausted budgets throw.
   */
  private prepare(doc: T) {
    /** Validated serialized byte count charged before staged work can be committed. */
    const bytes = jsonBytes(doc, this.limits.document);
    if (
      !doc ||
      !Object.hasOwn(doc, 'id') ||
      !Object.hasOwn(doc, 'text') ||
      typeof doc.id !== 'string' ||
      !doc.id ||
      doc.id.length > 512 ||
      typeof doc.text !== 'string'
    ) {
      throw new TypeError('Document requires id and text');
    }
    /** Independent clone retained by the candidate index; caller mutations cannot change it. */
    const stored = structuredClone(doc);
    /** Weighted analyzer/term frequencies prepared without changing live postings. */
    const frequencies = new Map<string, number>();
    let length = 0,
      tokens = 0;
    // Analyze only configured own string fields; metadata is never evaluated as source.
    for (const field of this.configuration.fields) {
      if (!Object.hasOwn(stored, field)) {
        continue;
      }
      /** Own searchable field or cloned lookup candidate; nonstring searchable fields are ignored. */
      const value = stored[field];
      if (typeof value !== 'string') {
        continue;
      }
      /** Resolved field analysis policy, captured before indexing or query expansion. */
      const analyzer = this.configuration.analyzers[field];
      if (!analyzer) {
        throw new TypeError(`Missing analyzer for field ${field}`);
      }
      /** Matching analyzer group; prefixes prevent incompatible normalization vocabularies from merging. */
      const group = this.groups.find(
        (g) => g.key === JSON.stringify(analyzer)
      )!;
      /** Validated nonnegative contribution of this searchable field. */
      const weight = this.configuration.weights[field];
      if (weight === undefined) {
        throw new TypeError(`Missing weight for field ${field}`);
      }
      // Charge every analyzed token before stopword removal to keep work bounded.
      for (const term of tokenize(value, analyzer)) {
        if (++tokens > 100000) {
          throw new SearchLimitError('DOCUMENT_LIMIT');
        }
        if (group.stop.has(term)) {
          continue;
        }
        /** Analyzer-prefixed posting identity, or exact serialized analyzer identity during grouping. */
        const key = group.prefix + '\0' + term;
        frequencies.set(key, (frequencies.get(key) ?? 0) + weight);
        length += weight;
      }
    }
    return { stored, frequencies, length, bytes };
  }
  /** Build a copy-on-write candidate generation. The caller publishes it only after the entire iterable and vocabulary limits validate.
   * @param {Iterable<T>} documents - Bounded document batch; repeated IDs use the final staged record.
   * @param {State<T>} base - Borrowed previous candidate or published state; defaults to the current generation.
   * @returns {State<T>} Complete candidate state; failed iteration or validation leaves the original untouched.
   */
  private stage(documents: Iterable<T>, base = this.state): State<T> {
    /** Candidate state or edit-distance row; updates remain separate from the currently published generation. */
    const next: State<T> = {
      documents: new Map(base.documents),
      postings: new Map(base.postings),
      lengths: new Map(base.lengths),
      termsById: new Map(base.termsById),
    };
    /** Posting keys already copied for this candidate; untouched live maps remain borrowed and immutable. */
    const copied = new Set<string>();
    /** Copy-on-first-write posting accessor; staged mutations never alter the published generation.
     * @param {string} key - Analyzer-prefixed posting key to edit.
     * @returns {Map<string, number>} Candidate-owned posting map, cloned on first edit.
     */
    const posting = (key: string) => {
      if (!copied.has(key)) {
        next.postings.set(key, new Map(next.postings.get(key)));
        copied.add(key);
      }
      return next.postings.get(key)!;
    };
    let count = 0,
      bytes = 0;
    // Stage every document under aggregate count/byte limits before publishing a generation.
    for (const doc of documents) {
      if (++count > this.limits.batch) {
        throw new SearchLimitError('BATCH_LIMIT');
      }
      /** Prepared document or copied posting map whose changes belong only to this operation. */
      const p = this.prepare(doc);
      bytes += p.bytes;
      if (bytes > this.limits.batchBytes) {
        throw new SearchLimitError('BATCH_LIMIT');
      }
      if (
        !next.documents.has(p.stored.id) &&
        next.documents.size >= this.maxDocuments
      ) {
        throw new SearchLimitError('DOCUMENT_LIMIT');
      }
      // Remove the replaced record from its old candidate postings before adding new frequencies.
      for (const key of next.termsById.get(p.stored.id) ?? []) {
        posting(key).delete(p.stored.id);
      }
      next.documents.set(p.stored.id, p.stored);
      next.lengths.set(p.stored.id, p.length);
      next.termsById.set(p.stored.id, new Set(p.frequencies.keys()));
      // Write prepared weighted frequencies only into candidate-owned posting maps.
      for (const [key, n] of p.frequencies) {
        posting(key).set(p.stored.id, n);
      }
    }
    // Discard newly empty posting keys so removed tokens do not persist in vocabulary.
    for (const key of copied) {
      if (!next.postings.get(key)!.size) {
        next.postings.delete(key);
      }
    }
    if (next.postings.size > this.limits.vocabulary) {
      throw new SearchLimitError('VOCABULARY_LIMIT');
    }
    return next;
  }
  /** Atomically add or replace one document by ID after complete validation.
   * @param {T} doc - Inert caller-owned record; the retained record is cloned.
   * @returns {void} Publishes the candidate only on success.
   */
  add(doc: T): void {
    this.state = this.stage([doc]);
  }
  /** Atomically add or replace a bounded iterable; a late malformed record does not partially alter the index.
   * @param {Iterable<T>} documents - Host-owned iterable within configured batch count and byte limits.
   * @returns {void} Publishes one complete candidate or throws without replacing state.
   */
  addMany(documents: Iterable<T>): void {
    this.state = this.stage(documents);
  }
  /** Compatibility alias for add: replace an existing ID or add it when absent.
   * @param {T} doc - Complete replacement document, not a partial patch.
   * @returns {void} Publishes only a fully validated record.
   */
  update(doc: T): void {
    this.add(doc);
  }
  /** Read a document without exposing the internal mutable record.
   * @param {string} id - Exact document identity; no analyzer is applied.
   * @returns {T | undefined} Independent clone or undefined when absent.
   */
  get(id: string): T | undefined {
    /** Own searchable field or cloned lookup candidate; nonstring searchable fields are ignored. */
    const value = this.state.documents.get(id);
    return value ? structuredClone(value) : undefined;
  }
  /** Check exact document identity without exposing document contents.
   * @param {string} id - Exact document identity.
   * @returns {boolean} Whether the published generation contains this ID.
   */
  has(id: string) {
    return this.state.documents.has(id);
  }
  /** Remove one document and its postings using a separate candidate generation.
   * @param {string} id - Exact document identity to remove.
   * @returns {boolean} True after removal, false when the ID did not exist.
   */
  remove(id: string): boolean {
    if (!this.has(id)) {
      return false;
    }
    /** Candidate state or edit-distance row; updates remain separate from the currently published generation. */
    const next: State<T> = {
      documents: new Map(this.state.documents),
      postings: new Map(this.state.postings),
      lengths: new Map(this.state.lengths),
      termsById: new Map(this.state.termsById),
    };
    // Copy and edit only posting maps referenced by the removed document.
    for (const key of next.termsById.get(id) ?? []) {
      /** Prepared document or copied posting map whose changes belong only to this operation. */
      const p = new Map(next.postings.get(key));
      p.delete(id);
      if (p.size) {
        next.postings.set(key, p);
      } else {
        next.postings.delete(key);
      }
    }
    next.documents.delete(id);
    next.lengths.delete(id);
    next.termsById.delete(id);
    this.state = next;
    return true;
  }
  /** Replace all in-memory state with fresh empty maps. No external storage or borrowed resource is closed.
   * @returns {void} Drops this index generation; existing returned clones remain independent.
   */
  clear() {
    this.state = empty<T>();
  }
  /** Count currently published document identities.
   * @returns {number} Document count, including records with no searchable tokens.
   */
  get size() {
    return this.state.documents.size;
  }
  /** Count analyzer-specific posting keys rather than unique visible text strings.
   * @returns {number} Retained posting-key count.
   */
  get vocabularySize() {
    return this.state.postings.size;
  }
  /** Iterate independent document clones in map insertion order; callers never receive retained records.
   * @returns {IterableIterator<T>} Lazy iterator of cloned records; no external handle is acquired.
   */
  *values(): IterableIterator<T> {
    // Yield independent clones; a consumer cannot mutate the retained records.
    for (const doc of this.state.documents.values()) {
      yield structuredClone(doc);
    }
  }
  /** Return bounded prefix suggestions ranked by document frequency and deterministic lexical ties. Vocabulary suggestions are not authorization-filtered.
   * @param {string} prefix - Literal prefix bounded by the configured query length.
   * @param {number} limit - Requested count; defaults to ten and is capped at 100.
   * @returns {string[]} Normalized suggestion terms; vocabulary budget exhaustion throws.
   */
  suggest(prefix: string, limit = 10): string[] {
    if (typeof prefix !== 'string' || prefix.length > this.limits.query) {
      throw new SearchLimitError('QUERY_LIMIT');
    }
    /** Resolved finite bounded numeric setting or page limit. */
    const n = bounded(limit, 10, 100);
    /** Suggestion terms accumulated with document-frequency counts under a bounded vocabulary scan. */
    const found = new Map<string, number>();
    let scanned = 0;
    // Evaluate each analyzer namespace independently; incompatible normalization never shares terms.
    for (const group of this.groups) {
      /** Final analyzed prefix token; empty/stopword input produces no suggestions for this group. */
      const normalized = tokenize(prefix, group.analyzer).at(-1);
      if (!normalized) {
        continue;
      }
      // Charge vocabulary inspection before collecting bounded prefix suggestions.
      for (const [key, p] of this.state.postings) {
        if (++scanned > this.limits.scan) {
          throw new SearchLimitError('VOCABULARY_LIMIT');
        }
        if (key.startsWith(group.prefix + '\0')) {
          /** Literal vocabulary suffix after removing its analyzer-group prefix. */
          const term = key.slice(group.prefix.length + 1);
          if (term.startsWith(normalized)) {
            found.set(term, (found.get(term) ?? 0) + p.size);
          }
        }
      }
    }
    return [...found]
      .sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))
      .slice(0, n)
      .map(([term]) => term);
  }
  /** Rank a bounded literal query against the published generation. Visibility predicates are synchronous over clones; they do not isolate private vocabulary.
   * @param {string} query - Literal query text; regex/DSL evaluation is unsupported.
   * @param {SearchOptions} options - Optional bounded matching, scoring, pagination and scalar/visibility filters.
   * @returns {SearchResult<T>[]} Cloned ranked results with deterministic ID ties; invalid policies or budget exhaustion throw.
   */
  search(query: string, options: SearchOptions = {}): SearchResult<T>[] {
    if (typeof query !== 'string' || query.length > this.limits.query) {
      throw new SearchLimitError('QUERY_LIMIT');
    }
    if (
      !options ||
      Object.keys(options).some(
        (k) =>
          ![
            'limit',
            'offset',
            'mode',
            'prefix',
            'filter',
            'filters',
            'match',
            'fuzzy',
            'algorithm',
          ].includes(k)
      ) ||
      (options.mode !== undefined && !['all', 'any'].includes(options.mode)) ||
      (options.prefix !== undefined && typeof options.prefix !== 'boolean') ||
      (options.match !== undefined &&
        !['exact', 'prefix', 'fuzzy'].includes(options.match)) ||
      (options.filter !== undefined && typeof options.filter !== 'function') ||
      (options.algorithm !== undefined &&
        !['bm25', 'term-frequency'].includes(options.algorithm)) ||
      (options.match !== undefined &&
        options.prefix === true &&
        options.match !== 'prefix') ||
      (options.fuzzy !== undefined && options.match !== 'fuzzy')
    ) {
      throw new TypeError('Invalid search options');
    }
    /** Explicit match mode; legacy prefix flag is used only when match is omitted. */
    const match = options.match ?? (options.prefix ? 'prefix' : 'exact');
    /** Declared fuzzy edit distance, defaulting to one and restricted to one or two. */
    const maxDistance = options.fuzzy?.maxDistance ?? 1;
    /** Finite expansion cap; per-query overrides cannot exceed the index policy. */
    const maxExpansions =
      options.fuzzy?.maxExpansions ?? this.limits.expansions;
    if (
      options.fuzzy &&
      (Object.keys(options.fuzzy).some(
        (k) => !['maxDistance', 'maxExpansions'].includes(k)
      ) ||
        ![1, 2].includes(maxDistance) ||
        !Number.isSafeInteger(maxExpansions) ||
        maxExpansions < 1 ||
        maxExpansions > this.limits.expansions)
    ) {
      throw new TypeError('Invalid fuzzy limits');
    }
    /** Validate an index resource ceiling before any document is accepted.
     * @param {number | undefined} v - Optional explicit limit.
     * @param {number} fallback - Default used when no limit is supplied.
     * @param {number} max - Absolute supported maximum.
     * @returns {number} Positive safe integer; invalid settings throw.
     */
    const limit = bounded(options.limit, 20, 1000);
    /** Validated ranked-result offset, bounded to one million. */
    const offset = bounded(options.offset, 0, 1000000);
    /** Cloned validated scalar clauses; tenant authorization must occur outside this matcher. */
    const filters = validateSearchFilters(options.filters);
    /** Published generation captured for this synchronous search; candidate writes publish only after validation. */
    const state = this.state;
    /** Distinct original query clauses analyzed per group; all-mode counts these clauses rather than expansion count. */
    const firstGroup = this.groups[0];
    /** Query terms after analyzer normalization and stop-word removal. */
    const raw =
      this.groups.length === 1 && firstGroup
        ? [
            ...new Set(
              tokenize(query, firstGroup.analyzer).filter(
                (t) => !firstGroup.stop.has(t)
              )
            ),
          ]
        : [
            ...new Set(
              tokenize(query, {
                normalization: 'none',
                caseSensitive: true,
                includeMarks: true,
              })
            ),
          ].filter((clause) =>
            this.groups.some((group) =>
              tokenize(clause, group.analyzer).some(
                (term) => !group.stop.has(term)
              )
            )
          );
    if (
      raw.length > this.limits.terms ||
      raw.some(
        (t) =>
          t.length > 256 || (match === 'fuzzy' && Array.from(t).length > 64)
      )
    ) {
      throw new SearchLimitError('QUERY_LIMIT');
    }
    if (!raw.length) {
      return [];
    }
    /** Accumulated per-document scores and matched original-clause indexes. */
    const scores = new Map<string, { score: number; matches: Set<number> }>();
    /** Average weighted document length, with one as the empty/zero-length scoring fallback. */
    const avg =
      [...state.lengths.values()].reduce((a, b) => a + b, 0) /
        Math.max(1, this.size) || 1;
    let scanned = 0,
      expanded = 0;
    raw.forEach((clause, i) => {
      // Evaluate each analyzer namespace independently; incompatible normalization never shares terms.
      for (const group of this.groups) {
        /** Distinct analyzed clause terms after group-specific stopword removal. */
        const terms = [
          ...new Set(
            tokenize(clause, group.analyzer).filter((t) => !group.stop.has(t))
          ),
        ];
        if (!terms.length) {
          continue;
        }
        if (
          terms.length > this.limits.terms ||
          terms.some(
            (t) =>
              t.length > 256 || (match === 'fuzzy' && Array.from(t).length > 64)
          )
        ) {
          throw new SearchLimitError('QUERY_LIMIT');
        }
        /** Single-group/single-term fast path preserving existing score accumulation order. */
        const simple = this.groups.length === 1 && terms.length === 1;
        /** Temporary per-group matches; multianalyzer clauses count only when every analyzed term matched. */
        const local = simple
          ? undefined
          : new Map<
              string,
              {
                score: number; /** Maximum analyzed query clauses. */
                terms: Set<string>;
              }
            >();
        // Accumulate one analyzed term at a time while deduplicating expanded document matches.
        for (const term of terms) {
          let candidates: string[];
          /** Candidate edit distances used for deterministic ordering and fuzzy-score penalties. */
          const edits = new Map<string, number>();
          /** Analyzer-prefixed posting identity, or exact serialized analyzer identity during grouping. */
          const key = group.prefix + '\0' + term;
          if (match === 'exact') {
            candidates = [key];
          } else {
            candidates = [];
            // Cap scanned vocabulary and accepted expansions independently; exhaustion throws rather than truncating silently.
            for (const candidate of state.postings.keys()) {
              if (++scanned > this.limits.scan) {
                throw new SearchLimitError('VOCABULARY_LIMIT');
              }
              if (!candidate.startsWith(group.prefix + '\0')) {
                continue;
              }
              /** Literal candidate term without the analyzer-group prefix. */
              const word = candidate.slice(group.prefix.length + 1);
              /** Bounded edit distance; prefix matching intentionally uses zero. */
              const edit =
                match === 'fuzzy' ? distance(term, word, maxDistance) : 0;
              if (
                match === 'prefix' ? word.startsWith(term) : edit <= maxDistance
              ) {
                if (++expanded > maxExpansions) {
                  throw new SearchLimitError('EXPANSION_LIMIT');
                }
                edits.set(candidate, edit);
                candidates.push(candidate);
              }
            }
            candidates.sort(
              (a, b) =>
                (edits.get(a) ?? 0) - (edits.get(b) ?? 0) || compare(a, b)
            );
          }
          /** Document IDs already scored for this term so expansions do not count a document repeatedly. */
          const processed = new Set<string>();
          // Score deterministic expansion order; each document contributes at most once per term.
          for (const candidate of candidates) {
            /** Borrowed immutable posting map for this published analyzer/term candidate. */
            const postings = state.postings.get(candidate);
            if (!postings) {
              continue;
            }
            /** Existing BM25 inverse-document-frequency factor; this pass preserves its arithmetic. */
            const idf = Math.log(
              1 + (this.size - postings.size + 0.5) / (postings.size + 0.5)
            );
            // Apply the unchanged ranking formula and distance penalty without exposing retained documents.
            for (const [id, tf] of postings) {
              if (processed.has(id)) {
                continue;
              }
              processed.add(id);
              /** Existing selected scoring formula, before fuzzy distance adjustment. */
              const score =
                options.algorithm === 'term-frequency'
                  ? tf
                  : idf *
                    ((tf * 2.2) /
                      (tf +
                        1.2 *
                          (0.25 +
                            (0.75 * (state.lengths.get(id) ?? 0)) / avg)));
              if (simple) {
                let entry = scores.get(id);
                if (!entry) {
                  scores.set(id, (entry = { score: 0, matches: new Set() }));
                }
                entry.score += score / (1 + (edits.get(candidate) ?? 0));
                entry.matches.add(i);
              } else {
                let item = local!.get(id);
                if (!item) {
                  local!.set(id, (item = { score: 0, terms: new Set() }));
                }
                item.score += score / (1 + (edits.get(candidate) ?? 0));
                item.terms.add(term);
              }
            }
          }
        }
        // A multianalyzer clause counts only when every normalized term matched this document.
        for (const [id, item] of local ?? []) {
          if (item.terms.size === terms.length) {
            let entry = scores.get(id);
            if (!entry) {
              scores.set(id, (entry = { score: 0, matches: new Set() }));
            }
            entry.score += item.score;
            entry.matches.add(i);
          }
        }
      }
    });
    /** Trusted synchronous visibility callback over a clone; nonboolean/async results fail closed.
     * @param {T} doc - Borrowed retained document, cloned before invoking the callback.
     * @returns {boolean} Explicit host visibility decision; invalid results throw.
     */
    const visible = (doc: T) => {
      if (!options.filter) {
        return true;
      }
      /** Untrusted visibility return value; it must be a synchronous boolean. */
      const decision: unknown = options.filter(structuredClone(doc));
      if (typeof decision !== 'boolean') {
        if (
          decision &&
          typeof (decision as { then?: unknown }).then === 'function'
        ) {
          void Promise.resolve(decision).catch(() => {});
        }
        throw new TypeError('Search filter must return a synchronous boolean');
      }
      return decision;
    };
    return [...scores]
      .filter(
        ([id, item]) =>
          (options.mode !== 'all' || item.matches.size === raw.length) &&
          matchesSearchFilters(state.documents.get(id)!, filters) &&
          visible(state.documents.get(id)!)
      )
      .sort((a, b) => b[1].score - a[1].score || compare(a[0], b[0]))
      .slice(offset, offset + limit)
      .map(([id, item]) => ({
        document: structuredClone(state.documents.get(id)!),
        score: item.score,
        matches: raw.filter((_, i) => item.matches.has(i)),
      }));
  }
  /** Create a bounded immutable-by-copy snapshot. V1 omits original configuration; explicit V2 records the resolved receiving policy.
   * @returns {SearchSnapshot<T> | SearchSnapshotV2<T>} Independent serializable snapshot with no generated timestamp; budget exhaustion throws.
   */
  snapshot(): SearchSnapshot<T>;
  /** Create a bounded immutable-by-copy snapshot. V1 omits original configuration; explicit V2 records the resolved receiving policy.
   * @param {{version: 2}} options - Explicit V2 selection; omission preserves the legacy V1 envelope.
   * @param {2} options.version - Required V2 discriminator; no automatic format upgrade.
   * @returns {SearchSnapshot<T> | SearchSnapshotV2<T>} Independent serializable snapshot with no generated timestamp; budget exhaustion throws.
   */
  snapshot(options: { version: 2 }): SearchSnapshotV2<T>;
  /** Create a bounded immutable-by-copy snapshot. V1 omits original configuration; explicit V2 records the resolved receiving policy.
   * @param {{version: 2}} options - Explicit V2 selection; omission preserves the legacy V1 envelope.
   * @param {2} options.version - Required V2 discriminator; no automatic format upgrade.
   * @returns {SearchSnapshot<T> | SearchSnapshotV2<T>} Independent serializable snapshot with no generated timestamp; budget exhaustion throws.
   */
  snapshot(options?: { version: 2 }): SearchSnapshot<T> | SearchSnapshotV2<T> {
    let bytes = 0;
    /** Cloned snapshot records collected under the configured document/total byte ceilings. */
    const documents: T[] = [];
    // Charge document and complete-snapshot budgets before returning any serialized snapshot.
    for (const doc of this.values()) {
      bytes += jsonBytes(doc, this.limits.document);
      if (bytes > this.limits.snapshot) {
        throw new SearchLimitError('DOCUMENT_LIMIT');
      }
      documents.push(doc);
    }
    if (options !== undefined && options.version !== 2) {
      throw new TypeError('Unsupported snapshot version');
    }
    /** Explicit V1 or V2 snapshot envelope; generation time is deliberately absent for determinism. */
    const result: SearchSnapshot<T> | SearchSnapshotV2<T> =
      options?.version === 2
        ? {
            version: 2,
            configuration: structuredClone(this.configuration),
            documents,
          }
        : { version: 1, documents };
    if (
      new TextEncoder().encode(JSON.stringify(result)).byteLength >
      this.limits.snapshot
    ) {
      throw new SearchLimitError('DOCUMENT_LIMIT');
    }
    return result;
  }
  /** Validate the complete inert snapshot and build staged bounded batches before a single state replacement. V2 must match this index policy; failed loads preserve the prior generation.
   * @param {SearchSnapshot<T> | SearchSnapshotV2<T>} snapshot - Plain V1/V2 snapshot; classes, accessors, duplicate IDs and incompatible configuration reject.
   * @returns {void} Publishes only a completely validated replacement.
   */
  load(snapshot: SearchSnapshot<T> | SearchSnapshotV2<T>): void {
    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(snapshot)) ||
      Object.values(Object.getOwnPropertyDescriptors(snapshot)).some(
        (d) => !('value' in d)
      ) ||
      ![1, 2].includes(snapshot.version) ||
      Reflect.ownKeys(snapshot).some(
        (k) =>
          typeof k !== 'string' ||
          ![
            'version',
            'documents',
            ...(snapshot.version === 2 ? ['configuration'] : []),
          ].includes(k)
      ) ||
      !Array.isArray(snapshot.documents) ||
      Object.getPrototypeOf(snapshot.documents) !== Array.prototype ||
      snapshot.documents.length > this.maxDocuments
    ) {
      throw new TypeError('Unsupported search snapshot');
    }
    if (snapshot.version === 2) {
      if (!snapshot.configuration) {
        throw new TypeError('Unsupported search snapshot');
      }
      jsonBytes(snapshot.configuration, 131072);
      if (canonical(snapshot.configuration) !== canonical(this.configuration)) {
        throw new TypeError('Incompatible search snapshot configuration');
      }
    }
    if (
      Reflect.ownKeys(snapshot.documents).some(
        (k) =>
          typeof k !== 'string' ||
          (k !== 'length' && !/^(0|[1-9][0-9]*)$/.test(k))
      ) ||
      Object.values(Object.getOwnPropertyDescriptors(snapshot.documents)).some(
        (d) => !('value' in d)
      )
    ) {
      throw new TypeError('Snapshot accessors forbidden');
    }
    /** Snapshot-local duplicate detector; all IDs are checked before replacement. */
    const ids = new Set<string>();
    let bytes = 0;
    // Validate every imported document and duplicate ID before building the replacement.
    for (const doc of snapshot.documents) {
      bytes += jsonBytes(doc, this.limits.document);
      if (bytes > this.limits.snapshot) {
        throw new SearchLimitError('DOCUMENT_LIMIT');
      }
      if (!doc || !Object.hasOwn(doc, 'id') || ids.has(doc.id)) {
        throw new TypeError('Duplicate snapshot document');
      }
      ids.add(doc.id);
    }
    if (
      new TextEncoder().encode(JSON.stringify(snapshot)).byteLength >
      this.limits.snapshot
    ) {
      throw new SearchLimitError('DOCUMENT_LIMIT');
    }
    /** Isolated receiving-policy index used only to stage a complete replacement. */
    const restored = new SearchIndex<T>(this.options);
    let next = empty<T>();
    // Stage bounded import pages against a separate candidate; publication occurs only after the last page.
    for (let i = 0; i < snapshot.documents.length; i += this.limits.batch) {
      next = restored.stage(
        snapshot.documents.slice(i, i + this.limits.batch),
        next
      );
    }
    this.state = next;
  }
}
/** Resolve compatibility pagination by flooring a finite nonnegative value and applying the maximum.
 * @param {number | undefined} value - Optional requested count/offset.
 * @param {number} fallback - Default used when the request is undefined.
 * @param {number} max - Upper bound applied after flooring.
 * @returns {number} Bounded integer; negative or nonfinite input throws.
 */
export function bounded(
  value: number | undefined,
  fallback: number,
  max: number
) {
  /** Resolved finite bounded numeric setting or page limit. */
  const n = value ?? fallback;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    throw new RangeError(
      'Pagination values must be non-negative finite numbers'
    );
  }
  return Math.min(max, Math.floor(n));
}
/** Create a standalone independent local index; no implicit persistence, remote engine or background work is enabled.
 * @param {SearchIndexOptions<T>} options - Optional analyzer/ranking/resource configuration.
 * @returns {SearchIndex<T>} Caller-owned in-memory index; clear explicitly discards its documents.
 */
export function createSearchIndex<T extends SearchDocument = SearchDocument>(
  options?: SearchIndexOptions<T>
) {
  return new SearchIndex<T>(options);
}
