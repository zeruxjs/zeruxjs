/** Documentation routing and navigation. Add a version with its own content directory; no renderer changes needed. */
export const site = {
  title: "ZeruxJS",
  basePath: "/zeruxjs",
  // Set the deployed domain origin to emit canonical URLs and a sitemap.
  origin: null,
  description: "Build applications with the ZeruxJS runtime and ecosystem.",
  repository: "https://github.com/zeruxjs/zeruxjs",
  latest: "0.0.2",
  versions: [
    {
      id: "0.0.2",
      label: "0.0.2",
      status: "Early development",
      reference: "workspace",
      ref: "master",
    },
  ],
  sections: [
    "Getting started",
    "Fundamentals",
    "Runtime",
    "Data and services",
    "Frontend",
    "Operations",
    "API reference",
    "Packages",
    "Contributing",
  ],
};

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
