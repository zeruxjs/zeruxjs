/** Compatible authored single-source CSS descriptors, independent of binary ownership. */
export interface FontFaceOptions {
  /** Authored font family; validated descriptor, not an invented installed-font fact. */
  family: string;
  /** Single explicit source URL; this compatible API does not acquire bytes. */
  src: string;
  /** Optional normal/bold or bounded numeric/range descriptor; defaults to 400. */
  weight?: string | number;
  /** Optional validated normal/italic/oblique descriptor; defaults to normal. */
  style?: string;
  /** Explicit CSS timing policy; defaults to swap, without promising zero layout shift. */
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
  /** Optional literal CSS format hint; not full binary conformance verification. */
  format?: string;
  /** Optional bounded Unicode range descriptor; does not prove complete script shaping. */
  unicodeRange?: string;
}
/** Explicit authored URL and optional format hint; no automatic network acquisition. */
export interface FontSource {
  /** Explicit font source URL; fetching/hosting/CSP/consent remain host-owned. */
  url: string;
  /** Optional literal CSS format hint; not full binary conformance verification. */
  format?: string;
}
/** Validated multi-source face descriptors used by CSS/registry consumers. */
export interface FontDefinition extends Omit<
  FontFaceOptions,
  'src' | 'format'
> {
  /** 1–16 explicit URL/format records, copied on registry retention. */
  sources: FontSource[];
  /** Optional validated named/percentage stretch descriptor. */
  stretch?: string;
  /** Optional bounded unique four-character feature settings; no arbitrary declarations. */
  featureSettings?: string;
  /** Optional bounded unique axis settings; actual binary axes need explicit build inspection. */
  variationSettings?: string;
}
