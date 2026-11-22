import type { StaticExportPage } from 'zeruxjs/static-export';
import { createZyroRenderer } from 'zeruxjs/renderers';
import {
  analyzeDocumentationMarkdown,
  validateDocumentationLinks,
  type DocumentationMarkdownOptions,
} from './markdown.js';
import { documentationNavigation } from './navigation.js';
import type { DocumentationCatalog, DocumentationPage } from './index.js';
import {
  escapeHtmlText,
  escapeHtmlAttribute,
} from '@zeruxjs/security/encoding';

/** Trusted presentation/resource policy, never loaded from Markdown. */
export interface DocumentationArticleOptions extends Omit<
  DocumentationMarkdownOptions,
  'images'
> {
  /** Inert site label; defaults “Documentation”. */
  siteTitle?: string;
  /** Optional local CSS resource, selected separately by static asset export. */
  stylesheet?: string;
}
/** Optional complete-document presentation; executable paths belong only to trusted host configuration. */
export interface DocumentationDocumentOptions extends DocumentationArticleOptions {
  /** Explicit BCP-47 document language; defaults en without inferring user identity. */
  lang?: string;
  /** Optional local bundled module URL; handler CSP must explicitly enableLocalScripts. */
  script?: string;
}
/** Link one already authorized public navigation record.
 * @param {DocumentationPage} item - Public target record.
 * @param {DocumentationPage} current - Current authorized page.
 * @returns {string} Escaped native link with current-page metadata.
 */
function pageLink(item: DocumentationPage, current: DocumentationPage): string {
  return `<a href="${escapeHtmlAttribute(item.url)}"${item.url === current.url ? ' aria-current="page"' : ''}>${escapeHtmlText(item.title)}</a>`;
}
/** Assemble version/section navigation, related pages and safe Markdown inside a themeable shell.
 * @param {DocumentationCatalog} catalog - Host-owned immutable catalog.
 * @param {DocumentationPage} page - Current page, authorized by the host before rendering private content.
 * @param {DocumentationArticleOptions} [options] - Explicit host labels and image delivery policy.
 * @returns {string} Escaped structural HTML; no inline scripts/styles or browser work occurs.
 */
