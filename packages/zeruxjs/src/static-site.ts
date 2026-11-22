import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  assertSafeBuildDirectories,
  assertDisjointBuildSources,
  readBuildFile,
} from './commands/build-paths.js';

export interface StaticOutputOptions {
  /** Trusted project root; output and staging must be distinct descendants. */
  rootDir: string;
  /** Explicit exporter-owned completed candidate directory. */
  stagingDir: string;
  /** Project-relative public output directory, default out. */
  outDir?: string;
  /** Explicit migration/replacement of an existing host-owned output, default false. */
  replaceExisting?: boolean;
  /** Host validation runs before publication; it must not start application services. */
  validate?: (directory: string) => void | Promise<void>;
}
interface StaticFile {
  /** Safe artifact-relative path. */
  file: string;
  /** Exact file byte length, at most 16 MiB. */
  bytes: number;
  /** Lowercase SHA-256 identity verified before response bytes are exposed. */
  sha256: string;
}
/** Validate a relative artifact path before any filesystem access.
 * @param {unknown} value - Candidate manifest-owned filename.
 * @returns {string} Safe nonsecret artifact spelling.
 */
function filename(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    value.includes('\\') ||
    value.includes(':') ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    ) ||
    !value ||
    value.startsWith('/') ||
    value
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          (part.startsWith('.') && part !== '.nojekyll')
      )
  ) {
    throw new TypeError('Invalid static artifact path');
  }
  return value;
}
/** Hash bounded bytes using the native cryptographic owner.
 * @param {Uint8Array} bytes - Already bounded artifact content.
 * @returns {string} Stable SHA-256 identity.
 */
function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
/** Compare literal artifact paths independently of process locale.
 * @param {StaticFile} left - First validated artifact identity.
 * @param {StaticFile} right - Second validated artifact identity.
 * @returns {number} Stable lexical ordering.
 */
function compareFiles(left: StaticFile, right: StaticFile): number {
  if (left.file < right.file) {
    return -1;
  }
  if (left.file > right.file) {
    return 1;
  }
  return 0;
}
/** Resolve a safe project-owned output without permitting source-tree replacement.
 * @param {string} rootDir - Trusted project root.
 * @param {string} outDir - Project-relative output path.
 * @returns {Promise<{root:string,out:string}>} Validated absolute directory pair.
 */
async function outputPath(rootDir: string, outDir: string) {
  if (
    typeof rootDir !== 'string' ||
    typeof outDir !== 'string' ||
    !outDir ||
    path.isAbsolute(outDir)
  ) {
    throw new TypeError('Invalid static output directory');
  }
  /** Native root with symlink ancestry normalized before containment checks. */
  const root = await fs.realpath(rootDir);
  /** Explicit project-owned destination. */
  const out = path.resolve(root, outDir);
  if (out === root) {
    throw new TypeError('Static output cannot replace project root');
  }
  await assertSafeBuildDirectories(root, out);
  await assertDisjointBuildSources(root, out, [
    'src',
    'app',
    'public',
    'packages',
    'node_modules',
    '.git',
    '.workspace',
  ]);
  return { root, out };
}
/** Publish a completed public artifact tree atomically; app renderers remain replaceable consumers.
 * @param {StaticOutputOptions} options - Explicit public staging/output ownership and optional host validation.
 * @returns {Promise<void>} Publication after validation; previous output is restored on promotion failure.
 */
