export type ResourceHintRelation =
  | 'preconnect'
  | 'dns-prefetch'
  | 'preload'
  | 'modulepreload'
  | 'prefetch';
/** Encode hint attribute text for ampersand, quote and less-than contexts.
 * @param {string} value - Explicit hint attribute text, never executable HTML.
 * @returns {string} Escaped attribute text.
 */
const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
/** Serialize deduplicated HTTP(S) link hints with attribute escaping. Inputs are trusted build/host configuration; hints do not authorize destinations or prove a completed fetch.
 * @param {string[]} urls - Explicit HTTP(S) resources; no remote discovery.
 * @param {ResourceHintRelation} rel - Typed hint relation, default preconnect; JavaScript callers must preserve the declared relation contract.
 * @param {object} attributes - Optional trusted resource/credential metadata.
 * @param {string} [attributes.as] - Trusted resource destination.
 * @param {string} [attributes.crossOrigin] - Typed anonymous/use-credentials mode.
 * @param {string} [attributes.type] - Escaped declared MIME attribute.
 * @returns {string[]} Deterministic first-occurrence hint markup; no DOM insertion or network fetch.
 */
export function createResourceHints(
  urls: string[],
  rel: ResourceHintRelation = 'preconnect',
  attributes: {
    /** Optional trusted resource destination attribute. */
    as?: string;
    /** Typed trusted credentials mode; runtime callers must honor the declared union. */
    crossOrigin?: 'anonymous' | 'use-credentials';
    /** Optional declared MIME attribute, not content validation. */
    type?: string;
  } = {}
): string[] {
  /** Per-call deduplication preserving first occurrence of each relation/URL pair. */
  const seen = new Set<string>();
  return urls
    .map((input) => {
      /** Parsed deliberate HTTP(S) resource or audit URL, never fetched by serialization. */
      const url = new URL(input);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new TypeError('Invalid resource URL');
      }
      /** Stable relation-plus-absolute-URL identity used only within this call. */
      const key = `${rel}:${url.href}`;
      if (seen.has(key)) {
        return '';
      }
      seen.add(key);
      /** Optional escaped hint attributes joined without executing or fetching content. */
      const extra = [
        attributes.as && `as="${escape(attributes.as)}"`,
        attributes.crossOrigin && `crossorigin="${attributes.crossOrigin}"`,
        attributes.type && `type="${escape(attributes.type)}"`,
      ]
        .filter(Boolean)
        .join(' ');
      return `<link rel="${rel}" href="${escape(url.href)}"${extra ? ' ' + extra : ''}>`;
    })
    .filter(Boolean);
}
