import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { site, sitePath } from '../site.config.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const repositoryRoot = path.resolve(root, '../..');

/** Read public workspace metadata, excluding sample and private manifests.
 * @param {string} directory Package directory. @returns {Promise<object[]>} Sorted manifests. Reads repository files only.
 */
export async function discoverPackages(
  directory = path.join(repositoryRoot, 'packages'),
) {
  const records = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      entry.name.startsWith('sample') ||
      entry.name === 'node_modules'
    )
      continue;
    const child = path.join(directory, entry.name);
    let manifest;
    try {
      manifest = JSON.parse(
        await fs.readFile(path.join(child, 'package.json'), 'utf8'),
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (manifest) {
      if (!manifest.private)
        records.push({
          ...manifest,
          source: path
            .relative(repositoryRoot, child)
            .split(path.sep)
            .join('/'),
        });
    } else records.push(...(await discoverPackages(child)));
  }
  return records.sort((a, b) => a.name.localeCompare(b.name));
}
/** Load validated versioned Markdown documents. @returns {Promise<object[]>} Page records. Reads docs and declared repository sources only. */
export async function loadContent() {
  const pages = [];
  for (const version of site.versions) {
    if (!/^[a-zA-Z0-9.-]+$/.test(version.id))
      throw new Error('Invalid docs version');
    const directory = path.join(root, 'src/docs', version.id);
    for (const entry of (await fs.readdir(directory)).sort()) {
      if (!entry.endsWith('.md')) continue;
      const source = await fs.readFile(path.join(directory, entry), 'utf8');
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);
      if (!match) throw new Error(`Missing JSON metadata: ${entry}`);
      const metadata = JSON.parse(match[1]);
      const slug = entry.slice(0, -3);
      if (!/^[a-z0-9-]+$/.test(slug))
        throw new Error(`Invalid docs slug: ${slug}`);
      for (const key of ['title', 'description', 'section'])
        if (typeof metadata[key] !== 'string' || !metadata[key].trim())
          throw new Error(`Missing ${key}: ${entry}`);
      if (!site.sections.includes(metadata.section))
        throw new Error(`Unknown navigation section: ${metadata.section}`);
      if (!Number.isFinite(metadata.order))
        throw new Error(`Missing navigation order: ${entry}`);
      if (!Array.isArray(metadata.sources) || !metadata.sources.length)
        throw new Error(`Missing source references: ${entry}`);
      if (!Array.isArray(metadata.related))
        throw new Error(`Missing related pages: ${entry}`);
      for (const reference of metadata.sources) {
        const absolute = path.resolve(repositoryRoot, reference);
        if (!absolute.startsWith(repositoryRoot + path.sep))
          throw new Error(`Source escapes repository: ${reference}`);
        if (
          version.reference === 'workspace' &&
          !(await fs.stat(absolute)).isFile()
        )
          throw new Error(`Missing source file: ${reference}`);
      }
      const words = match[2].split(/\s+/).length;
      pages.push({
        ...metadata,
        slug,
        version: version.id,
        versionInfo: version,
        url: sitePath(`/docs/${version.id}/${slug}/`),
        body: match[2],
        source: `apps/zerux-docs/src/docs/${version.id}/${entry}`,
        readingMinutes: Math.max(1, Math.ceil(words / 200)),
      });
    }
  }
  const keys = new Set(pages.map((page) => page.version + '/' + page.slug));
  for (const version of site.versions)
    for (const slug of ['api', 'packages']) keys.add(version.id + '/' + slug);
  for (const page of pages)
    for (const slug of page.related)
      if (!keys.has(page.version + '/' + slug))
        throw new Error(`Broken related page ${slug} in ${page.slug}`);
  return pages.sort(
    (a, b) =>
      site.sections.indexOf(a.section) - site.sections.indexOf(b.section) ||
      a.order - b.order ||
      a.title.localeCompare(b.title),
  );
}
