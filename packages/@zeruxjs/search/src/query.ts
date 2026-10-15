import { tokenize } from './tokenize.js';
/** Normalize query text once; useful for live search UIs and highlighting. */
export function parseSearchQuery(query: string, stopWords: Iterable<string> = []): string[] {
  const blocked = new Set([...stopWords].flatMap(tokenize));
  return [...new Set(tokenize(query).filter(term => !blocked.has(term)))];
}
/** Escape special regex syntax before using terms in a highlighter. */
export function highlightMatches(text: string, terms: Iterable<string>, wrap: (match: string) => string = m => `<mark>${escapeHtml(m)}</mark>`): string {
  const tokens = [...new Set([...terms].filter(Boolean))].sort((a,b) => b.length - a.length);
  if (!tokens.length) return escapeHtml(text);
  const re = new RegExp(tokens.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'giu');
  let output = ''; let last=0;
  for (const match of text.matchAll(re)) { const at = match.index; output += escapeHtml(text.slice(last,at)) + wrap(match[0]); last = at + match[0].length; }
  return output + escapeHtml(text.slice(last));
}
function escapeHtml(input:string):string {return input.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
