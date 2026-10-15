export interface SearchDocument { id: string; text: string; [key: string]: unknown }
export interface SearchResult<T> { document: T; score: number; matches: string[] }
export interface SearchOptions { limit?: number; offset?: number; mode?: 'all' | 'any'; prefix?: boolean; filter?: (document: SearchDocument) => boolean }
export interface SearchIndexOptions<T> { fields?: (keyof T & string)[]; weights?: Partial<Record<keyof T & string, number>>; stopWords?: Iterable<string>; maxDocuments?: number }
export interface SearchSnapshot<T> { version: 1; documents: T[] }
