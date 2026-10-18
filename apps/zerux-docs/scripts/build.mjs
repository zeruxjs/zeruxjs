import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, loadContent } from '../src/lib/content.mjs';
import { site, sitePath } from '../src/site.config.mjs';
import { markdown, escape } from '../src/lib/markdown.mjs';
import { document, home } from '../src/lib/template.mjs';
import { versionReference } from '../src/lib/reference.mjs';
import { check } from './check.mjs';

export { root };
export const output = path.join(root, 'dist');

/** Render an import map as an accessible table. @param {object} item Package manifest. @returns {string} Structural HTML. No globals. */
function manifestHtml(item) {
  const entries = Object.entries(
    item.exports ?? { '.': item.main || '(no entry point)' },
  );
  return `<section class="manifest-reference"><h2 id="public-entry-points">Public entry points</h2><p>Manifest reference for <code>${escape(item.name)}@${escape(item.version)}</code>. Each target describes a published entry, not automatic framework registration.</p><div class="table-wrap"><table><thead><tr><th>Import</th><th>Target</th></tr></thead><tbody>${entries.map(([key, value]) => `<tr><td><code>${escape(key === '.' ? item.name : item.name + key.slice(1))}</code></td><td><pre>${escape(typeof value === 'string' ? value : JSON.stringify(value, null, 2))}</pre></td></tr>`).join('')}</tbody></table></div><details><summary>Runtime requirements and dependencies</summary><pre><code>${escape(JSON.stringify({ engines: item.engines ?? {}, dependencies: item.dependencies ?? {}, peerDependencies: item.peerDependencies ?? {}, bin: item.bin ?? {} }, null, 2))}</code></pre></details></section>`;
}
/** Create source-backed reference pages without inventing package behavior.
 * @param {object[]} pages Authored documents. @returns {Promise<Map>} Per-version manifest snapshots. Reads explicit version reference configuration.
 */
