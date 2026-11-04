import { tokenize } from './tokenize.js';
import type { SearchAnalyzer, SearchFilter, SearchDocument } from './types.js';
/** Bounded literal terms; no user regular expressions or executable query language. */
export function parseSearchQuery(
  query: string,
  stopWords: Iterable<string> = [],
  analyzer: SearchAnalyzer = {},
): string[] {
  if (typeof query !== 'string' || query.length > 4096) throw new RangeError('Query length limit');
  const blocked = new Set<string>();
  let n = 0;
  for (const word of stopWords) {
    if (++n > 10000 || typeof word !== 'string' || word.length > 256)
      throw new RangeError('Stopword limit');
    for (const term of tokenize(word, analyzer)) blocked.add(term);
  }
  const result = [...new Set(tokenize(query, analyzer).filter((t) => !blocked.has(t)))];
  if (result.length > 64 || result.some((t) => t.length > 256))
    throw new RangeError('Query term limit');
  return result;
}
export function validateSearchFilters(
  filters: readonly SearchFilter[] = [],
): readonly SearchFilter[] {
  if (!Array.isArray(filters) || filters.length > 16) throw new RangeError('Filter limit');
  const scalar = (v: unknown) =>
    v === null ||
    typeof v === 'boolean' ||
    (typeof v === 'number' && Number.isFinite(v)) ||
    (typeof v === 'string' && v.length <= 1024);
  for (const f of filters) {
    if (
      !f ||
      Object.keys(f).some((k) => !['field', 'operator', 'value', 'caseSensitive'].includes(k)) ||
      typeof f.field !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_-]{0,95}$/.test(f.field) ||
      ['__proto__', 'constructor', 'prototype'].includes(f.field) ||
      !['eq', 'neq', 'in', 'gte', 'lte', 'exists', 'contains', 'prefix'].includes(f.operator) ||
      (f.caseSensitive !== undefined && typeof f.caseSensitive !== 'boolean')
    )
      throw new TypeError('Invalid search filter');
    if (f.operator === 'exists') {
      if (f.value !== undefined) throw new TypeError('Exists filter has no value');
    } else if (f.operator === 'in') {
      if (
        !Array.isArray(f.value) ||
        f.value.length > 32 ||
        f.value.some((v: unknown) => !scalar(v))
      )
        throw new TypeError('Invalid in filter');
    } else if (
      !scalar(f.value) ||
      (['gte', 'lte'].includes(f.operator) && typeof f.value !== 'number') ||
      (['contains', 'prefix'].includes(f.operator) && typeof f.value !== 'string')
    )
      throw new TypeError('Invalid filter value');
  }
  return structuredClone(filters);
}
export function matchesSearchFilters(
  document: SearchDocument,
  filters: readonly SearchFilter[],
): boolean {
  return filters.every((f) => {
    const own = Object.hasOwn(document, f.field),
      raw = own ? document[f.field] : undefined,
      fold = (v: unknown) =>
        f.caseSensitive === false && typeof v === 'string' ? v.toLowerCase() : v,
      value = fold(raw),
      expected = fold(f.value);
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
        return typeof value === 'string' && value.startsWith(expected as string);
    }
  });
}
/** Default output is escaped. A custom wrapper is trusted host HTML, never query data. */
export function highlightMatches(
  text: string,
  terms: Iterable<string>,
  wrap: (match: string) => string = (m) => `<mark>${escapeHtml(m)}</mark>`,
): string {
  if (typeof text !== 'string' || text.length > 1024 * 1024 || typeof wrap !== 'function')
    throw new RangeError('Highlighter input limit');
  const values: string[] = [];
  let count = 0;
  for (const term of terms) {
    if (++count > 64 || typeof term !== 'string' || term.length > 256)
      throw new RangeError('Highlight term limit');
    if (term) values.push(term);
  }
  const tokens = [...new Set(values)].sort((a, b) => b.length - a.length);
  if (!tokens.length) return escapeHtml(text);
  const re = new RegExp(
    tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'giu',
  );
  let output = '',
    last = 0;
  for (const match of text.matchAll(re)) {
    const at = match.index;
    output += escapeHtml(text.slice(last, at)) + wrap(match[0]);
    last = at + match[0].length;
  }
  return output + escapeHtml(text.slice(last));
}
function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
