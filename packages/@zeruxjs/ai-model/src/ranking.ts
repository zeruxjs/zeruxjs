import type { KnowledgeDocument, KnowledgeResult } from './types.js';
import { tokenize } from './tokenizer.js';
/** Explicit opt-in weighted analyzer policy; absence retains legacy scoring and locale behavior. */
export interface KnowledgeRankingOptions {
  /** Finite per-field weights from 0 through 100, with at least one positive field. */
  weights?: {
    /** Relative title field weight, default 8, from 0 through 100. */
    title?: number;
    /** Relative text field weight, default 1, from 0 through 100. */
    text?: number;
    /** Relative symbols field weight, default 4, from 0 through 100. */
    symbols?: number;
  };
  /** Opt-in NFC/NFKC/none analyzer choice; defaults NFKC in configured ranking. */
  normalization?: 'NFC' | 'NFKC' | 'none';
  /** Opt-in combining-mark folding; defaults false. */
  foldDiacritics?: boolean;
  /** Add overlapping Han code-point bigrams; defaults true, not full language segmentation. */
  cjkBigrams?: boolean;
}
/**
 * Validate explicit field/analyzer policy without changing legacy ranking defaults.
 * @param {KnowledgeRankingOptions} options - Validated optional policy; nested field declarations document units, bounds and ownership. Defaults to {}.
 * @returns {object} Resolved weights and normalization flags; invalid/unknown policy rejects.
 */
export function rankingSettings(options: KnowledgeRankingOptions = {}) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (k) =>
        !['weights', 'normalization', 'foldDiacritics', 'cjkBigrams'].includes(
          k
        )
    ) ||
    (options.weights !== undefined &&
      (!options.weights ||
        typeof options.weights !== 'object' ||
        Array.isArray(options.weights) ||
        Object.keys(options.weights).some(
          (k) => !['title', 'text', 'symbols'].includes(k)
        )))
  ) {
    throw new TypeError('Invalid ranking fields');
  }
  /** Validated per-field weights; at least one positive field is required. */
  const weights = {
    title: options.weights?.title ?? 8,
    text: options.weights?.text ?? 1,
    symbols: options.weights?.symbols ?? 4,
  };
  // Reject invalid individual weights before combining field contributions.
  for (const v of Object.values(weights)) {
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      throw new TypeError('Invalid evidence field weight');
    }
  }
  if (
    !Object.values(weights).some((v) => v > 0) ||
    (options.normalization !== undefined &&
      !['NFC', 'NFKC', 'none'].includes(options.normalization)) ||
    (options.foldDiacritics !== undefined &&
      typeof options.foldDiacritics !== 'boolean') ||
    (options.cjkBigrams !== undefined &&
      typeof options.cjkBigrams !== 'boolean')
  ) {
    throw new TypeError('Invalid ranking settings');
  }
  return {
    weights,
    normalization: options.normalization ?? 'NFKC',
    foldDiacritics: options.foldDiacritics ?? false,
    cjkBigrams: options.cjkBigrams ?? true,
  };
}
/**
 * Tokenize normalized text with optional diacritic folding and Han code-point bigrams.
 * @param {string} text - Untrusted source/prompt text; never executed as instructions.
 * @param {ReturnType<typeof rankingSettings>} settings - Explicit evidence/ranking settings; omitted policy retains documented defaults.
 * @returns {string[]} Lexical tokens, not model embeddings or universal language segmentation.
 */
export function rankingTokens(
  text: string,
  settings: ReturnType<typeof rankingSettings>
): string[] {
  let value =
    settings.normalization === 'none'
      ? text
      : text.normalize(settings.normalization);
  value = value.toLowerCase();
  if (settings.foldDiacritics) {
    value = value.normalize('NFD').replace(/\p{M}+/gu, '');
  }
  /** Legacy word tokens plus explicitly selected Han bigrams; no language model is invoked. */
  const result = tokenize(value);
  if (settings.cjkBigrams) {
    // Generate bigrams only from contiguous Han runs, never across unrelated word boundaries.
    for (const part of value.match(/\p{Script=Han}+/gu) ?? []) {
      /** Code points allow Han bigrams without splitting Unicode surrogate pairs. */
      const chars = Array.from(part);
      for (let i = 0; i + 1 < chars.length; i++) {
        /** Adjacent code points used to detect a bounded token boundary. */
        const first = chars[i];
        /** Following code point paired with the current boundary candidate. */
        const second = chars[i + 1];
        if (first !== undefined && second !== undefined) {
          result.push(first + second);
        }
      }
    }
  }
  return result;
}
/**
 * Compute opt-in saturating field TF/IDF over the explicitly supplied candidate population.
 * @param {readonly KnowledgeDocument[]} documents - Explicit bounded population; caller must filter authorization before this helper.
 * @param {string} query - Bounded lexical query text; no executable regex or remote DSL is accepted.
 * @param {number} limit - Maximum returned results, validated before ranking.
 * @param {KnowledgeRankingOptions} options - Validated optional policy; nested field declarations document units, bounds and ownership.
 * @param {ReadonlySet<string>} stop - Explicit query stop vocabulary; no global mutable analyzer state. Defaults to new Set().
 * @returns {KnowledgeResult[]} Positive scores with deterministic binary-ID ties; direct helper retains supplied document references.
 */
