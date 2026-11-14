export interface AssetVariant {
  /** Descriptive HTTP(S) URL; not a fetch permission or signed access grant. */
  url?: string;
  /** Inert descriptive value; host rendering policy remains required. */
  value?: string;
  /** Bounded inert string metadata, copied at validation boundaries. */
  metadata?: Record<string, string>;
}
export interface Asset {
  /** Optional validated descriptive brand rules. */
  brand?: import('./brand-rules.js').BrandRules;
  /** Stable logical asset identifier, not a storage path authorization. */
  id: string;
  /** Human-authored display label; escape at its output sink. */
  name: string;
  /** Explicit catalog kind, not binary format detection. */
  type: 'image' | 'video' | 'font' | 'color' | 'document' | 'other';
  /** Descriptive HTTP(S) URL; not a fetch permission or signed access grant. */
  url?: string;
  /** Inert descriptive value; host rendering policy remains required. */
  value?: string;
  /** Optional bounded descriptive tags. */
  tags?: string[];
  /** Bounded inert string metadata, copied at validation boundaries. */
  metadata?: Record<string, string>;
  /** Named validated URL/value overrides; resolution is explicit. */
  variants?: Record<string, AssetVariant>;
}
export interface AssetFilter {
  /** Explicit catalog kind, not binary format detection. */
  type?: Asset['type'];
  /** Optional exact tag filter. */
  tag?: string;
  /** Optional locale-folded substring match over name, ID and tags. */
  query?: string;
  /** Result page size, default/max 10000. */
  limit?: number;
  /** Nonnegative result offset, default zero. */
  offset?: number;
}
export interface AssetSnapshot {
  /** Legacy snapshot format version, fixed at one. */
  version: 1;
  /** Detached catalog records; import validates the complete array. */
  assets: Asset[];
  /** Optional single-process optimistic revision, not distributed locking. */
  revision?: number;
}
export type AssetOperation =
  | {
      /** Explicit staged catalog operation. */
      action: 'add'; /** Asset candidate validated before publication. */
      asset: Asset;
    }
  | {
      /** Explicit staged catalog operation. */
      action: 'update'; /** Stable logical asset identifier, not a storage path authorization. */
      id: string; /** Partial descriptive changes; the resulting complete asset is validated. */
      changes: Partial<Omit<Asset, 'id'>>;
    }
  | {
      /** Explicit staged catalog operation. */
      action: 'remove'; /** Stable logical asset identifier, not a storage path authorization. */
      id: string;
    };
