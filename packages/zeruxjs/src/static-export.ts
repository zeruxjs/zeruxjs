import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseFragment } from 'parse5';
import {
  escapeHtmlText,
  escapeHtmlAttribute,
} from '@zeruxjs/security/encoding';
import {
  createRendererRegistry,
  isRenderedHtml,
  type RendererAdapter,
} from './renderers.js';
import { createPublicRouteManifest } from './navigation-manifest.js';
import {
  assertSafeBuildDirectories,
  assertDisjointBuildSources,
  readBuildFile,
} from './commands/build-paths.js';
import { redactManifestConfig } from './bootstrap/manifest-config.js';

export interface StaticExportContext {
  /** Cooperative export or route cancellation signal. */
  readonly signal: AbortSignal;
  /** Absolute export/route deadline in Unix milliseconds. */
  readonly deadline: number;
  /** Resolved public route pathname without private source paths. */
  readonly pathname: string;
  /** Validated exact-origin canonical URL; not synthesized for the missing page. */
  readonly canonical: string;
  /** Resolve only a selected local asset to its mounted public URL, never fetch a remote resource.
   * @param {string} url - Explicit selected source asset URL.
   * @returns {string} Mounted exported URL; unknown resources reject.
   */
  asset(url: string): string;
}
export interface StaticExportPage<V> {
  /** Explicit public route pattern or redirect source. */
  path: string;
  /** Required public-only marker; authenticated/private views are unsupported. */
  access: 'public';
  /** Produce public inert data without request/session/service access for this explicitly enumerated route.
   * @param {Readonly<Record<string, string>>} params - Immutable complete finite dynamic parameter record.
   * @param {StaticExportContext} context - Request-free public path/canonical/asset/cancellation context.
   * @returns {V | Promise<V>} Public view candidate independently validated before rendering.
   */
  view(
    params: Readonly<Record<string, string>>,
    context: StaticExportContext
  ): V | Promise<V>;
  /** Required for each dynamic route. Every parameter must be enumerated. */
  params?: (
    context: Pick<StaticExportContext, 'signal' | 'deadline'>
  ) =>
    | Iterable<Record<string, string>>
    | AsyncIterable<Record<string, string>>
    | Promise<
        Iterable<Record<string, string>> | AsyncIterable<Record<string, string>>
      >;
  /** Optional authored bounded document title. */
  title?: string;
}
export interface StaticExportRedirect {
  /** Explicit public route pattern or redirect source. */
  path: string;
  /** Required public-only marker; authenticated/private views are unsupported. */
  access: 'public';
  /** Explicit validated local hosting redirect destination. */
  redirect: string;
  /** Deliberate HTTP page/redirect status; host configuration must preserve it. */
  status: 301 | 302 | 307 | 308;
}
export interface StaticExportOptions<V> {
  /** Trusted local project root. */
  rootDir: string;
  /** Project-contained exporter-owned output directory. */
  outDir?: string;
  /** Exact public HTTP(S) origin, never inferred from request Host headers. */
  origin: string;
  /** Canonical non-root mount prefix supported by pages and selected assets. */
  basePath?: string;
  /** Static-only output or explicit mixed Node-required hosting metadata. */
  mode?: 'static' | 'mixed';
  /** Explicit finite public page/redirect allowlist, never application route discovery. */
  routes: readonly (StaticExportPage<V> | StaticExportRedirect)[];
  /** Explicit real 404 content and hosting status policy. */
  notFound: {
    /** Required public-only marker; authenticated/private views are unsupported. */
    access: 'public';
    view: V; /** Optional authored bounded document title. */
    title?: string;
  };
  /** New export-owned adapter, disposed before publication; no app bootstrap. */
  renderer: () => RendererAdapter<V> | Promise<RendererAdapter<V>>;
  /** Explicit local source/public manifest/include policy. */
  assets?: {
    /** Project-relative selected local asset directory. */
    directory: string; /** Untrusted public source asset manifest checked against actual bytes. */
    manifest: unknown; /** Finite selected asset URL allowlist; unused assets are not automatically copied. */
    include: readonly string[];
  };
  /** Finite total routes and enumerated paths ceiling. */
  maxRoutes?: number;
  /** Maximum complete output bytes including the manifest. */
  maxBytes?: number;
  /** Maximum final document bytes per page. */
  maxPageBytes?: number;
  /** Whole-export cooperative deadline. */
  timeoutMs?: number;
  /** Per-route enumeration/render deadline. */
  routeTimeoutMs?: number;
  /** Cooperative export or route cancellation signal. */
  signal?: AbortSignal;
}
export interface StaticExportManifest {
  /** Explicit output manifest schema version 1. */
  version: 1;
  /** Exporter ownership discriminator. */
  kind: 'zerux-static-export';
  /** Static-only output or explicit mixed Node-required hosting metadata. */
  mode: 'static' | 'mixed';
  /** Canonical non-root mount prefix supported by pages and selected assets. */
  basePath: string;
  /** Resolved public page URL/file/status/canonical receipts. */
  pages: {
    /** Mounted public page or asset URL. */
    url: string; /** Safe output-relative artifact path. */
    file: string; /** Deliberate HTTP page/redirect status; host configuration must preserve it. */
    status:
      | 200
      | 404; /** Validated exact-origin canonical URL; not synthesized for the missing page. */
    canonical?: string;
  }[];
  /** Explicit local source/public manifest/include policy. */
  assets: {
    /** Selected public source asset URL, never a private filesystem path. */
    source: string; /** Mounted public page or asset URL. */
    url: string; /** Verified SHA-256 subresource integrity. */
    integrity: string;
  }[];
  /** Complete candidate file hashes and sizes, excluding manifest self-reference. */
  files: {
    /** Safe output-relative artifact path. */
    file: string; /** Actual artifact byte length. */
    bytes: number; /** Actual content SHA-256 for ownership/integrity checks. */
    sha256: string;
  }[];
  /** Explicit real 404, redirects and unlisted-route hosting requirements. */
  hosting: {
    /** Explicit real 404 content and hosting status policy. */
    notFound: {
      /** Safe output-relative artifact path. */
      file: string; /** Deliberate HTTP page/redirect status; host configuration must preserve it. */
      status: 404;
    };
    /** Explicit redirect hosting records; no HTML meta-refresh is invented. */
    redirects: {
      /** Validated local redirect source. */
      from: string; /** Validated local redirect destination. */
      to: string; /** Deliberate HTTP page/redirect status; host configuration must preserve it. */
      status: 301 | 302 | 307 | 308;
    }[];
    /** Real 404 in static mode or explicit Node-server requirement in mixed mode. */
    unlisted: '404' | 'node-server-required';
  };
}
/** Fixed export failure classification; private causes never enter public output manifests. */
export class StaticExportError extends Error {
  /** Classify export failure while retaining the private cause outside public hosting metadata.
   * @param {string} code - Fixed export diagnostic classification.
   * @param {unknown} cause - Optional private filesystem/renderer cause.
   */
  constructor(
    readonly code: string,
    cause?: unknown
  ) {
    super(code);
    this.name = 'StaticExportError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause });
    }
  }
}
/** Reject a candidate stage with a fixed export classification.
 * @param {string} code - Fixed internal diagnostic code.
 * @returns {never} Always throws a classified export failure.
 */
