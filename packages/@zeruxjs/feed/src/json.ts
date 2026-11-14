import type { FeedOptions } from './types.js';
import {
  normalizeFeed,
  finishFeed,
  date,
  authors,
  attachments,
  categories,
} from './utils.js';
/** Serialize a bounded JSON Feed 1.1 subset, preserving ordered facts without fetching any referenced resource. XML/JSON encoding never sanitizes HTML a reader later renders.
 * @param {FeedOptions} input - Public content-owned facts and finite budgets; generator normalization rejects invalid records before returning output.
 * @returns {string} Deterministic representation bytes for stable input/order; host must sanitize untrusted HTML and avoid signed/private URLs.
 * @throws {TypeError | RangeError} When normalization or serialized UTF-8 output limits fail.
 */
export function createJsonFeed(input: FeedOptions): string {
  /** Detached validated public publication; JSON fields map only documented format coverage. */
  const o = normalizeFeed(input);
  /**
   * Project only JSON Feed author fields supported by this generator.
   *
   * @param {ReturnType<typeof authors>[number]} a - Already validated authored metadata; no network or executable content.
   * @returns {object} Name/URL/avatar projection; undefined fields disappear during JSON serialization.
   */
  const person = (a: ReturnType<typeof authors>[number]) => ({
    name: a.name,
    url: a.url,
    avatar: a.avatar,
  });
  return finishFeed(
    JSON.stringify(
      {
        version: 'https://jsonfeed.org/version/1.1',
        title: o.title,
        home_page_url: o.siteUrl,
        feed_url: o.feedUrl,
        description: o.description,
        language: o.language,
        icon: o.image,
        authors: o.authors?.map(person),
        items: o.items.map((i) => ({
          id: i.id,
          url: i.url,
          title: i.title,
          content_text:
            i.contentText ??
            i.description ??
            (i.contentHtml === undefined ? i.title : undefined),
          content_html: i.contentHtml,
          date_published: date(i.date),
          date_modified: date(i.updated),
          authors: (() => {
            if (i.authors !== undefined) {
              return i.authors.map(person);
            }
            if (i.author) {
              return [{ name: i.author }];
            }
            return undefined;
          })(),
          tags: categories(i).length
            ? categories(i).map((c) => c.term)
            : undefined,
          language: i.language,
          image: i.image,
          attachments: attachments(i).length
            ? attachments(i).map((a) => ({
                url: a.url,
                mime_type: a.type,
                size_in_bytes: a.length,
                title: a.title,
                duration_in_seconds: a.duration,
              }))
            : undefined,
        })),
      },
      null,
      2
    ),
    o
  );
}
