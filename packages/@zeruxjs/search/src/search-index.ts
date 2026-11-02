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
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const canonical = (value: any): string =>
  Array.isArray(value)
    ? '[' + value.map(canonical).join(',') + ']'
    : value && typeof value === 'object'
      ? '{' +
        Object.keys(value)
          .sort(compare)
          .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
          .join(',') +
        '}'
      : JSON.stringify(value);
type State<T> = {
  documents: Map<string, T>;
  postings: Map<string, Map<string, number>>;
  lengths: Map<string, number>;
  termsById: Map<string, Set<string>>;
};
const empty = <T>(): State<T> => ({
  documents: new Map(),
  postings: new Map(),
  lengths: new Map(),
  termsById: new Map(),
});
function distance(a: string, b: string, max: number): number {
  if (a.length > 128 || b.length > 128) return max + 1;
  const x = Array.from(a),
    y = Array.from(b);
  if (x.length > 64 || y.length > 64 || Math.abs(x.length - y.length) > max) return max + 1;
  let row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const next = [i];
    let minimum = i;
    for (let j = 1; j <= y.length; j++) {
      next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
      minimum = Math.min(minimum, next[j]);
    }
    if (minimum > max) return max + 1;
    row = next;
  }
  return row[y.length];
}
export class SearchIndex<T extends SearchDocument = SearchDocument> {
  private state = empty<T>();
  private readonly options: SearchIndexOptions<T>;
  private readonly configuration: SearchConfiguration;
  private readonly groups: Array<{
    key: string;
    prefix: string;
    analyzer: SearchAnalyzer;
    stop: Set<string>;
  }>;
  private readonly limits: {
    document: number;
    batch: number;
    batchBytes: number;
    vocabulary: number;
    scan: number;
    terms: number;
    query: number;
    expansions: number;
    snapshot: number;
  };
  private readonly maxDocuments: number;
  constructor(options: SearchIndexOptions<T> = {}) {
    if (options.fields !== undefined && !Array.isArray(options.fields))
      throw new TypeError('Search fields must be an array');
    const fields = options.fields?.length ? [...new Set(options.fields)] : ['text'];
    if (
      !Array.isArray(fields) ||
      fields.length > 16 ||
      fields.some(
        (f) =>
          typeof f !== 'string' ||
          !/^[A-Za-z_][A-Za-z0-9_-]{0,95}$/.test(f) ||
          ['__proto__', 'constructor', 'prototype'].includes(f),
      )
    )
      throw new TypeError('Invalid search fields');
    if (
      (options.analyzers && Object.keys(options.analyzers).some((k) => !fields.includes(k))) ||
      (options.weights && Object.keys(options.weights).some((k) => !fields.includes(k)))
    )
      throw new TypeError('Unknown weighted/analyzed field');
    const analyzer = normalizeAnalyzer(options.analyzer),
      weights: Record<string, number> = {},
      analyzers: SearchConfiguration['analyzers'] = {};
    for (const field of fields) {
      weights[field] = Number(options.weights?.[field as keyof T & string] ?? 1);
      if (!Number.isFinite(weights[field]) || weights[field] < 0 || weights[field] > 1000)
        throw new RangeError('Weights must be finite non-negative numbers <=1000');
      analyzers[field] = normalizeAnalyzer({
        ...analyzer,
        ...options.analyzers?.[field as keyof T & string],
      });
    }
    const stops: string[] = [];
    for (const word of options.stopWords ?? []) {
      if (stops.length >= 10000 || typeof word !== 'string' || word.length > 256)
        throw new RangeError('Stopword limit');
      stops.push(word);
    }
    this.configuration = {
      fields,
      weights,
      analyzers,
      stopWords: [...new Set(stops)].sort(compare),
    };
    const configs = new Map<
      string,
      { key: string; prefix: string; analyzer: SearchAnalyzer; stop: Set<string> }
    >();
    for (const field of fields) {
      const key = JSON.stringify(analyzers[field]);
      if (!configs.has(key))
        configs.set(key, {
          key,
          prefix: String(configs.size),
          analyzer: analyzers[field],
          stop: new Set(stops.flatMap((s) => tokenize(s, analyzers[field]))),
        });
    }
    this.groups = [...configs.values()];
    const limit = (v: number | undefined, fallback: number, max: number) => {
      const n = v ?? fallback;
      if (!Number.isSafeInteger(n) || n < 1 || n > max)
        throw new RangeError('Invalid search resource limit');
      return n;
    };
    this.maxDocuments = options.maxDocuments ?? Infinity;
    if (
      this.maxDocuments !== Infinity &&
      (!Number.isSafeInteger(this.maxDocuments) || this.maxDocuments < 1)
    )
      throw new RangeError('maxDocuments must be positive');
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
  private prepare(doc: T) {
    const bytes = jsonBytes(doc, this.limits.document);
    if (
      !doc ||
      !Object.hasOwn(doc, 'id') ||
      !Object.hasOwn(doc, 'text') ||
      typeof doc.id !== 'string' ||
      !doc.id ||
      doc.id.length > 512 ||
      typeof doc.text !== 'string'
    )
      throw new TypeError('Document requires id and text');
    const stored = structuredClone(doc),
      frequencies = new Map<string, number>();
    let length = 0,
      tokens = 0;
    for (const field of this.configuration.fields) {
      if (!Object.hasOwn(stored, field)) continue;
      const value = stored[field];
      if (typeof value !== 'string') continue;
      const analyzer = this.configuration.analyzers[field],
        group = this.groups.find((g) => g.key === JSON.stringify(analyzer))!,
        weight = this.configuration.weights[field];
      for (const term of tokenize(value, analyzer)) {
        if (++tokens > 100000) throw new SearchLimitError('DOCUMENT_LIMIT');
        if (group.stop.has(term)) continue;
        const key = group.prefix + '\0' + term;
        frequencies.set(key, (frequencies.get(key) ?? 0) + weight);
        length += weight;
      }
    }
    return { stored, frequencies, length, bytes };
  }
  private stage(documents: Iterable<T>, base = this.state): State<T> {
    const next: State<T> = {
        documents: new Map(base.documents),
        postings: new Map(base.postings),
        lengths: new Map(base.lengths),
        termsById: new Map(base.termsById),
      },
      copied = new Set<string>();
    const posting = (key: string) => {
      if (!copied.has(key)) {
        next.postings.set(key, new Map(next.postings.get(key)));
        copied.add(key);
      }
      return next.postings.get(key)!;
    };
    let count = 0,
      bytes = 0;
    for (const doc of documents) {
      if (++count > this.limits.batch) throw new SearchLimitError('BATCH_LIMIT');
      const p = this.prepare(doc);
      bytes += p.bytes;
      if (bytes > this.limits.batchBytes) throw new SearchLimitError('BATCH_LIMIT');
      if (!next.documents.has(p.stored.id) && next.documents.size >= this.maxDocuments)
        throw new SearchLimitError('DOCUMENT_LIMIT');
      for (const key of next.termsById.get(p.stored.id) ?? []) posting(key).delete(p.stored.id);
      next.documents.set(p.stored.id, p.stored);
      next.lengths.set(p.stored.id, p.length);
      next.termsById.set(p.stored.id, new Set(p.frequencies.keys()));
      for (const [key, n] of p.frequencies) posting(key).set(p.stored.id, n);
    }
    for (const key of copied) if (!next.postings.get(key)!.size) next.postings.delete(key);
    if (next.postings.size > this.limits.vocabulary) throw new SearchLimitError('VOCABULARY_LIMIT');
    return next;
  }
  add(doc: T): void {
    this.state = this.stage([doc]);
  }
  addMany(documents: Iterable<T>): void {
    this.state = this.stage(documents);
  }
  update(doc: T): void {
    this.add(doc);
  }
  get(id: string): T | undefined {
    const value = this.state.documents.get(id);
    return value ? structuredClone(value) : undefined;
  }
  has(id: string) {
    return this.state.documents.has(id);
  }
  remove(id: string): boolean {
    if (!this.has(id)) return false;
    const next: State<T> = {
      documents: new Map(this.state.documents),
      postings: new Map(this.state.postings),
      lengths: new Map(this.state.lengths),
      termsById: new Map(this.state.termsById),
    };
    for (const key of next.termsById.get(id) ?? []) {
      const p = new Map(next.postings.get(key));
      p.delete(id);
      if (p.size) next.postings.set(key, p);
      else next.postings.delete(key);
    }
    next.documents.delete(id);
    next.lengths.delete(id);
    next.termsById.delete(id);
    this.state = next;
    return true;
  }
  clear() {
    this.state = empty<T>();
  }
  get size() {
    return this.state.documents.size;
  }
  get vocabularySize() {
    return this.state.postings.size;
  }
  *values(): IterableIterator<T> {
    for (const doc of this.state.documents.values()) yield structuredClone(doc);
  }
  suggest(prefix: string, limit = 10): string[] {
    if (typeof prefix !== 'string' || prefix.length > this.limits.query)
      throw new SearchLimitError('QUERY_LIMIT');
    const n = bounded(limit, 10, 100),
      found = new Map<string, number>();
    let scanned = 0;
    for (const group of this.groups) {
      const normalized = tokenize(prefix, group.analyzer).at(-1);
      if (!normalized) continue;
      for (const [key, p] of this.state.postings) {
        if (++scanned > this.limits.scan) throw new SearchLimitError('VOCABULARY_LIMIT');
        if (key.startsWith(group.prefix + '\0')) {
          const term = key.slice(group.prefix.length + 1);
          if (term.startsWith(normalized)) found.set(term, (found.get(term) ?? 0) + p.size);
        }
      }
    }
    return [...found]
      .sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))
      .slice(0, n)
      .map(([term]) => term);
  }
  search(query: string, options: SearchOptions = {}): SearchResult<T>[] {
    if (typeof query !== 'string' || query.length > this.limits.query)
      throw new SearchLimitError('QUERY_LIMIT');
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
          ].includes(k),
      ) ||
      (options.mode !== undefined && !['all', 'any'].includes(options.mode)) ||
      (options.prefix !== undefined && typeof options.prefix !== 'boolean') ||
      (options.match !== undefined && !['exact', 'prefix', 'fuzzy'].includes(options.match)) ||
      (options.filter !== undefined && typeof options.filter !== 'function') ||
      (options.algorithm !== undefined &&
        !['bm25', 'term-frequency'].includes(options.algorithm)) ||
      (options.match !== undefined && options.prefix === true && options.match !== 'prefix') ||
      (options.fuzzy !== undefined && options.match !== 'fuzzy')
    )
      throw new TypeError('Invalid search options');
    const match = options.match ?? (options.prefix ? 'prefix' : 'exact'),
      maxDistance = options.fuzzy?.maxDistance ?? 1,
      maxExpansions = options.fuzzy?.maxExpansions ?? this.limits.expansions;
    if (
      options.fuzzy &&
      (Object.keys(options.fuzzy).some((k) => !['maxDistance', 'maxExpansions'].includes(k)) ||
        ![1, 2].includes(maxDistance) ||
        !Number.isSafeInteger(maxExpansions) ||
        maxExpansions < 1 ||
        maxExpansions > this.limits.expansions)
    )
      throw new TypeError('Invalid fuzzy limits');
    const limit = bounded(options.limit, 20, 1000),
      offset = bounded(options.offset, 0, 1000000),
      filters = validateSearchFilters(options.filters),
      state = this.state;
    const raw =
      this.groups.length === 1
        ? [
            ...new Set(
              tokenize(query, this.groups[0].analyzer).filter((t) => !this.groups[0].stop.has(t)),
            ),
          ]
        : [
            ...new Set(
              tokenize(query, { normalization: 'none', caseSensitive: true, includeMarks: true }),
            ),
          ].filter((clause) =>
            this.groups.some((group) =>
              tokenize(clause, group.analyzer).some((term) => !group.stop.has(term)),
            ),
          );
    if (
      raw.length > this.limits.terms ||
      raw.some((t) => t.length > 256 || (match === 'fuzzy' && Array.from(t).length > 64))
    )
      throw new SearchLimitError('QUERY_LIMIT');
    if (!raw.length) return [];
    const scores = new Map<string, { score: number; matches: Set<number> }>(),
      avg = [...state.lengths.values()].reduce((a, b) => a + b, 0) / Math.max(1, this.size) || 1;
    let scanned = 0,
      expanded = 0;
    raw.forEach((clause, i) => {
      for (const group of this.groups) {
        const terms = [
          ...new Set(tokenize(clause, group.analyzer).filter((t) => !group.stop.has(t))),
        ];
        if (!terms.length) continue;
        if (
          terms.length > this.limits.terms ||
          terms.some((t) => t.length > 256 || (match === 'fuzzy' && Array.from(t).length > 64))
        )
          throw new SearchLimitError('QUERY_LIMIT');
        const simple = this.groups.length === 1 && terms.length === 1,
          local = simple ? undefined : new Map<string, { score: number; terms: Set<string> }>();
        for (const term of terms) {
          let candidates: string[];
          const edits = new Map<string, number>();
          const key = group.prefix + '\0' + term;
          if (match === 'exact') candidates = [key];
          else {
            candidates = [];
            for (const candidate of state.postings.keys()) {
              if (++scanned > this.limits.scan) throw new SearchLimitError('VOCABULARY_LIMIT');
              if (!candidate.startsWith(group.prefix + '\0')) continue;
              const word = candidate.slice(group.prefix.length + 1);
              const edit = match === 'fuzzy' ? distance(term, word, maxDistance) : 0;
              if (match === 'prefix' ? word.startsWith(term) : edit <= maxDistance) {
                if (++expanded > maxExpansions) throw new SearchLimitError('EXPANSION_LIMIT');
                edits.set(candidate, edit);
                candidates.push(candidate);
              }
            }
            candidates.sort((a, b) => (edits.get(a) ?? 0) - (edits.get(b) ?? 0) || compare(a, b));
          }
          const processed = new Set<string>();
          for (const candidate of candidates) {
            const postings = state.postings.get(candidate);
            if (!postings) continue;
            const idf = Math.log(1 + (this.size - postings.size + 0.5) / (postings.size + 0.5));
            for (const [id, tf] of postings) {
              if (processed.has(id)) continue;
              processed.add(id);
              const score =
                options.algorithm === 'term-frequency'
                  ? tf
                  : idf *
                    ((tf * 2.2) /
                      (tf + 1.2 * (0.25 + (0.75 * (state.lengths.get(id) ?? 0)) / avg)));
              if (simple) {
                let entry = scores.get(id);
                if (!entry) scores.set(id, (entry = { score: 0, matches: new Set() }));
                entry.score += score / (1 + (edits.get(candidate) ?? 0));
                entry.matches.add(i);
              } else {
                let item = local!.get(id);
                if (!item) local!.set(id, (item = { score: 0, terms: new Set() }));
                item.score += score / (1 + (edits.get(candidate) ?? 0));
                item.terms.add(term);
              }
            }
          }
        }
        for (const [id, item] of local ?? [])
          if (item.terms.size === terms.length) {
            let entry = scores.get(id);
            if (!entry) scores.set(id, (entry = { score: 0, matches: new Set() }));
            entry.score += item.score;
            entry.matches.add(i);
          }
      }
    });
    const visible = (doc: T) => {
      if (!options.filter) return true;
      const decision: unknown = options.filter(structuredClone(doc));
      if (typeof decision !== 'boolean') {
        if (decision && typeof (decision as { then?: unknown }).then === 'function')
          void Promise.resolve(decision).catch(() => {});
        throw new TypeError('Search filter must return a synchronous boolean');
      }
      return decision;
    };
    return [...scores]
      .filter(
        ([id, item]) =>
          (options.mode !== 'all' || item.matches.size === raw.length) &&
          matchesSearchFilters(state.documents.get(id)!, filters) &&
          visible(state.documents.get(id)!),
      )
      .sort((a, b) => b[1].score - a[1].score || compare(a[0], b[0]))
      .slice(offset, offset + limit)
      .map(([id, item]) => ({
        document: structuredClone(state.documents.get(id)!),
        score: item.score,
        matches: raw.filter((_, i) => item.matches.has(i)),
      }));
  }
  snapshot(): SearchSnapshot<T>;
  snapshot(options: { version: 2 }): SearchSnapshotV2<T>;
  snapshot(options?: { version: 2 }): SearchSnapshot<T> | SearchSnapshotV2<T> {
    let bytes = 0;
    const documents: T[] = [];
    for (const doc of this.values()) {
      bytes += jsonBytes(doc, this.limits.document);
      if (bytes > this.limits.snapshot) throw new SearchLimitError('DOCUMENT_LIMIT');
      documents.push(doc);
    }
    if (options !== undefined && options.version !== 2)
      throw new TypeError('Unsupported snapshot version');
    const result: SearchSnapshot<T> | SearchSnapshotV2<T> =
      options?.version === 2
        ? { version: 2, configuration: structuredClone(this.configuration), documents }
        : { version: 1, documents };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > this.limits.snapshot)
      throw new SearchLimitError('DOCUMENT_LIMIT');
    return result;
  }
  load(snapshot: SearchSnapshot<T> | SearchSnapshotV2<T>): void {
    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      Object.values(Object.getOwnPropertyDescriptors(snapshot)).some((d) => !('value' in d)) ||
      ![1, 2].includes(snapshot.version) ||
      Reflect.ownKeys(snapshot).some(
        (k) =>
          typeof k !== 'string' ||
          !['version', 'documents', ...(snapshot.version === 2 ? ['configuration'] : [])].includes(
            k,
          ),
      ) ||
      !Array.isArray(snapshot.documents) ||
      snapshot.documents.length > this.maxDocuments
    )
      throw new TypeError('Unsupported search snapshot');
    if (snapshot.version === 2) {
      if (!snapshot.configuration) throw new TypeError('Unsupported search snapshot');
      jsonBytes(snapshot.configuration, 131072);
      if (canonical(snapshot.configuration) !== canonical(this.configuration))
        throw new TypeError('Incompatible search snapshot configuration');
    }
    if (
      Reflect.ownKeys(snapshot.documents).some(
        (k) => typeof k !== 'string' || (k !== 'length' && !/^(0|[1-9][0-9]*)$/.test(k)),
      ) ||
      Object.values(Object.getOwnPropertyDescriptors(snapshot.documents)).some(
        (d) => !('value' in d),
      )
    )
      throw new TypeError('Snapshot accessors forbidden');
    const ids = new Set<string>();
    let bytes = 0;
    for (const doc of snapshot.documents) {
      bytes += jsonBytes(doc, this.limits.document);
      if (bytes > this.limits.snapshot) throw new SearchLimitError('DOCUMENT_LIMIT');
      if (!doc || !Object.hasOwn(doc, 'id') || ids.has(doc.id))
        throw new TypeError('Duplicate snapshot document');
      ids.add(doc.id);
    }
    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > this.limits.snapshot)
      throw new SearchLimitError('DOCUMENT_LIMIT');
    const restored = new SearchIndex<T>(this.options);
    let next = empty<T>();
    for (let i = 0; i < snapshot.documents.length; i += this.limits.batch)
      next = restored.stage(snapshot.documents.slice(i, i + this.limits.batch), next);
    this.state = next;
  }
}
export function bounded(value: number | undefined, fallback: number, max: number) {
  const n = value ?? fallback;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0)
    throw new RangeError('Pagination values must be non-negative finite numbers');
  return Math.min(max, Math.floor(n));
}
export function createSearchIndex<T extends SearchDocument = SearchDocument>(
  options?: SearchIndexOptions<T>,
) {
  return new SearchIndex<T>(options);
}
