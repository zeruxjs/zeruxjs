import { validateAcademy } from '../src/lib/academy.ts';
import { emitOffline } from './offline.ts';
import { navigationGroups } from '../src/lib/navigation.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, loadContent } from '../src/lib/content.ts';
import { site, sitePath, canonicalUrl } from '../src/site.config.ts';
import { markdown, escape } from '../src/lib/markdown.ts';
import { document, home } from '../src/lib/template.ts';
import { versionReference } from '../src/lib/reference.ts';
import { check } from './check.ts';
import zuix from '../zuix.config.ts';
import {
  optimizeStaticAssets,
  htmlFiles,
} from '../../../scripts/static-site-assets.ts';

import {
  rawMarkdown,
  markdownPath,
  markdownDigest,
} from '../src/lib/raw-markdown.ts';

export { root };
/** Fixed app-local export destination; imports do not create or replace it. */
export const output = path.join(root, 'dist');

/** Render an import map as an accessible table.
 * @param {object} item Package manifest.
 * @returns {string} Structural HTML. No globals. */
function manifestHtml(item) {
  /** Manifest-owned export entries rendered as escaped reference data, never imported code. */
  const entries = Object.entries(
    item.exports ?? { '.': item.main || '(no entry point)' }
  );
  return `<section class="manifest-reference"><h2 id="public-entry-points">Public entry points</h2><p>Manifest reference for <code>${escape(item.name)}@${escape(item.version)}</code>. Each target describes a published entry, not automatic framework registration.</p><div class="table-wrap"><table><thead><tr><th>Import</th><th>Target</th></tr></thead><tbody>${entries.map(([key, value]) => `<tr><td><code>${escape(key === '.' ? item.name : item.name + key.slice(1))}</code></td><td><pre>${escape(typeof value === 'string' ? value : JSON.stringify(value, null, 2))}</pre></td></tr>`).join('')}</tbody></table></div><details><summary>Runtime requirements and dependencies</summary><pre><code>${escape(JSON.stringify({ engines: item.engines ?? {}, dependencies: item.dependencies ?? {}, peerDependencies: item.peerDependencies ?? {}, bin: item.bin ?? {} }, null, 2))}</code></pre></details></section>`;
}
/** Create source-backed reference pages without inventing package behavior.
 *
 * @param {object[]} pages Authored documents.
 * @returns {Promise<Map>} Per-version manifest snapshots. Reads explicit version reference configuration.
 */
