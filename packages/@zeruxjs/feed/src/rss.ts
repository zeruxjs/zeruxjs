import type { FeedOptions } from "./types.js";
import {
  escapeXml as x,
  normalizeFeed,
  finishFeed,
  date,
  updated,
  authors,
  attachments,
  categories,
} from "./utils.js";
export function createRssFeed(input: FeedOptions): string {
  const options = normalizeFeed(input);
  if (options.items.some((i) => attachments(i).length > 1))
    throw new TypeError("RSS supports one enclosure per item");
  const hasAuthor =
      !!options.authors?.length ||
      options.items.some((i) => authors(i).length || i.language),
    hasContent = options.items.some((i) => i.contentHtml !== undefined);
  const creator = (a: ReturnType<typeof authors>[number]) =>
    `<dc:creator>${x(a.name)}</dc:creator>`;
  const cat = (c: ReturnType<typeof categories>[number]) =>
    `<category${c.scheme ? ` domain="${x(c.scheme)}"` : ""}>${x(c.term)}</category>`;
  const items = options.items
    .map((i) => {
      const people = authors(i),
        enclosure = attachments(i)[0];
      return `<item><guid isPermaLink="false">${x(i.id)}</guid><title>${x(i.title)}</title><link>${x(i.url)}</link>${(i.description ?? i.contentText) ? `<description>${x(i.description ?? i.contentText!)}</description>` : ""}${i.date ? `<pubDate>${new Date(date(i.date)!).toUTCString()}</pubDate>` : ""}${people.map(creator).join("")}${people.length === 1 && people[0].email ? `<author>${x(people[0].email)}</author>` : ""}${i.language ? `<dc:language>${x(i.language)}</dc:language>` : ""}${categories(i).map(cat).join("")}${enclosure ? `<enclosure url="${x(enclosure.url)}" type="${x(enclosure.type)}" length="${enclosure.length}"/>` : ""}${i.contentHtml !== undefined ? `<content:encoded>${x(i.contentHtml)}</content:encoded>` : ""}</item>`;
    })
    .join("");
  const known =
    options.updated !== undefined ||
    options.items.some((i) => i.date || i.updated);
  return finishFeed(
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"${hasAuthor ? ' xmlns:dc="http://purl.org/dc/elements/1.1/"' : ""}${hasContent ? ' xmlns:content="http://purl.org/rss/1.0/modules/content/"' : ""}${options.feedUrl ? ' xmlns:atom="http://www.w3.org/2005/Atom"' : ""}><channel><title>${x(options.title)}</title><link>${x(options.siteUrl)}</link><description>${x(options.description)}</description>${options.language ? `<language>${x(options.language)}</language>` : ""}${known ? `<lastBuildDate>${new Date(updated(options)).toUTCString()}</lastBuildDate>` : ""}${options.copyright ? `<copyright>${x(options.copyright)}</copyright>` : ""}${options.image ? `<image><url>${x(options.image)}</url><title>${x(options.title)}</title><link>${x(options.siteUrl)}</link></image>` : ""}${options.feedUrl ? `<atom:link href="${x(options.feedUrl)}" rel="self" type="application/rss+xml"/>` : ""}${(options.authors ?? []).map(creator).join("")}${categories(options).map(cat).join("")}${items}</channel></rss>`,
    options,
  );
}
