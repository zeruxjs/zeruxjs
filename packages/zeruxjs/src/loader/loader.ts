import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

import { resolvePath } from '@zeruxjs/hooks';
import {
  resolveRegisteredSpecifier,
  getLoaderService,
  setLoaderService,
} from './registry.js';

type ResolveContext = {
  /** Native importing module URL, absent for root resolution. */
  parentURL?: string;
  /** Native resolution conditions forwarded without mutation. */
  conditions?: string[];
};

type ResolveResult = {
  /** Native resolved module URL. */
  url: string;
  /** Native resolution-chain completion flag. */
  shortCircuit?: boolean;
};

type NextResolve = (
  specifier: string,
  context: ResolveContext
) => Promise<ResolveResult>;

/** Canonical explicit development root owned by this native loader instance. */
let sourceRoot: string | undefined;
/** Install explicit loader-thread registration data and canonicalize the optional source root.
 * @param {object} data - Optional host registration settings.
 * @param {string} data.serviceName - Optional process compatibility label.
 * @param {string} data.sourceRoot - Optional local authored-source directory.
 * @returns {Promise<void>} Loader state initialization; inaccessible roots reject.
 */
export async function initialize(
  data: {
    /** Explicit process loader compatibility label. */
    serviceName?: string;
    /** Explicit local authored-source root, canonicalized during initialization. */
    sourceRoot?: string;
  } = {}
): Promise<void> {
  if (data.serviceName !== undefined) {
    setLoaderService(data.serviceName);
  }
  sourceRoot =
    data.sourceRoot === undefined
      ? undefined
      : await fs.realpath(path.resolve(data.sourceRoot));
}
/** Check lexical containment and exclude dependencies, VCS and generated runtime state.
 * @param {string} file - Absolute local candidate.
 * @returns {boolean} Whether the candidate is inside the explicit source root.
 */
const insideSource = (file: string): boolean => {
  if (!sourceRoot) {
    return false;
  }
  /** Relative candidate path checked before authored-source fallback. */
  const relative = path.relative(sourceRoot, file);
  return (
    relative !== '..' &&
    !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative) &&
    !relative
      .split(path.sep)
      .some((part) => ['node_modules', '.git', '.zerux'].includes(part))
  );
};
/** Keep native resolution authoritative, falling back only for missing explicit local JavaScript references inside the source root.
 * @param {string} specifier - Native import specifier, not an arbitrary executable string.
 * @param {ResolveContext} context - Borrowed native resolution context.
 * @param {NextResolve} nextResolve - Native continuation invoked for original or validated canonical file URLs.
 * @returns {Promise<ResolveResult>} Native resolution result; original missing errors survive invalid fallback candidates.
 */
async function resolveSource(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve
): Promise<ResolveResult> {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    // Only missing, explicitly local file specifiers may use authored TS.
    // A successful JS resolution, dependency error or permission denial stays native.
    if (
      !sourceRoot ||
      (error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND' ||
      !context.parentURL?.startsWith('file:') ||
      !/^(?:\.\.?\/|file:)/.test(specifier)
    ) {
      throw error;
    }
    /** Borrowed importing file URL, including generation query state. */
    const parent = new URL(context.parentURL);
    /** Explicit relative/file specifier resolved against its importing file. */
    const requested = new URL(specifier, parent);
    if (
      requested.protocol !== 'file:' ||
      !insideSource(fileURLToPath(parent)) ||
      !insideSource(fileURLToPath(requested))
    ) {
      throw error;
    }
    /** Requested JavaScript extension eligible for an authored TypeScript counterpart. */
    const extension = path.extname(requested.pathname);
    /** Allowlisted TypeScript counterpart; unknown extensions never fall back. */
    const mapped = (
      { '.js': '.ts', '.mjs': '.mts', '.cjs': '.cts' } as Record<string, string>
    )[extension];
    if (!mapped) {
      throw error;
    }
    /** Authored counterpart URL retaining the original query and fragment. */
    const candidate = new URL(requested);
    candidate.pathname =
      candidate.pathname.slice(0, -extension.length) + mapped;
    let real: string;
    try {
      real = await fs.realpath(fileURLToPath(candidate));
    } catch {
      throw error;
    }
    if (!insideSource(real) || !(await fs.stat(real)).isFile()) {
      throw error;
    }
    /** Canonical real file URL after containment and file-type checks. */
    const target = pathToFileURL(real);
    target.search = candidate.search;
    target.hash = candidate.hash;
    if (!target.searchParams.has('t') && parent.searchParams.has('t')) {
      target.searchParams.set('t', parent.searchParams.get('t')!);
    }
    return nextResolve(target.href, context);
  }
}

/** Resolve explicit database/registered aliases before delegating to native resolution with bounded local-source fallback.
 * @param {string} specifier - Requested native import or explicitly registered alias.
 * @param {ResolveContext} context - Borrowed native resolution context.
 * @param {NextResolve} nextResolve - Native continuation; module execution remains Node-owned.
 * @returns {Promise<ResolveResult>} Resolved module URL or a compatibility-wrapped resolution error.
 */
export async function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve
): Promise<ResolveResult> {
  try {
    // Node URL/builtin protocols are not custom path aliases. In particular,
    // file:/// imports contain // which the private alias registry must reject.
    if (/^(?:file|node|data|https?):/.test(specifier)) {
      return resolveSource(specifier, context, nextResolve);
    }
    if (specifier === 'db' || specifier.startsWith('db:')) {
      /** Explicit database declaration name, with default as the legacy alias. */
      const identifier = specifier === 'db' ? 'default' : specifier.slice(3);
      /** Process loader service label selecting the virtual declaration directory. */
      const service = getLoaderService();
      /** Host-generated virtual database module path, not discovered executable packages. */
      const modulePath = path.join(
        process.cwd(),
        `.${service}`,
        'virtual',
        'db',
        `${identifier}.mjs`
      );
      return nextResolve(pathToFileURL(modulePath).href, context);
    }

    /** Explicit trusted registry resolution, if any prefix matched. */
    const registered = resolveRegisteredSpecifier(specifier);
    if (registered) {
      return nextResolve(registered, context);
    }

    /** Hooks-owned registered alias resolution, before native source resolution. */
    const resolved = resolvePath(specifier);

    if (resolved) {
      return nextResolve(resolved, context);
    }

    return resolveSource(specifier, context, nextResolve);
  } catch (err) {
    throw new Error(`[zerux loader] ${(err as Error).message}`);
  }
}