export async function publishStaticOutput(
  options: StaticOutputOptions
): Promise<void> {
  /** Validated host-owned output pair. */
  const { root, out } = await outputPath(
    options.rootDir,
    options.outDir ?? 'out'
  );
  /** Completed public candidate, not a source directory selected by a request. */
  const staging = path.resolve(root, options.stagingDir);
  await assertSafeBuildDirectories(root, staging);
  if (
    staging === root ||
    staging === out ||
    staging.startsWith(out + path.sep) ||
    out.startsWith(staging + path.sep)
  ) {
    throw new TypeError('Static staging/output overlap');
  }
  await assertDisjointBuildSources(root, staging, [
    'src',
    'app',
    'public',
    'packages',
    'node_modules',
    '.git',
    '.workspace',
  ]);
  /** Complete bounded manifest; no runtime/session state is discovered or serialized. */
  const files: StaticFile[] = [];
  let total = 0;
  /** Inspect generated files without following symlinks.
   * @param {string} directory - Candidate-owned directory.
   * @returns {Promise<void>} Finite recursive inventory.
   */
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      /** Candidate child checked before descent or reading. */
      const child = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error('Static symlinks are forbidden');
      }
      /** Every emitted artifact has a checked public relative name. */
      const relative = filename(
        path.relative(staging, child).split(path.sep).join('/')
      );
      if (relative === 'static-output.json') {
        throw new Error('Static manifest is publisher-owned');
      }
      if (entry.isDirectory()) {
        await visit(child);
        continue;
      }
      if (!entry.isFile() || files.length >= 100_000) {
        throw new RangeError('Static file limit');
      }
      /** Bounded same-inode read with native handle cleanup. */
      const bytes = await readBuildFile(child, 16_777_216, true);
      total += bytes.length;
      if (total > 268_435_456) {
        throw new RangeError('Static output byte limit');
      }
      files.push({ file: relative, bytes: bytes.length, sha256: hash(bytes) });
    }
  }
  await visit(staging);
  files.sort(compareFiles);
  /** Validation may read but must not mutate generated output; verify that contract before promotion. */
  const beforeValidation = JSON.stringify(files);
  await options.validate?.(staging);
  files.length = 0;
  total = 0;
  await visit(staging);
  files.sort(compareFiles);
  if (JSON.stringify(files) !== beforeValidation) {
    throw new Error('Static candidate changed during validation');
  }
  await fs.writeFile(
    path.join(staging, 'static-output.json'),
    JSON.stringify({ version: 1, kind: 'zerux-static-output', files }),
    { flag: 'wx', mode: 0o644 }
  );
  /** Existing destination is never removed before successful candidate promotion. */
  const existing = await fs.lstat(out).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return undefined;
  });
  if (existing && options.replaceExisting !== true) {
    throw new Error(
      'Existing static output requires explicit replacement ownership'
    );
  }
  /** Private same-filesystem rollback path owned by this publication. */
  const previous = path.join(
    path.dirname(out),
    '.static-previous-' + randomUUID()
  );
  await fs.mkdir(path.dirname(out), { recursive: true });
  await assertSafeBuildDirectories(root, out);
  if (existing) {
    await fs.rename(out, previous);
  }
  try {
    await fs.rename(staging, out);
  } catch (error) {
    if (existing) {
      await fs.rename(previous, out);
    }
    throw error;
  }
  if (existing) {
    await fs.rm(previous, { recursive: true, force: true });
  }
}

/** Validate one inert artifact identity before adding it to a public route table.
 * @param {unknown} input - Parsed manifest file record.
 * @returns {StaticFile} Detached immutable bounded identity.
 */
function staticIdentity(input: unknown): StaticFile {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Invalid static file identity');
  }
  /** JSON data is narrowed before filesystem lookup or hashing. */
  const item = input as Record<string, unknown>;
  if (
    typeof item.bytes !== 'number' ||
    !Number.isSafeInteger(item.bytes) ||
    item.bytes < 0 ||
    item.bytes > 16_777_216 ||
    typeof item.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(item.sha256)
  ) {
    throw new TypeError('Invalid static file identity');
  }
  return Object.freeze({
    file: filename(item.file),
    bytes: item.bytes,
    sha256: item.sha256,
  });
}
/** Validate a bounded local redirect graph before admitting static requests.
 * @param {unknown} input - Parsed exporter redirect data, never runtime request input.
 * @returns {Map<string,{to:string,status:number}>} Detached validated redirect graph.
 */