export function renderDocumentationArticle(
  catalog: DocumentationCatalog,
  page: DocumentationPage,
  options: DocumentationArticleOptions = {}
): string {
  /** Only explicitly authorized private pages can opt into their private image aliases. */
  const content = analyzeDocumentationMarkdown(
    (page.cover ? '![](asset:' + page.cover + ')\n\n' : '') + page.body,
    {
      ...options,
      images: catalog.images(page.version),
      includePrivateImages:
        page.access === 'private' && options.includePrivateImages === true,
    }
  );
  /** Exporter-owned 404 views deliberately have no registered release navigation. */
  const release = catalog.version(page.version);
  if (!release) {
    return `<main class="zerux-docs" id="docs-content"><h1>${escapeHtmlText(page.title)}</h1>${content.html}</main>`;
  }
  /** Hidden pages remain directly addressable but never enter sidebar/adjacent links. */
  const navigation = documentationNavigation(catalog, page.version, page.slug);
  /** Human version labels never alter stored URL identities. */
  const versions = [
    catalog.latest,
    ...catalog.versions.filter((id) => id !== catalog.latest),
  ]
    .map((id) => catalog.get(id, page.slug))
    .filter(
      (item): item is DocumentationPage =>
        item !== undefined && item.access === 'public'
    );
  /** Related links are an explicit source-owned relationship, not an authorization bypass. */
  const related = (page.related ?? [])
    .map((slug) => catalog.get(page.version, slug))
    .filter(
      (item): item is DocumentationPage =>
        item !== undefined && item.access === 'public'
    );
  /** Only known release states become banner classes or English UI labels. */
  const banner =
    release.status && release.status !== 'stable'
      ? `<aside class="zerux-docs-notice" role="note">${escapeHtmlText(release.label ?? release.id)}: ${escapeHtmlText(release.status)} documentation.</aside>`
      : '';
  /** Current hidden pages still have an authored breadcrumb without revealing other hidden titles. */
  const crumbs = navigation.breadcrumbs.length
    ? navigation.breadcrumbs
    : [release.label ?? release.id, page.title];
  return `<div class="zerux-docs-layout"><aside class="zerux-docs-sidebar"><details open><summary>Browse documentation</summary><nav aria-label="Documentation">${navigation.sections.map((section) => `<section>${section.title ? `<h2>${escapeHtmlText(section.title)}</h2>` : ''}<ul>${section.pages.map((item) => `<li>${pageLink(item, page)}</li>`).join('')}</ul></section>`).join('')}</nav><nav aria-label="Documentation versions"><h2>Versions</h2><ul>${versions.map((item) => `<li><a href="${escapeHtmlAttribute(item.url)}"${item.version === page.version ? ' aria-current="true"' : ''}>${escapeHtmlText(catalog.version(item.version)?.label ?? item.version)}</a></li>`).join('')}</ul></nav></details></aside><div class="zerux-docs-content"><nav aria-label="Breadcrumb"><ol>${crumbs.map((crumb) => `<li>${escapeHtmlText(crumb)}</li>`).join('')}</ol></nav>${banner}<main class="zerux-docs" id="docs-content"><h1>${escapeHtmlText(page.title)}</h1>${page.description ? `<p class="zerux-docs-description">${escapeHtmlText(page.description)}</p>` : ''}${page.updatedAt ? `<p>Updated <time datetime="${escapeHtmlAttribute(page.updatedAt)}">${escapeHtmlText(page.updatedAt)}</time></p>` : ''}${page.toc !== false && content.headings.length ? `<nav class="zerux-docs-toc" aria-label="On this page"><h2>On this page</h2><ul>${content.headings.map((heading) => `<li data-level="${heading.level}"><a href="#${escapeHtmlAttribute(heading.id)}">${escapeHtmlText(heading.title)}</a></li>`).join('')}</ul></nav>` : ''}${content.html}${related.length ? `<nav aria-label="Related pages"><h2>Related pages</h2><ul>${related.map((item) => `<li>${pageLink(item, page)}</li>`).join('')}</ul></nav>` : ''}</main><nav class="zerux-docs-adjacent" aria-label="Adjacent pages">${navigation.previous ? 'Previous: ' + pageLink(navigation.previous, page) : ''} ${navigation.next ? 'Next: ' + pageLink(navigation.next, page) : ''}</nav></div></div>`;
}
/** Complete static/dynamic HTML with an optional externally served local stylesheet.
 * @param {DocumentationCatalog} catalog - Host-owned catalog.
 * @param {DocumentationPage} page - Authorized page.
 * @param {DocumentationDocumentOptions} [options] - Host language, local CSS and optional local bundled module; no arbitrary head HTML.
 * @returns {string} Complete document, script-free by default; private pages receive noindex metadata.
 */
export function renderDocumentationDocument(
  catalog: DocumentationCatalog,
  page: DocumentationPage,
  options: DocumentationDocumentOptions = {}
): string {
  /** Language is explicit metadata, not inferred from a user's identity. */
  if (options.lang !== undefined && typeof options.lang !== 'string') {
    throw new TypeError('Invalid documentation language');
  }
  const lang = new Intl.Locale(options.lang ?? 'en').toString();
  if (
    options.stylesheet !== undefined &&
    (typeof options.stylesheet !== 'string' ||
      !/^\/(?!\/)[a-zA-Z0-9_./-]+\.css$/.test(options.stylesheet) ||
      new URL(options.stylesheet, 'https://documentation.invalid').pathname !==
        options.stylesheet)
  ) {
    throw new TypeError('Invalid documentation stylesheet URL');
  }
  if (
    options.script !== undefined &&
    (typeof options.script !== 'string' ||
      !/^\/(?!\/)[A-Za-z0-9_./-]+\.js$/.test(options.script) ||
      new URL(options.script, 'https://documentation.invalid').pathname !==
        options.script)
  ) {
    throw new TypeError('Invalid documentation client script URL');
  }
  if (
    options.siteTitle !== undefined &&
    (typeof options.siteTitle !== 'string' || options.siteTitle.length > 128)
  ) {
    throw new TypeError('Invalid documentation site title');
  }
  return `<!doctype html><html lang="${escapeHtmlAttribute(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtmlText(page.title)} | ${escapeHtmlText(options.siteTitle ?? 'Documentation')}</title>${page.description ? `<meta name="description" content="${escapeHtmlAttribute(page.description)}">` : ''}${page.access === 'private' ? '<meta name="robots" content="noindex, nofollow">' : ''}${options.stylesheet ? `<link rel="stylesheet" href="${escapeHtmlAttribute(options.stylesheet)}">` : ''}</head><body><a class="zerux-docs-skip" href="#docs-content">Skip to content</a>${renderDocumentationArticle(catalog, page, options)}${options.script ? `<script type="module" src="${escapeHtmlAttribute(options.script)}"></script>` : ''}</body></html>`;
}
/** Consume public catalog pages through existing framework export contracts.
 * @param {DocumentationCatalog} catalog - Explicit host catalog; private pages are excluded.
 * @param {DocumentationArticleOptions & {validateLinks?:boolean}} [options] - Link preflight and explicit public-image policy.
 * @returns {{routes:StaticExportPage<DocumentationPage>[],renderer:()=>ReturnType<typeof createZyroRenderer<DocumentationPage>>}} Public export inputs; asset copying remains explicit in the export configuration.
 */
