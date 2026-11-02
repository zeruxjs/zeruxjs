import { stripVTControlCharacters } from 'node:util';
/** Remove terminal escape sequences and controls, retaining ordinary LF/tab layout. */
export function stripTerminalCodes(text: string): string {
  return stripVTControlCharacters(text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}
export function formatError(error: unknown): string {
  return stripTerminalCodes(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
}
/** Bounded, deterministic typo hints; never automatically execute the suggestion. */
export function suggest(value: string, candidates: readonly string[]): string {
  if (value.length > 128) return '';
  const scored = [...new Set(candidates)].sort().slice(0, 256).map(candidate => {
    let row = Array.from({ length: candidate.length + 1 }, (_, index) => index);
    for (let i = 0; i < value.length; i++) {
      const next = [i + 1];
      for (let j = 0; j < candidate.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (value[i] === candidate[j] ? 0 : 1)));
      row = next;
    }
    return { candidate, distance: row[candidate.length] };
  }).filter(item => item.distance <= (value.length < 5 ? 1 : 2)).sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate));
  return scored.length ? ` Did you mean ${scored.slice(0, 3).map(item => item.candidate).join(', ')}?` : '';
}