function staticRedirects(
  input: unknown
): Map<string, { to: string; status: number }> {
  /** Explicit local redirect table from the existing exporter, never from request headers. */
  const redirects = new Map<string, { to: string; status: number }>();
  /** Optional exporter redirects are validated before any request is accepted. */
  const definitions = input;
  if (!Array.isArray(definitions) || definitions.length > 10_000) {
    throw new TypeError('Invalid static redirects');
  }
  for (const candidate of definitions) {
    if (!candidate || typeof candidate !== 'object') {
      throw new TypeError('Invalid static redirect');
    }
    /** Parsed JSON fields are narrowed before creating any redirect record. */
    const entry = candidate as Record<string, unknown>;
    if (
      !entry ||
      typeof entry.from !== 'string' ||
      typeof entry.to !== 'string' ||
      typeof entry.status !== 'number' ||
      ![301, 302, 307, 308].includes(entry.status)
    ) {
      throw new TypeError('Invalid static redirect');
    }
    // Reject control/authority syntax before creating a Location header.
    for (const value of [entry.from, entry.to]) {
      if (
        value.length > 2048 ||
        !value.startsWith('/') ||
        value.startsWith('//') ||
        value.includes('\\') ||
        [...value].some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
        )
      ) {
        throw new TypeError('Invalid static redirect URL');
      }
    }
    if (redirects.has(entry.from)) {
      throw new TypeError('Duplicate static redirect');
    }
    redirects.set(entry.from, { to: entry.to, status: entry.status });
  }
  for (const start of redirects.keys()) {
    /** Bounded visited chain rejects cycles and unsupported redirect depth. */
    const seen = new Set<string>();
    let next = start;
    while (redirects.has(next)) {
      if (seen.has(next) || seen.size >= 16) {
        throw new TypeError('Static redirect cycle/depth');
      }
      seen.add(next);
      next = redirects.get(next)!.to;
    }
  }
  return redirects;
}

/** Serve only manifest-listed generated assets; imports never start a server or bootstrap services.
 * @param {object} options - Explicit trusted project/output ownership.
 * @param {string} options.rootDir - Host project root.
 * @param {string} [options.outDir] - Public output directory, default out.
 * @returns {Promise<(request:Request)=>Promise<Response>>} Immutable manifest-scoped Fetch handler with GET/HEAD validators.
 */
