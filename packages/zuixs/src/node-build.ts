import { commitOutputs, attachManifest, readProjectFile } from './outputs.js';
import { compileStylesheet } from './stylesheet.js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createZuix } from './compiler.js';
import { extractClasses } from './scanner.js';
import { resolveLimits } from './safety.js';
import type { ZuixConfig, GenerateResult } from './types.js';

/** Finite source extensions admitted before applying configured globs. */
const supported = /\.(?:html?|jsx?|tsx?|vue|svelte|astro|mdx?)$/i;
/** Dependency/build/private-state directories pruned from traversal. */
const defaultExcluded = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.zerux',
  '.output',
  'coverage',
  '.cache',
  '.zuix',
]);
/** Compile the bounded supported glob subset into a literal-path regex.
 * @param {string} pattern - Trusted project-relative content/exclusion pattern.
 * @returns {RegExp} Anchored path matcher; no source modules are evaluated.
 */
function globRegex(pattern: string): RegExp {
  let s = '^';
  /** Slash-normalized bounded glob text, never evaluated as source code. */
  const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized.length > 500) {
    throw new Error('zuix: glob too long');
  }
  for (let i = 0; i < normalized.length; i++) {
    // Bounded loop indexes the current character, unlike optional lookahead.
    /** Current character proven present by the glob loop bound. */
    const ch = normalized[i]!;
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        i++;
        if (normalized[i + 1] === '/') {
          i++;
          s += '(?:.*/)?';
        } else {
          s += '.*';
        }
      } else {
        s += '[^/]*';
      }
    } else if (ch === '?') {
      s += '[^/]';
    } else {
      s += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(s + '$');
}
/** Expand bounded comma alternatives without shell evaluation.
 * @param {string} pattern - Trusted pattern with finite brace alternatives.
 * @returns {string[]} At most one hundred pending/completed variants, otherwise throws.
 */
function expandBraces(pattern: string): string[] {
  if (typeof pattern !== 'string' || pattern.length > 500) {
    throw new Error('zuix: invalid content glob');
  }
  /** Pending brace-glob expansions, capped together with completed patterns. */
  const queue = [pattern];
  /** Completed brace-glob patterns, bounded before regex compilation. */
  const results: string[] = [];
  while (queue.length) {
    /** Next glob variant and its first innermost brace expansion. */
    const current = queue.pop()!;
    /** Successful brace group; mandatory captures are present only inside this branch. */
    const match = /\{([^{}]+)\}/.exec(current);
    if (!match) {
      results.push(current);
      continue;
    }
    /** Explicit comma alternatives contributing to the finite expansion ceiling. */
    const parts = match[1]!.split(',');
    if (queue.length + results.length + parts.length > 100) {
      throw new Error('zuix: too many content globs');
    }
    for (const part of parts) {
      queue.push(
        current.slice(0, match.index) +
          part +
          current.slice(match.index + match[0].length)
      );
    }
  }
  return results;
}
/** Own a metadata/token cache for one immutable build configuration.
 * @param {string} root - Trusted project root.
 * @param {ZuixConfig} config - Application content/exclusion/output and extraction policies.
 * @returns {object} Scanner with explicit scan, invalidate and clear methods.
 */
