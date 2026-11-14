// String budgets count UTF-16 code units; byte budgets count UTF-8.
/** Authored person facts; each format preserves only its documented fields. */
export interface FeedAuthor {
  /** Required authored display name, at most 512 characters; never inferred from an address. */
  name: string;
  /** Optional absolute credential-free HTTP(S) profile URL; never fetched. */
  url?: string;
  /** Optional validated mailbox, at most 254 characters; JSON Feed omits it. */
  email?: string;
  /** Optional validated HTTP(S) avatar URL, represented only by JSON Feed. */
  avatar?: string;
}
/** Descriptive taxonomy, never executable rules or callbacks. */
export interface FeedCategory {
  /** Required taxonomy term, at most 512 characters. */
  term: string;
  /** Optional absolute HTTP(S) taxonomy URL; RSS domain or Atom scheme. */
  scheme?: string;
  /** Optional display label, at most 512 characters; only Atom preserves it. */
  label?: string;
}
/** Validated enclosure metadata, never permission to fetch a remote object. */
export interface FeedAttachment {
  /** Absolute credential-free HTTP(S) URL; no remote inspection or download occurs. */
  url: string;
  /** Bare MIME type/subtype, at most 128 characters; parameters reject. */
  type: string;
  /** Nonnegative safe-integer byte length supplied by the content owner. */
  length: number;
  /** Optional authored title, at most 512 characters; Atom/JSON Feed preserve it. */
  title?: string;
  /** Optional finite nonnegative seconds, at most ten years; JSON Feed only. */
  duration?: number;
}
/** Public content-owned facts; untrusted HTML still requires host sanitization. */
export interface FeedItem {
  /** Stable case-sensitive logical identity, at most 2048 characters; duplicates reject. */
  id: string;
  /** Optional separate Atom identity; strict mode requires a supported absolute IRI. */
  atomId?: string;
  /** Required authored title, at most 4096 characters; never a generated label. */
  title: string;
  /** Absolute credential-free HTTP(S) item URL; do not publish private signed URLs. */
  url: string;
  /** Optional summary, at most 1048576 characters; readers may interpret it as HTML. */
  description?: string;
  /** Optional inert plain-text body, at most 1048576 characters. */
  contentText?: string;
  /** Optional HTML body, at most 1048576 characters; XML encoding is not sanitization. */
  contentHtml?: string;
  /** Authored publication date: valid Date or supported ISO calendar/RFC3339 string. */
  date?: Date | string;
  /** Authored modification time; never replaced with the generation clock. */
  updated?: Date | string;
  /** Compatible single author name; cannot be combined with authors on this item. */
  author?: string;
  /** Optional ordered author records, at most 32; inheritance depends on format. */
  authors?: FeedAuthor[];
  /** Optional ordered legacy category terms, at most 100, each at most 512 characters. */
  tags?: string[];
  /** Optional ordered structured categories, at most 100; appended after tags. */
  categories?: FeedCategory[];
  /** Optional validated HTTP(S) item image, mapped only by JSON Feed. */
  image?: string;
  /** Compatible single attachment; cannot be combined with attachments. */
  enclosure?: FeedAttachment;
  /** Ordered attachments, at most 16; RSS additionally rejects more than one. */
  attachments?: FeedAttachment[];
  /** Optional canonicalized BCP 47 language tag, at most 64 characters. */
  language?: string;
}
/** Bounded public publication data; direct generator calls own no network resources. */
export interface FeedOptions {
  /** Required authored feed title, at most 4096 characters. */
  title: string;
  /** Required nonempty feed description, at most 65536 characters. */
  description: string;
  /** Absolute credential-free HTTP(S) site URL; default Atom feed identity. */
  siteUrl: string;
  /** Optional absolute HTTP(S) self URL; this never installs a route. */
  feedUrl?: string;
  /** Optional authored feed identity, at most 2048 characters; strict Atom checks its IRI. */
  id?: string;
  /** Optional canonicalized BCP 47 tag, at most 64 characters. */
  language?: string;
  /** Optional authored rights notice, at most 4096 characters. */
  copyright?: string;
  /** Optional validated HTTP(S) channel image/feed logo/icon; never fetched. */
  image?: string;
  /** Known feed modification time; item dates also contribute to the maximum update. */
  updated?: string | Date;
  /** Ordered public items; direct generators reject excess items rather than truncating. */
  items: FeedItem[];
  /** Optional ordered feed authors, at most 32; never invented from URL/email metadata. */
  authors?: FeedAuthor[];
  /** Optional ordered feed category terms, at most 100; format coverage is explicit. */
  tags?: string[];
  /** Optional ordered structured feed taxonomy, at most 100; JSON Feed omits it. */
  categories?: FeedCategory[];
  /** Opt-in Atom author/IRI/date checks; legacy mode retains opaque IDs and epoch fallback. */
  strict?: boolean;
  /** Integer item ceiling 1–10000, default 10000; Fetch has a separate prefix selection limit. */
  maxItems?: number;
  /** Returned UTF-8 byte ceiling 256–64 MiB, default 8 MiB; not a total heap bound. */
  maxBytes?: number;
}
