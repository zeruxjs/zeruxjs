import {
  rankKnowledgeDocuments,
  type KnowledgeRankingOptions,
} from './ranking.js';
import { tokenize } from './tokenizer.js';
import type {
  KnowledgeDocument,
  KnowledgeResult,
  KnowledgeSnapshot,
  KnowledgeOptions,
} from './types.js';
/**
 * Copy a document and its string metadata at the storage/consumer boundary.
 * @param {KnowledgeDocument} doc - Document record whose fields are validated before storage.
 * @returns {KnowledgeDocument} Detached record; input text is never evaluated.
 */
function clone(doc: KnowledgeDocument): KnowledgeDocument {
  return {
    id: doc.id,
    text: doc.text,
    title: doc.title,
    metadata: doc.metadata ? { ...doc.metadata } : undefined,
  };
}
/** Isolated bounded lexical store; host populates only authorized records and owns persistence. */
export class DocumentKnowledgeBase {
  /** Application-local records; batch/restore replace this table only after complete validation. */
  private docs = new Map<string, KnowledgeDocument>();
  /** Legacy locale-folded query stop vocabulary; never shared across bases. */
  private readonly stop: Set<string>;
  /** Maximum stored records; replacing an existing ID does not consume another slot. */
  private readonly max: number;
  /** Maximum UTF-16 text length admitted for one document. */
  private readonly maxChars: number;
  /**
   * Create an isolated bounded in-memory document store with legacy stop-word behavior.
   * @param {KnowledgeOptions} options - Validated optional policy; nested field declarations document units, bounds and ownership. Defaults to {}.
   * @throws {RangeError} Rejects invalid storage limits before accepting documents.
   */
  constructor(options: KnowledgeOptions = {}) {
    this.stop = new Set(
      (options.stopWords ?? []).map((s) => s.toLocaleLowerCase())
    );
    this.max = options.maxDocuments ?? 10000;
    this.maxChars = options.maxDocumentCharacters ?? 1000000;
    if (
      !Number.isSafeInteger(this.max) ||
      this.max < 1 ||
      !Number.isSafeInteger(this.maxChars) ||
      this.maxChars < 1
    ) {
      throw new RangeError('Invalid document limit');
    }
  }
  /**
   * Read stored document cardinality without exposing mutable records.
   * @returns {number} Current document count.
   */
  get size() {
    return this.docs.size;
  }

