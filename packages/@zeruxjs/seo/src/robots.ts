import type { RobotsGroup } from './types.js';
import { safeUrl } from './escape.js';
/** Validate the optional nonstandard crawl-delay numeric hint; crawlers may ignore it.
 * @param {number} delay - Finite nonnegative authored delay.
 * @returns {number} Unchanged validated delay; negative/nonfinite values reject.
 */
function positiveDelay(delay: number): number {
  if (!Number.isFinite(delay) || delay < 0) {
    throw new RangeError('Invalid crawl delay');
  }
  return delay;
}
/** Serialize explicit crawler directives. Robots hints do not authenticate, authorize or hide private paths.
 * @param {object} options - Optional explicit robots groups/rules/sitemap settings.
 * @param {string[]} options.allow - Legacy default wildcard-group allowed paths; defaults to root.
 * @param {string[]} options.disallow - Legacy default wildcard-group denied paths; defaults empty.
 * @param {string | string[]} options.sitemap - Explicit absolute HTTP(S) sitemap locations.
 * @param {RobotsGroup[]} options.groups - Explicit groups replacing the default wildcard group.
 * @returns {string} Line-validated text ending in one newline; no URLs are fetched.
 */
export function createRobotsTxt({
  allow = ['/'],
  disallow = [],
  sitemap,
  groups,
}: {
  allow?: string[];
  disallow?: string[];
  sitemap?: string | string[];
  groups?: RobotsGroup[];
} = {}): string {
  /** Reject line-breaking directive text before serializing robots output; it does not authorize crawlers.
   * @param {string} s - Authored user-agent or path directive value.
   * @returns {string} Unchanged line-safe value; line breaks/NUL reject.
   */
  const validate = (s: string) => {
    if (/[\r\n\0]/.test(s)) {
      throw new TypeError('Robots directives cannot contain line breaks');
    }
    return s;
  };
  /** Explicit groups or one legacy wildcard group with declared allow/disallow paths. */
  const all = groups ?? [{ userAgent: '*', allow, disallow }];
  /** Ordered user-agent/rule/sitemap lines; no synthetic host/noindex claims are added. */
  const lines = all.flatMap((group) => [
    ...[group.userAgent]
      .flat()
      .map((agent) => `User-agent: ${validate(agent)}`),
    ...(group.allow ?? []).map((path) => `Allow: ${validate(path)}`),
    ...(group.disallow ?? []).map((path) => `Disallow: ${validate(path)}`),
    ...(group.crawlDelay === undefined
      ? []
      : [`Crawl-delay: ${positiveDelay(group.crawlDelay)}`]),
    '',
  ]);
  // Append only explicitly supplied validated HTTP(S) sitemap locations.
  for (const item of [sitemap ?? []].flat()) {
    lines.push(`Sitemap: ${safeUrl(item)}`);
  }
  return lines.join('\n').trimEnd() + '\n';
}
