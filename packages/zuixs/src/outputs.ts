import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createZuix } from './compiler.js';
import type { ZuixConfig, ZuixBuildManifest } from './types.js';
/** Node-only resolver for the explicitly enabled optional source-map encoder. */
const require = createRequire(import.meta.url);

/** Read one bounded opened regular inode, refusing leaf symlinks and growth beyond its inspected size.
 * @param {string} file - Trusted contained project path.
 * @param {number} maximum - Maximum admitted file bytes.
 * @returns {string} UTF-8 contents; owned descriptor closes on success or failure.
 */
export function readProjectFile(file: string, maximum: number): string {
  /** Owned regular-file or exclusive temporary-file descriptor, closed in finally. */
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
  );
  try {
    /** Opened inode metadata, checked before allocating a bounded read buffer. */
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maximum) {
      throw new Error('zuix: unsafe or oversized file');
    }
    /** One-byte-over-length buffer detecting source growth during the read. */
    const buffer = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < buffer.length) {
      /** Actual bytes returned by this bounded read; zero ends the file. */
      const count = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) {
        break;
      }
      size += count;
    }
    if (size > stat.size) {
      throw new Error('zuix: file changed during read');
    }
    return buffer.subarray(0, size).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** Stage every changed file before replacement and compensate ordinary failures; multi-file publication is not crash-atomic.
 * @param {Map<string, string>} files - Complete validated destination/text candidate.
 * @param {number} maxBytes - Aggregate generated-byte ceiling.
 * @param {readonly string[]} deletions - Explicit previously generated paths to remove after validation.
 * @returns {void} Commit completes or throws, including explicit rollback/cleanup failures.
 */
export function commitOutputs(
  files: Map<string, string>,
  maxBytes: number,
  deletions: readonly string[] = []
): void {
  let bytes = 0;
  /** All changed/deleted candidates staged before replacing any public output. */
  const prepared: {
    file: string;
    temp: string;
    before: string | null;
    deleting?: boolean;
  }[] = [];
  /** Successful replacements retained in order for reverse compensating rollback. */
  const replaced: typeof prepared = [];
  try {
    for (const [file, text] of files) {
      bytes += Buffer.byteLength(text);
      if (bytes > maxBytes) {
        throw new Error('zuix: maxOutputBytes exceeded');
      }
      let before: string | null = null;
      try {
        before = readProjectFile(file, maxBytes);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
      if (before === text) {
        continue;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      /** Same-directory exclusive temporary path; no shell or user-supplied command is involved. */
      const temp = path.join(path.dirname(file), `.zuix-${randomUUID()}.tmp`);
      prepared.push({ file, temp, before });
      /** Owned regular-file or exclusive temporary-file descriptor, closed in finally. */
      const fd = fs.openSync(temp, 'wx', 0o644);
      try {
        fs.writeFileSync(fd, text);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }
    for (const file of new Set(deletions)) {
      if (files.has(file)) {
        continue;
      }
      /** Previous bounded file content retained only for ordinary failure rollback. */
      const before = readProjectFile(file, maxBytes);
      prepared.push({
        file,
        temp: path.join(path.dirname(file), `.zuix-${randomUUID()}.tmp`),
        before,
        deleting: true,
      });
    }
    for (const item of prepared) {
      if (item.deleting) {
        fs.unlinkSync(item.file);
      } else {
        fs.renameSync(item.temp, item.file);
      }
      replaced.push(item);
    }
  } catch (error) {
    /** Original replacement error plus any compensating rollback failures. */
    const errors: unknown[] = [error];
    for (const item of replaced.reverse()) {
      try {
        if (item.before === null) {
          fs.unlinkSync(item.file);
        } else {
          fs.writeFileSync(item.temp, item.before, { flag: 'wx' });
          fs.renameSync(item.temp, item.file);
        }
      } catch (rollback) {
        errors.push(rollback);
      }
    }
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        'zuix: output replacement/rollback failed'
      );
    }
    throw error;
  } finally {
    for (const item of prepared) {
      try {
        fs.unlinkSync(item.temp);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          // eslint-disable-next-line no-unsafe-finally -- Cleanup failure must propagate; this owner explicitly reports failed resource release.
          throw error;
        }
      }
    }
  }
}

/** Add public asset descriptors and optional file-level maps to an uncommitted output plan.
 * @param {string} root - Trusted project root.
 * @param {ZuixConfig} config - Explicit build/source-map policy.
 * @param {Map<string, string>} files - Candidate outputs extended with maps/manifest in place.
 * @param {Map<string, string[]>} sources - Private source-to-token ownership records.
 * @param {(name: string) => string} safePath - Host build owner’s project/symlink path validator.
 * @param {Map<string, string>} owners - Optional private per-source artifact ownership.
 * @returns {ZuixBuildManifest | undefined} Output-only manifest, or undefined when not configured.
 */
