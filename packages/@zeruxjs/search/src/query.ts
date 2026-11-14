import { tokenize } from './tokenize.js';
import type { SearchAnalyzer, SearchFilter, SearchDocument } from './types.js';
/** Parse bounded literal query terms with analyzer-consistent stopword removal. No client regular expressions or executable query language is accepted.
 * @param {string} query - Query text up to 4096 UTF-16 code units; invalid input throws.
 * @param {Iterable<string>} stopWords - At most 10000 bounded stopwords, normalized with the same analyzer.
 * @param {SearchAnalyzer} analyzer - Explicit Unicode analysis policy; omission preserves legacy defaults.
 * @returns {string[]} At most 64 unique ordered terms, each at most 256 code units.
 */
export function parseSearchQuery(
  query: string,
  stopWords: Iterable<string> = [],
  analyzer: SearchAnalyzer = {}
): string[] {
  if (typeof query !== 'string' || query.length > 4096) {
    throw new RangeError('Query length limit');
  }
  /** Analyzer-normalized stopwords; the same analyzer is applied to query terms. */
  const blocked = new Set<string>();
  let n = 0;
  // Normalize each bounded stopword using exactly the query analyzer policy.
  for (const word of stopWords) {
    if (++n > 10000 || typeof word !== 'string' || word.length > 256) {
      throw new RangeError('Stopword limit');
    }
    // A stopword may tokenize into several terms; exclude each normalized term.
    for (const term of tokenize(word, analyzer)) {
      blocked.add(term);
    }
  }
  /** Unique ordered terms remaining after stopword removal and before term-count validation. */
  const result = [
    ...new Set(tokenize(query, analyzer).filter((t) => !blocked.has(t))),
  ];
  if (result.length > 64 || result.some((t) => t.length > 256)) {
    throw new RangeError('Query term limit');
  }
  return result;
}
/** Validate bounded structured filter clauses and clone them before use. Filters express matching, not tenant authorization.
 * @param {readonly SearchFilter[]} filters - At most 16 allowlisted field/operator clauses with bounded scalar values.
 * @returns {readonly SearchFilter[]} Independent validated clauses; unsupported shapes, operators and values throw.
 */
export function validateSearchFilters(
  filters: readonly SearchFilter[] = []
): readonly SearchFilter[] {
  if (!Array.isArray(filters) || filters.length > 16) {
    throw new RangeError('Filter limit');
  }
  /** Finite JSON scalar predicate; filters never accept executable expressions or regular expressions.
   * @param {unknown} v - Untrusted filter operand.
   * @returns {boolean} Whether the operand is a supported finite bounded scalar.
   */
  const scalar = (v: unknown) =>
    v === null ||
    typeof v === 'boolean' ||
    (typeof v === 'number' && Number.isFinite(v)) ||
    (typeof v === 'string' && v.length <= 1024);
  // Validate all clauses before cloning or evaluating a document.
  for (const f of filters) {
    if (
      !f ||
      Object.keys(f).some(
        (k) => !['field', 'operator', 'value', 'caseSensitive'].includes(k)
      ) ||
      typeof f.field !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_-]{0,95}$/.test(f.field) ||
      ['__proto__', 'constructor', 'prototype'].includes(f.field) ||
      ![
        'eq',
        'neq',
        'in',
        'gte',
        'lte',
        'exists',
        'contains',
        'prefix',
      ].includes(f.operator) ||
      (f.caseSensitive !== undefined && typeof f.caseSensitive !== 'boolean')
    ) {
      throw new TypeError('Invalid search filter');
    }
    if (f.operator === 'exists') {
      if (f.value !== undefined) {
        throw new TypeError('Exists filter has no value');
      }
    } else if (f.operator === 'in') {
      if (
        !Array.isArray(f.value) ||
        f.value.length > 32 ||
        f.value.some((v: unknown) => !scalar(v))
      ) {
        throw new TypeError('Invalid in filter');
      }
    } else if (
      !scalar(f.value) ||
      (['gte', 'lte'].includes(f.operator) && typeof f.value !== 'number') ||
      (['contains', 'prefix'].includes(f.operator) &&
        typeof f.value !== 'string')
    ) {
      throw new TypeError('Invalid filter value');
    }
  }
  return structuredClone(filters);
}
/** Evaluate all validated filter clauses against own document fields. Missing values remain undefined and strings are case-sensitive unless explicitly disabled.
 * @param {SearchDocument} document - Borrowed inert document; comparison does not mutate it.
 * @param {readonly SearchFilter[]} filters - Previously validated clauses; every clause must match.
 * @returns {boolean} Whether all clauses match under their declared scalar comparison semantics.
 */
