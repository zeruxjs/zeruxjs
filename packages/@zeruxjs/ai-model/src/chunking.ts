import type { KnowledgeDocument } from './types.js';
export interface ChunkingOptions { maxCharacters?: number; overlapCharacters?: number; maxChunks?: number }
/** Unicode-safe approximate character chunks with stable deterministic IDs. */
export function chunkDocument(document: KnowledgeDocument, options: ChunkingOptions = {}): KnowledgeDocument[] {
  if (!document || typeof document.id !== 'string' || !document.id || typeof document.text !== 'string' || !document.text.trim()) throw new TypeError('Invalid document');
  const max = options.maxCharacters ?? 1600, overlap = options.overlapCharacters ?? 200, cap = options.maxChunks ?? 1000;
  if (!Number.isSafeInteger(max) || max < 32 || max > 100000 || !Number.isSafeInteger(overlap) || overlap < 0 || overlap * 2 >= max || !Number.isSafeInteger(cap) || cap < 1 || cap > 10000) throw new RangeError('Invalid chunking configuration');
  const chars = Array.from(document.text);
  const chunks: KnowledgeDocument[] = [];
  for (let start = 0; start < chars.length; ) {
    if (chunks.length >= cap) throw new RangeError('Too many document chunks');
    let end = Math.min(chars.length, start + max);
    // Prefer splitting on whitespace near the end without creating tiny chunks.
    if (end < chars.length) {
      const remaining = chars.slice(start, end);
      let boundary = -1; for (let i = remaining.length - 1; i > max * 0.7; i--) { if (/\s/u.test(remaining[i])) { boundary = i; break; } }
      if (boundary > 0) end = start + boundary + 1;
    }
    chunks.push({ id: `${document.id}#${chunks.length}`, text: chars.slice(start, end).join(''), title: document.title, metadata: { ...document.metadata, sourceId: document.id, chunk: String(chunks.length) } });
    if (end === chars.length) break;
    start = end - overlap;
  }
  return chunks;
}
