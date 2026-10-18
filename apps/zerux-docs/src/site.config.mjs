/** Documentation routing and navigation. Add a version with its own content directory; no renderer changes needed. */
import config from "../zerux.config.js";
export const site = config.documentation;

/** Mount an app-local URL under the docs site prefix. @param {string} pathname Local URL. @returns {string} Mounted URL. Reads public site config only. */
export function sitePath(pathname) {
  const base = site.basePath;
  if (!base) return pathname;
  if (
    pathname === base ||
    pathname.startsWith(base + "/") ||
    pathname.startsWith(base + "#")
  )
    return pathname;
  return base + (pathname.startsWith("/") ? pathname : "/" + pathname);
}

/** Mount internal HTML links without changing external URLs or heading fragments.
 * @param {string} html Rendered document. @returns {string} Mounted HTML. Reads public path config only.
 */
export function mountHtml(html) {
  return html.replace(
    /(data-site-root )?\b(href|src|action)="(\/(?!\/)[^"]*)"/g,
    (_match, rootLink, attribute, url) =>
      rootLink ? _match : `${attribute}="${sitePath(url)}"`,
  );
}