export function rankKnowledgeDocuments(
  documents: readonly KnowledgeDocument[],
  query: string,
  limit: number,
  options: KnowledgeRankingOptions,
  stop: ReadonlySet<string> = new Set()
): KnowledgeResult[] {
  if (
    !Array.isArray(documents) ||
    documents.length > 10000 ||
    typeof query !== 'string' ||
    query.length > 10000 ||
    !Number.isSafeInteger(limit) ||
    limit < 0 ||
    limit > 1000
  ) {
    throw new TypeError('Invalid ranking input');
  }
  /** Validated opt-in analyzer/weight settings; absent options never change legacy search. */
  const settings = rankingSettings(options);
  /** Unique bounded query vocabulary after normalization and stop-word removal. */
  const terms = [
    ...new Set(rankingTokens(query, settings).filter((t) => !stop.has(t))),
  ];
  if (terms.length > 128) {
    throw new RangeError('Evidence query complexity exceeded');
  }
  if (!terms.length) {
    return [];
  }
  /** Per-field token rows preserve the explicit caller-supplied authorized population. */
  const rows = documents.map((doc) => ({
    doc,
    title: rankingTokens(doc.title ?? '', settings),
    text: rankingTokens(doc.text, settings),
    symbols: rankingTokens(doc.metadata?.symbols ?? '', settings),
  }));
  /** Document-frequency map counts presence once per document across all fields. */
  const df = new Map<string, number>();
  let total = 0;
  // Compute rarity over exactly the supplied population; caller authorization precedes this helper.
  for (const row of rows) {
    total += row.text.length;
    /** Current document vocabulary supports IDF without double-counting repeated fields. */
    const words = new Set([...row.title, ...row.text, ...row.symbols]);
    // Bounded unique query vocabulary contributes only where the term is present.
    for (const term of terms) {
      if (words.has(term)) {
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }
  }
  /** Nonzero average text length normalizes text frequency without dividing by zero. */
  const avg = Math.max(1, total / Math.max(1, rows.length));
  /** Scored document references are sorted by score and binary ID before limiting. */
  const results = rows.map((row) => {
    let score = 0;
    // Keep per-field counts and normalization separate before applying host-selected weights.
    for (const field of ['title', 'text', 'symbols'] as const) {
      /** Per-field frequencies keep title/text/symbol contributions independently weighted. */
      const counts = new Map<string, number>();
      // Term frequency belongs to the current field, not a merged title/body vocabulary.
      for (const word of row[field]) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
      // Bounded unique query vocabulary contributes only where the term is present.
      for (const term of terms) {
        /** Current field frequency contributes only when the query term is present. */
        const tf = counts.get(term) ?? 0;
        if (tf) {
          /** Saturating TF/IDF document rarity, not a score-equivalence promise across engines. */
          const idf = Math.log(
            1 +
              (rows.length - (df.get(term) ?? 0) + 0.5) /
                ((df.get(term) ?? 0) + 0.5)
          );
          /** Only body text receives length normalization; other fields retain their declared weights. */
          const norm =
            field === 'text'
              ? 1.2 * (0.25 + (0.75 * row.text.length) / avg)
              : 1;
          score += (settings.weights[field] * idf * tf) / (tf + norm);
        }
      }
    }
    return { document: row.doc, score };
  });
  return results
    .filter((r) => r.score > 0)
    .sort((a, b) => {
      /** Preserve score precedence before deterministic binary identity ties. */
      const difference = b.score - a.score;
      if (difference) {
        return difference;
      }
      if (a.document.id < b.document.id) {
        return -1;
      }
      if (a.document.id > b.document.id) {
        return 1;
      }
      return 0;
    })
    .slice(0, limit);
}
