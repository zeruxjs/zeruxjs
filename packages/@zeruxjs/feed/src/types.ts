export interface FeedAuthor {
  name: string;
  url?: string;
  email?: string;
  avatar?: string;
}
export interface FeedCategory {
  term: string;
  scheme?: string;
  label?: string;
}
export interface FeedAttachment {
  url: string;
  type: string;
  length: number;
  title?: string;
  duration?: number;
}
export interface FeedItem {
  id: string;
  atomId?: string;
  title: string;
  url: string;
  description?: string;
  contentText?: string;
  contentHtml?: string;
  date?: Date | string;
  updated?: Date | string;
  author?: string;
  authors?: FeedAuthor[];
  tags?: string[];
  categories?: FeedCategory[];
  image?: string;
  enclosure?: FeedAttachment;
  attachments?: FeedAttachment[];
  language?: string;
}
export interface FeedOptions {
  title: string;
  description: string;
  siteUrl: string;
  feedUrl?: string;
  id?: string;
  language?: string;
  copyright?: string;
  image?: string;
  updated?: string | Date;
  items: FeedItem[];
  authors?: FeedAuthor[];
  tags?: string[];
  categories?: FeedCategory[];
  /** Adds Atom-required author/IRI/date checks. Legacy mode retains opaque IDs/epoch fallback. */ strict?: boolean;
  maxItems?: number;
  maxBytes?: number;
}
