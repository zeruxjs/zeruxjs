import type { FeedOptions } from "./types.js";
import { escapeXml as x, date, updated, normalizeFeed, finishFeed, authors, attachments, categories, atomId } from "./utils.js";
export function createAtomFeed(input: FeedOptions): string {
  const options = normalizeFeed(input),
    feedAuthors = options.authors ?? [],
    seen = new Set<string>(),
    feedUpdated = updated(options);
  if (
    options.strict &&
    ((!feedAuthors.length &&
      (!options.items.length ||
        options.items.some((i) => !authors(i).length))) ||
      (feedUpdated === new Date(0).toISOString() &&
        options.updated === undefined &&
        !options.items.some((i) => i.date || i.updated)))
  )
    throw new TypeError(
      "Strict Atom requires authored authors and updated timestamps",
    );
  const person = (a: ReturnType<typeof authors>[number]) =>
    `<author><name>${x(a.name)}</name>${a.url ? `<uri>${x(a.url)}</uri>` : ""}${a.email ? `<email>${x(a.email)}</email>` : ""}</author>`;
  const cat = (c: ReturnType<typeof categories>[number]) =>
    `<category term="${x(c.term)}"${c.scheme ? ` scheme="${x(c.scheme)}"` : ""}${c.label ? ` label="${x(c.label)}"` : ""}/>`;
  const items = options.items
    .map((i) => {
      const id = i.atomId ?? i.id;
      if (seen.has(id)) throw new TypeError("Duplicate Atom ID");
      seen.add(id);
      if (options.strict) {
        atomId(id);
        if (!i.updated && !i.date)
          throw new TypeError("Strict Atom entry requires updated/date");
      }
      return `<entry${i.language ? ` xml:lang="${x(i.language)}"` : ""}><id>${x(id)}</id><title>${x(i.title)}</title><link href="${x(i.url)}"/><updated>${date(i.updated ?? i.date) ?? feedUpdated}</updated>${i.date ? `<published>${date(i.date)}</published>` : ""}${authors(i).map(person).join("")}${i.description ? `<summary>${x(i.description)}</summary>` : ""}${i.contentHtml !== undefined ? `<content type="html">${x(i.contentHtml)}</content>` : i.contentText !== undefined ? `<content type="text">${x(i.contentText)}</content>` : ""}${categories(i).map(cat).join("")}${attachments(
        i,
      )
        .map(
          (a) =>
            `<link rel="enclosure" href="${x(a.url)}" type="${x(a.type)}" length="${a.length}"${a.title ? ` title="${x(a.title)}"` : ""}/>`,
        )
        .join("")}</entry>`;
    })
    .join("");
  const id = options.id ?? options.siteUrl;
  if (options.strict) atomId(id);
  return finishFeed(
    `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"${options.language ? ` xml:lang="${x(options.language)}"` : ""}><id>${x(id)}</id><title>${x(options.title)}</title><subtitle>${x(options.description)}</subtitle><updated>${feedUpdated}</updated><link href="${x(options.siteUrl)}"/>${options.feedUrl ? `<link rel="self" href="${x(options.feedUrl)}"/>` : ""}${options.copyright ? `<rights>${x(options.copyright)}</rights>` : ""}${options.image ? `<logo>${x(options.image)}</logo>` : ""}${feedAuthors.map(person).join("")}${categories(options).map(cat).join("")}${items}</feed>`,
    options,
  );
}
