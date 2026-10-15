import { tokenize } from './tokenize.js';
import type { SearchDocument, SearchResult, SearchOptions, SearchIndexOptions, SearchSnapshot } from './types.js';
export class SearchIndex<T extends SearchDocument = SearchDocument> {
  private documents = new Map<string, T>();
  private postings = new Map<string, Map<string, number>>();
  private lengths = new Map<string, number>();
  private termsById = new Map<string, Set<string>>();
  private readonly fields: string[];
  private readonly weights: Record<string,number>;
  private readonly stopWords: Set<string>;
  private readonly maxDocuments: number;
  constructor(options: SearchIndexOptions<T> = {}) {
    this.fields = [...new Set<string>(options.fields?.length ? options.fields : ['text'])];
    this.weights = Object.fromEntries(this.fields.map(field => [field, Number(options.weights?.[field as keyof T & string] ?? 1)]));
    if (Object.values(this.weights).some(w => !Number.isFinite(w) || w < 0)) throw new RangeError('Weights must be finite non-negative numbers');
    this.stopWords = new Set([...options.stopWords ?? []].flatMap(tokenize));
    this.maxDocuments = options.maxDocuments ?? Infinity;
    if (!(this.maxDocuments > 0) || (this.maxDocuments !== Infinity && !Number.isSafeInteger(this.maxDocuments))) throw new RangeError('maxDocuments must be positive');
  }
  add(doc: T): void {
    if (!doc || typeof doc.id !== 'string' || !doc.id || typeof doc.text !== 'string') throw new TypeError('Document requires id and text');
    if (!this.documents.has(doc.id) && this.size >= this.maxDocuments) throw new RangeError('Search index document limit exceeded');
    const frequencies = new Map<string,number>(); let length = 0;
    for (const field of this.fields) {
      const value = doc[field]; if (typeof value !== 'string') continue;
      const weight = this.weights[field];
      for (const term of tokenize(value)) {
        if (this.stopWords.has(term)) continue;
        frequencies.set(term, (frequencies.get(term) ?? 0) + weight); length += weight;
      }
    }
    this.remove(doc.id);
    const stored = structuredClone(doc); this.documents.set(doc.id, stored as T);
    this.lengths.set(doc.id, length); this.termsById.set(doc.id, new Set(frequencies.keys()));
    for (const [term, frequency] of frequencies) {
      let ids = this.postings.get(term); if (!ids) this.postings.set(term, ids = new Map());
      ids.set(doc.id, frequency);
    }
  }
  addMany(documents: Iterable<T>): void { for (const doc of documents) this.add(doc); }
  update(doc: T): void { this.add(doc); }
  get(id: string): T | undefined { const found = this.documents.get(id); return found ? structuredClone(found) : undefined; }
  has(id: string): boolean { return this.documents.has(id); }
  remove(id: string): boolean {
    if (!this.documents.has(id)) return false;
    for (const term of this.termsById.get(id) ?? []) { const ids = this.postings.get(term); ids?.delete(id); if (!ids?.size) this.postings.delete(term); }
    this.termsById.delete(id); this.lengths.delete(id); return this.documents.delete(id);
  }
  clear(): void { this.documents.clear(); this.postings.clear(); this.lengths.clear(); this.termsById.clear(); }
  get size(): number { return this.documents.size; }
  get vocabularySize(): number { return this.postings.size; }
  *values(): IterableIterator<T> { for (const doc of this.documents.values()) yield structuredClone(doc); }
  suggest(prefix: string, limit = 10): string[] {
    const normalized = tokenize(prefix).at(-1); if (!normalized) return [];
    const n = bounded(limit, 10, 100); return [...this.postings.keys()].filter(w => w.startsWith(normalized)).sort((a,b) => (this.postings.get(b)!.size - this.postings.get(a)!.size) || a.localeCompare(b)).slice(0,n);
  }
  search(query: string, options: SearchOptions = {}): SearchResult<T>[] {
    const terms = [...new Set(tokenize(query).filter(term => !this.stopWords.has(term)))];
    if (!terms.length) return [];
    const limit = bounded(options.limit, 20, 1000), offset = bounded(options.offset, 0, 1000000);
    const scores = new Map<string,{ score:number; matches:Set<string> }>();
    const avgLength = [...this.lengths.values()].reduce((sum,n) => sum+n,0) / Math.max(1,this.size) || 1;
    for (const term of terms) {
      const candidates = options.prefix ? [...this.postings.keys()].filter(key => key.startsWith(term)) : [term];
      const processed = new Set<string>();
      for (const candidate of candidates) {
        const postings = this.postings.get(candidate); if (!postings) continue;
        const idf = Math.log(1 + (this.size - postings.size + .5) / (postings.size + .5));
        for (const [id, tf] of postings) {
          if (processed.has(id)) continue; processed.add(id);
          const docLength = this.lengths.get(id) ?? 0;
          const score = idf * (tf * 2.2 / (tf + 1.2 * (.25 + .75 * docLength / avgLength)));
          let entry = scores.get(id); if (!entry) scores.set(id, entry = { score: 0, matches: new Set() });
          entry.score += score; entry.matches.add(term);
        }
      }
    }
    return [...scores].filter(([id,entry]) => (options.mode !== 'all' || entry.matches.size === terms.length) && (!options.filter || options.filter(this.documents.get(id)!)))
      .sort((a,b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
      .slice(offset, offset + limit).map(([id,entry]) => ({ document: structuredClone(this.documents.get(id)!), score: entry.score, matches: terms.filter(term => entry.matches.has(term)) }));
  }
  snapshot(): SearchSnapshot<T> { return { version: 1, documents: [...this.documents.values()].map(doc => structuredClone(doc)) }; }
  load(snapshot: SearchSnapshot<T>): void {
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.documents) || snapshot.documents.length > this.maxDocuments) throw new TypeError('Unsupported search snapshot');
    const restored = new SearchIndex<T>({fields: this.fields as (keyof T & string)[], weights: this.weights as Partial<Record<keyof T & string,number>>,stopWords:this.stopWords,maxDocuments:this.maxDocuments});
    restored.addMany(snapshot.documents); this.clear(); this.addMany(restored.values());
  }
}
export function bounded(value: number | undefined, fallback: number, max: number): number {
  const v = value ?? fallback; if (!Number.isFinite(v) || v < 0) throw new RangeError('Pagination values must be non-negative finite numbers');
  return Math.min(max, Math.floor(v));
}
export function createSearchIndex<T extends SearchDocument = SearchDocument>(options?: SearchIndexOptions<T>): SearchIndex<T> { return new SearchIndex<T>(options); }