function fail(code: string): never {
  throw new StaticExportError(code);
}
/** Hash candidate asset/file bytes for integrity and deterministic identity, never authorship.
 * @param {Uint8Array | string} bytes - Explicit local bytes or text.
 * @returns {string} SHA-256 hexadecimal content identity.
 */
const digest = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');

/** Accept only plain object-shaped candidates with an explicit own-key allowlist.
 * @param {unknown} value - Untrusted configuration/route candidate.
 * @param {readonly string[]} keys - Supported own-key names.
 * @returns {unknown} Truthy only when shape and own keys are accepted.
 */
const ownKeys = (value: unknown, keys: readonly string[]) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));
/** Validate an optional positive integer budget against its hard supported maximum.
 * @param {unknown} value - Runtime budget candidate.
 * @param {number} fallback - Default positive budget when absent.
 * @param {number} max - Hard supported ceiling.
 * @returns {number} Validated budget or explicit configuration failure.
 */
function number(value: unknown, fallback: number, max: number) {
  /** Stage-local candidate validated against the surrounding explicit JSON/type/budget contract. */
  const result = value ?? fallback;
  if (
    typeof result !== 'number' ||
    !Number.isSafeInteger(result) ||
    result < 1 ||
    result > max
  ) {
    fail('STATIC_LIMIT_INVALID');
  }
  return result as number;
}

/** Validate a nonempty relative path without traversal, empty segments, backslashes or controls.
 * @param {string} value - Runtime relative file/directory candidate.
 * @returns {string} Validated path; filesystem containment is checked separately.
 */
function relative(value: string) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 2048 ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.split('/').some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        // eslint-disable-next-line no-control-regex -- Reject control characters in validated path segments.
        /[\x00-\x1f\x7f]/.test(part)
    )
  ) {
    fail('STATIC_PATH_INVALID');
  }
  return value;
}
/** Reconstruct immutable bounded public JSON without accessors, private field names or executable serialization hooks.
 * @param {T} input - Explicit public view/parameter candidate.
 * @returns {T} Immutable validated public projection; this is not a general secret detector.
 */
function publicValue<T>(input: T): T {
  let nodes = 0;
  /** Current public-props recursion path used to reject cycles. */
  const seen = new Set<object>();
  /** Rebuild bounded inert public JSON using sorted own data properties.
   * @param {unknown} value - Candidate public JSON subtree.
   * @param {number} depth - Current bounded recursion depth.
   * @returns {unknown} Immutable public projection without invoking accessors.
   */
  const visit = (value: any, depth: number): any => {
    if (++nodes > 5000 || depth > 24) {
      fail('STATIC_PROPS_LIMIT');
    }
    if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      return value;
    }
    if (typeof value === 'string') {
      if (value.length > 1048576) {
        fail('STATIC_PROPS_LIMIT');
      }
      return value;
    }
    if (
      !value ||
      typeof value !== 'object' ||
      seen.has(value) ||
      (!Array.isArray(value) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    ) {
      fail('STATIC_PRIVATE_DATA');
    }
    if (Reflect.ownKeys(value).length > 1000) {
      fail('STATIC_PROPS_LIMIT');
    }
    seen.add(value);
    /** Stage-local candidate validated against the surrounding explicit JSON/type/budget contract. */
    const result: any = Array.isArray(value) ? [] : Object.create(null);
    for (const key of Object.keys(value).sort()) {
      if (
        key.length > 256 ||
        [
          '_action_key',
          '_action_csrf',
          '__proto__',
          'prototype',
          'constructor',
        ].includes(key) ||
        (redactManifestConfig({ [key]: 0 }) as any)[key] !== 0
      ) {
        fail('STATIC_PRIVATE_DATA');
      }
      /** Own public-prop descriptor; accessors reject rather than execute. */
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in property)) {
        fail('STATIC_PRIVATE_DATA');
      }
      result[key] = visit(property.value, depth + 1);
    }
    seen.delete(value);
    return Object.freeze(result);
  };
  /** Stage-local candidate validated against the surrounding explicit JSON/type/budget contract. */
  const result = visit(input, 0);
  if (Buffer.byteLength(JSON.stringify(result)) > 1048576) {
    fail('STATIC_PROPS_LIMIT');
  }
  return result;
}
/** Validate parent directories and read one bounded single-link regular inode without following its leaf.
 * @param {string} root - Trusted project root.
 * @param {string} file - Explicit project-contained local file.
 * @param {number} maximum - Maximum accepted bytes.
 * @returns {Promise<Buffer>} Actual local bytes; symlink/hardlink/non-file/size failures reject.
 */
