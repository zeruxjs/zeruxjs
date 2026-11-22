import type { DocumentationCatalog, DocumentationPage } from './index.js';

/** Build detached public navigation; private titles never enter sidebar or adjacent links.
 * @param {DocumentationCatalog} catalog - Immutable host catalog.
 * @param {string} version - Exact release; unknown releases reject.
 * @param {string} [slug] - Optional current page for adjacent links and breadcrumbs.
 * @returns {object} Ordered pages, section groups, breadcrumbs and adjacent public pages.
 */
export function documentationNavigation(
  catalog: DocumentationCatalog,
  version: string,
  slug?: string
) {
  if (!catalog.versions.includes(version)) {
    throw new TypeError('Unknown documentation navigation version');
  }
  /** Explicit order precedes locale-independent identity ties. */
  const pages = catalog
    .pages(version)
    .filter((page) => page.access === 'public' && page.hidden !== true)
    .sort(
      (a, b) =>
        (a.order ?? 0) - (b.order ?? 0) ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
    );
  /** Sections retain the first ordered page's position, not locale-dependent label sorting. */
  const groups = new Map<string, DocumentationPage[]>();
  for (const page of pages) {
    /** Empty group represents explicitly unsectioned content. */
    const section = page.section ?? '';
    if (!groups.has(section)) {
      groups.set(section, []);
    }
    groups.get(section)!.push(page);
  }
  /** Sidebar grouping and adjacent navigation share one final reading order. */
  const ordered = [...groups.values()].flat();
  /** Missing/private identities have no adjacent-page disclosure. */
  const current = ordered.findIndex((page) => page.slug === slug);
  return {
    pages: ordered,
    sections: [...groups].map(([title, items]) => ({ title, pages: items })),
    breadcrumbs:
      current < 0
        ? []
        : [
            version,
            ...(ordered[current]!.section ? [ordered[current]!.section!] : []),
            ordered[current]!.title,
          ],
    previous: current > 0 ? ordered[current - 1] : undefined,
    next: current >= 0 ? ordered[current + 1] : undefined,
  };
}