export function matchesSearchFilters(
  document: SearchDocument,
  filters: readonly SearchFilter[]
): boolean {
  return filters.every((f) => {
    /** Only own document fields participate; inherited properties do not count as present. */
    const own = Object.hasOwn(document, f.field);
    /** Own field value, or undefined for a missing field. */
    const raw = own ? document[f.field] : undefined;
    /** Explicit case-insensitive string comparison; numeric and missing values retain their types.
     * @param {unknown} v - Document value or filter operand under the same clause policy.
     * @returns {unknown} Lowercased string only when case-insensitive comparison was requested.
     */
    const fold = (v: unknown) =>
      f.caseSensitive === false && typeof v === 'string' ? v.toLowerCase() : v;
    /** Document value after the selected string comparison policy. */
    const value = fold(raw);
    /** Filter operand under the same comparison policy as document values. */
    const expected = fold(f.value);
    switch (f.operator) {
      case 'exists':
        return own && raw !== undefined;
      case 'eq':
        return value === expected;
      case 'neq':
        return value !== expected;
      case 'in':
        return (f.value as readonly unknown[]).some((v) => value === fold(v));
      case 'gte':
        return typeof value === 'number' && value >= (expected as number);
      case 'lte':
        return typeof value === 'number' && value <= (expected as number);
      case 'contains':
        return typeof value === 'string' && value.includes(expected as string);
      case 'prefix':
        return (
          typeof value === 'string' && value.startsWith(expected as string)
        );
    }
  });
}
/** Escape unmatched text and highlight bounded literal matches. The default wrapper escapes matched text; a custom wrapper is trusted host HTML and owns its escaping policy.
 * @param {string} text - Original text bounded to 1 Mi UTF-16 code units.
 * @param {Iterable<string>} terms - At most 64 literal terms of at most 256 code units.
 * @param {(match: string) => string} wrap - Trusted host callback; defaults to an escaped mark element.
 * @returns {string} Escaped HTML with wrapper output at matching spans; invalid budgets throw.
 */
export function highlightMatches(
  text: string,
  terms: Iterable<string>,
  wrap: (match: string) => string = (m) => `<mark>${escapeHtml(m)}</mark>`
): string {
  if (
    typeof text !== 'string' ||
    text.length > 1024 * 1024 ||
    typeof wrap !== 'function'
  ) {
    throw new RangeError('Highlighter input limit');
  }
  /** Validated nonempty literal terms collected within the highlighter term budget. */
  const values: string[] = [];
  let count = 0;
  // Accumulate one analyzed term at a time while deduplicating expanded document matches.
  for (const term of terms) {
    if (++count > 64 || typeof term !== 'string' || term.length > 256) {
      throw new RangeError('Highlight term limit');
    }
    if (term) {
      values.push(term);
    }
  }
  /** Unique literal terms longest first to prefer complete overlapping matches. */
  const tokens = [...new Set(values)].sort((a, b) => b.length - a.length);
  if (!tokens.length) {
    return escapeHtml(text);
  }
  /** Bounded literal alternation; metacharacters are escaped before constructing the matcher. */
  const re = new RegExp(
    tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'giu'
  );
  let output = '',
    last = 0;
  // Escape every unmatched original span while delegating matched spans to the declared wrapper.
  for (const match of text.matchAll(re)) {
    /** Current original-text offset; unmatched slices are escaped independently. */
    const at = match.index;
    output += escapeHtml(text.slice(last, at)) + wrap(match[0]);
    last = at + match[0].length;
  }
  return output + escapeHtml(text.slice(last));
}
/** Encode text for HTML content and quoted attributes; this is not a script, CSS or URL policy.
 * @param {string} input - Literal text to encode without evaluating markup.
 * @returns {string} Text with ampersands, angle brackets and quotes encoded.
 */
function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
