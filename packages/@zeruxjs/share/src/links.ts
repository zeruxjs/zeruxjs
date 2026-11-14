import type { ShareData } from './types.js';
import { validatedShareUrl } from './url.js';
/** Build fixed supported social/mail links with literal parameter encoding. No browser tab, popup, transport request or sharing action occurs.
 * @param {ShareData} data - Trusted authored share fields; URL receives the package validation policy.
 * @returns {object} Fixed x/linkedin/facebook/whatsapp/email link map; provider behavior remains external.
 */
export function shareLinks(data: ShareData) {
  /** Normalized credential-free HTTP(S) content location, not a destination permission grant. */
  const url = validatedShareUrl(data.url);
  /** Authored share title or empty string; query serialization handles encoding. */
  const title = data.title ?? '';
  /** Authored optional message or empty string; no text is executed. */
  const text = data.text ?? '';
  /** Build a fixed provider URL with native URLSearchParams literal value encoding.
   * @param {string} base - Fixed trusted provider endpoint.
   * @param {Record<string, string>} values - Authored literal query values.
   * @returns {string} Encoded fixed provider link; nothing is opened or fetched.
   */
  const params = (base: string, values: Record<string, string>) =>
    `${base}?${new URLSearchParams(values)}`;
  return {
    x: params('https://twitter.com/intent/tweet', {
      url,
      text: [title, text].filter(Boolean).join(' '),
    }),
    linkedin: params('https://www.linkedin.com/sharing/share-offsite/', {
      url,
    }),
    facebook: params('https://www.facebook.com/sharer/sharer.php', { u: url }),
    whatsapp: `https://wa.me/?${new URLSearchParams({ text: [title, text, url].filter(Boolean).join(' ') })}`,
    email: `mailto:?${new URLSearchParams({ subject: title, body: [text, url].filter(Boolean).join('\n') })}`,
  };
}
/** Select one own key from the fixed supported provider map; arbitrary provider URLs are unsupported.
 * @param {keyof ReturnType<typeof shareLinks>} provider - Explicit supported provider name.
 * @param {ShareData} data - Trusted authored share fields.
 * @returns {string} Encoded fixed provider link; unrecognized keys reject.
 */
export function shareLink(
  provider: keyof ReturnType<typeof shareLinks>,
  data: ShareData
): string {
  /** Fixed provider map; unknown provider keys reject rather than becoming arbitrary URLs. */
  const links = shareLinks(data);
  if (!Object.hasOwn(links, provider)) {
    throw new TypeError('Unsupported share provider');
  }
  return links[provider];
}
/** Prepare inert third-party anchor attributes; host UI still owns user gesture, label and rendering.
 * @param {keyof ReturnType<typeof shareLinks>} provider - Explicit supported provider name.
 * @param {ShareData} data - Trusted authored sharing fields.
 * @returns {object} Fixed href plus noopener/noreferrer and blank target; no link is opened automatically.
 */
export function shareLinkAttributes(
  provider: keyof ReturnType<typeof shareLinks>,
  data: ShareData
) {
  return {
    href: shareLink(provider, data),
    rel: 'noopener noreferrer',
    target: '_blank' as const,
  };
}