async function safeFile(
  root: string,
  file: string,
  maximum: number
): Promise<Buffer> {
  await assertSafeBuildDirectories(root, path.dirname(file), 'static source');
  try {
    return await readBuildFile(file, maximum, true);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ELOOP' ||
      (error instanceof Error &&
        error.message === 'Invalid or oversized build file')
    ) {
      fail('STATIC_ASSET_INVALID');
    }
    throw error;
  }
}
/** Export only explicit request-free public routes without application bootstrap; promote a complete valid candidate or preserve previous output.
 * @param {StaticExportOptions<V>} options - Explicit public routes, finite enumerators, licensed local assets and export-owned renderer policy.
 * @returns {Promise<StaticExportManifest>} Complete public output/hosting manifest after adapter cleanup and successful promotion.
 */
export async function exportStaticSite<V>(
  options: StaticExportOptions<V>
): Promise<StaticExportManifest> {
  if (
    !ownKeys(options, [
      'rootDir',
      'outDir',
      'origin',
      'basePath',
      'mode',
      'routes',
      'notFound',
      'renderer',
      'assets',
      'maxRoutes',
      'maxBytes',
      'maxPageBytes',
      'timeoutMs',
      'routeTimeoutMs',
      'signal',
    ]) ||
    !options ||
    typeof options.rootDir !== 'string' ||
    typeof options.renderer !== 'function' ||
    !Array.isArray(options.routes) ||
    !options.routes.length ||
    options.routes.length > 256 ||
    !ownKeys(options.notFound, ['access', 'view', 'title']) ||
    options.notFound.access !== 'public' ||
    (options.notFound.title !== undefined &&
      (typeof options.notFound.title !== 'string' ||
        options.notFound.title.length > 256)) ||
    (options.signal !== undefined &&
      !(options.signal instanceof AbortSignal)) ||
    (options.mode !== undefined && !['static', 'mixed'].includes(options.mode))
  ) {
    fail('STATIC_CONFIG_INVALID');
  }
  let origin: URL;
  try {
    origin = new URL(options.origin);
  } catch {
    fail('STATIC_ORIGIN_INVALID');
  }
  if (
    !['http:', 'https:'].includes(origin!.protocol) ||
    origin!.origin !== options.origin ||
    options.origin.length > 2048
  ) {
    fail('STATIC_ORIGIN_INVALID');
  }
  if (options.basePath !== undefined && typeof options.basePath !== 'string') {
    fail('STATIC_BASE_INVALID');
  }
  /** Validated canonical public mount prefix independent of filesystem roots. */
  const base = (options.basePath ?? '/').replace(/\/$/, '') || '/';
  if (!/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(base)) {
    fail('STATIC_BASE_INVALID');
  }
  /** Absolute explicit project root required to be its own canonical real path. */
  const root = path.resolve(options.rootDir);
  /** Project-contained exporter-owned destination; source and protected directories reject. */
  const out = path.resolve(root, relative(options.outDir ?? '.zerux/static'));
  /** First output directory segment checked against protected source/configuration namespaces. */
  const first = path.relative(root, out).split(path.sep)[0]!;
  if (
    [
      'app',
      'src',
      'public',
      'node_modules',
      '.git',
      '.agents',
      '.codex',
      '.aws',
      'packages',
      'apps',
      'sample-packages',
      'middleware',
      'controllers',
      'plugins',
      'components',
      'lib',
    ].includes(first) ||
    out === root
  ) {
    fail('STATIC_OUTPUT_INVALID');
  }
  /** Validated total finite route/enumeration ceiling. */
  const maxRoutes = number(options.maxRoutes, 1000, 10000);
  /** Validated complete candidate byte ceiling including manifest. */
  const maxBytes = number(options.maxBytes, 33554432, 536870912);
  /** Validated final HTML page byte ceiling. */
  const maxPage = number(options.maxPageBytes, 1048576, 16777216);
  /** Validated whole-export cooperative deadline. */
  const timeout = number(options.timeoutMs, 30000, 300000);
  /** Validated per-enumeration/render deadline. */
  const routeTimeout = number(options.routeTimeoutMs, 5000, 30000);
  /** Captured explicit public-only route descriptors; request-dependent features reject. */
  const routes = options.routes.map(
    (route: StaticExportPage<V> | StaticExportRedirect) => {
      if (
        !route ||
        route.access !== 'public' ||
        !ownKeys(
          route,
          'redirect' in route
            ? ['path', 'access', 'redirect', 'status']
            : ['path', 'access', 'view', 'params', 'title']
        ) ||
        typeof route.path !== 'string' ||
        route.path.includes('//') ||
        route.path.includes('{') ||
        route.path.includes('}') ||
        route.path
          .split('/')
          .some((part) => part === '.' || part === '..' || part.length > 200)
      ) {
        fail('STATIC_ROUTE_INVALID');
      }

      if ('redirect' in route) {
        if (
          typeof route.redirect !== 'string' ||
          !route.redirect.startsWith('/') ||
          route.redirect.startsWith('//') ||
          // eslint-disable-next-line no-control-regex -- Reject backslashes and controls in the configured redirect.
          /[\\\x00-\x20\x7f]/.test(route.redirect) ||
          !/^\/[A-Za-z0-9._~/-]*$/.test(route.redirect) ||
          route.redirect.includes('//') ||
          route.redirect
            .split('/')
            .some((part) => part === '.' || part === '..') ||
          !(
            base === '/' ||
            route.redirect === base ||
            route.redirect.startsWith(base + '/')
          ) ||
          ![301, 302, 307, 308].includes(route.status)
        ) {
          fail('STATIC_REDIRECT_INVALID');
        }
      } else if (
        typeof route.view !== 'function' ||
        (route.params !== undefined && typeof route.params !== 'function') ||
        (route.title !== undefined &&
          (typeof route.title !== 'string' || route.title.length > 256))
      ) {
        fail('STATIC_ROUTE_INVALID');
      }
      return { ...route, path: route.path.replace(/\/$/, '') || '/' };
    }
  );
  /** Shared validated public route grammar used only for explicit export routes. */
  const routeManifest = createPublicRouteManifest({
    basePath: base,
    routes: routes.map((route, index) => ({
      id: 'route' + index,
      pattern: route.path,
    })),
  });
  /** Validated route pattern lookup for finite parameter substitution. */
  const patterns = new Map(
    routeManifest.routes.map((route) => [route.pattern, route])
  );
  await assertSafeBuildDirectories(root, root);
  if ((await fs.realpath(root)) !== root) {
    fail('STATIC_SYMLINK_ROOT');
  }
  await assertSafeBuildDirectories(root, out);
  await assertDisjointBuildSources(root, out, [
    'app',
    'src',
    'public',
    'node_modules',
    '.git',
    'middleware',
    'controllers',
    'plugins',
    'components',
    'lib',
    ...(options.assets ? [relative(options.assets.directory)] : []),
  ]);
  /** Project-contained parent directory used for staging, backup and exclusive lock. */
  const parent = path.dirname(out);
  await fs.mkdir(parent, { recursive: true });
  await assertSafeBuildDirectories(root, parent);
  /** Per-destination private exclusive lock file; stale locks are not broken automatically. */
  const lockPath = path.join(
    parent,
    '.static-' + digest(out).slice(0, 16) + '.lock'
  );
  /** Owned exclusive file handle always closed before removing its lock path. */
  const lock = await fs.open(lockPath, 'wx', 0o600);
  let stage: string | undefined,
    adapter: RendererAdapter<V> | undefined,
    disposed = false,
    total = 0;
  /** Whole-export cooperative cancellation owner retained through cleanup. */
  const controller = new AbortController();
  /** Propagate host cancellation without force-stopping callback JavaScript.
   * @returns {void} Abort notification completion.
   */
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) {
    abort();
  }
  /** Absolute whole-export deadline checked between every protected stage. */
  const deadline = Date.now() + timeout;
  /** Owned whole-export or per-render deadline timer released after actual settlement. */
  const timer = setTimeout(abort, timeout);
  /** Reject an expired/cancelled export before the next stage or promotion.
   * @returns {void} Cancellation/deadline validation completion.
   */
  const check = () => {
    if (Date.now() >= deadline) {
      controller.abort();
    }
    if (controller.signal.aborted) {
      fail('STATIC_CANCELLED');
    }
  };
  /** Candidate public pages/assets/files/hosting metadata assembled before promotion. */
  const manifest: StaticExportManifest = {
    version: 1,
    kind: 'zerux-static-export',
    mode: options.mode ?? 'static',
    basePath: base,
    pages: [],
    assets: [],
    files: [],
    hosting: {
      notFound: {
        file: (base === '/' ? '' : base.slice(1) + '/') + '404.html',
        status: 404,
      },
      redirects: [],
      unlisted: options.mode === 'mixed' ? 'node-server-required' : '404',
    },
  };
  /** Prefix only an authored root-relative public URL with the validated mount.
   * @param {string} url - Internal root-relative URL.
   * @returns {string} Canonical mounted public URL.
   */
  const mount = (url: string) => (base === '/' ? '' : base) + url;
  /** Explicit selected source-URL to mounted-URL map; undeclared resources never fetch. */
  const assetUrls = new Map<string, string>();
  try {
    // Never overwrite a directory that this exporter does not own, or edited output.
    try {
      /** Existing exporter manifest inspected before replacing an owned unmodified output. */
      const previous = JSON.parse(
        (
          await safeFile(root, path.join(out, 'static-export.json'), 8388608)
        ).toString()
      );
      if (
        previous.kind !== 'zerux-static-export' ||
        previous.version !== 1 ||
        !Array.isArray(previous.files) ||
        previous.files.length > 12000
      ) {
        fail('STATIC_OUTPUT_INVALID');
      }
      /** Exact previous-file allowlist used to reject user-modified/unowned output. */
      const expected = new Set(['static-export.json']);
      for (const file of previous.files) {
        if (
          typeof file.file !== 'string' ||
          !/^[a-f0-9]{64}$/.test(file.sha256)
        ) {
          fail('STATIC_OUTPUT_INVALID');
        }
        relative(file.file);
        expected.add(file.file);
        if (
          digest(await safeFile(root, path.join(out, file.file), 16777216)) !==
          file.sha256
        ) {
          fail('STATIC_OUTPUT_MODIFIED');
        }
      }
      /** Verify an existing exporter output contains only recorded files and no symlinks.
       * @param {string} dir - Export-owned directory under the destination.
       * @returns {Promise<void>} Ownership/integrity tree validation completion.
       */
      const walk = async (dir: string) => {
        for (const item of await fs.readdir(dir, { withFileTypes: true })) {
          /** Project-contained output/source filename checked by relative-path and byte policy. */
          const file = path.join(dir, item.name);
          if (item.isSymbolicLink()) {
            fail('STATIC_OUTPUT_MODIFIED');
          }
          if (item.isDirectory()) {
            await walk(file);
          } else if (
            !expected.has(path.relative(out, file).split(path.sep).join('/'))
          ) {
            fail('STATIC_OUTPUT_MODIFIED');
          }
        }
      };
      await walk(out);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      try {
        await fs.lstat(out);
        fail('STATIC_OUTPUT_INVALID');
      } catch (missing) {
        if ((missing as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw missing;
        }
      }
    }
    stage = await fs.mkdtemp(path.join(parent, '.static-candidate-'));
    /** Write one uniquely named bounded candidate file and record its actual content hash.
     * @param {string} file - Validated relative candidate destination.
     * @param {Buffer | string} bytes - Explicit local bytes/text.
     * @returns {Promise<void>} Candidate write and manifest receipt completion.
     */
    const put = async (file: string, bytes: Buffer | string) => {
      check();
      relative(file);
      if (manifest.files.some((item) => item.file === file)) {
        fail('STATIC_OUTPUT_COLLISION');
      }
      /** Bounded candidate bytes after explicit Buffer conversion. */
      const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      total += data.length;
      if (total > maxBytes || data.length > 16777216) {
        fail('STATIC_OUTPUT_LIMIT');
      }
      /** Project-contained candidate destination or redirect traversal target. */
      const target = path.join(stage!, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, data, { flag: 'wx', mode: 0o644 });
      manifest.files.push({ file, bytes: data.length, sha256: digest(data) });
    };
    if (options.assets) {
      /** Explicit selected asset source policy; no provider/network discovery occurs. */
      const assets = options.assets;
      /** Untrusted public asset manifest projection checked before copying. */
      const source = assets.manifest as any;
      if (
        !source ||
        source.schema !== 1 ||
        !Array.isArray(source.assets) ||
        source.assets.length > 10000 ||
        !Array.isArray(assets.include) ||
        assets.include.length > 1000 ||
        new Set(assets.include).size !== assets.include.length
      ) {
        fail('STATIC_ASSET_MANIFEST_INVALID');
      }
      /** Canonical project-contained explicit asset directory. */
      const directory = path.resolve(root, relative(assets.directory));
      await assertSafeBuildDirectories(root, directory);
      for (const url of [...assets.include].sort()) {
        if (
          typeof url !== 'string' ||
          !/^\/(?!\/)[A-Za-z0-9_./-]+\.(?:css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|txt|xml)$/.test(
            url
          )
        ) {
          fail('STATIC_ASSET_INVALID');
        }
        relative(url.slice(1));
        /** Exact public-manifest matches for this selected asset URL. */
        const matches = source.assets.filter((item: any) => item.url === url);
        if (matches.length !== 1) {
          fail('STATIC_ASSET_MISSING');
        }
        /** Selected manifest record checked against actual file bytes before copying. */
        const item = matches[0];
        /** Actual same-inode local asset bytes under the per-file ceiling. */
        const bytes = await safeFile(
          root,
          path.join(directory, url.slice(1)),
          Math.min(maxBytes, 16777216)
        );
        /** Actual SHA-256 subresource integrity compared with the authored public asset manifest. */
        const integrity =
          'sha256-' + createHash('sha256').update(bytes).digest('base64');
        if (bytes.length !== item.bytes || item.integrity !== integrity) {
          fail('STATIC_ASSET_INTEGRITY');
        }
        /** Canonical mounted URL used by both HTML resolution and output mapping. */
        const mounted = mount(url);
        assetUrls.set(url, mounted);
        manifest.assets.push({ source: url, url: mounted, integrity });
        await put(mounted.slice(1), bytes);
      }
    }
    /** Unique public route paths, including redirects, charged to the global route budget. */
    const paths = new Set<string>();
    /** Finite resolved public page inputs prepared before any page is rendered. */
    const pages: {
      route: StaticExportPage<V>;
      /** Complete finite dynamic parameter enumeration, required for every dynamic route. */
      params: Readonly<Record<string, string>>;
      /** Resolved public route pathname without private source paths. */
      pathname: string;
    }[] = [];
    for (const route of routes) {
      check();
      if (paths.size >= maxRoutes) {
        fail('STATIC_ROUTE_LIMIT');
      }
      /** Shared validated route grammar and required parameter metadata. */
      const pattern = patterns.get(route.path)!;
      if ('redirect' in route) {
        if (pattern.parameters.length) {
          fail('STATIC_REDIRECT_UNRESOLVED');
        }
        if (paths.has(route.path)) {
          fail('STATIC_ROUTE_DUPLICATE');
        }
        paths.add(route.path);
        manifest.hosting.redirects.push({
          from: route.path,
          to: route.redirect,
          status: route.status,
        });
        continue;
      }
      if (pattern.parameters.length && !route.params) {
        fail('STATIC_PARAMS_REQUIRED');
      }
      /** Per-enumeration cancellation owner linked to the whole-export signal. */
      const routeController = new AbortController();
      /** Minimum whole-export and per-route enumeration deadline. */
      const routeDeadline = Math.min(deadline, Date.now() + routeTimeout);
      /** Owned per-enumeration deadline timer removed after iterator release. */
      const routeTimer = setTimeout(
        () => routeController.abort(),
        Math.max(1, routeDeadline - Date.now())
      );
      /** Propagate export cancellation to the current route/render owner.
       * @returns {void} Cooperative abort notification completion.
       */
      const forward = () => routeController.abort();
      controller.signal.addEventListener('abort', forward, { once: true });
      let iterator:
        | AsyncIterator<Record<string, string>>
        | Iterator<Record<string, string>>
        | undefined;
      try {
        /** Explicit finite parameter source returned by the trusted enumerator; no module discovery. */
        const values = route.params
          ? await route.params(
              Object.freeze({
                signal: routeController.signal,
                deadline: routeDeadline,
              })
            )
          : [{}];
        if (
          !values ||
          (typeof (values as any)[Symbol.asyncIterator] !== 'function' &&
            typeof (values as any)[Symbol.iterator] !== 'function')
        ) {
          fail('STATIC_PARAMS_INVALID');
        }
        iterator =
          typeof (values as any)[Symbol.asyncIterator] === 'function'
            ? (values as any)[Symbol.asyncIterator]()
            : (values as any)[Symbol.iterator]();
        let enumerated = 0;
        while (true) {
          check();
          if (routeController.signal.aborted || Date.now() >= routeDeadline) {
            fail('STATIC_ENUMERATION_TIMEOUT');
          }
          /** Actual enumeration result checked after cancellation/deadline observation. */
          const next = await iterator!.next();
          check();
          if (routeController.signal.aborted || Date.now() >= routeDeadline) {
            fail('STATIC_ENUMERATION_TIMEOUT');
          }
          if (next.done) {
            break;
          }
          if (++enumerated > maxRoutes || paths.size >= maxRoutes) {
            fail('STATIC_ROUTE_LIMIT');
          }
          /** Immutable validated parameter record required to match every declared dynamic name. */
          const params = publicValue(next.value);
          if (
            !params ||
            typeof params !== 'object' ||
            Array.isArray(params) ||
            Object.keys(params).sort().join(',') !==
              pattern.parameters
                .map((item) => item.name)
                .sort()
                .join(',')
          ) {
            fail('STATIC_PARAMS_INVALID');
          }
          let pathname = route.path;

          for (const parameter of pattern.parameters) {
            /** Validated parameter/resource lookup value before encoding or use. */
            const value = params[parameter.name];
            if (
              typeof value !== 'string' ||
              !value ||
              (!parameter.catchAll && value.includes('/'))
            ) {
              fail('STATIC_PARAMS_INVALID');
            }
            /** Catch-all path components individually checked before URI encoding. */
            const parts = value.split('/');
            if (
              parts.some(
                (part) =>
                  !part ||
                  !/^[A-Za-z0-9._~-]+$/.test(part) ||
                  part === '.' ||
                  part === '..' ||
                  // eslint-disable-next-line no-control-regex -- Reject backslashes and controls in dynamic path segments.
                  /[\\\x00-\x1f\x7f]/.test(part) ||
                  encodeURIComponent(part).length > 200
              )
            ) {
              fail('STATIC_PARAMS_INVALID');
            }
            pathname = pathname.replace(
              ':' + parameter.name + (parameter.catchAll ? '*' : ''),
              parts.map((part) => encodeURIComponent(part)).join('/')
            );
          }
          if (pathname.length > 2048 || paths.has(pathname)) {
            fail('STATIC_ROUTE_DUPLICATE');
          }
          paths.add(pathname);
          pages.push({ route, params, pathname });
        }
        if (!enumerated) {
          fail('STATIC_PARAMS_EMPTY');
        }
      } finally {
        routeController.abort();
        try {
          await iterator?.return?.();
        } finally {
          clearTimeout(routeTimer);
          controller.signal.removeEventListener('abort', forward);
        }
      }
    }
    /** Explicit normalized redirect graph used to reject cycles/unresolved static targets. */
    const redirects = new Map(
      manifest.hosting.redirects.map((item) => [
        item.from,
        item.to.replace(/\/$/, '') || '/',
      ])
    );
    for (const [from] of redirects) {
      /** Current redirect traversal path used for cycle detection. */
      const visited = new Set<string>();
      let target = from;
      while (redirects.has(target)) {
        if (visited.has(target)) {
          fail('STATIC_REDIRECT_CYCLE');
        }
        visited.add(target);
        target = redirects.get(target)!;
      }
      if (
        options.mode !== 'mixed' &&
        !paths.has(target) &&
        target !== mount('/404.html')
      ) {
        fail('STATIC_REDIRECT_UNRESOLVED');
      }
    }
    if (paths.has(mount('/404.html'))) {
      fail('STATIC_OUTPUT_COLLISION');
    }
    check();
    adapter = await options.renderer();
    if (
      !adapter ||
      !adapter.capabilities?.staticHtml ||
      adapter.capabilities.streaming ||
      adapter.capabilities.hydration ||
      adapter.capabilities.clientOnly
    ) {
      fail('STATIC_RENDERER_UNSUPPORTED');
    }
    /** Inspect rendered fragments for unsupported active/server features and undeclared resource URLs; never fetch resources.
     * @param {string} html - Trusted renderer fragment checked before publication.
     * @param {string} pathname - Resolved public page path used for URL policy.
     * @returns {void} Bounded fragment/URL validation completion.
     */
    const validateHtml = (html: string, pathname: string) => {
      if (/<!doctype|<\s*\/?\s*(?:html|head|body)(?:\s|>)/i.test(html)) {
        fail('STATIC_FRAGMENT_REQUIRED');
      }
      /** Parse5 fragment tree used only for bounded static output validation. */
      const fragment = parseFragment(html);
      /** Bounded fragment traversal stack; no DOM scripting is run. */
      const pending: any[] = [fragment];
      let count = 0;
      while (pending.length) {
        /** Parsed fragment node inspected before following child nodes. */
        const node = pending.pop();
        if (++count > 50000) {
          fail('STATIC_HTML_LIMIT');
        }
        /** Parsed HTML tag name checked against unsupported active/server elements. */
        const name = node.tagName;
        if (
          [
            'script',
            'form',
            'iframe',
            'object',
            'embed',
            'base',
            'meta',
            'template',
          ].includes(name)
        ) {
          fail('STATIC_SERVER_FEATURE');
        }
        for (const attr of node.attrs ?? []) {
          if (
            /^on/i.test(attr.name) ||
            attr.name === 'srcset' ||
            /^_action_/.test(attr.value)
          ) {
            fail('STATIC_SERVER_FEATURE');
          }
          if (
            [
              'src',
              'href',
              'action',
              'srcdoc',
              'poster',
              'xlink:href',
            ].includes(attr.name)
          ) {
            if (attr.name === 'srcdoc') {
              fail('STATIC_SERVER_FEATURE');
            }
            /** Selected validated public URL or parsed authored HTML destination. */
            let referencePath: string;
            if (pathname.endsWith('/404.html')) {
              if (base === '/') {
                referencePath = '/';
              } else {
                referencePath = base + '/';
              }
            } else if (pathname === '/') {
              referencePath = '/';
            } else {
              referencePath = pathname + '/';
            }
            /** Resolve authored attributes against the validated public page reference base. */
            const url = new URL(attr.value, origin!.origin + referencePath);
            /** Whether this attribute requires a selected local exported asset rather than an ordinary link. */
            const resource =
              ['src', 'poster'].includes(attr.name) ||
              (attr.name === 'href' && !['a', 'area'].includes(name));
            if (
              resource &&
              (url.origin !== origin!.origin ||
                !Array.from(assetUrls.values()).includes(url.pathname))
            ) {
              fail('STATIC_ASSET_MISSING');
            }
            if (
              !['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)
            ) {
              fail('STATIC_URL_INVALID');
            }
            if (/\/_zerux\/actions\//.test(url.pathname)) {
              fail('STATIC_SERVER_FEATURE');
            }
            if (
              url.origin === origin!.origin &&
              attr.value &&
              !attr.value.startsWith('#')
            ) {
              if (
                !(
                  base === '/' ||
                  url.pathname === base ||
                  url.pathname.startsWith(base + '/')
                )
              ) {
                fail('STATIC_BASE_INVALID');
              }
              if (
                (['src', 'poster'].includes(attr.name) ||
                  (attr.name === 'href' && !['a', 'area'].includes(name))) &&
                !Array.from(assetUrls.values()).includes(url.pathname)
              ) {
                fail('STATIC_ASSET_MISSING');
              }
            }
          }
        }
        pending.push(...(node.childNodes ?? []));
      }
    };
    /** Render one public immutable view through a temporary request-owned registry borrowing the export adapter.
     * @param {V} view - Bounded inert public view.
     * @param {string} pathname - Resolved public page path.
     * @param {AbortSignal} signal - Current export/render cancellation signal.
     * @returns {Promise<string>} Validated static fragment; temporary registry cleanup always settles.
     */
    const render = async (view: V, pathname: string, signal: AbortSignal) => {
      /** Owned temporary render registry; adapter disposal remains with the overall exporter. */
      const registry = createRendererRegistry({
        maxBytes: maxPage,
        maxActive: 1,
        timeoutMs: routeTimeout,
      });
      try {
        /** Registry-local token wrapping the borrowed export adapter without duplicate adapter disposal. */
        const token = registry.register({
          ...adapter!,
          render: adapter!.render.bind(adapter),
          dispose: undefined,
        });
        /** Stage-local candidate validated against the surrounding explicit JSON/type/budget contract. */
        const result = await registry.render(token, view, {
          requestId: 'static-' + digest(pathname).slice(0, 24),
          pathname,
          signal,
        });
        if (
          !isRenderedHtml(result) ||
          (result.headers && Object.keys(result.headers).length)
        ) {
          fail('STATIC_PRIVATE_RESPONSE');
        }
        validateHtml(result.html, pathname);
        return result.html;
      } finally {
        await registry.close();
      }
    };
    /** Build a fixed document shell with context-specific title/canonical encoding.
     * @param {string} title - Authored bounded page title.
     * @param {string} html - Already validated trusted static fragment.
     * @param {string | undefined} canonical - Optional validated public canonical URL; omitted for real 404 output.
     * @returns {string} Complete deterministic document without hydration/server runtime serialization.
     */
    const document = (title: string, html: string, canonical?: string) =>
      `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtmlText(title)}</title>${canonical ? `<link rel="canonical" href="${escapeHtmlAttribute(canonical)}">` : ''}</head><body>${html}</body></html>\n`;
    for (const page of pages.sort((a, b) =>
      a.pathname < b.pathname ? -1 : 1
    )) {
      /** Exact configured public origin plus normalized resolved page path. */
      const canonical =
        origin!.origin + (page.pathname === '/' ? '/' : page.pathname + '/');
      let html: string | undefined;
      for (let pass = 0; pass < 2; pass++) {
        check();
        /** Per-render cooperative cancellation owner. */
        const local = new AbortController();
        /** Propagate export cancellation to the current route/render owner.
         * @returns {void} Cooperative abort notification completion.
         */
        const forward = () => local.abort();
        /** Minimum per-render and whole-export deadline. */
        const expires = Math.min(deadline, Date.now() + routeTimeout);
        /** Owned whole-export or per-render deadline timer released after actual settlement. */
        const timer = setTimeout(forward, Math.max(1, expires - Date.now()));
        controller.signal.addEventListener('abort', forward, { once: true });
        try {
          /** Request-free public render/view context; unsupported request properties reject. */
          const context: StaticExportContext = new Proxy(
            Object.freeze({
              signal: local.signal,
              deadline: expires,
              pathname: page.pathname,
              canonical,
              /** Resolve only a selected local asset to its mounted public URL, never fetch a remote resource.
               * @param {string} url - Explicit selected source asset URL.
               * @returns {string} Mounted exported URL; unknown resources reject.
               */
              asset(url: string) {
                /** Validated parameter/resource lookup value before encoding or use. */
                const value = assetUrls.get(url);
                if (!value) {
                  fail('STATIC_ASSET_MISSING');
                }
                return value;
              },
            }),
            {
              /** Reject request-dependent context reads instead of serializing an application runtime into static output.
               * @param {object} target - Fixed frozen public context projection.
               * @param {string | symbol} key - Requested context property.
               * @param {unknown} receiver - Native proxy receiver.
               * @returns {unknown} Allowed public context property; unavailable request fields reject.
               */
              get(target, key, receiver) {
                if (
                  typeof key === 'string' &&
                  ![
                    'signal',
                    'deadline',
                    'pathname',
                    'canonical',
                    'asset',
                  ].includes(key)
                ) {
                  fail('STATIC_REQUEST_CONTEXT_UNAVAILABLE');
                }
                return Reflect.get(target, key, receiver);
              },
            }
          );
          /** Bounded immutable public-only view projection returned by the explicit callback. */
          const view = publicValue(await page.route.view(page.params, context));
          if (local.signal.aborted || Date.now() >= expires) {
            fail('STATIC_RENDER_TIMEOUT');
          }
          /** Actual static fragment compared across two passes for deterministic output. */
          const rendered = await render(view, page.pathname, local.signal);
          if (local.signal.aborted || Date.now() >= expires) {
            fail('STATIC_RENDER_TIMEOUT');
          }
          if (pass && rendered !== html) {
            fail('STATIC_NONDETERMINISTIC');
          }
          html = rendered;
        } finally {
          local.abort();
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', forward);
        }
      }
      /** Complete encoded document checked against the final page byte ceiling. */
      const output = document(
        page.route.title ?? page.pathname,
        html!,
        canonical
      );
      if (Buffer.byteLength(output) > maxPage) {
        fail('STATIC_PAGE_LIMIT');
      }
      /** Project-contained output/source filename checked by relative-path and byte policy. */
      const file =
        (page.pathname === '/' ? '' : page.pathname.slice(1) + '/') +
        'index.html';
      await put(file, output);
      manifest.pages.push({
        url: page.pathname === '/' ? '/' : page.pathname + '/',
        file,
        status: 200,
        canonical,
      });
      if (page.pathname !== '/') {
        manifest.hosting.redirects.push({
          from: page.pathname,
          to: page.pathname + '/',
          status: 308,
        });
      }
    }
    /** Explicit bounded public missing-page view; no universal SPA fallback is created. */
    const notFound = publicValue(options.notFound.view);
    /** First real 404 fragment rendering. */
    const missing = await render(
      notFound,
      mount('/404.html'),
      controller.signal
    );
    /** Second 404 rendering required to match the first exactly. */
    const missingAgain = await render(
      notFound,
      mount('/404.html'),
      controller.signal
    );
    if (missing !== missingAgain) {
      fail('STATIC_NONDETERMINISTIC');
    }
    /** Complete real 404 document without an invented canonical. */
    const missingDocument = document(
      options.notFound.title ?? 'Not found',
      missing
    );
    if (Buffer.byteLength(missingDocument) > maxPage) {
      fail('STATIC_PAGE_LIMIT');
    }
    await put(manifest.hosting.notFound.file, missingDocument);
    manifest.pages.push({
      url: mount('/404.html'),
      file: manifest.hosting.notFound.file,
      status: 404,
    });
    disposed = true;
    await adapter.dispose?.();
    check();
    manifest.files.sort((a, b) => (a.file < b.file ? -1 : 1));
    manifest.pages.sort((a, b) => (a.url < b.url ? -1 : 1));
    manifest.hosting.redirects.sort((a, b) => (a.from < b.from ? -1 : 1));
    /** Deterministic public manifest text included in the complete-output byte ceiling. */
    const serialized = JSON.stringify(manifest, null, 2) + '\n';
    if (total + Buffer.byteLength(serialized) > maxBytes) {
      fail('STATIC_OUTPUT_LIMIT');
    }
    await fs.writeFile(path.join(stage, 'static-export.json'), serialized, {
      flag: 'wx',
      mode: 0o644,
    });
    for (const file of manifest.files) {
      check();
      if (
        digest(await safeFile(root, path.join(stage!, file.file), 16777216)) !==
        file.sha256
      ) {
        fail('STATIC_CANDIDATE_MODIFIED');
      }
    }
    await assertSafeBuildDirectories(root, out);
    await fs.chmod(stage!, 0o755);
    check();
    /** Owned temporary previous-output backup restored if candidate promotion fails. */
    const backup = path.join(parent, '.static-previous-' + randomUUID());
    let saved = false;
    try {
      try {
        await fs.rename(out, backup);
        saved = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
      try {
        check();
        await fs.rename(stage, out);
        stage = undefined;
      } catch (error) {
        if (saved) {
          await fs.rename(backup, out);
        }
        throw error;
      }
      if (saved) {
        await fs.rm(backup, { recursive: true, force: true });
      }
    } catch (cause) {
      throw new StaticExportError('STATIC_PROMOTION_FAILED', cause);
    }
    return manifest;
  } catch (cause) {
    throw cause instanceof StaticExportError
      ? cause
      : new StaticExportError('STATIC_EXPORT_FAILED', cause);
  } finally {
    controller.abort();
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    try {
      if (adapter && !disposed) {
        await adapter.dispose?.();
      }
    } finally {
      try {
        if (stage) {
          await fs.rm(stage, { recursive: true, force: true });
        }
      } finally {
        await lock.close();
        await fs.unlink(lockPath);
      }
    }
  }
}