export function attachManifest(
  root: string,
  config: ZuixConfig,
  files: Map<string, string>,
  sources: Map<string, string[]>,
  safePath: (name: string) => string,
  owners?: Map<string, string>
): ZuixBuildManifest | undefined {
  /** Explicit public-manifest/source-map configuration; absence leaves legacy output unchanged. */
  const settings = config.buildManifest;
  if (!settings) {
    return;
  }
  if (
    !settings ||
    typeof settings !== 'object' ||
    typeof settings.file !== 'string' ||
    typeof settings.publicPath !== 'string'
  ) {
    throw new Error('zuix: invalid build manifest');
  }
  /** Validated absolute slash-terminated public mount path. */
  const base = settings.publicPath;
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base) || base.startsWith('//')) {
    throw new Error('zuix: publicPath must be an absolute path ending in /');
  }
  if (
    (settings.sourceMap !== undefined &&
      typeof settings.sourceMap !== 'boolean') ||
    (settings.includeSources !== undefined &&
      typeof settings.includeSources !== 'boolean') ||
    (settings.includeSources && !settings.sourceMap)
  ) {
    throw new Error('zuix: invalid source map policy');
  }
  /** Shared output directory constraining every publicly described artifact. */
  const directory = path.dirname(safePath(config.output ?? 'zuix.css'));
  /** Map one contained generated asset to its declared public mount.
   * @param {string} file - Validated generated path.
   * @returns {string} Encoded mounted URL, never a source URL.
   */
  const url = (file: string) => {
    /** Generated path relative to the shared output directory; traversal/absolute escapes reject. */
    const relative = path.relative(directory, file).split(path.sep).join('/');
    if (
      relative.startsWith('../') ||
      relative === '..' ||
      path.isAbsolute(relative)
    ) {
      throw new Error(
        'zuix: manifest assets must be inside the shared output directory'
      );
    }
    return base + relative.split('/').map(encodeURIComponent).join('/');
  };
  /** Public stylesheet records containing opaque IDs, URLs and content integrity only. */
  const entries: ZuixBuildManifest['stylesheets'] = [];
  for (const [file, original] of [...files]) {
    if (!file.endsWith('.css')) {
      continue;
    }
    let text = original,
      mapUrl: string | undefined;
    if (settings.sourceMap) {
      /** Optional explicitly enabled source-map implementation, loaded only in the Node build path. */
      const { SourceMapGenerator } =
        require('source-map-js') as typeof import('source-map-js');
      /** Per-output file-level map; resets/recipes/plugin-only rules intentionally remain unmapped. */
      const map = new SourceMapGenerator({ file: path.basename(file) });
      /** Mapping lookup compiler without recipes/plugins/preflight to avoid invented ownership. */
      const compiler = createZuix({
        ...config,
        preflight: false,
        recipes: [],
        plugins: [],
      });
      /** Generated offsets already mapped, preventing duplicate source claims. */
      const offsets = new Set<number>();
      // File-level ownership only. Resets/recipes/plugin-only rules deliberately stay unmapped.
      for (const [source, tokens] of sources) {
        if (owners?.has(file) && owners.get(file) !== source) {
          continue;
        }
        /** Validated relative source identity included only in explicitly enabled maps. */
        const sourcePath = path
          .relative(path.dirname(file), safePath(source))
          .split(path.sep)
          .join('/');
        for (const token of tokens) {
          /** Supported utility rule searched in the completed generated stylesheet. */
          const rule = compiler.compileClass(token);
          if (!rule) {
            continue;
          }
          /** First matching generated rule position; missing/duplicate positions stay unmapped. */
          const offset = original.indexOf(rule);
          if (offset < 0 || offsets.has(offset)) {
            continue;
          }
          offsets.add(offset);
          /** Previous bounded file content retained only for ordinary failure rollback. */
          const before = original.slice(0, offset);
          /** One-based generated line derived from the exact candidate CSS. */
          const line = before.split('\n').length;
          /** Zero-based generated column derived from the preceding newline. */
          const column = offset - (before.lastIndexOf('\n') + 1);
          map.addMapping({
            generated: { line, column },
            original: { line: 1, column: 0 },
            source: sourcePath,
          });
        }
        if (settings.includeSources) {
          map.setSourceContent(
            sourcePath,
            fs.readFileSync(safePath(source), 'utf8')
          );
        }
      }
      /** Validated external map destination, checked against duplicate output candidates. */
      const mapFile = safePath(file + '.map');
      if (files.has(mapFile)) {
        throw new Error('zuix: duplicate output');
      }
      files.set(mapFile, map.toString() + '\n');
      mapUrl = url(mapFile);
      text =
        original.trimEnd() +
        `\n/*# sourceMappingURL=${encodeURIComponent(path.basename(mapFile))} */\n`;
      files.set(file, text);
    }
    entries.push({
      id:
        path.resolve(file) === safePath(config.output ?? 'zuix.css')
          ? 'shared'
          : createHash('sha256')
              .update(path.relative(directory, file))
              .digest('hex')
              .slice(0, 24),
      url: url(file),
      integrity: 'sha256-' + createHash('sha256').update(text).digest('base64'),
      ...(mapUrl ? { sourceMap: mapUrl } : {}),
    });
  }
  entries.sort((a, b) => {
    if (a.id < b.id) {
      return -1;
    } else {
      if (a.id > b.id) {
        return 1;
      } else {
        return 0;
      }
    }
  });
  /** Versioned public output-only descriptor sorted by stable opaque identity. */
  const manifest: ZuixBuildManifest = { version: 1, stylesheets: entries };
  /** Validated manifest destination, distinct from every existing output candidate. */
  const target = safePath(settings.file);
  if (files.has(target)) {
    throw new Error('zuix: duplicate manifest output');
  }
  files.set(target, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
