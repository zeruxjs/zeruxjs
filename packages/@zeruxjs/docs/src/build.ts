/** Optional Node-only asset inventory preparation. Root/Markdown/browser imports never load this entry. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import type { DocumentationCatalog } from './index.js';
import { analyzeDocumentationMarkdown } from './markdown.js';
import { record, list } from './validation.js';

/** Walk canonical parents before no-follow open; host-owned source trees must not change adversarially mid-build.
 * @param {string} root - Canonical project root.
 * @param {string} target - Absolute root-contained file or directory.
 * @returns {Promise<void>} Rejects symlinks, missing parents and paths outside the explicit project.
 */
async function safePath(root: string, target: string): Promise<void> {
  /** Relative components are bounded source paths, never values from a network response. */
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new TypeError('Documentation asset path escapes project');
  }
  let cursor = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if ((await fs.lstat(cursor)).isSymbolicLink()) {
      throw new TypeError('Documentation asset symlink rejected');
    }
  }
}
/** Recognize passive raster container headers without claiming a full decoder or glyph/dimension verifier.
 * @param {Buffer} bytes - Bounded source bytes.
 * @param {string} url - Validated image URL with a supported extension.
 * @returns {boolean} Basic extension/container agreement; content licensing and full decode stay host-owned.
 */