async function addReferencePages(pages) {
  const references = new Map();
  for (const version of site.versions) {
    const inventory = await versionReference(version);
    references.set(version.id, inventory);
    const authored = pages.filter((page) => page.version === version.id);
    const claims = authored
      .filter((page) => page.package)
      .map((page) => page.package);
    if (new Set(claims).size !== claims.length)
      throw new Error(`Duplicate authored package guide in ${version.id}`);
    for (const name of claims)
      if (!inventory.some((item) => item.name === name))
        throw new Error(`Unknown package guide: ${name}`);
    for (const item of inventory.filter((item) =>
      item.name.startsWith('@zeruxjs/'),
    ))
      if (!claims.includes(item.name))
        throw new Error(`Missing authored package guide for ${item.name}`);
    const base = {
      version: version.id,
      versionInfo: version,
      sources: ['apps/zerux-docs/src/site.config.mjs'],
      source: 'apps/zerux-docs/README.md',
      readingMinutes: 2,
      related: ['capabilities', 'configuration-reference'],
    };
    for (const item of inventory) {
      let page = authored.find((page) => page.package === item.name);
      if (!page) {
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
    const cards = inventory
      .map((item) => {
        const page = pages.find(
          (page) => page.version === version.id && page.package === item.name,
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
      extra: `<div class="package-filter" hidden><label for="package-filter">Filter packages</label><input type="search" id="package-filter" placeholder="Database, cache, email…"><p id="package-count" role="status"></p></div><div class="card-grid package-grid">${cards}</div>`,
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
/** Build a validated static documentation export. @returns {Promise<void>} Completion. Writes fixed app-local output; never starts framework services. */
export async function build() {
  if (site.origin) {
    const origin = new URL(site.origin);
    if (
      !['https:', 'http:'].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      throw new Error(
        'site.origin must be a public domain origin without a path, credentials, query or fragment',
      );
  }
  if (!/^\/[a-z0-9-]+$/.test(site.basePath))
    throw new Error('Choose a single-segment static site basePath');
  const pages = await loadContent();
  const references = await addReferencePages(pages);
  pages.sort((a, b) => {
    const order = (value) => {
      const index = site.sections.indexOf(value);
      return index < 0 ? site.sections.length : index;
    };
    return (
      order(a.section) - order(b.section) ||
      a.order - b.order ||
      a.title.localeCompare(b.title)
    );
  });
  const seen = new Set();
  for (const page of pages) {
    if (seen.has(page.url)) throw new Error(`Duplicate route: ${page.url}`);
    seen.add(page.url);
  }
  const staging = await fs.mkdtemp(path.join(root, '.docs-build-'));
  const search = [];
  const mountedRoot = path.join(staging, site.basePath.slice(1));
  await fs.mkdir(mountedRoot, { recursive: true });
  try {
    await fs.cp(path.join(root, 'public'), mountedRoot, {
      recursive: true,
      dereference: false,
    });
    for (const page of pages) {
      const isGeneratedReadme = page.section === 'Package reference';
      const sourceUrl = `${site.repository}/blob/${page.versionInfo.ref || 'master'}/${page.manifest?.source}/README.md`;
      const rendered = markdown(page.body, {
        version: page.version,
        ...(isGeneratedReadme ? { sourceUrl } : {}),
      });
      let content = rendered.html + (page.extra || '');
      if (page.manifest) {
        content += manifestHtml(page.manifest);
        if (!isGeneratedReadme && page.readme) {
          const readme = markdown(page.readme, {
            version: page.version,
            sourceUrl,
          });
          // Prefix README headings to keep repeated README topics separate from authored guide anchors.
          content += `<details class="readme-reference"><summary>Full package README</summary><div>${readme.html.replace(/id="([^"]+)"/g, 'id="readme-$1"').replace(/href="#([^"]+)"/g, 'href="#readme-$1"')}</div></details>`;
        }
      }
      const target = path.join(staging, page.url.slice(1), 'index.html');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, document(page, pages, content, rendered.toc));
      const plain = page.body
        .replace(/```[^\n]*\n[\s\S]*?```/g, ' ')
        .replace(/[#*`>|]/g, ' ');
      search.push({
        title: page.title,
        section: page.section,
        version: page.version,
        url: page.url,
        text: plain.slice(0, 14000),
        description: page.description,
      });
      for (const heading of rendered.toc)
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
    await fs.writeFile(path.join(mountedRoot, 'index.html'), home(pages));
    for (const version of site.versions) {
      const intro = pages.find(
        (page) => page.version === version.id && page.slug === 'introduction',
      );
      const aliases = [
        `docs/${version.id}/index.html`,
        ...(version.id === site.latest ? ['docs/index.html'] : []),
      ];
      for (const alias of aliases) {
        await fs.mkdir(path.dirname(path.join(mountedRoot, alias)), {
          recursive: true,
        });
        await fs.copyFile(
          path.join(staging, intro.url, 'index.html'),
          path.join(mountedRoot, alias),
        );
      }
    }
    const intro = pages.find(
      (page) => page.version === site.latest && page.slug === 'introduction',
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
        '<p>This route does not exist in the static export. <a href="/">Open the documentation home.</a></p>',
      ),
    );
    await fs.writeFile(
      path.join(mountedRoot, 'assets/search.json'),
      JSON.stringify(search),
    );
    await fs.writeFile(
      path.join(mountedRoot, 'build-manifest.json'),
      JSON.stringify(
        {
          schema: 2,
          rendering: 'static-html',
          basePath: site.basePath,
          latest: site.latest,
          packageRoutes: Object.fromEntries(
            pages
              .filter((page) => page.package)
              .map((page) => [page.package, page.url]),
          ),
          versions: site.versions.map((version) => version.id),
          pages: pages.map((page) => page.url),
          packages: Object.fromEntries(
            [...references].map(([version, items]) => [
              version,
              items.map((item) => item.name),
            ]),
          ),
        },
        null,
        2,
      ),
    );
    const urls = [sitePath('/'), ...pages.map((page) => page.url)];
    if (site.origin) {
      const xml =
        '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        urls
          .map(
            (url) =>
              `<url><loc>${escape(new URL(url, site.origin).href)}</loc></url>`,
          )
          .join('') +
        '</urlset>';
      await fs.writeFile(path.join(mountedRoot, 'sitemap.xml'), xml);
    }
    await fs.writeFile(
      path.join(mountedRoot, 'robots.txt'),
      'User-agent: *\nAllow: /\n' +
        (site.origin
          ? `Sitemap: ${new URL(sitePath('/sitemap.xml'), site.origin).href}\n`
          : ''),
    );
    const result = await check(staging);
    const existing = await fs.lstat(output).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (existing?.isSymbolicLink())
      throw new Error('Refusing symlinked docs output');
    const previous = path.join(root, '.docs-previous');
    if (await fs.lstat(previous).catch(() => null))
      throw new Error(
        'Previous build directory exists; inspect before building',
      );
    if (existing) await fs.rename(output, previous);
    try {
      await fs.rename(staging, output);
    } catch (error) {
      if (existing) await fs.rename(previous, output);
      throw error;
    }
    if (existing) await fs.rm(previous, { recursive: true, force: true });
    console.info(
      `[docs] ${pages.length} routes · ${result.links} verified local links · ${search.length} search entries → dist/`,
    );
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await build();