export function createProjectScanner(root: string, config: ZuixConfig = {}) {
  /** Resolved project root owning source traversal and output policy. */
  const absoluteRoot = path.resolve(root);
  /** Validated scanner/output resource budgets. */
  const limits = resolveLimits(config.limits);
  /** Expanded allowlisted content globs compiled once for this scanner. */
  const patterns = (
    config.content?.length
      ? config.content
      : ['**/*.{html,js,jsx,ts,tsx,vue,svelte,astro,md,mdx}']
  )
    .flatMap(expandBraces)
    .map(globRegex);
  /** Expanded explicit exclusion globs, separate from built-in tree pruning. */
  const excluded = (config.exclude ?? []).flatMap(expandBraces).map(globRegex);
  /** Source token cache committed only after a complete successful traversal. */
  const cache = new Map<
    string,
    { size: number; mtimeMs: number; classes: string[] }
  >();
  /** Known shared CSS/map/public-manifest paths excluded from source scanning. */
  const generated = new Set([
    path.resolve(absoluteRoot, config.output ?? 'zuix.css'),
    path.resolve(absoluteRoot, (config.output ?? 'zuix.css') + '.map'),
    ...(config.buildManifest
      ? [path.resolve(absoluteRoot, config.buildManifest.file)]
      : []),
  ]);
  /** Configured generated subtree excluded from recursive scanning. */
  const perFileDir = config.perFile
    ? path.resolve(
        absoluteRoot,
        typeof config.perFile === 'object'
          ? (config.perFile.dir ?? 'zuix-files')
          : 'zuix-files'
      )
    : '';
  /** Stage a complete source/token cache before replacing the previous successful cache.
   * @returns {Map<string, string[]>} Bounded current sources; deleted sources are absent.
   */
  function scan(): Map<string, string[]> {
    /** Complete candidate source-to-token map; failed traversal never replaces the cache. */
    const files = new Map<string, string[]>();
    let totalBytes = 0,
      visited = 0;
    /** Candidate metadata/token records promoted only after the full scan succeeds. */
    const nextCache = new Map<
      string,
      { size: number; mtimeMs: number; classes: string[] }
    >();
    /** Traverse trusted project directories while pruning generated/private/symlink entries.
     * @param {string} dir - Current directory within the project traversal.
     * @returns {void} Adds candidate records or throws before cache promotion.
     */
    function visit(dir: string): void {
      for (const entry of fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => {
          if (a.name < b.name) {
            return -1;
          } else {
            if (a.name > b.name) {
              return 1;
            } else {
              return 0;
            }
          }
        })) {
        if (++visited > limits.maxFiles * 20) {
          throw new Error('zuix: directory traversal limit exceeded');
        }
        if (
          entry.isSymbolicLink() ||
          defaultExcluded.has(entry.name) ||
          entry.name.startsWith('.env')
        ) {
          continue;
        }
        /** Current absolute child path in the trusted project tree. */
        const abs = path.join(dir, entry.name);
        /** Forward-slash project-relative source path used for globs and cache keys. */
        const rel = path.relative(absoluteRoot, abs).split(path.sep).join('/');
        if (generated.has(abs) || excluded.some((p) => p.test(rel))) {
          continue;
        }
        if (entry.isDirectory()) {
          if (abs === perFileDir) {
            continue;
          }
          visit(abs);
        } else if (
          entry.isFile() &&
          supported.test(entry.name) &&
          patterns.some((p) => p.test(rel))
        ) {
          if (files.size >= limits.maxFiles) {
            throw new Error('zuix: maxFiles limit exceeded');
          }
          /** Source metadata checked against file and aggregate byte ceilings. */
          const stat = fs.statSync(abs);
          if (stat.size > limits.maxFileBytes) {
            throw new Error(`zuix: maxFileBytes exceeded: ${rel}`);
          }
          totalBytes += stat.size;
          if (totalBytes > limits.maxTotalBytes) {
            throw new Error('zuix: maxTotalBytes limit exceeded');
          }
          /** Previous cached extraction reused only when size and modification time match. */
          const old = cache.get(rel);
          /** Cached or newly extracted literal tokens for this source. */
          const classes =
            old && old.size === stat.size && old.mtimeMs === stat.mtimeMs
              ? old.classes
              : extractClasses(readProjectFile(abs, limits.maxFileBytes), {
                  limits: config.limits,
                });
          files.set(rel, classes);
          nextCache.set(rel, {
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            classes,
          });
        }
      }
    }
    visit(absoluteRoot);
    cache.clear();
    for (const [key, value] of nextCache) {
      cache.set(key, value);
    }
    return files;
  }
  return {
    scan,
    invalidate: (file: string) => cache.delete(file),
    clear: () => cache.clear(),
  };
}
/** Perform one bounded scan with an ephemeral per-call token cache.
 * @param {string} root - Trusted project root.
 * @param {ZuixConfig} config - Explicit source and resource policy.
 * @returns {Map<string, string[]>} Current sources and extracted literal tokens.
 */
export function scanProjectFiles(
  root: string,
  config: ZuixConfig = {}
): Map<string, string[]> {
  return createProjectScanner(root, config).scan();
}
/** Collect unique literal tokens across the current bounded source scan.
 * @param {string} root - Trusted project root.
 * @param {ZuixConfig} config - Explicit source and resource policy.
 * @returns {string[]} Unique tokens; no modules or templates are executed.
 */
export function scanProject(root: string, config: ZuixConfig = {}): string[] {
  return [...new Set([...scanProjectFiles(root, config).values()].flat())];
}
/** Check a strict path descendant without accepting the root itself.
 * @param {string} root - Resolved owner directory.
 * @param {string} location - Resolved candidate path.
 * @returns {boolean} Whether the candidate is a strict non-traversing descendant.
 */
