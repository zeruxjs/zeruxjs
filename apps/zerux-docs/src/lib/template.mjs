import {
  academyHome,
  learningTools,
  plainLanguage,
} from "./academy-template.mjs";
import { site, sitePath, mountHtml, canonicalUrl } from "../site.config.mjs";
import { markdownPath } from "./raw-markdown.mjs";
import { escape } from "./markdown.mjs";

/** Render header/navigation shared by every page. @param {object} page Current page. @param {object[]} pages All documents. @returns {string} Safe structural HTML. Reads site configuration only. */
function header(page, pages) {
  const versions = site.versions
    .map((version) => {
      const target =
        pages.find(
          (item) => item.version === version.id && item.slug === page.slug,
        ) ||
        pages.find(
          (item) => item.version === version.id && item.slug === "introduction",
        );
      return `<a href="${target.url}" ${page.version === version.id ? 'aria-current="true"' : ""}>${escape(version.label)} <small>${escape(version.status)}</small></a>`;
    })
    .join("");
  return `<a class="skip" href="#content">Skip to content</a><header class="site-header"><a class="brand" href="/" title="ZeruxJS documentation home"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" focusable="false"><path fill="currentColor" d="M6 6h12v3l-8 6h8v3H6v-3l8-6H6z"/></svg></span>Zerux<span>JS</span><small>Docs</small></a><nav class="top-nav" aria-label="Primary"><a data-site-root href="/">Ecosystem</a><a href="/docs/${page.version}/learn/">Learn</a><a href="/docs/${page.version}/solutions/">Solve</a><a href="/docs/${page.version}/api/">API</a><a href="/docs/${page.version}/packages/">Packages</a></nav><div class="header-tools"><button id="open-search" class="search-trigger" type="button" hidden>Search docs <kbd>⌘ K</kbd></button><details class="version-switch"><summary>v${escape(page.version)} ▾</summary><nav aria-label="Documentation versions">${versions}</nav></details><button type="button" class="utility-control" data-open-shortcuts aria-label="Keys: keyboard shortcuts" hidden>Keys <kbd aria-hidden="true">?</kbd></button><button class="theme-toggle" type="button" aria-label="Change color theme" hidden>Theme</button><a class="github-link" href="${site.repository}">GitHub ↗</a></div></header><div class="reading-progress" aria-hidden="true" hidden></div>`;
}
/** Render version-aware section navigation. @param {object} page Current page. @param {object[]} pages Documents. @returns {string} Sidebar. Reads site sections only. */
function sidebar(page, pages) {
  return `<aside class="sidebar"><details class="mobile-navigation" open><summary>Browse documentation</summary><nav aria-label="Documentation">${site.sections
    .map((section) => {
      const members = pages.filter(
        (item) => item.version === page.version && item.section === section,
      );
      if (!members.length) return "";
      const links = members
        .map(
          (item) =>
            `<a href="${item.url}"${item.url === page.url ? ' aria-current="page"' : ""}>${escape(item.navTitle || item.title)}</a>`,
        )
        .join("");
      return section === "Packages"
        ? `<details class="package-navigation" ${page.section === section ? "open" : ""}><summary>Package guides <span>${members.length}</span></summary>${links}</details>`
        : `<section><h2>${escape(section)}</h2>${links}</section>`;
    })
    .join(
      "",
    )}</nav><div class="sidebar-foot">${escape(page.versionInfo?.status || "Documentation")}<br>Learn · Build · Reference</div></details></aside>`;
}
/** Render a complete HTML document. @param {object} page Current document. @param {object[]} pages All pages. @param {string} content Rendered article. @param {object[]} toc Heading metadata. @returns {string} HTML. No environment values are read. */
export function document(page, pages, content, toc = []) {
  const peers = pages.filter(
    (item) => item.version === page.version && item.section !== "Packages",
  );
  const index = peers.findIndex((item) => item.url === page.url);
  const previous = index > 0 ? peers[index - 1] : null;
  const next = index >= 0 ? peers[index + 1] : null;
  const sourceLinks = (page.sources || [])
    .map(
      (source) =>
        `<li><a href="${site.repository}/blob/${escape(page.versionInfo?.ref || "master")}/${escape(source)}">${escape(source)}</a></li>`,
    )
    .join("");
  const related = (page.related || [])
    .map((slug) =>
      pages.find((item) => item.version === page.version && item.slug === slug),
    )
    .filter(Boolean);
  const neighbors = [previous, next]
    .map((item, i) =>
      item
        ? `<a href="${item.url}"><small>${i ? "Next" : "Previous"}</small>${escape(item.title)} <span aria-hidden="true">${i ? "→" : "←"}</span></a>`
        : "<span></span>",
    )
    .join("");
  const structured = {
    "@context": "https://schema.org",
    "@type":
      page.slug === "home"
        ? "WebSite"
        : page.slug?.startsWith("learn-")
          ? "LearningResource"
          : "TechArticle",
    name: page.title,
    description: page.description,
    inLanguage: "en",
    ...(page.slug?.startsWith("learn-")
      ? {
          learningResourceType: "Lesson",
          educationalLevel: "Beginner to intermediate",
        }
      : {}),
    ...(site.origin ? { url: canonicalUrl(page.url) } : {}),
    isAccessibleForFree: true,
  };
  const jsonLd = JSON.stringify(structured).replace(/</g, "\\u003c");
  const pageTitle = `${page.title} | ZeruxJS Documentation`;
  const pageTools = `<div class="page-actions" aria-label="Page tools"><a href="${markdownPath(page.url)}" data-no-prefetch>↗ View Markdown</a><button type="button" data-bookmark aria-pressed="false" hidden>Save page</button><button class="copy-page" type="button" data-markdown="${markdownPath(page.url)}" hidden>Copy Markdown</button><span data-page-notice role="status"></span></div>`;
  const active = page.slug === "introduction";
  return mountHtml(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escape(page.description)}"><meta name="color-scheme" content="light dark"><meta property="og:title" content="${escape(pageTitle)}"><meta property="og:description" content="${escape(page.description)}"><meta property="og:type" content="${page.slug === "home" ? "website" : "article"}"><meta name="twitter:card" content="summary"><meta name="theme-color" content="#263b74"><link rel="manifest" href="/manifest.webmanifest"><script type="application/ld+json">${jsonLd}</script>${site.origin ? `<link rel="canonical" href="${escape(canonicalUrl(page.url))}"><meta property="og:url" content="${escape(canonicalUrl(page.url))}">` : ""}<link rel="alternate" type="text/markdown" href="${markdownPath(page.url)}" title="Markdown"><title>${escape(pageTitle)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/docs.css"><script type="module" src="/assets/docs.js"></script><script type="module" src="/assets/learning.js"></script><script type="module" src="/assets/offline.js"></script></head><body data-doc-slug="${escape(page.slug)}" data-version="${escape(page.version)}" data-base-path="${escape(site.basePath)}">${header(page, pages)}
<div class="docs-shell">${sidebar(page, pages)}<main id="content" tabindex="-1"><div class="breadcrumb"><a href="/">Docs</a><span>/</span>${escape(page.section)}<span>/</span>v${escape(page.version)}</div><article class="doc-article"><div class="article-meta ui-flex ui-justify-between"><span>${escape(page.section)}</span><span>${page.readingMinutes || 1} min read</span></div><h1>${escape(page.title)}</h1><p class="lead">${escape(page.description)}</p>${page.slug !== "home" ? pageTools : ""}${active ? `<div class="callout"><strong>Start with a working application</strong><p>Learn the runtime by building a notes API, then add the services your application needs.</p><a href="/docs/${page.version}/tutorial/">Follow the tutorial →</a></div>` : ""}${plainLanguage(page)}${content}${learningTools(page)}</article>${related.length ? `<section class="related"><h2>Continue learning</h2><div class="card-grid ui-grid ui-grid-cols-1 cards:ui-grid-cols-2 ui-gap-3">${related.map((item) => `<a class="topic-card" href="${item.url}"><strong>${escape(item.title)} <span>↗</span></strong><p>${escape(item.description)}</p></a>`).join("")}</div></section>` : ""}${sourceLinks ? `<details class="source-details"><summary>Implementation sources</summary><p>Implementation files for the APIs described on this page.</p><ul>${sourceLinks}</ul></details>` : ""}${page.slug === "home" ? pageTools : ""}<div class="page-footer"><a href="${site.repository}/edit/${escape(page.versionInfo?.ref || "master")}/${escape(page.source || "apps/zerux-docs/README.md")}">Edit this page ↗</a><a href="${site.repository}/issues/new">Report a documentation issue ↗</a></div><nav class="neighbors ui-grid ui-grid-cols-2 ui-gap-tight wide:ui-gap-neighbor" aria-label="Previous and next">${neighbors}</nav><footer><p>ZeruxJS · Open source · MIT OR Apache-2.0</p><div class="footer-controls"><a href="/docs/${page.version}/handbook-help/">Handbook controls</a><button type="button" data-motion-toggle hidden>Motion: on</button><button type="button" data-enable-offline hidden>Enable offline reading</button><button type="button" data-disable-offline hidden>Remove offline data</button><button type="button" data-install-app hidden>Install handbook</button><button type="button" data-update-offline hidden>Update handbook</button></div><p data-offline-status role="status"></p></footer></main><aside class="right-rail">${toc.length ? "<h2>On this page</h2>" : ""}<nav aria-label="On this page">${toc.map((item) => `<a class="toc-depth-${item.depth}" href="#${escape(item.id)}">${escape(item.title)}</a>`).join("")}</nav><div class="rail-note">Reading the ${escape(page.version)} docs.<br>${escape(page.versionInfo?.status || "")}<br><a href="/docs/${page.version}/capabilities/">Capabilities and release status →</a></div></aside></div>
<dialog id="shortcuts-dialog" aria-labelledby="shortcuts-title"><div class="search-heading"><h2 id="shortcuts-title">Make yourself at home.</h2><button type="button" data-close-dialog aria-label="Close keyboard shortcuts">Close</button></div><p>Every shortcut has a visible control too. Reading and navigation work without JavaScript.</p><dl class="shortcut-list"><dt><kbd>Ctrl / ⌘ K</kbd></dt><dd>Search all documentation</dd><dt><kbd>/</kbd></dt><dd>Search, outside editable fields</dd><dt><kbd>?</kbd></dt><dd>This help, outside editable fields</dd><dt><kbd>↑ / ↓</kbd></dt><dd>Move through search results</dd><dt><kbd>Esc</kbd></dt><dd>Close a dialog or version menu</dd></dl><label class="exercise-confirm"><input type="checkbox" data-single-shortcuts checked> Enable optional single-key shortcuts (/ and ?)</label><a href="/docs/${page.version}/handbook-help/">Progress, privacy, offline reading and controls →</a></dialog><dialog id="reset-progress-dialog" aria-labelledby="reset-progress-title"><h2 id="reset-progress-title">Reset this learning record?</h2><p>This removes course answers, exercise confirmations, bookmarks and recent pages for this docs version in this browser. Export a copy first if you want to keep it.</p><div class="hero-actions"><button class="primary-button" type="button" data-confirm-reset>Reset my local progress</button><button type="button" data-close-dialog>Keep my progress</button></div></dialog><dialog id="search-dialog" aria-labelledby="search-title"><div class="search-heading"><h2 id="search-title">Search documentation</h2><button type="button" class="close-search" aria-label="Close search">Esc</button></div><label class="visually-hidden" for="search-input">Search topics, APIs and packages</label><input id="search-input" type="search" placeholder="Search topics, APIs and packages…" autocomplete="off"><p id="search-status" role="status" aria-live="polite">Type at least two characters.</p><div id="search-results"></div></dialog></body></html>`);
}
/** Render the documentation portal. @param {object[]} pages Documents. @returns {string} HTML. Reads site configuration only. */
export function home(pages) {
  const intro = pages.find(
    (item) => item.version === site.latest && item.slug === "introduction",
  );
  const page = {
    ...intro,
    title: "Learn, build and solve with ZeruxJS",
    description:
      "Learn ZeruxJS step by step, build with source-backed examples, and find practical fixes. An eight-lesson course with local progress and no account.",
    slug: "home",
    source: "apps/zerux-docs/src/lib/template.mjs",
    section: "Getting started",
    url: sitePath("/"),
    related: [],
    sources: [],
    readingMinutes: 1,
  };
  return document(page, pages, academyHome(site.latest))
    .replace(`<h1>${page.title}</h1>`, "")
    .replace(`<p class="lead">${page.description}</p>`, "")
    .replace('class="doc-article"', 'class="doc-article portal"')
    .replace("<body ", '<body class="portal-layout" ');
}
