/**
 * Select only the three declared UTF-8 feed representation media types.
 *
 * @param {'rss' | 'atom' | 'json'} format - Explicit representation; unknown runtime values reject.
 * @returns {string} Fixed MIME type with UTF-8 charset, without negotiating a request.
 * @throws {TypeError} When the requested format is unsupported.
 */
export function getFeedContentType(format: 'rss' | 'atom' | 'json'): string {
  if (!['rss', 'atom', 'json'].includes(format)) {
    throw new TypeError('Invalid feed format');
  }
  return {
    rss: 'application/rss+xml; charset=utf-8',
    atom: 'application/atom+xml; charset=utf-8',
    json: 'application/feed+json; charset=utf-8',
  }[format];
}
