/** Inert source record; caller owns visibility and secret redaction before adding it. */
export interface KnowledgeDocument {
  /** Stable document/evidence identity; it is not proof of ownership or authorization. */
  id: string;
  /** Untrusted indexed source text, never code or instructions to execute. */
  text: string;
  /** Optional inert source title; ranking may weight it but rendering must escape it. */
  title?: string;
  /** String provenance labels; callers must not include secrets or infer permissions from labels. */
  metadata?: Record<string, string>;
}
/** Lexical match and backend-specific relevance score, not a factual confidence estimate. */
export interface KnowledgeResult {
  /** Matched document record; legacy base APIs return detached copies. */
  document: KnowledgeDocument;
  /** Nonnegative lexical/backend relevance score, not confidence or cross-engine equivalence. */
  score: number;
}
/** Legacy version-1 document snapshot; it does not capture authorization or ranking settings. */
export interface KnowledgeSnapshot {
  /** Explicit snapshot/settings schema version; unsupported versions reject. */
  version: 1;
  /** Bounded complete document list; authorization remains the host boundary. */
  documents: KnowledgeDocument[];
}
/** Per-base in-memory limits and legacy query stop words; no global state is configured. */
export interface KnowledgeOptions {
  /** Optional legacy query stop words folded with the existing locale behavior. */
  stopWords?: string[];
  /** Maximum stored documents, default 10000; bulk operations stage before replacement. */
  maxDocuments?: number;
  /** Maximum document UTF-16 characters, default 1000000. */
  maxDocumentCharacters?: number;
}
