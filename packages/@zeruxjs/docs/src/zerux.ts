import type { StaticExportPage } from 'zeruxjs/static-export';
import { createZyroRenderer } from 'zeruxjs/renderers';
import {
  analyzeDocumentationMarkdown,
  validateDocumentationLinks,
} from './markdown.js';
import { documentationNavigation } from './navigation.js';
import type { DocumentationCatalog, DocumentationPage } from './index.js';
import {
  escapeHtmlText,
  escapeHtmlAttribute,
} from '@zeruxjs/security/encoding';

/** Assemble accessible version/page navigation without exposing private page titles.
 * @param {DocumentationCatalog} catalog - Host-owned immutable catalog.
 * @param {DocumentationPage} page - Authorized current page.
 * @returns {string} Escaped structural navigation and Markdown article fragment.
 */
export function renderDocumentationArticle(
  catalog: DocumentationCatalog,
  page: DocumentationPage
): string {
  // Exporter-owned 404 views are deliberately outside registered release navigation.
  if (!catalog.versions.includes(page.version)) {
    return `<main class="zerux-docs"><h1>${escapeHtmlText(page.title)}</h1>${analyzeDocumentationMarkdown(page.body).html}</main>`;
  }
  /** Public-only authored ordering and adjacent links share the headless contract. */
  const navigation = documentationNavigation(catalog, page.version, page.slug);
  /** Body H1 headings are demoted; the page title owns the sole document H1. */
  const content = analyzeDocumentationMarkdown(page.body);
  /** Every href and label is escaped separately from stored Markdown. */
  const link = (item: DocumentationPage) =>
    `<a href="${escapeHtmlAttribute(item.url)}"${item.slug === page.slug ? ' aria-current="page"' : ''}>${escapeHtmlText(item.title)}</a>`;
  return `<nav aria-label="Documentation">${navigation.sections.map((section) => `<div>${section.title ? `<strong>${escapeHtmlText(section.title)}</strong>` : ''}${section.pages.map(link).join(' ')}</div>`).join('')}<span>Version:</span> ${catalog.versions
    .map((id) => catalog.get(id, page.slug))
    .filter(
      (item): item is DocumentationPage =>
        item !== undefined && item.access === 'public'
    )
    .map(
      (item) =>
        `<a href="${escapeHtmlAttribute(item.url)}">${escapeHtmlText(item.version)}</a>`
    )
    .join(
      ' '
    )}</nav><p aria-label="Breadcrumb">${navigation.breadcrumbs.map(escapeHtmlText).join(' / ')}</p><main class="zerux-docs"><h1>${escapeHtmlText(page.title)}</h1>${content.headings.length ? `<nav aria-label="On this page">${content.headings.map((heading) => `<a href="#${escapeHtmlAttribute(heading.id)}">${escapeHtmlText(heading.title)}</a>`).join(' ')}</nav>` : ''}${content.html}</main><nav aria-label="Adjacent pages">${navigation.previous ? 'Previous: ' + link(navigation.previous) : ''} ${navigation.next ? 'Next: ' + link(navigation.next) : ''}</nav>`;
}
/** Consume public catalog output through existing framework renderer/export contracts.
 * @param {DocumentationCatalog} catalog - Explicit host catalog; private pages are excluded.
 * @param {{validateLinks?:boolean}} [options] - Explicit release-link preflight before export.
 * @returns {{routes:StaticExportPage<DocumentationPage>[],renderer:()=>ReturnType<typeof createZyroRenderer<DocumentationPage>>}} Public export inputs; root/origin/output/404 remain host-owned.
 */
export function documentationStaticRoutes(
  catalog: DocumentationCatalog,
  options: { validateLinks?: boolean } = {}
) {
  if (
    options.validateLinks !== undefined &&
    typeof options.validateLinks !== 'boolean'
  ) {
    throw new TypeError('Invalid documentation link validation option');
  }
  if (
    options.validateLinks &&
    catalog.versions.some(
      (version) => validateDocumentationLinks(catalog, version).length > 0
    )
  ) {
    throw new TypeError('Documentation export has invalid local links');
  }
  return {
    routes: catalog
      .pages()
      .filter((page) => page.access === 'public')
      .map(
        (page): StaticExportPage<DocumentationPage> => ({
          path: page.url.replace(/\/$/, ''),
          title: page.title,
          access: 'public',
          view: () => page,
        })
      ),
    renderer: () =>
      createZyroRenderer<DocumentationPage>((page) =>
        renderDocumentationArticle(catalog, page)
      ),
  };
}
