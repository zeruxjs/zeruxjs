import {
  assertSafeBuildDirectories,
  assertDisjointBuildSources,
  readBuildFile,
} from './build-paths.js';
import {
  ModuleBoundaryError,
  classifyModules,
  loadBuildParser,
  rewriteClientModule,
  type BuildSource,
} from '../compiler/module-boundaries.js';
import { prepareConfiguration } from '../bootstrap/config-validation.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { ZeruxConfig } from '../index.js';

/** Explicit supported application source families; generated/dependency trees are never scanned. */
const SOURCE_DIRS = [
  'app',
  'middleware',
  'controllers',
  'composables',
  'plugins',
  'public',
  'lib',
  'components',
];
/** Authored TypeScript extensions that require the selected build transformer. */
const CODE = /\.(?:ts|tsx|mts|cts)$/;
/** Map authored TypeScript suffixes to matching emitted JavaScript module suffixes.
 * @param {string} file - Authored relative source path.
 * @returns {string} Emitted relative filename; other suffixes remain unchanged.
 */
const emittedFile = (file: string) =>
  file.replace(CODE, (ext) => {
    if (ext === '.mts') {
      return '.mjs';
    }
    if (ext === '.cts') {
      return '.cjs';
    }
    return '.js';
  });
/** Maximum bytes accepted for one scanned project file. */
const MAX_FILE = 16 * 1024 * 1024;
/** Directory segments excluded from both explicit source registration and recursive scanning. */
const ignored = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.zerux',
]);
export interface ProjectBuildOptions {
  /** Trusted project root selected by the caller. */
  rootDir: string;
  /** Logical names to leading-client source paths, or prebundled public asset URLs. */
  clientEntries?: Record<string, string>;
  /** Explicit validated runtime/build namespace. */
  serviceName?: string;
  /** Private host build settings; no application services are started. */
  config?: ZeruxConfig;
  /** Testable compiler seam; production uses the project's TypeScript dependency. */
  transform?: (
    source: string,
    fileName: string,
    context?: {
      /** Explicit server/client transform target. */
      environment: 'server' | 'client';
    }
  ) => Promise<string> | string;
}
export interface ProductionBuildManifest {
  /** Explicit private/public rendering manifest filenames. */
  rendering?: {
    /** Private source/environment graph manifest filename. */
    serverManifest: 'server-manifest.json';
    /** Public URL/integrity asset manifest filename. */
    assetsManifest: 'public-assets.json';
  };
  /** Completed private build receipt schema version 1. */
  schema: 1;
  /** Number of unique scanned non-declaration source files. */
  files: number;
  /** Aggregate original source bytes included in the build identity. */
  bytes: number;
  /** Deterministic SHA-256 identity of ordered source paths/bytes. */
  digest: string;
  /** Exact private source-to-compiled directory mapping. */
  directories: Record<string, string>;
}

/** Validate a source path stays strictly within the project and excludes generated/dependency directories.
 * @param {string} root - Trusted absolute project root.
 * @param {string} value - Explicit host-authored source path.
 * @returns {string} Validated project-relative non-root path.
 */
function projectRelative(root: string, value: string) {
  /** Absolute project source candidate checked before project-relative use. */
  const full = path.resolve(root, value);
  /** Validated non-root project-relative source path without generated segments. */
  const rel = path.relative(root, full);
  if (
    !rel ||
    rel === '..' ||
    rel.startsWith('..' + path.sep) ||
    path.isAbsolute(rel)
  ) {
    throw new Error(`Invalid project source path: ${value}`);
  }
  if (rel.split(path.sep).some((part) => ignored.has(part))) {
    throw new Error(`Generated directories cannot be build sources: ${value}`);
  }
  return rel;
}

/** Yield source files in deterministic order without following symlinks or special files.
 * @param {string} base - Explicit project-contained source root.
 * @param {string} root - Trusted absolute project root.
 * @returns {AsyncGenerator<string>} Project-contained source file paths; unsupported entries reject.
 */
