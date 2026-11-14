import {
  createSearchIndex,
  type SearchDocument,
  type SearchOptions,
  type SearchIndex,
} from '@zeruxjs/search';

/** Searchable public document whose fields were independently validated from tuples. */
export interface DocsSearchDocument extends SearchDocument {
  /** Public title, displayed as inert text. */
  title: string;
  /** Navigation group label. */
  section: string;
  /** Public documentation version. */
  version: string;
  /** Same-site generated document URL. */
  url: string;
  /** Inert public summary. */
  description: string;
  /** Plain-text searchable body. */
  text: string;
}
let pending: Promise<SearchIndex<DocsSearchDocument>> | undefined;
/** Fetch a compact versioned index and build the workspace search index only on demand.
 *
 * @returns {Promise<object>} Search engine. Reads public document metadata and same-origin static JSON only.
 */
async function engine() {
  pending ??= (async () => {
    /** Exact docs mount scopes index loading; no external search endpoint is selected. */
    const base = document.body.dataset.basePath || '';
    /** Generated search asset identity used for cache busting, separate from page filtering. */
    const version = document.body.dataset.searchVersion || '';
    /** On-demand same-origin static index response; failed loads clear the shared pending promise. */
    const response = await fetch(
      `${base}/assets/search.json?v=${encodeURIComponent(version)}`
    );
    if (!response.ok) {
      throw new Error('Search index unavailable');
    }
    /** Versioned index candidate, checked before constructing the local search engine. */
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== 'object' ||
      !('schema' in data) ||
      !('pages' in data) ||
      !('sections' in data) ||
      data.schema !== 2 ||
      !Array.isArray(data.pages) ||
      !Array.isArray(data.sections)
    ) {
      throw new Error('Invalid search index');
    }
    /** Instance-local bounded search index; no network search or telemetry is activated. */
    const index = createSearchIndex<DocsSearchDocument>({
      fields: ['title', 'section', 'text'],
      weights: { title: 8, section: 3, text: 1 },
      maxDocuments: 10000,
    });
    /** Public page records reconstructed from compact static tuples. */
    const pageRows: Array<[string, string, string, string, string, string]> =
      data.pages.map((row: unknown) => {
        if (
          !Array.isArray(row) ||
          row.length !== 6 ||
          !row.every((value) => typeof value === 'string')
        ) {
          throw new Error('Invalid search page');
        }
        return row as [string, string, string, string, string, string];
      });
    /** Heading tuples validate parent indexes and scalar labels before index construction. */
    const sectionRows: Array<[number, string, string, string]> =
      data.sections.map((row: unknown) => {
        if (
          !Array.isArray(row) ||
          row.length !== 4 ||
          !Number.isSafeInteger(row[0]) ||
          row[0] < 0 ||
          !row.slice(1).every((value) => typeof value === 'string')
        ) {
          throw new Error('Invalid search section');
        }
        return row as [number, string, string, string];
      });
    /** Typed public records supplied to the local index after tuple validation. */
    const pages = pageRows.map(
      ([title, section, version, url, description, text], i) => ({
        id: 'page-' + i,
        title,
        section,
        version,
        url,
        description,
        text,
      })
    );
    for (const page of pages) {
      index.add(page);
    }
    sectionRows.forEach(([parent, title, anchor, text], i) => {
      /** Parent page supplies version/route metadata for a heading-local search record. */
      const page = pages[parent];
      if (!page) {
        return;
      }
      index.add({
        ...page,
        id: 'heading-' + i,
        title,
        section: `${page.title} / ${page.section}`,
        url: page.url + '#' + anchor,
        text,
      });
    });
    return index;
  })().catch((error) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
/** Query the local package search engine.
 * @param {string} query Bounded user query.
 * @param {string} version Documentation version.
 * @returns {Promise<object[]>} Ranked public topics. No telemetry. */
export async function searchDocs(
  query: string,
  version: string
): Promise<DocsSearchDocument[]> {
  /** Instance-local bounded search index; no network search or telemetry is activated. */
  const index = await engine();
  /** Bounded user terms with common question filler removed; no regular expression is compiled. */
  const words = query
    .slice(0, 120)
    .toLowerCase()
    .split(/\s+/)
    .filter(
      (word) =>
        ![
          'how',
          'do',
          'i',
          'the',
          'a',
          'an',
          'is',
          'my',
          'to',
          'for',
          'can',
        ].includes(word)
    );
  /** Meaningful term sequence, retaining bounded original text when every word was filler. */
  const normalized = words.join(' ') || query.slice(0, 120);
  /** Fixed result/prefix policy with explicit current-version filtering. */
  const options: SearchOptions = {
    limit: 12,
    prefix: true,
    filter: (document: SearchDocument) => document.version === version,
  };
  /** All-term results take precedence; broader any-term matching is an explicit fallback. */
  const exact = index.search(normalized, { ...options, mode: 'all' });
  return (
    exact.length ? exact : index.search(normalized, { ...options, mode: 'any' })
  ).map((result) => result.document);
}