async function addReferencePages(pages) {
  /** Per-version manifest/README snapshots shared by HTML and Markdown output. */
  const references = new Map();
  for (const version of site.versions) {
    /** Source-backed public package records for this exact documentation version. */
    const inventory = await versionReference(version);
    references.set(version.id, inventory);
    /** Only this version’s authored pages can claim its public packages. */
    const authored = pages.filter((page) => page.version === version.id);
    /** Explicit package claims must be unique and match the real inventory. */
    const claims = authored
      .filter((page) => page.package)
      .map((page) => page.package);
    if (new Set(claims).size !== claims.length) {
      throw new Error(`Duplicate authored package guide in ${version.id}`);
    }
    for (const name of claims) {
      if (!inventory.some((item) => item.name === name)) {
        throw new Error(`Unknown package guide: ${name}`);
      }
    }
    for (const item of inventory.filter(
      (item) =>
        version.reference === 'workspace' || item.name.startsWith('@zeruxjs/')
    )) {
      if (!claims.includes(item.name)) {
        throw new Error(`Missing authored package guide for ${item.name}`);
      }
    }
    /** Shared generated-page metadata bound to the current version and known source paths. */
    const base = {
      version: version.id,
      versionInfo: version,
      sources: ['apps/zerux-docs/src/site.config.ts'],
      source: 'apps/zerux-docs/README.md',
      readingMinutes: 2,
      related: ['capabilities', 'configuration-reference'],
    };
    for (const item of inventory) {
      let page = authored.find((page) => page.package === item.name);
      if (!page) {
        /** Fallback reference identity preserves the established package-name slug convention. */
        const slug =
          'reference-' + item.name.replace('@', '').replaceAll('/', '-');
        page = {
          ...base,
          title: item.name,
          description: item.description || 'Ecosystem package reference.',
          slug,
          section: 'Package reference',
          order: 0,
          url: sitePath(`/docs/${version.id}/${slug}/`),
          package: item.name,
          body:
            item.readme ||
            'See the linked package source for current implementation details.',
          sources: [item.source + '/package.json', item.source + '/README.md'],
          source: item.source + '/README.md',
        };
        pages.push(page);
      }
      page.manifest = item;
      page.readme = item.readme;
    }
    /** Escaped package-directory cards point at actual version-local guides. */
    const cards = inventory
      .map((item) => {
        /** Exact version/package guide selected from the validated inventory. */
        const page = pages.find(
          (page) => page.version === version.id && page.package === item.name
        );
        return `<a class="topic-card package-card" href="${page.url}"><strong>${escape(item.name)} <span>↗</span></strong><p>${escape(item.description || 'Ecosystem package')}</p><small>v${escape(item.version)}</small></a>`;
      })
      .join('');
    pages.push({
      ...base,
      title: 'Package directory',
      description: `${inventory.length} public packages. Choose a task-focused guide or inspect the source contract.`,
      slug: 'packages',
      section: 'API reference',
      order: 80,
      url: sitePath(`/docs/${version.id}/packages/`),
      body: '## Find the right layer\n\nThe framework coordinates the runtime. Focused packages supply data, storage, communication, content and browser capabilities. Package guides explain setup, ownership and failure behavior. Manifest references and linked READMEs expose the exact declared entry points.\n\n## Public packages\n\nPrivate and sample workspaces are excluded. A published name does not imply a completed integration or production certification.',
      extra: `<div class="package-filter" hidden><label for="package-filter">Filter packages</label><input type="search" id="package-filter" placeholder="Database, cache, email…"><p id="package-count" role="status"></p></div><div class="card-grid package-grid ui-grid ui-grid-cols-1 cards:ui-grid-cols-2 ui-gap-3">${cards}</div>`,
    });
    pages.push({
      ...base,
      title: 'Framework API overview',
      description:
        'Navigate the public contracts by responsibility, then inspect exact import paths.',
      sources: [
        'packages/zeruxjs/src/index.ts',
        'packages/zeruxjs/src/bootstrap/types.ts',
      ],
      slug: 'api',
      section: 'API reference',
      order: 0,
      url: sitePath(`/docs/${version.id}/api/`),
      body: '## Start with a contract\n\n- [Configuration reference](configuration-reference.md): project structure, hosts, service startup and runtime settings.\n- [Request context](context-reference.md): params, query, state, services and response access.\n- [Plugin API](plugin-reference.md): registrations and generation ownership.\n- [Response API](response-reference.md): cache policies, streams, redirects and deliberate errors.\n- [Workers](workers.md): startup cleanup and thread-pool tasks.\n- [Fetch bridge](fetch-handlers.md): interoperable Web Request/Response handlers.\n- [Template variables](template-variables.md): bounded interpolation and escaping.\n\n## Import paths\n\nUse public export-map entries. Private source paths and generated dist internals are not stable application imports.',
      extra: manifestHtml(inventory.find((item) => item.name === 'zeruxjs')),
    });
  }
  return references;
}
/** Build a validated static documentation export.
 * @param {object} root0 - Explicit build policy; importing the module never builds.
 * @param {boolean} root0.production - Whether to optimize production assets and omit source maps.
 * @returns {Promise<void>} Completion. Writes fixed app-local output; never starts framework services. */