async function* scan(base: string, root: string): AsyncGenerator<string> {
  /** No-follow source/output metadata required before recursive reads or output creation. */
  const info = await fs.lstat(base);
  if (info.isSymbolicLink()) {
    throw new Error(`Symlink is not an allowed build source: ${base}`);
  }
  if (info.isFile()) {
    yield base;
    return;
  }
  if (!info.isDirectory()) {
    throw new Error(`Unsupported build source: ${base}`);
  }
  for (const entry of (await fs.readdir(base)).sort()) {
    if (ignored.has(entry)) {
      continue;
    }
    /** Project-contained scanned source path or private production manifest location. */
    const file = path.join(base, entry);
    if (!file.startsWith(root + path.sep)) {
      throw new Error('Unsafe build path');
    }
    yield* scan(file, root);
  }
}
/** Load the explicit project TypeScript dependency and return a transpiler; this is not a semantic typecheck or source evaluation.
 * @param {string} root - Trusted project root for package and module-mode resolution.
 * @param {boolean} client - Whether to emit browser ESM instead of the authored server module mode.
 * @returns {Promise<Function>} Compiler-backed source-to-JavaScript transformer.
 */
async function defaultTransformer(root: string, client = false) {
  let esm = false;
  try {
    esm =
      JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
        .type === 'module';
  } catch {
    /* Node defaults to CommonJS without type:module. */
  }
  /** Fixed compiler package name; no arbitrary transformer package discovery. */
  const moduleName = 'typescript';
  /** Native project-local package resolution helper, loaded only during explicit compilation. */
  const { createRequire } = await import('node:module');
  /** Project-scoped loader for the explicitly required TypeScript build dependency. */
  const require = createRequire(path.join(root, 'package.json'));
  /** Host-installed TypeScript compiler namespace; compilation never evaluates source modules. */
  const ts = require(moduleName) as any;
  return (source: string, fileName: string) => {
    /** Actual transformer output or fixed build-output directory selected for validation. */
    const output = ts.transpileModule(source, {
      fileName,
      compilerOptions: {
        module:
          !client &&
          (fileName.endsWith('.cts') || (!esm && !fileName.endsWith('.mts')))
            ? ts.ModuleKind.CommonJS
            : ts.ModuleKind.ESNext,
        moduleResolution:
          !client &&
          (fileName.endsWith('.cts') || (!esm && !fileName.endsWith('.mts')))
            ? ts.ModuleResolutionKind.Node10
            : ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
      reportDiagnostics: true,
    });
    /** Compiler-reported error diagnostics; an unsuccessful transform never promotes staging. */
    const errors =
      output.diagnostics?.filter(
        (d: { category: number }) => d.category === ts.DiagnosticCategory.Error
      ) ?? [];
    if (errors.length) {
      throw new Error(
        `TypeScript transform failed for ${fileName}: ${ts.flattenDiagnosticMessageText(errors[0].messageText, '\n')}`
      );
    }
    return output.outputText;
  };
}

/** Build a complete deterministic private candidate and promote it only after compilation, boundary validation and manifest generation succeed.
 * @param {ProjectBuildOptions} options - Explicit project root, source settings, client entries and optional trusted compiler seam.
 * @returns {Promise<ProductionBuildManifest>} Completed build receipt; failed candidates preserve the previous complete build.
 */
export async function buildProjectSources(
  options: ProjectBuildOptions
): Promise<ProductionBuildManifest> {
  /** Absolute trusted project root selected by the build caller. */
  const root = path.resolve(options.rootDir);
  /** Prepared private configuration; compiler service discovery does not start application services. */
  const config = (await prepareConfiguration(options.config ?? {})).config;
  /** Validated runtime build namespace, default zerux. */
  const serviceName = options.serviceName ?? 'zerux';
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(serviceName)) {
    throw new Error('Invalid service name');
  }
  /** Configured output path or the conventional private runtime directory. */
  const outputRelative = config.outDir ?? `.${serviceName}`;
  /** Absolute destination required to stay strictly inside the project. */
  const outputRoot = path.resolve(root, outputRelative);
  if (outputRoot === root || !outputRoot.startsWith(root + path.sep)) {
    throw new Error('Build output must be inside the project');
  }
  /** Slash-normalized build output prefix stored in the private manifest. */
  const relativeOutput = path
    .relative(root, outputRoot)
    .split(path.sep)
    .join('/');
  if ([...SOURCE_DIRS].some((dir) => outputRoot === path.join(root, dir))) {
    throw new Error('Build output cannot overwrite application sources');
  }
  /** Complete active build destination; replaced only after a candidate is ready. */
  const final = path.join(outputRoot, 'build');
  /** Owned unique private candidate directory removed if promotion does not complete. */
  const staging = path.join(outputRoot, `.build-${randomUUID()}`);
  /** Owned unique previous-build backup restored if candidate promotion fails. */
  const backup = path.join(outputRoot, `.build-old-${randomUUID()}`);
  /** Explicit authored source-directory configuration. */
  const structure = config.structure ?? {};
  /** Private source-to-compiled-directory mapping consumed by production startup. */
  const directories: Record<string, string> = {};
  /** Deduplicated explicit source roots including the optional authored entry file. */
  const sourcePaths = new Set<string>();
  /** Ordered configured public source roots preserving overlap precedence. */
  const publicRoots: string[] = [];
  /** Explicit middleware/controller/plugin roots classified as server-only. */
  const serverRoots: string[] = [];
  /** Explicit route roots checked for server handler syntax. */
  const appRoots: string[] = [];
  let scriptBytes = 0;
  let entryRelative: string | undefined;
  /** Bounded authored script graph collected for syntax-only environment classification. */
  const buildSources: BuildSource[] = [];
  /** Private candidate static asset records retaining source/priority only until public projection. */
  const publicAssets: {
    /** Root-relative public asset URL. */
    url: string;
    /** Content-derived SHA-256 subresource integrity value. */
    integrity: string;
    /** Aggregate original source bytes included in the build identity. */
    bytes: number;
    /** Explicit static/module public asset kind. */
    kind: string;
    /** Private configured public-source precedence; omitted from public assets. */
    priority: number;
    /** Private authored source identity; omitted from public asset manifests. */
    source: string;
  }[] = [];
  let entryName: string | undefined;
  for (const ext of ['.ts', '.js', '.mjs', '.cjs', '.mts', '.cts']) {
    /** Finite authored entry candidate checked without importing the application. */
    const possible = `${config.entryPoint ?? 'index'}${ext}`;
    try {
      if ((await fs.lstat(path.join(root, possible))).isFile()) {
        entryName = config.entryPoint ?? 'index';
        entryRelative = possible.split(path.sep).join('/');
        sourcePaths.add(projectRelative(root, possible));
        break;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
  for (const key of SOURCE_DIRS) {
    /** Configured source-family path or validated production entry mapping. */
    const entry = (structure as Record<string, unknown>)[key] ?? key;
    for (const name of Array.isArray(entry) ? entry : [entry]) {
      if (typeof name !== 'string') {
        throw new TypeError(`Invalid structure.${key}`);
      }
      /** Validated non-root project-relative source path without generated segments. */
      const rel = projectRelative(root, name);
      directories[rel] = path.posix.join(
        relativeOutput,
        'build',
        rel.split(path.sep).join('/')
      );
      sourcePaths.add(rel);
      if (key === 'public') {
        publicRoots.push(rel.split(path.sep).join('/'));
      }
      if (['middleware', 'controllers', 'plugins'].includes(key)) {
        serverRoots.push(rel.split(path.sep).join('/'));
      }
      if (key === 'app') {
        appRoots.push(rel.split(path.sep).join('/'));
      }
    }
  }

  await assertDisjointBuildSources(root, outputRoot, sourcePaths);
  await assertSafeBuildDirectories(root, outputRoot);

  /** Source-order SHA-256 builder identity, not authorship or a distributed lock. */
  const digest = createHash('sha256');
  let files = 0,
    bytes = 0;
  /** Scanned source identities already processed, including overlapping source roots. */
  const emitted = new Set<string>();
  let published = false,
    backedUp = false;
  try {
    /** No-follow source/output metadata required before recursive reads or output creation. */
    const info = await fs.lstat(outputRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Unsafe build output directory');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  await fs.mkdir(outputRoot, { recursive: true, mode: 0o700 });
  // Refuse attacker-controlled symlink destinations.
  for (const target of [final, staging]) {
    try {
      if ((await fs.lstat(target)).isSymbolicLink()) {
        throw new Error(`Unsafe build target: ${target}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
  await fs.mkdir(staging, { mode: 0o700 });
  try {
    let transform = options.transform;
    for (const source of [...sourcePaths].sort()) {
      /** Absolute source root or borrowed original structure mapping for this operation. */
      const base = path.join(root, source);
      await assertSafeBuildDirectories(
        root,
        path.dirname(base),
        'build source'
      );
      try {
        await fs.lstat(base);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        throw error;
      }
      for await (const file of scan(base, root)) {
        /** Project-relative scanned source identity before slash normalization. */
        const relative = path.relative(root, file);
        if (/\.d\.[cm]?ts$/.test(relative)) {
          continue;
        }
        if (emitted.has(relative)) {
          continue;
        } // Nested source roots may overlap.
        emitted.add(relative);
        if (
          /^\.env(?:\.|$)/.test(path.basename(relative)) ||
          /\.(?:key|pem)$/i.test(relative)
        ) {
          throw new Error(
            `Potential secret file in build sources: ${relative}`
          );
        }
        /** Bounded same-inode bytes read without following a leaf symlink. */
        const raw = await readBuildFile(file, MAX_FILE);
        /** Slash-normalized graph source identity. */
        const posix = relative.split(path.sep).join('/');
        /** Matching explicit public source prefix, if any. */
        const publicRoot = publicRoots.find((base) =>
          posix.startsWith(base + '/')
        );
        if (/\.[cm]?[jt]sx?$/.test(relative)) {
          scriptBytes += raw.length;
          if (
            buildSources.length >= 5000 ||
            scriptBytes > 64 * 1024 * 1024 ||
            raw.length > 1048576
          ) {
            throw new ModuleBoundaryError('MODULE_GRAPH_LIMIT', [posix]);
          }
          buildSources.push({
            relative: posix,
            source: raw.toString('utf8'),
            serverOnly:
              posix === entryRelative ||
              serverRoots.some((base) => posix.startsWith(base + '/')),
            routeModule: appRoots.some((base) => posix.startsWith(base + '/')),
            ...(publicRoot
              ? { publicPath: posix.slice(publicRoot.length + 1) }
              : {}),
          });
        }
        /** Whether this authored source requires TypeScript transformation. */
        const isCode = CODE.test(relative);
        if (isCode && !transform) {
          transform = await defaultTransformer(root);
        }
        /** Transformed bytes or original non-code asset bytes written only into staging. */
        const built = isCode
          ? Buffer.from(
              await transform!(raw.toString('utf8'), file, {
                environment: 'server',
              })
            )
          : raw;
        /** Owned candidate output path under the unique staging directory. */
        const destination = path.join(
          staging,
          isCode
            ? relative.replace(CODE, (ext) => {
                if (ext === '.mts') {
                  return '.mjs';
                }
                if (ext === '.cts') {
                  return '.cjs';
                }
                return '.js';
              })
            : relative
        );
        await fs.mkdir(path.dirname(destination), {
          recursive: true,
          mode: 0o700,
        });
        await fs.writeFile(destination, built, { flag: 'wx', mode: 0o600 });
        for (const [priority, base] of publicRoots.entries()) {
          if (posix.startsWith(base + '/')) {
            publicAssets.push({
              url: '/' + emittedFile(posix.slice(base.length + 1)),
              integrity:
                'sha256-' + createHash('sha256').update(built).digest('base64'),
              bytes: built.length,
              kind: 'static',
              priority,
              source: posix,
            });
          }
        }
        digest.update(relative);
        digest.update('\0');
        digest.update(raw);
        digest.update('\0');
        files++;
        bytes += raw.length;
        if (files > 20_000 || bytes > 512 * 1024 * 1024) {
          throw new Error('Project build exceeds safety limits');
        }
      }
    }
    /** Host TypeScript syntax parser, loaded only when script graph validation is needed. */
    const parser = buildSources.length
      ? await loadBuildParser(root)
      : undefined;
    /** Complete closed-graph client/server/shared classification before publication. */
    const classification = parser
      ? classifyModules(parser, buildSources)
      : {
          modules: [],
          clientEntries: [],
          clientModules: new Set<string>(),
          edges: new Map(),
        };
    /** Validated compiler-emitted client source keyed by graph identity. */
    const clientOutput = new Map<string, string>();
    /** Deterministic per-source public asset identifiers, distinct from content integrity. */
    const ids = new Map<string, string>();
    let browserTransform: ProjectBuildOptions['transform'];
    for (const file of [...classification.clientModules].sort()) {
      /** Explicit authored graph record required for each classified client module. */
      const item = buildSources.find((source) => source.relative === file)!;
      browserTransform ??=
        options.transform ?? (await defaultTransformer(root, true));
      /** Actual transformer output or fixed build-output directory selected for validation. */
      const output = await browserTransform(
        item.source,
        path.join(root, file),
        { environment: 'client' }
      );
      if (typeof output !== 'string' || Buffer.byteLength(output) > MAX_FILE) {
        throw new Error('Invalid client compiler output');
      }
      clientOutput.set(file, output);
      ids.set(
        file,
        createHash('sha256').update(file).digest('hex').slice(0, 24)
      );
    }
    /** Ordered client graph/content identity used in the generated public URL namespace. */
    const clientDigest = createHash('sha256');
    for (const [file, source] of clientOutput) {
      clientDigest.update(file);
      clientDigest.update('\0');
      clientDigest.update(source);
      clientDigest.update('\0');
    }
    /** Bounded deterministic client graph version used for asset cache identity. */
    const graphId = clientDigest.digest('hex').slice(0, 24);
    /** Configured first public directory or the conventional public fallback. */
    const clientRoot = publicRoots[0] ?? 'public';
    /** Generated browser module URL/integrity/size records without private source paths. */
    const clientAssets: {
      /** Root-relative public asset URL. */
      url: string;
      /** Content-derived SHA-256 subresource integrity value. */
      integrity: string;
      /** Aggregate original source bytes included in the build identity. */
      bytes: number;
      /** Explicit static/module public asset kind. */
      kind: string;
    }[] = [];
    for (const [file, source] of clientOutput) {
      /** Actual transformer output or fixed build-output directory selected for validation. */
      const output = rewriteClientModule(
        parser!,
        file,
        source,
        buildSources,
        ids
      );
      /** Graph-assigned source asset identifier required before emitted import rewriting. */
      const id = ids.get(file)!;
      /** Validated selected public asset URL, never a private source path. */
      const url = `/_zerux/client/${graphId}/${id}.js`;
      /** Owned candidate output path under the unique staging directory. */
      const destination = path.join(
        staging,
        clientRoot,
        '_zerux',
        'client',
        graphId,
        id + '.js'
      );
      await fs.mkdir(path.dirname(destination), {
        recursive: true,
        mode: 0o700,
      });
      await fs.writeFile(destination, output, { flag: 'wx', mode: 0o600 });
      clientAssets.push({
        url,
        integrity:
          'sha256-' + createHash('sha256').update(output).digest('base64'),
        bytes: Buffer.byteLength(output),
        kind: 'module',
      });
      // A public TypeScript source must not retain a CommonJS copy beside the browser asset.
      /** Optional explicitly public authored source needing an ESM replacement beside hashed assets. */
      const publicCopy = buildSources.find(
        (item) => item.relative === file
      )?.publicPath;
      if (publicCopy !== undefined) {
        /** Owned public candidate path or exact production directory mapping from the manifest. */
        const target = path.join(staging, emittedFile(file));
        /** Rewritten browser ESM source replacing an otherwise incompatible public server copy. */
        const publicOutput = rewriteClientModule(
          parser!,
          file,
          source,
          buildSources,
          ids,
          `/_zerux/client/${graphId}/`
        );
        await fs.writeFile(target, publicOutput, { mode: 0o600 });
        for (const asset of publicAssets.filter(
          (item) => item.source === file
        )) {
          asset.integrity =
            'sha256-' +
            createHash('sha256').update(publicOutput).digest('base64');
          asset.bytes = Buffer.byteLength(publicOutput);
        }
      }
    }
    for (const module of classification.modules) {
      if (
        module.environment === 'client' &&
        buildSources.find((item) => item.relative === module.path)
          ?.publicPath === undefined
      ) {
        await fs.rm(path.join(staging, emittedFile(module.path)), {
          force: true,
        });
      }
    }
    /** Private environment/source graph manifest; never exposed as the public asset projection. */
    const privateManifest = {
      schema: 1,
      modules: classification.modules.map((module) => ({
        ...module,
        ...(module.environment !== 'client'
          ? { serverFile: emittedFile(module.path) }
          : {}),
        ...(ids.has(module.path)
          ? {
              clientAsset: `/_zerux/client/${graphId}/${ids.get(module.path)}.js`,
            }
          : {}),
      })),
    };
    /** Final per-URL asset selection honoring configured public-source precedence. */
    const selectedAssets = new Map<
      string,
      {
        /** Root-relative public asset URL. */
        url: string; /** Content-derived SHA-256 subresource integrity value. */
        integrity: string; /** Aggregate original source bytes included in the build identity. */
        bytes: number; /** Explicit static/module public asset kind. */
        kind: string;
      }
    >();
    for (const item of [...publicAssets].sort(
      (a, b) => a.priority - b.priority
    )) {
      /** Explicit public-safe projection excluding private source and precedence bookkeeping. */
      const { url, integrity, bytes, kind } = item;
      selectedAssets.set(url, { url, integrity, bytes, kind });
    }
    for (const asset of clientAssets) {
      if (selectedAssets.has(asset.url)) {
        throw new Error(
          'Generated client asset path conflicts with public source'
        );
      }
      selectedAssets.set(asset.url, asset);
    }
    /** Null-prototype bounded authored entry-name map for explicit document bootstrap selection. */
    const namedEntries: Record<string, string> = Object.create(null);
    if (options.clientEntries !== undefined) {
      if (
        !options.clientEntries ||
        typeof options.clientEntries !== 'object' ||
        Array.isArray(options.clientEntries) ||
        Object.keys(options.clientEntries).length > 32
      ) {
        throw new TypeError('Invalid client entries');
      }
      for (const [name, target] of Object.entries(options.clientEntries).sort(
        ([a], [b]) => (a < b ? -1 : 1)
      )) {
        if (
          !/^[a-z][a-z0-9-]{0,63}$/.test(name) ||
          ['constructor', 'prototype'].includes(name) ||
          typeof target !== 'string'
        ) {
          throw new TypeError('Invalid client entry');
        }
        /** Validated selected public asset URL, never a private source path. */
        let url: string | undefined;
        if (target.startsWith('/')) {
          url = target;
        } else if (
          classification.clientEntries.some((entry) => entry === target)
        ) {
          url = `/_zerux/client/${graphId}/${ids.get(target)}.js`;
        } else {
          url = undefined;
        }
        /** Winning configured public source for a selected entry URL. */
        const publicSource = publicAssets
          .filter((asset) => asset.url === url)
          .sort((a, b) => a.priority - b.priority)
          .at(-1)?.source;
        if (
          !url ||
          !selectedAssets.has(url) ||
          !/\.m?js$/.test(url) ||
          (target.startsWith('/') &&
            !clientAssets.some((asset) => asset.url === url) &&
            !classification.clientEntries.some(
              (entry) => entry === publicSource
            ))
        ) {
          throw new Error(
            'Client entry is not an emitted JavaScript entry asset'
          );
        }
        namedEntries[name] = url;
      }
    }
    /** Public URL/integrity/size projection with no private filesystem/source metadata. */
    const publicManifest = {
      schema: 1,
      namedEntries,
      entries: classification.clientEntries.map(
        (file) => `/_zerux/client/${graphId}/${ids.get(file)}.js`
      ),
      assets: [...selectedAssets.values()].sort((a, b) => {
        if (a.url < b.url) {
          return -1;
        }
        if (a.url > b.url) {
          return 1;
        }
        return 0;
      }),
    };
    await fs.writeFile(
      path.join(staging, 'server-manifest.json'),
      JSON.stringify(privateManifest, null, 2),
      { flag: 'wx', mode: 0o600 }
    );
    await fs.writeFile(
      path.join(staging, 'public-assets.json'),
      JSON.stringify(publicManifest, null, 2),
      { flag: 'wx', mode: 0o600 }
    );
    /** Complete private build receipt, written before candidate promotion. */
    const manifest: ProductionBuildManifest = {
      schema: 1,
      rendering: {
        serverManifest: 'server-manifest.json',
        assetsManifest: 'public-assets.json',
      },
      files,
      bytes,
      digest: digest.digest('hex'),
      directories,
    };
    if (entryName) {
      (
        manifest as ProductionBuildManifest & { entryPoint?: string }
      ).entryPoint = entryName;
    }
    await fs.writeFile(
      path.join(staging, 'build-manifest.json'),
      JSON.stringify(manifest, null, 2),
      { flag: 'wx', mode: 0o600 }
    );
    try {
      await fs.rename(final, backup);
      backedUp = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    try {
      await fs.rename(staging, final);
      published = true;
    } catch (error) {
      if (backedUp) {
        await fs.rename(backup, final);
      }
      throw error;
    }
    if (backedUp) {
      await fs.rm(backup, { recursive: true, force: true });
    }
    return manifest;
  } finally {
    if (!published) {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
}

/** Select completed compiled paths only from a validated private manifest; absent builds retain source compatibility without inventing artifacts.
 * @param {string} rootDir - Trusted project root.
 * @param {string} serviceName - Validated runtime namespace.
 * @param {ZeruxConfig} config - Private host configuration, copied for compiled path projection.
 * @returns {Promise<ZeruxConfig>} Configuration selecting exact completed build paths, or unchanged input when no build exists.
 */
export async function resolveProductionStructure(
  rootDir: string,
  serviceName: string,
  config: ZeruxConfig
): Promise<ZeruxConfig> {
  /** Configured output path or the conventional private runtime directory. */
  const outputRelative = config.outDir ?? `.${serviceName}`;
  /** Absolute trusted project root for production output containment checks. */
  const absoluteRoot = path.resolve(rootDir);
  /** Absolute configured build output, required to remain within the project. */
  const absoluteOutput = path.resolve(absoluteRoot, outputRelative);
  if (
    absoluteOutput === absoluteRoot ||
    !absoluteOutput.startsWith(absoluteRoot + path.sep)
  ) {
    throw new Error('Unsafe production build path');
  }
  /** Slash-normalized build output prefix stored in the private manifest. */
  const relativeOutput = path
    .relative(absoluteRoot, absoluteOutput)
    .split(path.sep)
    .join('/');
  await assertSafeBuildDirectories(absoluteRoot, absoluteOutput);
  /** Expected complete staged build directory, checked with no-follow metadata. */
  const buildDir = path.resolve(rootDir, relativeOutput, 'build');
  /** Project-contained scanned source path or private production manifest location. */
  const file = path.join(buildDir, 'build-manifest.json');
  let manifest: ProductionBuildManifest;
  try {
    /** No-follow metadata rejecting symlinked or non-directory active builds. */
    const buildStat = await fs.lstat(buildDir);
    if (!buildStat.isDirectory() || buildStat.isSymbolicLink()) {
      throw new Error('Unsafe production build directory');
    }
    let bytes: Buffer;
    try {
      bytes = await readBuildFile(file, 64 * 1024);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw error;
      }
      throw new Error('Unsafe production build manifest', { cause: error });
    }
    manifest = JSON.parse(bytes.toString('utf8')) as ProductionBuildManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return config;
    }
    throw error;
  }
  if (
    manifest.schema !== 1 ||
    !/^[0-9a-f]{64}$/.test(manifest.digest) ||
    !Number.isSafeInteger(manifest.files) ||
    manifest.files < 1
  ) {
    throw new Error('Invalid production build manifest');
  }
  /** Absolute source root or borrowed original structure mapping for this operation. */
  const base = config.structure ?? {};
  /** Explicit authored source-directory configuration. */
  const structure = { ...base };
  // Copy-only library/component folders are not runtime structure configuration keys.
  for (const key of SOURCE_DIRS.filter(
    (name) => !['lib', 'components'].includes(name)
  )) {
    /** Configured source-family path or validated production entry mapping. */
    const entry = (base as Record<string, unknown>)[key] ?? key;
    /** Configured source directory sequence preserving scalar/list shape. */
    const paths = Array.isArray(entry) ? entry : [entry];
    /** Validated compiled directory sequence required to match the completed manifest. */
    const mapped = paths.map((value) => {
      if (typeof value !== 'string') {
        throw new Error('Invalid production structure');
      }
      /** Validated non-root project-relative source path without generated segments. */
      const rel = projectRelative(rootDir, value);
      /** Owned public candidate path or exact production directory mapping from the manifest. */
      const target = manifest.directories[rel];
      if (
        target !==
        path.posix.join(relativeOutput, 'build', rel.split(path.sep).join('/'))
      ) {
        throw new Error(`Incomplete production build: ${rel}`);
      }
      return target;
    });
    (structure as Record<string, unknown>)[key] = Array.isArray(entry)
      ? mapped
      : mapped[0];
  }
  /** Configured source-family path or validated production entry mapping. */
  const entry = (manifest as ProductionBuildManifest & { entryPoint?: string })
    .entryPoint;
  return {
    ...config,
    structure,
    ...(entry
      ? { entryPoint: path.posix.join(relativeOutput, 'build', entry) }
      : {}),
  };
}

export { ModuleBoundaryError } from '../compiler/boundary-error.js';
