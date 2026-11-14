import { markdownDigest } from '../src/lib/raw-markdown.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sitePath } from '../src/site.config.ts';
import { root } from '../src/lib/content.ts';

/** Validate emitted routes, anchors, asset links and search coverage.
 *
 * @param {string} directory Generated export.
 * @returns {Promise<object>} Validation counts. Reads generated output only.
 */
export async function check(directory = path.join(root, 'dist')) {
  /** Candidate export text inventory; symbolic links reject instead of traversing outside output. */
  const files = new Map();
  /** Collect candidate files without following symlink entries.
   * @param {string} base - Current directory under the explicit candidate root.
   * @returns {Promise<void>} Completes the private inventory or rejects on an unsafe/missing entry.
   */
  async function walk(base) {
    for (const entry of await fs.readdir(base, { withFileTypes: true })) {
      /** Visited entry under the explicit candidate directory. */
      const file = path.join(base, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Symlink in static export: ${file}`);
      }
      if (entry.isDirectory()) {
        await walk(file);
      } else if (entry.isFile()) {
        files.set(
          '/' + path.relative(directory, file).split(path.sep).join('/'),
          await fs.readFile(file, 'utf8')
        );
      }
    }
  }
  await walk(directory);
  /** Only emitted HTML files participate in page/anchor checks. */
  const html = [...files].filter(([name]) => name.endsWith('.html'));
  /** Per-file ID inventory detects duplicates and validates local fragments. */
  const ids = new Map();
  for (const [name, content] of html) {
    if (
      !content.startsWith('<!doctype html>') ||
      !content.includes('<h1>') ||
      !content.includes('<article')
    ) {
      throw new Error(`Incomplete static HTML: ${name}`);
    }
    if (
      [...content.matchAll(/<h1(?:\s[^>]*)?>/g)].length !== 1 ||
      !content.includes('<main')
    ) {
      throw new Error(`Invalid main heading/landmark: ${name}`);
    }
    if (!name.endsWith('/offline.html')) {
      if (
        !content.includes('name="description"') ||
        !content.includes('name="viewport"')
      ) {
        throw new Error(`Missing metadata: ${name}`);
      }
      /** Fixed JSON-LD script data is parsed as JSON, never executed. */
      const structured =
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(
          content
        );
      if (!structured || !JSON.parse(structured[1]).name) {
        throw new Error(`Invalid structured data: ${name}`);
      }
    }
    /** Native HTML IDs collected before resolving any same-document anchors. */
    const found = [...content.matchAll(/\bid="([^"]+)"/g)].map(
      (match) => match[1]
    );
    if (new Set(found).size !== found.length) {
      throw new Error(`Duplicate heading/element IDs: ${name}`);
    }
    ids.set(name, new Set(found));
  }
  /** Map directory URLs to their actual index.html files without inventing SPA routes. */
  /** Resolve a static directory URL to its actual file representation.
   * @param {string} pathname - Decoded candidate-local URL path.
   * @returns {string} File lookup path, preserving non-directory extensions.
   */
  const resolve = (pathname) =>
    pathname.endsWith('/') ? pathname + 'index.html' : pathname;
  let links = 0;
  for (const [name, content] of html) {
    for (const match of content.matchAll(
      /(data-site-root )?\b(?:href|src)="([^"]+)"/g
    )) {
      /** Attribute URL with XML/HTML ampersands decoded for exact lookup. */
      const href = match[2].replaceAll('&amp;', '&');
      if (match[1] && href === '/') {
        continue;
      } // The ecosystem root is owned by the combined builder.
      if (!href.startsWith('/') && !href.startsWith('#')) {
        continue;
      }
      /** Local validation origin resolves fragments without trusting incoming Host headers. */
      const url = new URL(href, 'https://docs.invalid' + name);
      /** Decoded emitted route must exist in the candidate inventory. */
      const target = resolve(decodeURIComponent(url.pathname));
      if (!files.has(target)) {
        throw new Error(`Broken link ${href} in ${name}`);
      }
      if (
        url.hash &&
        ids.has(target) &&
        !ids.get(target).has(decodeURIComponent(url.hash.slice(1)))
      ) {
        throw new Error(`Broken anchor ${href} in ${name}`);
      }
      links++;
    }
  }
  /** Candidate build manifest ties pages, Markdown digests and search coverage together. */
  const manifest = JSON.parse(files.get(sitePath('/build-manifest.json')));
  if (!files.has(sitePath('/.nojekyll'))) {
    throw new Error('Raw Markdown requires .nojekyll');
  }
  for (const [url, digest] of Object.entries(manifest.markdownFiles ?? {})) {
    /** Raw exported Markdown must remain text and match its recorded digest. */
    const text = files.get(url);
    if (
      !text ||
      /^\s*<!doctype html/i.test(text) ||
      markdownDigest(text) !== digest
    ) {
      throw new Error(`Missing or altered Markdown export: ${url}`);
    }
  }
  for (const page of manifest.pages) {
    if (
      !manifest.markdownFiles?.[page.slice(0, -1) + '.md'] ||
      !manifest.markdownFiles?.[page + 'index.md']
    ) {
      throw new Error(`Missing Markdown alternatives: ${page}`);
    }
  }
  /** Offline install metadata must remain relative to this exact docs mount. */
  const appManifest = JSON.parse(files.get(sitePath('/manifest.webmanifest')));
  if (
    appManifest.scope !== './' ||
    appManifest.start_url !== './' ||
    !files.has(sitePath('/sw.js'))
  ) {
    throw new Error('Offline support must stay within the docs mount');
  }
  for (const icon of appManifest.icons ?? []) {
    if (!files.has(sitePath('/' + icon.src))) {
      throw new Error(`Missing PWA icon: ${icon.src}`);
    }
  }
  /** Compact static search schema; rows reference only known emitted routes. */
  const search = JSON.parse(files.get(sitePath('/assets/search.json')));
  if (
    search.schema !== 2 ||
    !Array.isArray(search.pages) ||
    !Array.isArray(search.sections)
  ) {
    throw new Error('Invalid compact search schema');
  }
  /** Reconstructed page/heading URLs for independent output existence/anchor validation. */
  const entries = [
    ...search.pages.map((row) => ({ url: row[3] })),
    ...search.sections.map((row) => ({
      url: search.pages[row[0]][3] + '#' + row[2],
    })),
  ];
  for (const page of manifest.pages) {
    if (!files.has(resolve(page))) {
      throw new Error(`Missing page ${page}`);
    }
    if (!entries.some((entry) => entry.url.split('#')[0] === page)) {
      throw new Error(`Page absent from search: ${page}`);
    }
  }
  for (const entry of entries) {
    /** Local validation origin resolves fragments without trusting incoming Host headers. */
    const url = new URL(entry.url, 'https://docs.invalid');
    /** Decoded emitted route must exist in the candidate inventory. */
    const target = resolve(url.pathname);
    if (
      !files.has(target) ||
      (url.hash && !ids.get(target)?.has(url.hash.slice(1)))
    ) {
      throw new Error(`Broken search result ${entry.url}`);
    }
  }
  return { pages: html.length, links, searchEntries: entries.length };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.info('[docs] Verified', await check());
}