export async function build({ production = true } = {}) {
  if (site.origin) {
    /** Explicit configured public origin; credentials/path/query/hash are rejected before writing. */
    const origin = new URL(site.origin);
    if (
      !['https:', 'http:'].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    ) {
      throw new Error(
        'site.origin must be a public domain origin without a path, credentials, query or fragment'
      );
    }
  }
  if (
    site.deploymentPath &&
    !/^\/branch\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(site.deploymentPath)
  ) {
    throw new Error('Choose an explicit safe branch preview deploymentPath');
  }
  if (!/^\/[a-z0-9-]+$/.test(site.basePath)) {
    throw new Error('Choose a single-segment static site basePath');
  }
  /** Complete candidate page inventory, validated before acquiring a staging directory. */
  const pages = await loadContent();
  /** Per-version manifest/README snapshots shared by HTML and Markdown output. */
  const references = await addReferencePages(pages);
  validateAcademy(
    pages,
    site.versions.map((version) => version.id)
  );
  pages.sort((a, b) => {
    /** Read configured section precedence, placing unknown labels last.
     * @param {string} value - Authored section label.
     * @returns {number} Stable section order without modifying the page inventory.
     */
    const order = (value) => {
      /** Configured section order; unknown sections sort after known sections. */
      const index = site.sections.indexOf(value);
      return index < 0 ? site.sections.length : index;
    };
    return (
      order(a.section) - order(b.section) ||
      a.order - b.order ||
      a.title.localeCompare(b.title)
    );
  });
  /** Exact candidate route identities; duplicate output routes reject before writes. */
  const seen = new Set();
  for (const page of pages) {
    if (seen.has(page.url)) {
      throw new Error(`Duplicate route: ${page.url}`);
    }
    seen.add(page.url);
  }
  /** Owned app-local candidate tree, removed in finally; only a validated complete candidate is promoted. */
  const staging = await fs.mkdtemp(path.join(root, '.docs-build-'));
  /** Public document/heading records accumulated for the candidate’s static search index. */
  const search = [];
  /** URL-to-digest integrity map for every emitted raw Markdown representation. */
  const markdownFiles = {};
  /** Write one validated public Markdown route into the owned candidate only.
   * @param {string} url - Validated mounted route, never an arbitrary destination.
   * @param {string} text - Inert public Markdown body.
   * @returns {Promise<void>} Records the digest only after a successful file write.
   */
  async function emitMarkdown(url, text) {
    /** Candidate-local Markdown destination; callers supply already validated internal routes. */
    const file = path.join(staging, url.slice(1));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
    markdownFiles[url] = markdownDigest(text);
  }
  /** Candidate root aligned with the configured public mount, never the operator’s running output. */
  const mountedRoot = path.join(staging, site.basePath.slice(1));
  await fs.mkdir(mountedRoot, { recursive: true });
  try {
    await fs.cp(path.join(root, 'public'), mountedRoot, {
      recursive: true,
      dereference: false,
    });
    for (const page of pages) {
      /** Reference-only pages resolve prose against package source rather than authored docs routes. */
      const isGeneratedReadme = page.section === 'Package reference';
      /** Exact repository/ref/package README base for portable relative links. */
      const sourceUrl = `${site.repository}/blob/${page.versionInfo.ref || 'master'}/${page.manifest?.source}/README.md`;
      /** Article HTML and heading metadata from the inert Markdown parser. */
      const rendered = markdown(page.body, {
        version: page.version,
        ...(isGeneratedReadme ? { sourceUrl } : {}),
      });
      let content = rendered.html + (page.extra || '');
      if (page.manifest) {
        content += manifestHtml(page.manifest);
        if (!isGeneratedReadme && page.readme) {
          /** Separately rendered reference README; heading prefixes avoid collisions with the authored article. */
          const readme = markdown(page.readme, {
            version: page.version,
            sourceUrl,
          });
          // Prefix README headings to keep repeated README topics separate from authored guide anchors.
          content += `<details class="readme-reference"><summary>Full package README</summary><div>${readme.html.replace(/id="([^"]+)"/g, 'id="readme-$1"').replace(/href="#([^"]+)"/g, 'href="#readme-$1"')}</div></details>`;
        }
      }
      /** Candidate-only HTML output path; public output remains unchanged until all checks succeed. */
      const target = path.join(staging, page.url.slice(1), 'index.html');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, document(page, pages, content, rendered.toc));
      /** Portable Markdown text shared by flat and index aliases. */
      const raw = rawMarkdown(page, pages, references.get(page.version));
      await emitMarkdown(markdownPath(page.url), raw);
      await emitMarkdown(page.url + 'index.md', raw);
      search.push({
        title: page.title,
        section: page.section,
        version: page.version,
        url: page.url,
        text: page.body
          .split(/^#{1,3}\s.+$/m)[0]
          .replace(/[#*`>|]/g, ' ')
          .slice(0, 2000),
        description: page.description,
      });
      for (const heading of rendered.toc) {
        search.push({
          title: heading.title,
          section: `${page.title} / ${page.section}`,
          version: page.version,
          url: page.url + '#' + heading.id,
          text: (heading.text || page.description)
            .replace(/[#*`>|]/g, ' ')
            .slice(0, 5000),
          description: page.description,
        });
      }
    }
    await fs.writeFile(path.join(mountedRoot, 'index.html'), home(pages));
    await fs.writeFile(
      path.join(mountedRoot, 'offline.html'),
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>You are offline | ZeruxJS Docs</title><link rel="stylesheet" href="${sitePath('/assets/docs.css')}"></head><body><main class="offline-page"><article><p>ZERUXJS FIELD GUIDE</p><h1>This page is not saved offline yet.</h1><p>Reconnect to open it. Previously read eligible articles may still be available. Offline copies can be older than the live handbook.</p><a href="${sitePath('/')}">Open your handbook home →</a><p>Your local learning progress is separate from the offline cache.</p></article></main></body></html>`
    );
    await fs.writeFile(path.join(mountedRoot, '.nojekyll'), '');
    /** Public portal content for the Markdown alternative, independent of HTML navigation chrome. */
    const portal = {
      title: 'The ZeruxJS handbook',
      description: site.description,
      body:
        '## Start learning\n\n[Eight-lesson course](' +
        sitePath(`/docs/${site.latest}/learn/`) +
        ') · [Find a solution](' +
        sitePath(`/docs/${site.latest}/solutions/`) +
        ') · [Glossary](' +
        sitePath(`/docs/${site.latest}/glossary/`) +
        ')\n\n## Browse documentation\n\n' +
        navigationGroups
          .map(
            (group) =>
              `- [${group.label}](${sitePath(`/docs/${site.latest}/${group.slug}/`)}) — ${group.description}`
          )
          .join('\n'),
    };
    await emitMarkdown(sitePath('/index.md'), rawMarkdown(portal, pages));
    await emitMarkdown(
      sitePath('/404.md'),
      '# Page not found\n\nThis route does not exist. Browse the [documentation home](' +
        sitePath('/') +
        ').\n'
    );
    for (const version of site.versions) {
      /** Existing same-version introduction supplies explicit alias/fallback content. */
      const intro = pages.find(
        (page) => page.version === version.id && page.slug === 'introduction'
      );
      /** Declared static introduction aliases; no universal SPA fallback is emitted. */
      const aliases = [
        `docs/${version.id}/index.html`,
        ...(version.id === site.latest ? ['docs/index.html'] : []),
      ];
      for (const alias of aliases) {
        await emitMarkdown(
          sitePath('/' + alias.replace(/\/index\.html$/, '.md')),
          rawMarkdown(intro, pages, references.get(version.id))
        );
        await emitMarkdown(
          sitePath('/' + alias.replace(/index\.html$/, 'index.md')),
          rawMarkdown(intro, pages, references.get(version.id))
        );
        await fs.mkdir(path.dirname(path.join(mountedRoot, alias)), {
          recursive: true,
        });
        await fs.copyFile(
          path.join(staging, intro.url, 'index.html'),
          path.join(mountedRoot, alias)
        );
      }
    }
    /** Existing same-version introduction supplies explicit alias/fallback content. */
    const intro = pages.find(
      (page) => page.version === site.latest && page.slug === 'introduction'
    );
    await fs.writeFile(
      path.join(mountedRoot, '404.html'),
      document(
        {
          ...intro,
          title: 'Page not found',
          description:
            'Choose a topic from the sidebar or search documentation.',
          slug: 'not-found',
          url: sitePath('/404.html'),
          body: '',
          related: ['introduction', 'tutorial'],
          sources: [],
        },
        pages,
        '<p>This route does not exist in the static export. <a href="/">Open the documentation home.</a></p>'
      )
    );
    await fs.writeFile(
      path.join(mountedRoot, 'assets/search.json'),
      JSON.stringify(
        (() => {
          /** Collapse prose whitespace only for compact static search records, never authored code blocks. */
          /** Compact only search prose, leaving exported article/code text unchanged.
           * @param {string} text - Public indexed prose.
           * @returns {string} Whitespace-normalized search text.
           */
          const normalize = (text) => text.replace(/\s+/g, ' ').trim();
          /** Complete candidate page inventory, validated before acquiring a staging directory. */
          const pages = search.filter((entry) => !entry.url.includes('#'));
          /** Page URL-to-index mapping binds heading tuples to the correct public parent record. */
          const parents = new Map(
            pages.map((entry, index) => [entry.url, index])
          );
          return {
            schema: 2,
            pages: pages.map((entry) => [
              entry.title,
              entry.section,
              entry.version,
              entry.url,
              entry.description,
              normalize(entry.text).slice(0, 8000),
            ]),
            sections: search
              .filter((entry) => entry.url.includes('#'))
              .map((entry) => {
                /** Exact heading URL split into its known parent and fragment. */
                const [url, anchor] = entry.url.split('#');
                return [
                  parents.get(url),
                  entry.title,
                  anchor,
                  normalize(entry.text).slice(0, 1200),
                ];
              }),
          };
        })()
      )
    );
    await fs.writeFile(
      path.join(mountedRoot, 'build-manifest.json'),
      JSON.stringify(
        {
          schema: 2,
          markdownFiles,
          rendering: 'static-html',
          basePath: site.basePath,
          latest: site.latest,
          packageRoutes: Object.fromEntries(
            pages
              .filter((page) => page.package)
              .map((page) => [page.package, page.url])
          ),
          versions: site.versions.map((version) => version.id),
          pages: pages.map((page) => page.url),
          packages: Object.fromEntries(
            [...references].map(([version, items]) => [
              version,
              items.map((item) => item.name),
            ])
          ),
        },
        null,
        2
      )
    );
    /** Candidate public routes only; sitemap timestamps are never synthesized. */
    const urls = [sitePath('/'), ...pages.map((page) => page.url)];
    if (site.origin) {
      /** Deterministic XML assembled from explicit canonical origins and escaped route values. */
      const xml =
        '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        urls
          .map((url) => `<url><loc>${escape(canonicalUrl(url))}</loc></url>`)
          .join('') +
        '</urlset>';
      await fs.writeFile(path.join(mountedRoot, 'sitemap.xml'), xml);
    }
    await fs.writeFile(
      path.join(mountedRoot, 'robots.txt'),
      'User-agent: *\nAllow: /\n' +
        (site.origin
          ? `Sitemap: ${canonicalUrl(sitePath('/sitemap.xml'))}\n`
          : '')
    );
    /** Completed optimizer manifest supplies content identities and production/development asset policy. */
    const assets = await optimizeStaticAssets({
      directory: mountedRoot,
      htmlFiles: await htmlFiles(mountedRoot),
      css: 'assets/docs.css',
      entries: [
        'src/browser/docs.ts',
        'src/browser/search.ts',
        'src/browser/learning.ts',
        'src/browser/offline.ts',
      ],
      sourceRoot: root,
      basePath: site.basePath,
      zuix,
      production,
      search: { file: 'assets/search.json', module: 'search.js' },
    });
    await emitOffline(mountedRoot, site, pages, assets, { production });
    /** Candidate validation must succeed before touching the existing export. */
    const result = await check(staging);
    /** Existing output metadata; symlink outputs are rejected before rename. */
    const existing = await fs.lstat(output).catch((error) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      return null;
    });
    if (existing?.isSymbolicLink()) {
      throw new Error('Refusing symlinked docs output');
    }
    /** Reserved rollback location; an existing recovery directory requires operator inspection. */
    const previous = path.join(root, '.docs-previous');
    if (await fs.lstat(previous).catch(() => null)) {
      throw new Error(
        'Previous build directory exists; inspect before building'
      );
    }
    if (existing) {
      await fs.rename(output, previous);
    }
    try {
      await fs.rename(staging, output);
    } catch (error) {
      if (existing) {
        await fs.rename(previous, output);
      }
      throw error;
    }
    if (existing) {
      await fs.rm(previous, { recursive: true, force: true });
    }
    console.info(
      `[docs] ${pages.length} routes · ${result.links} verified local links · ${search.length} search entries → dist/`
    );
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await build({ production: !process.argv.includes('--development') });
}