export async function createStaticSiteHandler(options: {
  rootDir: string;
  outDir?: string;
}) {
  /** Validated output boundary reused for every response. */
  const { root, out } = await outputPath(
    options.rootDir,
    options.outDir ?? 'out'
  );
  /** Framework exporters share file integrity records while retaining their own schema discriminators. */
  /** Bounded manifest bytes are read through the shared no-follow build utility. */
  const raw = await readBuildFile(
    path.join(out, 'static-output.json'),
    16_777_216
  ).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return readBuildFile(path.join(out, 'static-export.json'), 16_777_216);
  });
  /** Parsed data is checked before selecting any resource. */
  const manifest = JSON.parse(raw.toString('utf8'));
  if (
    !manifest ||
    manifest.version !== 1 ||
    !['zerux-static-output', 'zerux-static-export'].includes(manifest.kind) ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 100_000
  ) {
    throw new TypeError('Invalid static output manifest');
  }
  /** Exact URL allowlist; request input never becomes a filesystem path. */
  const routes = new Map<string, StaticFile>();
  for (const item of manifest.files) {
    /** One validated immutable file identity; source data never remains mutable in the route table. */
    const file = staticIdentity(item);
    /** Native URL encoding preserves UTF-8 and already encoded exporter filenames. */
    const url = new URL('/' + file.file, 'https://static.invalid').pathname;
    if (routes.has(url)) {
      throw new TypeError('Duplicate static file');
    }
    routes.set(url, file);
    if (file.file === 'index.html' || file.file.endsWith('/index.html')) {
      routes.set(url.slice(0, -10), file);
    }
  }
  /** Authored missing-page identity remains scoped to manifest-listed files. */
  const missingFile =
    manifest.kind === 'zerux-static-export'
      ? filename(manifest.hosting?.notFound?.file)
      : '404.html';
  if (
    manifest.kind === 'zerux-static-export' &&
    !routes.has('/' + missingFile)
  ) {
    throw new TypeError('Unlisted static missing page');
  }
  if (manifest.mode === 'mixed') {
    throw new TypeError('Mixed exports require their dynamic runtime fallback');
  }
  /** Only validated local redirect metadata can create Location headers. */
  const redirects = staticRedirects(manifest.hosting?.redirects ?? []);
  let active = 0;
  /** Actual accepted read/render settlement retains one of eight slots until cleanup.
   * @param {Request} request - Borrowed native Fetch request.
   * @returns {Promise<Response>} Integrity-checked public representation.
   */
  async function respond(request: Request): Promise<Response> {
    request.signal.throwIfAborted();
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response(null, {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
      });
    }
    /** Normalized native URL is used for lookup only, never outbound origin selection. */
    const pathname = new URL(request.url).pathname;
    /** Explicit exporter redirects retain their deliberate status, including temporary redirects. */
    const redirect = redirects.get(pathname);
    if (redirect) {
      return new Response(null, {
        status: redirect.status,
        headers: { Location: redirect.to, 'Cache-Control': 'no-store' },
      });
    }
    /** A directory index redirect is emitted only for a known public artifact. */
    const index = routes.get(pathname + '/');
    if (!routes.has(pathname) && index) {
      return new Response(null, {
        status: 308,
        headers: { Location: pathname + '/' },
      });
    }
    /** Missing pages remain real 404s rather than an application-wide SPA fallback. */
    const file = routes.get(pathname) ?? routes.get('/' + missingFile);
    /** Missing artifacts must retain a real missing-page HTTP status. */
    const status =
      routes.has(pathname) && file?.file !== missingFile ? 200 : 404;
    if (!file) {
      return new Response(request.method === 'HEAD' ? null : 'Not found', {
        status: 404,
      });
    }
    try {
      await assertSafeBuildDirectories(
        root,
        path.dirname(path.join(out, file.file))
      );
      /** Same-inode bounded bytes verified before exposure, including HEAD/conditional requests. */
      const bytes = await readBuildFile(
        path.join(out, file.file),
        16_777_216,
        true
      );
      if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) {
        throw new Error('Static integrity mismatch');
      }
      request.signal.throwIfAborted();
      /** Representation-specific strong validator. */
      const etag = '"' + file.sha256 + '"';
      /** Small explicit public MIME map; unknown artifacts never become executable HTML. */
      const mime: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.md': 'text/markdown; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.woff2': 'font/woff2',
        '.txt': 'text/plain; charset=utf-8',
        '.xml': 'application/xml; charset=utf-8',
      };
      /** Public static files are explicitly exported; authenticated requests never receive a shared-cache policy. */
      const headers = new Headers({
        'Content-Type':
          mime[path.extname(file.file)] ?? 'application/octet-stream',
        'Content-Length': String(bytes.length),
        ETag: etag,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control':
          request.headers.has('authorization') || request.headers.has('cookie')
            ? 'private, no-store'
            : 'public, max-age=0, must-revalidate',
      });
      if (
        status === 200 &&
        request.headers
          .get('If-None-Match')
          ?.split(',')
          .some(
            (tag) =>
              tag.trim() === '*' || tag.trim().replace(/^W\//, '') === etag
          )
      ) {
        headers.delete('Content-Length');
        return new Response(null, { status: 304, headers });
      }
      return new Response(
        request.method === 'HEAD' ? null : new Uint8Array(bytes),
        { status, headers }
      );
    } catch (error) {
      if (request.signal.aborted) {
        throw error;
      }
      return new Response(
        request.method === 'HEAD' ? null : 'Static output unavailable',
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
  }
  return async (request: Request): Promise<Response> => {
    if (active >= 8) {
      return new Response(null, {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    active++;
    try {
      return await respond(request);
    } finally {
      active--;
    }
  };
}
