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
/** Choose a collection from validated explicit metadata or stable topic conventions.
 * @param {object} page - Authored metadata and slug; an explicit unknown navigation ID rejects.
 * @returns {object} Configured collection record, preserving the existing classification order.
 */
export function groupFor(page) {
  if (page.navigation !== undefined) {
    /** Explicit metadata selection must identify a configured collection before rendering. */
    const group = navigationGroups.find(
      (group) => group.id === page.navigation
    );
    if (!group) {
      throw Error('Unknown documentation navigation group');
    }
    return group;
  }
  /** Deterministic default collection derived from existing metadata and stable topic conventions. */
  let id;
  if (
    page.package ||
    ['Packages', 'API reference', 'Package reference'].includes(page.section)
  ) {
    id = 'api';
  } else if (
    page.slug === 'structure' ||
    page.slug.startsWith('structure-') ||
    structureSlugs.has(page.slug)
  ) {
    id = 'structure';
  } else if (
    page.slug === 'examples' ||
    page.slug.startsWith('example-') ||
    exampleSlugs.has(page.slug)
  ) {
    id = 'examples';
  } else if (
    page.section === 'Operations' ||
    page.slug === 'deployment' ||
    page.slug.startsWith('deploy-')
  ) {
    id = 'deploy';
  } else if (['Getting started', 'Learning'].includes(page.section)) {
    id = 'start';
  } else {
    id = 'guide';
  }
  return navigationGroups.find((group) => group.id === id);
}
/** Select peers within the current version and collection only.
 * @param {object} page - Current versioned document.
 * @param {object[]} pages - Validated complete page inventory.
 * @returns {object[]} Same-version collection members in their existing navigation order.
 */
export function groupPages(page, pages) {
  return pages.filter(
    (item) =>
      item.version === page.version && groupFor(item).id === groupFor(page).id
  );
}

/** Group package navigation by documented responsibility without loading package code.
 * @param {string} name - Actual public package name from the manifest inventory.
 * @returns {string} Human-readable family label with a runtime/tooling fallback.
 */
export function packageFamily(name) {
  if (/(?:cache|db|search)(?:-|$)/.test(name)) {
    return 'Data and search';
  }
  if (/(?:files|media|asset-manager|font|seo|feed|share|zenix)/.test(name)) {
    return 'Content and CMS';
  }
  if (
    /(?:queue|email|analytics|tags|reports|auth|security|validator)/.test(name)
  ) {
    return 'Server services';
  }
  if (/(?:zyro|react|vue|zuixs|zlocale|accessibility|performance)/.test(name)) {
    return 'Rendering and UI';
  }
  return 'Runtime and tooling';
}

/** Preserve archived slugs when a collection landing did not exist in that version.
 * @param {object} group - Configured collection with its preferred landing slug.
 * @param {object} page - Current version boundary.
 * @param {object[]} pages - Validated page inventory.
 * @returns {string} Existing same-version landing/member/introduction URL; throws if no fallback exists.
 */
export function groupTarget(group, page, pages) {
  /** Same-version pages only; archived navigation never jumps silently to current content. */
  const candidates = pages.filter((item) => item.version === page.version);
  /** Preferred collection landing, then a collection member, then same-version introduction. */
  const target =
    candidates.find((item) => item.slug === group.slug) ||
    candidates.find((item) => groupFor(item).id === group.id) ||
    candidates.find((item) => item.slug === 'introduction');
  if (!target) {
    throw Error('Missing documentation navigation target');
  }
  return target.url;
}