function rasterHeader(bytes: Buffer, url: string): boolean {
  if (/\.png$/i.test(url)) {
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (/\.jpe?g$/i.test(url)) {
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  }
  if (/\.gif$/i.test(url)) {
    return ['GIF87a', 'GIF89a'].includes(
      bytes.subarray(0, 6).toString('ascii')
    );
  }
  if (/\.webp$/i.test(url)) {
    return (
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (/\.avif$/i.test(url)) {
    return (
      bytes.subarray(4, 8).toString('ascii') === 'ftyp' &&
      ['avif', 'avis'].includes(bytes.subarray(8, 12).toString('ascii'))
    );
  }
  return false;
}
/** Prepare used local public image manifests for the existing framework exporter; never fetch or copy bytes.
 * @param {DocumentationCatalog} catalog - Explicit immutable catalog; only public page/image references qualify.
 * @param {{rootDir:string;directory:string;include?:readonly string[]}} options - Absolute project root, project-relative public asset directory and optional local CSS URLs.
 * @returns {Promise<{directory:string;manifest:{schema:1;assets:{url:string;bytes:number;integrity:string}[]};include:string[]}>} Framework-compatible asset inputs; the framework verifies bytes again before atomic publication.
 */
export async function prepareDocumentationAssets(
  catalog: DocumentationCatalog,
  options: { rootDir: string; directory: string; include?: readonly string[] }
) {
  record(options);
  if (
    typeof options?.rootDir !== 'string' ||
    !path.isAbsolute(options.rootDir) ||
    typeof options.directory !== 'string' ||
    path.isAbsolute(options.directory) ||
    options.directory.includes('\\')
  ) {
    throw new TypeError('Invalid documentation asset directory');
  }
  /** All source paths resolve from an explicit project root, never the process working directory. */
  const root = await fs.realpath(path.resolve(options.rootDir));
  /** The exporter owns destination copying; this helper only inventories project-contained inputs. */
  const directory = path.resolve(root, options.directory);
  await safePath(root, directory);
  if (!(await fs.stat(directory)).isDirectory()) {
    throw new TypeError('Documentation asset directory missing');
  }
  /** Deduplication spans routes/releases, while historical versions may deliberately select different URLs. */
  const urls = new Set<string>();
  /** Shared URLs may not claim incompatible historical byte identities. */
  const pins = new Map<string, string>();
  /** Record a selected local resource and its optional declared integrity.
   * @param {string} url - Registered canonical URL.
   * @param {string} [pin] - Optional authored SHA-256 SRI.
   * @returns {void} Adds only local URLs and rejects contradictory pins before opening files.
   */
  const include = (url: string, pin?: string) => {
    if (!url.startsWith('/')) {
      return;
    }
    if (pin && pins.has(url) && pins.get(url) !== pin) {
      throw new TypeError('Conflicting version image integrity pins');
    }
    urls.add(url);
    if (pin) {
      pins.set(url, pin);
    }
  };
  for (const page of catalog.pages()) {
    if (page.access !== 'public') {
      continue;
    }
    /** Default rendering emits only registered public local images; remote references remain the host's separate delivery policy. */
    const images = catalog.images(page.version);
    /** Parsing, rather than regex over Markdown, ignores references in code fences. */
    const content = analyzeDocumentationMarkdown(
      (page.cover ? '![](asset:' + page.cover + ')\n\n' : '') + page.body,
      { images }
    );
    for (const reference of content.imageReferences) {
      /** Only exact aliases appear in the registry; arbitrary Markdown paths are never opened. */
      const alias = /^asset:([a-zA-Z0-9][a-zA-Z0-9._-]{0,127})$/.exec(
        reference
      )?.[1];
      /** Denied/private/remote sets are never copied as a side effect of source inspection. */
      const image = alias ? images[alias] : undefined;
      if (content.imageIssues.some((issue) => issue.alias === alias)) {
        continue;
      }
      if (!image || image.access !== 'public') {
        continue;
      }
      include(image.src, image.integrity);
      if (image.darkSrc) {
        include(image.darkSrc, image.darkIntegrity);
      }
      for (const source of image.sources ?? []) {
        include(source.src, source.integrity);
      }
    }
  }
  if (options.include !== undefined) {
    if (!Array.isArray(options.include) || options.include.length > 32) {
      throw new RangeError('Documentation extra asset limit');
    }
    for (const url of list(options.include, 32)) {
      if (
        typeof url !== 'string' ||
        !/^\/(?!\/)[A-Za-z0-9_./-]+\.css$/.test(url) ||
        new URL(url, 'https://documentation.invalid').pathname !== url
      ) {
        throw new TypeError('Only explicit local stylesheets may be added');
      }
      urls.add(url);
    }
  }
  if (urls.size > 1000) {
    throw new RangeError('Documentation asset count limit');
  }
  /** Manifest order is independent of registration order or directory enumeration. */
  const assets: { url: string; bytes: number; integrity: string }[] = [];
  let total = 0;
  for (const url of [...urls].sort()) {
    /** SVG is deliberately not copied by the raster helper; hosts must sanitize/review SVG separately. */
    if (/\.svg$/i.test(url)) {
      throw new TypeError(
        'SVG publication requires a separate reviewed host asset pipeline'
      );
    }
    /** Canonical local image URL maps to the same path under the explicit public directory. */
    const file = path.resolve(directory, url.slice(1));
    if (!file.startsWith(directory + path.sep)) {
      throw new TypeError('Documentation asset path escapes public directory');
    }
    await safePath(root, file);
    /** No-follow final open preserves regular-file identity for reading and hashing. */
    const handle = await fs.open(
      file,
      fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0)
    );
    try {
      /** Per-file and aggregate bounds precede allocation. */
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1) {
        throw new TypeError(
          'Documentation asset must be a single-link regular file'
        );
      }
      if (stat.size > 16_777_216 || total + stat.size > 67_108_864) {
        throw new RangeError('Documentation asset byte limit');
      }
      /** A bounded same-handle read catches growth instead of trusting a prior stat indefinitely. */
      const bytes = Buffer.alloc(Math.min(stat.size + 1, 16_777_217));
      let offset = 0;
      while (offset < bytes.length) {
        /** Read a finite remaining span rather than using unbounded readFile after stat. */
        const result = await handle.read(
          bytes,
          offset,
          bytes.length - offset,
          offset
        );
        if (!result.bytesRead) {
          break;
        }
        offset += result.bytesRead;
      }
      if (offset !== stat.size) {
        throw new Error('Documentation asset changed during inventory');
      }
      /** CSS remains trusted host source; image containers get basic header agreement checks. */
      const data = bytes.subarray(0, offset);
      if (!url.endsWith('.css') && !rasterHeader(data, url)) {
        throw new TypeError('Image extension/container mismatch');
      }
      /** Image pins protect historical binary identity only where the host explicitly recorded them. */
      const actual =
        'sha256-' + createHash('sha256').update(data).digest('base64');
      if (pins.has(url) && pins.get(url) !== actual) {
        throw new Error('Documentation image integrity mismatch');
      }
      total += offset;
      assets.push({
        url,
        bytes: offset,
        integrity: actual,
      });
    } finally {
      await handle.close();
    }
  }
  return {
    directory: options.directory,
    manifest: { schema: 1 as const, assets },
    include: assets.map((asset) => asset.url),
  };
}