export function documentationStaticRoutes(
  catalog: DocumentationCatalog,
  options: DocumentationArticleOptions & { validateLinks?: boolean } = {}
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
      (version) =>
        validateDocumentationLinks(catalog, version, {
          ...options,
          includePrivateImages: true,
        }).length > 0
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
      createZyroRenderer<DocumentationPage>((page) => {
        if (
          options.stylesheet !== undefined &&
          (!/^\/(?!\/)[A-Za-z0-9_./-]+\.css$/.test(options.stylesheet) ||
            new URL(options.stylesheet, 'https://documentation.invalid')
              .pathname !== options.stylesheet)
        ) {
          throw new TypeError('Invalid documentation stylesheet URL');
        }
        /** Body-safe stylesheet links preserve the older export envelope contract. */
        const stylesheet = options.stylesheet
          ? `<link rel="stylesheet" href="${escapeHtmlAttribute(options.stylesheet)}">`
          : '';
        return (
          stylesheet +
          renderDocumentationArticle(catalog, page, {
            ...options,
            responsiveImages: options.responsiveImages === true,
            includePrivateImages: false,
          })
        );
      }),
  };
}

/** Build optional temporary latest/landing redirects without changing immutable version URLs.
 * @param {DocumentationCatalog} catalog - Explicit public catalog.
 * @param {{landing?:string;alias?:string}} [options] - Optional latest public landing slug and virtual version alias (default latest).
 * @returns {import('zeruxjs/static-export').StaticExportRedirect[]} Explicit temporary redirects; hosts/exporters own HTTP mounting.
 */
export function documentationRedirects(
  catalog: DocumentationCatalog,
  options: { landing?: string; alias?: string } = {}
) {
  /** Virtual aliases cannot shadow an actual registered release. */
  const alias = options.alias ?? 'latest';
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(alias) ||
    catalog.versions.includes(alias)
  ) {
    throw new TypeError(
      'Documentation redirect alias conflicts with a release'
    );
  }
  /** No authenticated/private page is discoverable through generated redirects. */
  const routes: import('zeruxjs/static-export').StaticExportRedirect[] = catalog
    .pages(catalog.latest)
    .filter((page) => page.access === 'public')
    .map((page) => ({
      path:
        (catalog.basePath === '/' ? '' : catalog.basePath) +
        '/' +
        alias +
        '/' +
        page.slug,
      access: 'public',
      redirect: page.url,
      status: 302,
    }));
  if (options.landing !== undefined) {
    /** Host must choose a real public latest page; no guessed slug or fallback version. */
    const page = catalog.get(catalog.latest, options.landing);
    if (!page || page.access !== 'public') {
      throw new TypeError('Invalid documentation landing page');
    }
    routes.push({
      path: catalog.basePath,
      access: 'public',
      redirect: page.url,
      status: 302,
    });
  }
  return routes;
}
