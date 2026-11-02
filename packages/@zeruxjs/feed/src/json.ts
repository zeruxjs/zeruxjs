import type { FeedOptions } from "./types.js";
import {
  normalizeFeed,
  finishFeed,
  date,
  authors,
  attachments,
  categories,
} from "./utils.js";
export function createJsonFeed(input: FeedOptions): string {
  const o = normalizeFeed(input),
    person = (a: ReturnType<typeof authors>[number]) => ({
      name: a.name,
      url: a.url,
      avatar: a.avatar,
    });
  return finishFeed(
    JSON.stringify(
      {
        version: "https://jsonfeed.org/version/1.1",
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
          authors:
            i.authors !== undefined
              ? i.authors.map(person)
              : i.author
                ? [{ name: i.author }]
                : undefined,
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
      2,
    ),
    o,
  );
}
