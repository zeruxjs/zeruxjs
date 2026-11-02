export interface SearchDocument {
  id: string;
  text: string;
  [key: string]: unknown;
}
export interface SearchResult<T> {
  document: T;
  score: number;
  matches: string[];
}
export interface SearchAnalyzer {
  normalization?: 'none' | 'NFC' | 'NFD' | 'NFKC' | 'NFKD';
  caseSensitive?: boolean;
  locale?: string;
  diacritics?: 'preserve' | 'fold';
  includeMarks?: boolean;
}
export interface SearchFilter {
  field: string;
  operator: 'eq' | 'neq' | 'in' | 'gte' | 'lte' | 'exists' | 'contains' | 'prefix';
  value?: string | number | boolean | null | readonly (string | number | boolean | null)[];
  caseSensitive?: boolean;
}
export interface SearchOptions {
  limit?: number;
  offset?: number;
  mode?: 'all' | 'any';
  prefix?: boolean;
  filter?: (document: SearchDocument) => boolean;
  filters?: readonly SearchFilter[];
  match?: 'exact' | 'prefix' | 'fuzzy';
  fuzzy?: { maxDistance?: 1 | 2; maxExpansions?: number };
  algorithm?: 'bm25' | 'term-frequency';
}
export interface SearchIndexOptions<T> {
  fields?: (keyof T & string)[];
  weights?: Partial<Record<keyof T & string, number>>;
  stopWords?: Iterable<string>;
  maxDocuments?: number;
  analyzer?: SearchAnalyzer;
  analyzers?: Partial<Record<keyof T & string, SearchAnalyzer>>;
  maxDocumentBytes?: number;
  maxBatchSize?: number;
  maxBatchBytes?: number;
  maxVocabulary?: number;
  maxVocabularyScan?: number;
  maxQueryTerms?: number;
  maxQueryLength?: number;
  maxExpansions?: number;
  maxSnapshotBytes?: number;
}
export interface SearchSnapshot<T> {
  version: 1;
  documents: T[];
}
export interface SearchSnapshotV2<T> {
  version: 2;
  configuration: SearchConfiguration;
  documents: T[];
}
export interface SearchConfiguration {
  fields: string[];
  weights: Record<string, number>;
  analyzers: Record<string, Required<Omit<SearchAnalyzer, 'locale'>> & { locale?: string }>;
  stopWords: string[];
}
export class SearchLimitError extends RangeError {
  constructor(
    readonly code:
      | 'QUERY_LIMIT'
      | 'VOCABULARY_LIMIT'
      | 'EXPANSION_LIMIT'
      | 'BATCH_LIMIT'
      | 'DOCUMENT_LIMIT',
  ) {
    super(`Search limit exceeded (${code})`);
    this.name = 'SearchLimitError';
  }
}
