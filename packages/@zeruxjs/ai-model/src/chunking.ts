import type { KnowledgeDocument } from './types.js';
/** Deterministic code-point splitting policy, validated before emitting a complete chunk list. */
export interface ChunkingOptions {
  /** Unicode-code-point chunk width, default 1600, between 32 and 100000. */
  maxCharacters?: number;
  /** Code-point overlap, default 200; must stay below half of chunk width. */
  overlapCharacters?: number;
  /** Maximum generated chunks; overflow rejects the complete candidate. */
  maxChunks?: number;
}
/**
 * Stage deterministic Unicode-safe overlapping chunks with stable ordinal IDs.
 * @param {KnowledgeDocument} document - Source text record to split; metadata remains inert host-reviewed data.
 * @param {ChunkingOptions} options - Validated optional policy; nested field declarations document units, bounds and ownership. Defaults to {}.
 * @returns {KnowledgeDocument[]} Complete chunk list; invalid policy or overflow throws without returning a partial split.
 * @throws {TypeError | RangeError} Rejects malformed source, invalid chunk policy or chunk overflow before returning a partial list.
 */
export function chunkDocument(
  document: KnowledgeDocument,
  options: ChunkingOptions = {}
): KnowledgeDocument[] {
  if (
    !document ||
    typeof document.id !== 'string' ||
    !document.id ||
    typeof document.text !== 'string' ||
    !document.text.trim()
  ) {
    throw new TypeError('Invalid document');
  }
  /** Unicode-code-point chunk width, default 1600, bounded before source allocation. */
  const max = options.maxCharacters ?? 1600;
  /** Code-point overlap must stay below half the width to guarantee progress. */
  const overlap = options.overlapCharacters ?? 200;
  /** Finite chunk-count budget; exceeding it rejects rather than returning a partial document. */
  const cap = options.maxChunks ?? 1000;
  if (
    !Number.isSafeInteger(max) ||
    max < 32 ||
    max > 100000 ||
    !Number.isSafeInteger(overlap) ||
    overlap < 0 ||
    overlap * 2 >= max ||
    !Number.isSafeInteger(cap) ||
    cap < 1 ||
    cap > 10000
  ) {
    throw new RangeError('Invalid chunking configuration');
  }
  /** Code-point view avoids splitting UTF-16 surrogate pairs while constructing chunks. */
  const chars = Array.from(document.text);
  /** Staged deterministic chunks; caller receives them only after the complete split succeeds. */
  const chunks: KnowledgeDocument[] = [];
  for (let start = 0; start < chars.length; ) {
    if (chunks.length >= cap) {
      throw new RangeError('Too many document chunks');
    }
    let end = Math.min(chars.length, start + max);
    // Prefer splitting on whitespace near the end without creating tiny chunks.
    if (end < chars.length) {
      /** Current candidate window used to find a nearby whitespace boundary. */
      const remaining = chars.slice(start, end);
      let boundary = -1;
      for (let i = remaining.length - 1; i > max * 0.7; i--) {
        /** Candidate split character used to prefer whitespace boundaries. */
        const character = remaining[i];
        if (character !== undefined && /\s/u.test(character)) {
          boundary = i;
          break;
        }
      }
      if (boundary > 0) {
        end = start + boundary + 1;
      }
    }
    chunks.push({
      id: `${document.id}#${chunks.length}`,
      text: chars.slice(start, end).join(''),
      title: document.title,
      metadata: {
        ...document.metadata,
        sourceId: document.id,
        chunk: String(chunks.length),
      },
    });
    if (end === chars.length) {
      break;
    }
    start = end - overlap;
  }
  return chunks;
}