  /**
   * Validate and clone one record, replacing only an existing matching ID.
   * @param {KnowledgeDocument} doc - Document record whose fields are validated before storage.
   * @returns {void} No value; invalid/capacity failures leave prior records intact.
   * @throws {TypeError | RangeError} Rejects invalid fields/capacity before mutating the table.
   */
  add(doc: KnowledgeDocument): void {
    if (
      !doc ||
      typeof doc.id !== 'string' ||
      !doc.id.trim() ||
      // eslint-disable-next-line no-control-regex -- Intentionally matches control characters for validation; preserve these rejection ranges.
      /[\x00-\x1f\x7f]/.test(doc.id) ||
      typeof doc.text !== 'string' ||
      !doc.text.trim()
    ) {
      throw new TypeError('Document id and text required');
    }
    if (
      doc.id.length > 256 ||
      doc.text.length > this.maxChars ||
      (doc.title && doc.title.length > 1000) ||
      (doc.metadata &&
        (Object.keys(doc.metadata).length > 100 ||
          Object.entries(doc.metadata).some(
            ([k, v]) =>
              ['__proto__', 'constructor', 'prototype'].includes(k) ||
              typeof v !== 'string' ||
              v.length > 10000
          )))
    ) {
      throw new TypeError('Invalid document fields');
    }
    if (!this.docs.has(doc.id) && this.docs.size >= this.max) {
      throw new RangeError('Knowledge base is full');
    }
    this.docs.set(doc.id, clone(doc));
  }
  /**
   * Stage the complete batch against a copy before replacing the original document table.
   * @param {KnowledgeDocument[]} docs - Complete batch staged before committing any replacement.
   * @returns {void} No value; invalid later input cannot partially mutate the original base.
   * @throws {TypeError | RangeError} Any invalid staged document leaves the original base unchanged.
   */
  addMany(docs: KnowledgeDocument[]): void {
    /** Staged replacement preserves the original base if any bulk/import document fails validation. */
    const replacement = new DocumentKnowledgeBase({
      stopWords: [...this.stop],
      maxDocuments: this.max,
      maxDocumentCharacters: this.maxChars,
    });
    // Clone existing records into staging so a later invalid batch cannot damage them.
    for (const doc of this.docs.values()) {
      replacement.add(doc);
    }
    // Validate the complete incoming batch before swapping the stored table.
    for (const doc of docs) {
      replacement.add(doc);
    }
    this.docs = new Map(replacement.docs);
  }
  /**
   * Delete one document identity from this isolated base.
   * @param {string} id - Stable document identity within this isolated base.
   * @returns {boolean} Whether a stored ID was present; no persistent/external delete occurs.
   */
  remove(id: string) {
    return this.docs.delete(id);
  }
  /**
   * Remove all records from this in-memory base.
   * @returns {void} No value; borrowed snapshots remain independent copies.
   */
  clear() {
    this.docs.clear();
  }
  /**
   * Read one document through a defensive clone.
   * @param {string} id - Stable document identity within this isolated base.
   * @returns {KnowledgeDocument | undefined} Detached record, or undefined for a missing identity.
   */
  get(id: string) {
    /** Stored record is cloned before return so caller mutation cannot alter the base. */
    const doc = this.docs.get(id);
    return doc ? clone(doc) : undefined;
  }
  /**
   * Read all records through defensive clones.
   * @returns {KnowledgeDocument[]} Detached insertion-order records; callers must enforce tenant visibility before population.
   */
  list() {
    return [...this.docs.values()].map(clone);
  }
  /**
   * Rank bounded queries using unchanged legacy scoring unless explicit ranking is supplied.
   * @param {string} query - Bounded lexical query text; no executable regex or remote DSL is accepted.
   * @param {number} limit - Maximum returned results, validated before ranking. Defaults to 5.
   * @param {KnowledgeRankingOptions | undefined} ranking - Optional explicit field/analyzer policy; omission retains legacy behavior.
   * @returns {KnowledgeResult[]} Detached positive-score results; legacy locale ties and opt-in binary ties remain distinct.
   * @throws {TypeError | RangeError} Rejects invalid query/limit or explicit ranking configuration.
   */
  search(
    query: string,
    limit = 5,
    ranking?: KnowledgeRankingOptions
  ): KnowledgeResult[] {
    if (typeof query !== 'string' || query.length > 10000) {
      throw new TypeError('Invalid knowledge query');
    }
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 1000) {
      throw new RangeError('Invalid search limit');
    }
    if (ranking) {
      return rankKnowledgeDocuments(
        this.list(),
        query,
        limit,
        ranking,
        this.stop
      );
    }
    /** Unique non-stop query terms or document tokens used only by the legacy lexical score. */
    const terms = [
      ...new Set(tokenize(query).filter((t) => !this.stop.has(t))),
    ];
    if (!terms.length) {
      return [];
    }
    /** Stable current document population for this search; no authorization is inferred here. */
    const docs = [...this.docs.values()];
    /** Document-frequency counts are computed only over the caller-populated base. */
    const frequencies = new Map<string, number>();
    /** Document/token rows retain the legacy title/text scoring behavior. */
    const counts = docs.map((doc) => {
      /** Unique non-stop query terms or document tokens used only by the legacy lexical score. */
      const terms = tokenize(`${doc.title ?? ''} ${doc.text}`);
      /** Per-document vocabulary counts each query term at most once toward document frequency. */
      const set = new Set(terms);
      // Presence, not repeated frequency, contributes once to document frequency.
      for (const term of set) {
        frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      }
      return { doc, terms };
    });
    return counts
      .map(({ doc, terms: words }) => {
        let score = 0;
        /** Per-document token counts determine logarithmic legacy term frequency. */
        const count = new Map<string, number>();
        // Count per-document frequency without changing the legacy title multiplier.
        for (const word of words) {
          count.set(word, (count.get(word) ?? 0) + 1);
        }
        /** Legacy title vocabulary applies its existing factor without changing default ranking. */
        const title = new Set(tokenize(doc.title ?? ''));
        // Only observed query terms contribute to the unchanged legacy score.
        for (const term of terms) {
          /** Observed frequency of this query term in the current document. */
          const tf = count.get(term) ?? 0;
          if (tf) {
            score +=
              (1 + Math.log(tf)) *
              (Math.log(
                1 +
                  (docs.length - (frequencies.get(term) ?? 0) + 0.5) /
                    ((frequencies.get(term) ?? 0) + 0.5)
              ) +
                1) *
              (title.has(term) ? 2 : 1);
          }
        }
        return { document: clone(doc), score };
      })
      .filter((x) => x.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score || a.document.id.localeCompare(b.document.id)
      )
      .slice(0, limit);
  }
  /**
   * Build compatible bounded literal context from legacy search results.
   * @param {string} query - Bounded lexical query text; no executable regex or remote DSL is accepted.
   * @param {number} limit - Maximum returned results, validated before ranking. Defaults to 5.
   * @param {number} maxCharacters - Character budget using the owning API’s documented UTF-16/code-point units. Defaults to 10000.
   * @returns {string} Joined source entries within the existing character accounting; no citation validation.
   * @throws {RangeError} Rejects invalid character budgets; search validation may also reject.
   */
  context(query: string, limit = 5, maxCharacters = 10000): string {
    if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 0) {
      throw new RangeError('Invalid context budget');
    }
    /** Staged legacy context entries; no unbounded document table is serialized. */
    const segments: string[] = [];
    let used = 0;
    // Stop at the existing legacy character budget rather than serializing the whole base.
    for (const { document } of this.search(query, limit)) {
      /** One literal source entry; callers must treat legacy context as untrusted text. */
      const entry = `[${document.id}] ${document.title ?? ''}\n${document.text}`;
      if (used + entry.length > maxCharacters) {
        break;
      }
      segments.push(entry);
      used += entry.length + 2;
    }
    return segments.join('\n\n');
  }
  /**
   * Create a detached version-1 snapshot without changing ranking configuration.
   * @returns {KnowledgeSnapshot} V1 document snapshot, not a durable or authenticated store.
   */
  snapshot(): KnowledgeSnapshot {
    return { version: 1, documents: this.list() };
  }
  /**
   * Validate a complete snapshot in staging before atomically replacing the in-memory table.
   * @param {KnowledgeSnapshot} snapshot - Complete versioned candidate; no partial restoration/promotion is allowed.
   * @returns {void} No value; duplicates or invalid records preserve all previous documents.
   * @throws {TypeError | RangeError} Invalid snapshot or duplicate IDs preserve the previous base.
   */
  restore(snapshot: KnowledgeSnapshot): void {
    if (
      snapshot?.version !== 1 ||
      !Array.isArray(snapshot.documents) ||
      snapshot.documents.length > this.max
    ) {
      throw new TypeError('Invalid knowledge snapshot');
    }
    /** Staged replacement preserves the original base if any bulk/import document fails validation. */
    const replacement = new DocumentKnowledgeBase({
      stopWords: [...this.stop],
      maxDocuments: this.max,
      maxDocumentCharacters: this.maxChars,
    });
    // Stage every snapshot record and reject duplicates before replacing any current document.
    for (const doc of snapshot.documents) {
      if (replacement.docs.has(doc.id)) {
        throw new TypeError('Duplicate knowledge document ID');
      }
      replacement.add(doc);
    }
    this.docs = new Map(replacement.docs);
  }
}
/**
 * Construct an explicitly scoped bounded base without global state or source discovery.
 * @param {KnowledgeOptions | undefined} options - Validated optional policy; nested field declarations document units, bounds and ownership.
 * @returns {DocumentKnowledgeBase} Fresh independent in-memory owner.
 */
export const createKnowledgeBase = (options?: KnowledgeOptions) =>
  new DocumentKnowledgeBase(options);
