import type { FeedOptions } from './types.js';
import {
  escapeXml as x,
  date,
  updated,
  normalizeFeed,
  finishFeed,
  authors,
  attachments,
  categories,
  atomId,
} from './utils.js';
/** Serialize the documented Atom subset; optional strict mode requires known authors, supported IRIs and authored timestamps. XML/JSON encoding never sanitizes HTML a reader later renders.
 * @param {FeedOptions} input - Public content-owned facts and finite budgets; generator normalization rejects invalid records before returning output.
 * @returns {string} Deterministic representation bytes for stable input/order; host must sanitize untrusted HTML and avoid signed/private URLs.
 * @throws {TypeError | RangeError} When normalization, strict Atom facts, effective identity uniqueness or output limits fail.
 */
export function createAtomFeed(input: FeedOptions): string {
  /** Detached validated public publication; strict Atom adds format-specific fact/IRI checks. */
  const options = normalizeFeed(input);
  /** Authored feed-level authors; empty data never synthesizes an author. */
  const feedAuthors = options.authors ?? [];
  /** Effective entry Atom IDs compared case-sensitively after logical ID normalization. */
  const seen = new Set<string>();
  /** Maximum known content date, or the explicitly limited legacy epoch fallback. */
  const feedUpdated = updated(options);
  if (
    options.strict &&
    ((!feedAuthors.length &&
      (!options.items.length ||
        options.items.some((i) => !authors(i).length))) ||
      (feedUpdated === new Date(0).toISOString() &&
        options.updated === undefined &&
        !options.items.some((i) => i.date || i.updated)))
  ) {
    throw new TypeError(
      'Strict Atom requires authored authors and updated timestamps'
    );
  }
  /**
   * Encode only supported authored Atom person fields.
   *
   * @param {ReturnType<typeof authors>[number]} a - Already validated authored metadata; no network or executable content.
   * @returns {string} XML author element; avatars are intentionally not mapped.
   */
  const person = (a: ReturnType<typeof authors>[number]) =>
    `<author><name>${x(a.name)}</name>${a.url ? `<uri>${x(a.url)}</uri>` : ''}${a.email ? `<email>${x(a.email)}</email>` : ''}</author>`;
  /**
   * Encode a validated Atom taxonomy term and optional scheme/label attributes.
   *
   * @param {ReturnType<typeof categories>[number]} c - Already validated authored metadata; no network or executable content.
   * @returns {string} XML category element; metadata never authorizes remote fetching.
   */
  const cat = (c: ReturnType<typeof categories>[number]) =>
    `<category term="${x(c.term)}"${c.scheme ? ` scheme="${x(c.scheme)}"` : ''}${c.label ? ` label="${x(c.label)}"` : ''}/>`;
  /** Ordered entry XML with no inserted output whitespace; HTML remains escaped untrusted text. */
  const items = options.items
    .map((i) => {
      /** Effective authored Atom identity; strict mode checks supported IRI syntax without rewriting it. */
      const id = i.atomId ?? i.id;
      if (seen.has(id)) {
        throw new TypeError('Duplicate Atom ID');
      }
      seen.add(id);
      if (options.strict) {
        atomId(id);
        if (!i.updated && !i.date) {
          throw new TypeError('Strict Atom entry requires updated/date');
        }
      }
      return `<entry${i.language ? ` xml:lang="${x(i.language)}"` : ''}><id>${x(id)}</id><title>${x(i.title)}</title><link href="${x(i.url)}"/><updated>${date(i.updated ?? i.date) ?? feedUpdated}</updated>${i.date ? `<published>${date(i.date)}</published>` : ''}${authors(i).map(person).join('')}${i.description ? `<summary>${x(i.description)}</summary>` : ''}${(() => {
        if (i.contentHtml !== undefined) {
          return `<content type="html">${x(i.contentHtml)}</content>`;
        }
        if (i.contentText !== undefined) {
          return `<content type="text">${x(i.contentText)}</content>`;
        }
        return '';
      })()}${categories(i).map(cat).join('')}${attachments(i)
        .map(
          (a) =>
            `<link rel="enclosure" href="${x(a.url)}" type="${x(a.type)}" length="${a.length}"${a.title ? ` title="${x(a.title)}"` : ''}/>`
        )
        .join('')}</entry>`;
    })
    .join('');
  /** Effective authored Atom identity; strict mode checks supported IRI syntax without rewriting it. */
  const id = options.id ?? options.siteUrl;
  if (options.strict) {
    atomId(id);
  }
  return finishFeed(
    `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"${options.language ? ` xml:lang="${x(options.language)}"` : ''}><id>${x(id)}</id><title>${x(options.title)}</title><subtitle>${x(options.description)}</subtitle><updated>${feedUpdated}</updated><link href="${x(options.siteUrl)}"/>${options.feedUrl ? `<link rel="self" href="${x(options.feedUrl)}"/>` : ''}${options.copyright ? `<rights>${x(options.copyright)}</rights>` : ''}${options.image ? `<logo>${x(options.image)}</logo>` : ''}${feedAuthors.map(person).join('')}${categories(options).map(cat).join('')}${items}</feed>`,
    options
  );
}
