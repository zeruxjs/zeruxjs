export interface SearchDocument {
  /** Stable nonempty document identity; add/update replace the existing record with the same ID. */
  id: string;
  /** Required searchable text; other own fields may carry inert JSON metadata. */
  text: string;
  [key: string]: unknown;
}
export interface SearchResult<T> {
  /** Independent result document clone; mutating it does not mutate the index. */
  document: T;
  /** Algorithm-specific ranking score; scores are not comparable across engines. */
  score: number;
  /** Matched normalized terms, not raw snippets or executable query expressions. */
  matches: string[];
}
export interface SearchAnalyzer {
  /** Unicode normalization form; defaults to NFKC, with explicit none to disable. */
  normalization?: 'none' | 'NFC' | 'NFD' | 'NFKC' | 'NFKD';
  /** Preserve case when true; analyzer defaults false, filter comparisons default true. */
  caseSensitive?: boolean;
  /** Explicit canonical locale; omitted analyzer locale captures the runtime effective locale. */
  locale?: string;
  /** Preserve combining marks by default or explicitly fold them after NFD normalization. */
  diacritics?: 'preserve' | 'fold';
  /** Include trailing combining marks in tokens; defaults false for compatibility. */
  includeMarks?: boolean;
}
export interface SearchFilter {
  /** Own document field to compare; prototype-sensitive and malformed names reject. */
  field: string;
  /** Allowlisted literal comparison; no raw DSL or user regular expression. */
  operator:
    | 'eq'
    | 'neq'
    | 'in'
    | 'gte'
    | 'lte'
    | 'exists'
    | 'contains'
    | 'prefix';
  /** Scalar operand, or bounded scalar array for in; exists must omit it. */
  value?:
    | string
    | number
    | boolean
    | null
    | readonly (string | number | boolean | null)[];
  /** Preserve case when true; analyzer defaults false, filter comparisons default true. */
  caseSensitive?: boolean;
}
export interface SearchOptions {
  /** Maximum result page length; validated against index query limits. */
  limit?: number;
  /** Number of ranked results to skip within the bounded result window. */
  offset?: number;
  /** Require all analyzed clauses or accept any; defaults to any. */
  mode?: 'all' | 'any';
  /** Legacy prefix matching option; preserved alongside explicit match mode. */
  prefix?: boolean;
  /** Trusted synchronous visibility predicate over clones; not a tenant isolation boundary. */
  filter?: (document: SearchDocument) => boolean;
  /** Bounded structured scalar comparisons; separate from the trusted visibility predicate. */
  filters?: readonly SearchFilter[];
  /** Explicit exact, prefix or bounded fuzzy matching policy. */
  match?: 'exact' | 'prefix' | 'fuzzy';
  /** Finite edit-distance/expansion settings; never an unbounded vocabulary search. */
  fuzzy?: {
    maxDistance?:
      | 1
      | 2; /** Maximum expanded terms accepted for prefix/fuzzy lookup. */
    maxExpansions?: number;
  };
  /** Explicit BM25 or term-frequency scoring; defaults retain BM25. */
  algorithm?: 'bm25' | 'term-frequency';
}
export interface SearchIndexOptions<T> {
  /** Ordered searchable fields; order is part of V2 configuration compatibility. */
  fields?: (keyof T & string)[];
  /** Nonnegative per-field ranking weights captured in configuration snapshots; zero is supported. */
  weights?: Partial<Record<keyof T & string, number>>;
  /** Bounded analyzer-normalized stopwords omitted from indexed/query terms. */
  stopWords?: Iterable<string>;
  /** Document cap; legacy default Infinity requires an explicit finite production policy. */
  maxDocuments?: number;
  /** Default field analyzer; individual field overrides remain explicit. */
  analyzer?: SearchAnalyzer;
  /** Resolved per-field analyzer policies in snapshots; optional overrides in index options. */
  analyzers?: Partial<Record<keyof T & string, SearchAnalyzer>>;
  /** Maximum inert serialized document bytes; defaults to 1 MiB. */
  maxDocumentBytes?: number;
  /** Maximum documents staged in one atomic mutation batch. */
  maxBatchSize?: number;
  /** Maximum aggregate document bytes staged in one batch. */
  maxBatchBytes?: number;
  /** Maximum analyzer/term posting keys retained by the index. */
  maxVocabulary?: number;
  /** Maximum vocabulary keys inspected by bounded expansion. */
  maxVocabularyScan?: number;
  /** Maximum analyzed query clauses accepted per call. */
  maxQueryTerms?: number;
  /** Maximum query UTF-16 code units accepted per call. */
  maxQueryLength?: number;
  /** Maximum expanded terms accepted for prefix/fuzzy lookup. */
  maxExpansions?: number;
  /** Maximum serialized snapshot bytes; defaults to 16 MiB. */
  maxSnapshotBytes?: number;
}
export interface SearchSnapshot<T> {
  /** Snapshot schema discriminator; V1 uses receiving configuration, V2 verifies recorded configuration. */
  version: 1;
  /** Ordered inert document records validated completely before a staged replacement. */
  documents: T[];
}
export interface SearchSnapshotV2<T> {
  /** Snapshot schema discriminator; V1 uses receiving configuration, V2 verifies recorded configuration. */
  version: 2;
  /** Captured analysis/ranking policy; V2 import requires compatible receiver settings. */
  configuration: SearchConfiguration;
  /** Ordered inert document records validated completely before a staged replacement. */
  documents: T[];
}
export interface SearchConfiguration {
  /** Ordered searchable fields; order is part of V2 configuration compatibility. */
  fields: string[];
  /** Nonnegative per-field ranking weights captured in configuration snapshots; zero is supported. */
  weights: Record<string, number>;
  /** Resolved per-field analyzer policies in snapshots; optional overrides in index options. */
  analyzers: Record<
    string,
    Required<Omit<SearchAnalyzer, 'locale'>> & {
      /** Explicit canonical locale; omitted analyzer locale captures the runtime effective locale. */
      locale?: string;
    }
  >;
  /** Bounded analyzer-normalized stopwords omitted from indexed/query terms. */
  stopWords: string[];
}
/** Public bounded-resource failure with a fixed category and no retained private values. */
export class SearchLimitError extends RangeError {
  /** Create a fixed-category limit error without retaining document or query values.
 * @param {| 'QUERY_LIMIT'
      | 'VOCABULARY_LIMIT'
      | 'EXPANSION_LIMIT'
      | 'BATCH_LIMIT'
      | 'DOCUMENT_LIMIT'} code - Bounded public category identifying the exhausted budget.
 */
  constructor(
    /** Fixed exhausted-budget category; excludes private query/document values. */
    readonly code:
      | 'QUERY_LIMIT'
      | 'VOCABULARY_LIMIT'
      | 'EXPANSION_LIMIT'
      | 'BATCH_LIMIT'
      | 'DOCUMENT_LIMIT'
  ) {
    super(`Search limit exceeded (${code})`);
    this.name = 'SearchLimitError';
  }
}
