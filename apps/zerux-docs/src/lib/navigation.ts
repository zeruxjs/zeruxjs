/** Authored documentation taxonomy. URLs remain versioned and existing slugs never move. */
export const navigationGroups = Object.freeze(
  [
    {
      id: 'start',
      label: 'Get Started',
      slug: 'introduction',
      description:
        'Install, understand the runtime and build your first application.',
    },
    {
      id: 'structure',
      label: 'Structure',
      slug: 'structure',
      description:
        'Every structure mode, directory and public/private boundary.',
    },
    {
      id: 'guide',
      label: 'Guide',
      slug: 'guide',
      description:
        'Connect rendering, data, services and application lifecycles.',
    },
    {
      id: 'api',
      label: 'API',
      slug: 'api',
      description: 'Public contracts and authored guides for every package.',
    },
    {
      id: 'deploy',
      label: 'Deploy',
      slug: 'deployment',
      description:
        'Build, export and operate with explicit runtime requirements.',
    },
    {
      id: 'examples',
      label: 'Examples',
      slug: 'examples',
      description:
        'Small public-import recipes with prerequisites and expected results.',
    },
  ].map(Object.freeze)
);
/** Legacy structure-topic identities retain their existing URLs while joining the Structure collection. */
const structureSlugs = new Set([
  'project-structure',
  'file-conventions',
  'configuration-structure',
  'static-assets',
  'environment',
]);
/** Explicit example-topic identities supplement the example- slug convention. */
const exampleSlugs = new Set([
  'tutorial',
  'configuration-examples',
  'private-file-api',
  'tenant-data',
  'localization-site-settings',
]);
export function groupFor(page) {
  if (page.navigation !== undefined) {
    /** Explicit metadata selection must identify a configured collection before rendering. */
    const group = navigationGroups.find(
      (group) => group.id === page.navigation
    );
    if (!group) throw Error('Unknown documentation navigation group');
    return group;
  }
  /** Deterministic default collection derived from existing metadata and stable topic conventions. */
  const id =
    page.package ||
    ['Packages', 'API reference', 'Package reference'].includes(page.section)
      ? 'api'
      : page.slug === 'structure' ||
          page.slug.startsWith('structure-') ||
          structureSlugs.has(page.slug)
        ? 'structure'
        : page.slug === 'examples' ||
            page.slug.startsWith('example-') ||
            exampleSlugs.has(page.slug)
          ? 'examples'
          : page.section === 'Operations' ||
              page.slug === 'deployment' ||
              page.slug.startsWith('deploy-')
            ? 'deploy'
            : ['Getting started', 'Learning'].includes(page.section)
              ? 'start'
              : 'guide';
  return navigationGroups.find((group) => group.id === id);
}
export function groupPages(page, pages) {
  return pages.filter(
    (item) =>
      item.version === page.version && groupFor(item).id === groupFor(page).id
  );
}

export function packageFamily(name) {
  if (/(?:cache|db|search)(?:-|$)/.test(name)) return 'Data and search';
  if (/(?:files|media|asset-manager|font|seo|feed|share|zenix)/.test(name))
    return 'Content and CMS';
  if (
    /(?:queue|email|analytics|tags|reports|auth|security|validator)/.test(name)
  )
    return 'Server services';
  if (/(?:zyro|react|vue|zuixs|zlocale|accessibility|performance)/.test(name))
    return 'Rendering and UI';
  return 'Runtime and tooling';
}

/** Preserve archived slugs when a collection landing did not exist in that version. */
export function groupTarget(group, page, pages) {
  /** Same-version pages only; archived navigation never jumps silently to current content. */
  const candidates = pages.filter((item) => item.version === page.version);
  /** Preferred collection landing, then a collection member, then same-version introduction. */
  const target =
    candidates.find((item) => item.slug === group.slug) ||
    candidates.find((item) => groupFor(item).id === group.id) ||
    candidates.find((item) => item.slug === 'introduction');
  if (!target) throw Error('Missing documentation navigation target');
  return target.url;
}