function inside(root: string, location: string): boolean {
  /** Relative path checked against absolute and parent traversal escapes. */
  const relative = path.relative(root, location);
  return (
    relative !== '' &&
    !relative.startsWith('..' + path.sep) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}
/** Resolve a strict project-contained destination while rejecting existing symlink path segments.
 * @param {string} root - Trusted project root.
 * @param {string} target - Configured relative or in-project absolute destination.
 * @returns {string} Validated absolute path; concurrent malicious writers remain outside this boundary.
 */
export function outputPath(root: string, target: string): string {
  /** Resolved output candidate constrained to a strict project descendant. */
  const location = path.resolve(root, target);
  if (!inside(path.resolve(root), location)) {
    throw new Error('zuix: output must remain inside project root');
  }
  let current = path.resolve(root);
  for (const segment of path.relative(current, location).split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error('zuix: symlink output path denied');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
  return location;
}
/** Compile all shared/per-source outputs before staging replacements and generated stale removal.
 * @param {string} root - Trusted project root.
 * @param {ZuixConfig} config - Validated application build configuration.
 * @param {Map<string, string[]>} files - Complete bounded source/token candidate.
 * @returns {GenerateResult} Global result after output commit; failures preserve or explicitly report rollback state.
 */
export function buildFromFiles(
  root: string,
  config: ZuixConfig,
  files: Map<string, string[]>
): GenerateResult {
  /** Complete output candidate built before any replacement is staged. */
  const plan = new Map<string, string>();
  /** Private per-source ownership used only for optional map generation. */
  const owners = new Map<string, string>();
  /** Global compilation result returned after successful output commit. */
  const result = createZuix(config).generate(
    new Set([...files.values()].flat())
  );
  /** Previously generated artifacts eligible for controlled removal after validation. */
  const staleFiles: string[] = [];
  /** Per-file settings, retaining legacy Boolean configuration compatibility. */
  const settings = typeof config.perFile === 'object' ? config.perFile : {};
  if (!config.perFile || settings.shared !== false) {
    plan.set(outputPath(root, config.output ?? 'zuix.css'), result.css + '\n');
  }
  if (config.perFile) {
    /** Validated per-file directory or shared output directory. */
    const directory = outputPath(root, settings.dir ?? 'zuix-files');
    /** Private source-to-generated-file lookup with explicit generated filenames. */
    const manifest: Record<string, string> = Object.create(null);
    for (const [source, classes] of files) {
      /** Validated per-source CSS path; public manifests use opaque hashed names. */
      const dest = outputPath(
        root,
        path.join(
          directory,
          config.buildManifest
            ? createHash('sha256').update(source).digest('hex').slice(0, 24) +
                '.css'
            : source + '.css'
        )
      );
      if (!inside(directory, dest)) {
        throw new Error('zuix: invalid source filename');
      }
      /** Per-source compilation omitting preflight and unrelated safelist tokens. */
      const css = createZuix({
        ...config,
        preflight: false,
        safelist: [],
      }).generate(classes).css;
      if (plan.has(dest)) {
        throw new Error('zuix: duplicate output');
      }
      plan.set(dest, css + '\n');
      owners.set(dest, source);
      manifest[source] = path.relative(root, dest).split(path.sep).join('/');
    }
    /** Previous public-directory lookup used only for compatibility/migration. */
    const legacyManifest = outputPath(
      root,
      path.join(directory, 'manifest.json')
    );
    /** Selected source lookup path; explicit public manifests keep it under private .zuix. */
    const manifestFile = config.buildManifest
      ? outputPath(
          root,
          path.join(
            '.zuix',
            createHash('sha256')
              .update(path.relative(root, directory))
              .digest('hex')
              .slice(0, 24),
            'manifest.json'
          )
        )
      : legacyManifest;
    /** Existing lookup selected without assuming an unavailable new private manifest. */
    const previousFile = fs.existsSync(manifestFile)
      ? manifestFile
      : legacyManifest;
    if (fs.existsSync(previousFile)) {
      /** Bounded parsed prior lookup; only recognizable generated targets become stale candidates. */
      const previous = JSON.parse(
        readProjectFile(
          previousFile,
          resolveLimits(config.limits).maxOutputBytes
        )
      ) as Record<string, string>;
      for (const [source, filename] of Object.entries(previous)) {
        if (
          (Object.hasOwn(manifest, source) && manifest[source] === filename) ||
          typeof filename !== 'string' ||
          !(
            filename.endsWith(source + '.css') ||
            path.basename(filename) ===
              createHash('sha256').update(source).digest('hex').slice(0, 24) +
                '.css'
          )
        ) {
          continue;
        }
        /** Validated generated stale path, never an arbitrary source-controlled deletion. */
        const stale = outputPath(root, filename);
        if (
          inside(directory, stale) &&
          fs.existsSync(stale) &&
          fs.lstatSync(stale).isFile()
        ) {
          staleFiles.push(stale);
        }
      }
    }
    if (
      config.buildManifest &&
      legacyManifest !== manifestFile &&
      fs.existsSync(legacyManifest)
    ) {
      staleFiles.push(legacyManifest);
    }
    if (plan.has(manifestFile)) {
      throw new Error('zuix: duplicate output');
    }
    plan.set(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  }
  attachManifest(
    root,
    config,
    plan,
    files,
    (name) => outputPath(root, name),
    owners
  );
  collectOldMaps(root, plan, staleFiles);
  commitOutputs(
    plan,
    resolveLimits(config.limits).maxOutputBytes,
    staleFiles.filter((file) => !plan.has(file))
  );
  return result;
}
/** Collect only maps explicitly referenced by a generated CSS footer.
 * @param {string} root - Trusted project root.
 * @param {Map<string, string>} plan - New output candidates.
 * @param {string[]} stale - Generated deletion candidates extended in place.
 * @returns {void} Never deletes an arbitrary unreferenced map.
 */
function collectOldMaps(
  root: string,
  plan: Map<string, string>,
  stale: string[]
): void {
  for (const file of [...plan.keys(), ...stale]) {
    if (!file.endsWith('.css') || !fs.existsSync(file)) {
      continue;
    }
    /** Exact generated map footer proving a prior CSS file referenced its map. */
    const marker = `/*# sourceMappingURL=${encodeURIComponent(path.basename(file + '.map'))} */`;
    if (
      !readProjectFile(file, 64 * 1024 * 1024)
        .trimEnd()
        .endsWith(marker)
    ) {
      continue;
    }
    /** Validated companion map path eligible only when no new candidate replaces it. */
    const map = outputPath(root, file + '.map');
    if (!plan.has(map) && fs.existsSync(map)) {
      stale.push(map);
    }
  }
}
/** Scan and compile one trusted project with contained outputs.
 * @param {string} root - Project directory, default process.cwd().
 * @param {ZuixConfig} config - Explicit application build configuration.
 * @returns {GenerateResult} Compilation result after successful staging/commit.
 */
export function buildZuix(
  root = process.cwd(),
  config: ZuixConfig = {}
): GenerateResult {
  /** Resolved trusted project directory for this standalone build. */
  const absolute = path.resolve(root);
  return buildFromFiles(absolute, config, scanProjectFiles(absolute, config));
}
/** Compile a trusted CSS entry with automatic bounded template scanning.
 * @param {string} root - Project directory; input/output must stay inside it.
 * @param {string} input - Authored CSS entry relative to root.
 * @param {ZuixConfig} config - Explicit theme/recipes/resource policy.
 * @returns {GenerateResult} Committed CSS result; no environment credentials are read.
 */
export function buildZuixStylesheet(
  root = process.cwd(),
  input = 'src/styles.css',
  config: ZuixConfig = {}
): GenerateResult {
  return buildStylesheetFromFiles(
    path.resolve(root),
    input,
    config,
    scanProjectFiles(path.resolve(root), config)
  );
}
/** Compile an authored CSS entry from a complete source-token candidate and commit its output plan.
 * @param {string} absolute - Resolved trusted project root.
 * @param {string} input - Authored CSS path.
 * @param {ZuixConfig} config - Explicit application build policy.
 * @param {Map<string, string[]>} files - Complete bounded source/token candidate.
 * @returns {GenerateResult} Result after output/map/manifest commit.
 */
export function buildStylesheetFromFiles(
  absolute: string,
  input: string,
  config: ZuixConfig,
  files: Map<string, string[]>
): GenerateResult {
  /** Validated authored CSS input, kept distinct from the generated destination. */
  const entry = outputPath(absolute, input);
  /** Validated shared CSS destination inside the project. */
  const destination = outputPath(absolute, config.output ?? 'zuix.css');
  if (entry === destination) {
    throw new Error('zuix: CSS input and output must differ');
  }
  /** Global compilation result returned after successful output commit. */
  const result = compileStylesheet(
    readProjectFile(entry, resolveLimits(config.limits).maxFileBytes),
    [...new Set([...files.values()].flat())],
    config
  );
  /** Complete output candidate built before any replacement is staged. */
  const plan = new Map([[destination, result.css + '\n']]);
  attachManifest(absolute, config, plan, files, (name) =>
    outputPath(absolute, name)
  );
  /** Validated generated stale path, never an arbitrary source-controlled deletion. */
  const stale: string[] = [];
  collectOldMaps(absolute, plan, stale);
  commitOutputs(plan, resolveLimits(config.limits).maxOutputBytes, stale);
  return result;
}
