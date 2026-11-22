import { SearchIndex, type SearchDocument } from '@zeruxjs/search';
import type { DocumentationCatalog } from './index.js';

/** Portable public-only search record; contains no image/private registry metadata. */
export interface DocumentationSearchDocument extends SearchDocument {
  /** Canonical public URL is the immutable per-version search identity. */
  id: string;
  /** Authored public page title. */
  title: string;
  /** Expanded Markdown text; result consumers must render as text, never raw HTML. */
  text: string;
  /** Authored summary, not generated personal data. */
  description: string;
  /** Plain searchable keyword string. */
  keywords: string;
  /** Owning exact version. */
  version: string;
  /** Canonical local navigation URL. */
  url: string;
}
/** Build an owned, bounded public search index without a remote provider or private-page fallback.
 * @param {DocumentationCatalog} catalog - Immutable host catalog; private pages are always excluded.
 * @param {{version?:string;limit?:number}} [options] - Exact version (default latest) and maximum returned rows (default ten, ceiling fifty).
 * @returns {{search:(query:string)=>import('@zeruxjs/search').SearchResult<DocumentationSearchDocument>[];destroy:()=>void}} Local query and idempotent index cleanup.
 */
export function createDocumentationSearch(
  catalog: DocumentationCatalog,
  options: { version?: string; limit?: number } = {}
) {
  /** Separate per-release indexes prevent historical terms leaking into current search results. */
  const version = options.version ?? catalog.latest;
  /** Result budgets are fixed by the host, never overridden by query text. */
  const limit = options.limit ?? 10;
  if (
    !catalog.versions.includes(version) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    throw new TypeError('Invalid documentation search configuration');
  }
  /** Reuse the existing search owner and Unicode/ranking implementation. */
  const index = new SearchIndex<DocumentationSearchDocument>({
    fields: ['title', 'description', 'keywords', 'text'],
    weights: { title: 5, description: 2, keywords: 3, text: 1 },
    maxDocuments: 5000,
    maxBatchSize: 5000,
    maxBatchBytes: 67_108_864,
    maxDocumentBytes: 8_388_608,
    analyzer: { locale: 'en', normalization: 'NFKC' },
  });
  /** Compile one staged batch rather than repeatedly cloning a growing index. */
  const documents: DocumentationSearchDocument[] = [];
  for (const page of catalog.pages(version)) {
    if (page.access !== 'public' || page.searchable === false) {
      continue;
    }
    documents.push({
      id: page.url,
      title: page.title,
      text: page.body,
      description: page.description ?? '',
      keywords: (page.keywords ?? []).join(' '),
      version,
      url: page.url,
    });
  }
  index.addMany(documents);
  let disposed = false;
  return {
    /** Search bounded literal terms; no remote calls, regex/DSL interpretation or automatic telemetry.
     * @param {string} query - At most 512 characters and sixteen whitespace-separated terms.
     * @returns {import('@zeruxjs/search').SearchResult<DocumentationSearchDocument>[]} Detached ranked results; title weight is explicit.
     */
    search(query: string) {
      if (disposed) {
        throw new Error('Documentation search disposed');
      }
      if (
        typeof query !== 'string' ||
        query.length > 512 ||
        query.trim().split(/\s+/u).length > 16
      ) {
        throw new RangeError('Documentation query limit');
      }
      if (!query.trim()) {
        return [];
      }
      return index.search(query, { limit });
    },
    /** Release this scope's index; a later query rejects rather than resurrecting state.
     * @returns {void} Synchronous idempotent cleanup; no borrowed host index is destroyed.
     */
    destroy() {
      if (!disposed) {
        disposed = true;
        index.clear();
      }
    },
  };
}
