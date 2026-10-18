import { site, sitePath, mountHtml } from '../site.config.mjs';
import { escape } from './markdown.mjs';

/** Render header/navigation shared by every page. @param {object} page Current page. @param {object[]} pages All documents. @returns {string} Safe structural HTML. Reads site configuration only. */
function header(page, pages) {
  const versions = site.versions
    .map((version) => {
      const target =
        pages.find(
          (item) => item.version === version.id && item.slug === page.slug,
        ) ||
        pages.find(
          (item) => item.version === version.id && item.slug === 'introduction',
        );
      return `<a href="${target.url}" ${page.version === version.id ? 'aria-current="true"' : ''}>${escape(version.label)} <small>${escape(version.status)}</small></a>`;
    })
    .join('');
  return `<a class="skip" href="#content">Skip to content</a><header class="site-header"><a class="brand" href="/" aria-label="ZeruxJS home"><span class="brand-mark">Z</span>Zerux<span>JS</span><small>Docs</small></a><nav class="top-nav" aria-label="Primary"><a href="/docs/${page.version}/introduction/">Learn</a><a href="/docs/${page.version}/api/">API</a><a href="/docs/${page.version}/packages/">Packages</a></nav><div class="header-tools"><button id="open-search" class="search-trigger" type="button" hidden>Search docs <kbd>⌘ K</kbd></button><details class="version-switch"><summary>v${escape(page.version)} ▾</summary><nav aria-label="Documentation versions">${versions}</nav></details><button class="theme-toggle" type="button" aria-label="Change color theme" hidden>Theme</button><a class="github-link" href="${site.repository}">GitHub ↗</a></div></header>`;
}
/** Render version-aware section navigation. @param {object} page Current page. @param {object[]} pages Documents. @returns {string} Sidebar. Reads site sections only. */
function sidebar(page, pages) {
  return `<aside class="sidebar"><details class="mobile-navigation" open><summary>Browse documentation</summary><nav aria-label="Documentation">${site.sections
    .map((section) => {
      const members = pages.filter(
        (item) => item.version === page.version && item.section === section,
      );
      if (!members.length) return '';
      const links = members
        .map(
          (item) =>
            `<a href="${item.url}"${item.url === page.url ? ' aria-current="page"' : ''}>${escape(item.navTitle || item.title)}</a>`,
        )
        .join('');
      return section === 'Packages'
        ? `<details class="package-navigation" ${page.section === section ? 'open' : ''}><summary>Package guides <span>${members.length}</span></summary>${links}</details>`
        : `<section><h2>${escape(section)}</h2>${links}</section>`;
    })
    .join(
      '',
    )}</nav><div class="sidebar-foot">${escape(page.versionInfo?.status || 'Documentation')}<br>Learn · Build · Reference</div></details></aside>`;
}
/** Render a complete HTML document. @param {object} page Current document. @param {object[]} pages All pages. @param {string} content Rendered article. @param {object[]} toc Heading metadata. @returns {string} HTML. No environment values are read. */
export function document(page, pages, content, toc = []) {
  const peers = pages.filter(
    (item) => item.version === page.version && item.section !== 'Packages',
  );
  const index = peers.findIndex((item) => item.url === page.url);
  const previous = index > 0 ? peers[index - 1] : null;
  const next = index >= 0 ? peers[index + 1] : null;
  const sourceLinks = (page.sources || [])
    .map(
      (source) =>
        `<li><a href="${site.repository}/blob/${escape(page.versionInfo?.ref || 'master')}/${escape(source)}">${escape(source)}</a></li>`,
    )
    .join('');
  const related = (page.related || [])
    .map((slug) =>
      pages.find((item) => item.version === page.version && item.slug === slug),
    )
    .filter(Boolean);
  const neighbors = [previous, next]
    .map((item, i) =>
      item
        ? `<a href="${item.url}"><small>${i ? 'Next' : 'Previous'}</small>${escape(item.title)} <span aria-hidden="true">${i ? '→' : '←'}</span></a>`
        : '<span></span>',
    )
    .join('');
  const pageTitle = `${page.title} | ZeruxJS Documentation`;
  const active = page.slug === 'introduction';
  return mountHtml(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escape(page.description)}"><meta name="color-scheme" content="light dark"><meta property="og:title" content="${escape(pageTitle)}"><meta property="og:description" content="${escape(page.description)}"><meta property="og:type" content="article">${site.origin ? `<link rel="canonical" href="${escape(new URL(page.url, site.origin).href)}"><meta property="og:url" content="${escape(new URL(page.url, site.origin).href)}">` : ''}<title>${escape(pageTitle)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/docs.css"><script src="/assets/docs.js" defer></script></head><body data-version="${escape(page.version)}" data-base-path="${escape(site.basePath)}">${header(page, pages)}
<div class="docs-shell">${sidebar(page, pages)}<main id="content"><div class="breadcrumb"><a href="/">Docs</a><span>/</span>${escape(page.section)}<span>/</span>v${escape(page.version)}</div><article class="doc-article"><div class="article-meta"><span>${escape(page.section)}</span><span>${page.readingMinutes || 1} min read</span></div><h1>${escape(page.title)}</h1><p class="lead">${escape(page.description)}</p>${active ? `<div class="callout"><strong>Start with a working application</strong><p>Learn the runtime by building a notes API, then add the services your application needs.</p><a href="/docs/${page.version}/tutorial/">Follow the tutorial →</a></div>` : ''}${content}</article>${related.length ? `<section class="related"><h2>Continue learning</h2><div class="card-grid">${related.map((item) => `<a class="topic-card" href="${item.url}"><strong>${escape(item.title)} <span>↗</span></strong><p>${escape(item.description)}</p></a>`).join('')}</div></section>` : ''}${sourceLinks ? `<details class="source-details"><summary>Implementation sources</summary><p>Implementation files for the APIs described on this page.</p><ul>${sourceLinks}</ul></details>` : ''}<div class="page-footer"><a href="${site.repository}/edit/master/${escape(page.source || 'apps/zerux-docs/README.md')}">Edit this page ↗</a><a href="${site.repository}/issues/new">Report a documentation issue ↗</a></div><nav class="neighbors" aria-label="Previous and next">${neighbors}</nav><footer>ZeruxJS · Open source · MIT OR Apache-2.0</footer></main><aside class="right-rail">${toc.length ? '<h2>On this page</h2>' : ''}<nav aria-label="On this page">${toc.map((item) => `<a class="toc-depth-${item.depth}" href="#${escape(item.id)}">${escape(item.title)}</a>`).join('')}</nav><div class="rail-note">Reading the ${escape(page.version)} docs.<br>${escape(page.versionInfo?.status || '')}<br><a href="/docs/${page.version}/capabilities/">Capabilities and release status →</a></div></aside></div>
<dialog id="search-dialog" aria-labelledby="search-title"><div class="search-heading"><h2 id="search-title">Search documentation</h2><button type="button" class="close-search" aria-label="Close search">Esc</button></div><label class="visually-hidden" for="search-input">Search topics, APIs and packages</label><input id="search-input" type="search" placeholder="Search topics, APIs and packages…" autocomplete="off"><p id="search-status" role="status" aria-live="polite">Type at least two characters.</p><div id="search-results"></div></dialog></body></html>`);
}
/** Render the documentation portal. @param {object[]} pages Documents. @returns {string} HTML. Reads site configuration only. */
export function home(pages) {
  const version = site.latest;
  const links = [
    [
      'tutorial',
      '01',
      'Build your first app',
      'A guided project from routes to production build.',
    ],
    [
      'mental-model',
      '02',
      'Understand the runtime',
      'Requests, plugins, generations and ownership.',
    ],
    [
      'database-queries',
      '03',
      'Connect your data',
      'Named connections, caching and service boundaries.',
    ],
    [
      'packages',
      '04',
      'Explore the ecosystem',
      'Focused guides for the packages you actually use.',
    ],
  ];
  const intro = pages.find(
    (item) => item.version === version && item.slug === 'introduction',
  );
  const content = `<div class="portal-intro"><p class="eyebrow">THE ZERUXJS HANDBOOK</p><h1>From your first route<br>to a connected application.</h1><p>Learn the server runtime, work with focused packages, and understand the contracts behind your application.</p><div class="hero-actions"><a class="primary-button" href="/docs/${version}/tutorial/">Start building <span>→</span></a><a class="secondary-button" href="/docs/${version}/mental-model/">Explore the architecture</a></div><div class="release-note"><span class="status-dot"></span>Version ${version} · Early development · <a href="/docs/${version}/capabilities/">See what is implemented</a></div></div><h2 class="portal-section">Choose your next step</h2><div class="portal-grid">${links.map(([slug, number, title, body]) => `<a class="portal-card" href="/docs/${version}/${slug}/"><span class="card-number">${number} /</span><h3>${title} <span>↗</span></h3><p>${body}</p></a>`).join('')}</div><div class="portal-bottom"><h2>A guide for each layer</h2><p>File routes and middleware. Lifecycle-managed workers. Database, cache, files and email. Browser state bridges and accessible interactions. Each guide explains setup, ownership, constraints and the source that defines the contract.</p></div>`;
  return document(
    {
      ...intro,
      title: 'The ZeruxJS handbook',
      description: site.description,
      slug: 'home',
      source: 'apps/zerux-docs/src/lib/template.mjs',
      section: 'Getting started',
      url: sitePath('/'),
      related: [],
      sources: [],
      readingMinutes: 1,
    },
    pages,
    content,
  )
    .replace('<h1>The ZeruxJS handbook</h1>', '')
    .replace('class="doc-article"', 'class="doc-article portal"');
}
