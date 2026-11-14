import fs from 'node:fs';
import path from 'node:path';
import { availableParallelism, totalmem } from 'node:os';

/**
 * Title: Choose automatic build concurrency.
 * Description: Uses available CPU parallelism and the effective memory limit, reserving one quarter of RAM and budgeting 512 MiB per compiler; supports up to 32 builds.
 * Global Variables: Reads OS CPU/RAM information and process.constrainedMemory() only.
 * @param options Optional machine capacity values for deterministic verification.
 * @returns Maximum independent compiler processes for this runner.
 */
/** Perform the get default build concurrency operation.
 * @param {unknown} root0 - Input value for root0.
 * @param {unknown} root0.parallelism - Input value for parallelism.
 * @param {unknown} root0.memoryBytes - Input value for memory bytes.
 * @param {unknown} root0.memoryLimitBytes - Input value for memory limit bytes.
 * @returns {unknown} Result produced by get default build concurrency.
 */
export function getDefaultBuildConcurrency({
  parallelism = availableParallelism(),
  memoryBytes = totalmem(),
  memoryLimitBytes = process.constrainedMemory?.() ?? 0,
}: {
  parallelism?: number;
  memoryBytes?: number;
  memoryLimitBytes?: number;
} = {}): number {
  /** Local value for memory. */
  const memory =
    memoryLimitBytes > 0
      ? Math.min(memoryBytes, memoryLimitBytes)
      : memoryBytes;
  /** Local value for memory slots. */
  const memorySlots = Math.max(
    1,
    Math.floor((memory * 0.75) / (512 * 1024 * 1024))
  );
  return Math.max(1, Math.min(32, parallelism, memorySlots));
}

/** Shared automatic limit for local, test and CI builds. */
/** Local value for default build concurrency. */
export const DEFAULT_BUILD_CONCURRENCY = getDefaultBuildConcurrency();

/**
 * Title: Discover npm workspaces.
 * Description: Reads release packages by default, or every workspace for lock validation.
 * Global Variables: none; reads package manifests below the supplied filesystem root.
 * @param {string} root Repository directory.
 * @param {{release?: boolean}} options Select release patterns or installation patterns.
 * @returns {Map<string, {name: string, dir: string, pkg: object}>} Workspace manifests by name.
 */
/** Perform the discover workspaces operation.
 * @param {unknown} root - Input value for root.
 * @param {unknown} root1 - Input value for root1.
 * @param {unknown} root1.release - Input value for release.
 * @returns {unknown} Result produced by discover workspaces.
 */
export function discoverWorkspaces(
  root: string,
  { release = true }: { release?: boolean } = {}
) {
  /** Local value for manifest. */
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  );
  /** Local value for patterns. */
  const patterns =
    (release ? manifest.releaseWorkspaces : manifest.workspaces) ??
    manifest.workspaces ??
    [];
  if (!Array.isArray(patterns)) {
    throw new Error('Expected a workspace array');
  }
  /** Local value for entries. */
  const entries = new Map();
  for (const pattern of patterns) {
    if (
      typeof pattern !== 'string' ||
      !pattern.endsWith('/*') ||
      pattern.includes('..')
    ) {
      throw new Error(`Unsupported workspace pattern: ${pattern}`);
    }
    /** Local value for directory. */
    const directory = path.join(root, pattern.slice(0, -2));
    if (!fs.existsSync(directory)) {
      continue;
    }
    for (const name of fs.readdirSync(directory).sort()) {
      /** Local value for dir. */
      const dir = path.join(directory, name);
      if (!fs.statSync(dir).isDirectory()) {
        continue;
      }
      /** Local value for file. */
      const file = path.join(dir, 'package.json');
      if (!fs.existsSync(file)) {
        continue;
      }
      /** Local value for pkg. */
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!pkg.name || typeof pkg.name !== 'string') {
        throw new Error(`Unnamed package: ${file}`);
      }
      if (entries.has(pkg.name)) {
        throw new Error(`Duplicate workspace name: ${pkg.name}`);
      }
      entries.set(pkg.name, { name: pkg.name, dir, pkg });
    }
  }
  return entries;
}

/**
 * Build a deterministic dependency plan for selected workspaces.
 *
 * @param {Map<string, {name: string, dir: string, pkg: object}>} entries - Workspace manifests indexed by package name.
 * @param {{scopes?: string[], includeDependents?: boolean, requireBuild?: boolean}} options - Selection and build-script requirements.
 * @returns {{ordered: string[], dependencies: Map<string, string[]>, bootstrapScripts: Map<string, string>, finalize: string[]}} Dependency-ordered build metadata.
 */
/** Perform the plan workspaces operation.
 * @param {unknown} entries - Input value for entries.
 * @param {unknown} root1 - Input value for root1.
 * @param {unknown} root1.scopes - Input value for scopes.
 * @param {unknown} root1.includeDependents - Input value for include dependents.
 * @param {unknown} root1.requireBuild - Input value for require build.
 * @returns {unknown} Result produced by plan workspaces.
 */
export function planWorkspaces(
  entries: ReturnType<typeof discoverWorkspaces>,
  {
    scopes = [],
    includeDependents = false,
    requireBuild = true,
  }: {
    scopes?: string[];
    includeDependents?: boolean;
    requireBuild?: boolean;
  } = {}
) {
  /** Local value for names. */
  const names = [...entries.keys()].sort();
  /** Local value for bootstraps. */
  const bootstraps = new Map();
  for (const name of names) {
    /** Local value for metadata. */
    const metadata = entries.get(name).pkg.workspaceBuild;
    if (metadata === undefined) {
      continue;
    }
    if (
      !metadata ||
      typeof metadata !== 'object' ||
      Array.isArray(metadata) ||
      Object.keys(metadata).some(
        (key) => !['bootstrapScript', 'finalizeDependencies'].includes(key)
      ) ||
      typeof metadata.bootstrapScript !== 'string' ||
      !/^build:[a-z0-9-]+$/.test(metadata.bootstrapScript) ||
      typeof entries.get(name).pkg.scripts?.[metadata.bootstrapScript] !==
        'string' ||
      typeof entries.get(name).pkg.scripts?.build !== 'string' ||
      !Array.isArray(metadata.finalizeDependencies) ||
      !metadata.finalizeDependencies.length ||
      metadata.finalizeDependencies.length > 32 ||
      new Set(metadata.finalizeDependencies).size !==
        metadata.finalizeDependencies.length ||
      metadata.finalizeDependencies.some(
        (dep) =>
          typeof dep !== 'string' ||
          dep === name ||
          !entries.has(dep) ||
          !entries.get(dep).pkg.scripts?.build
      )
    ) {
      throw new Error(`Invalid workspace build bootstrap: ${name}`);
    }
    bootstraps.set(name, {
      script: metadata.bootstrapScript,
      dependencies: [...metadata.finalizeDependencies],
    });
  }
  for (const [name, metadata] of bootstraps) {
    if (metadata.dependencies.some((dep) => bootstraps.has(dep))) {
      throw new Error(
        `Nested workspace build finalization is unsupported: ${name}`
      );
    }
  }
  /** Workspace-to-workspace edges used for ordering and dependent expansion. */
  const dependencies = new Map();
  /** Reverse dependency edges used when callers request dependent workspaces. */
  const dependents = new Map(names.map((name) => [name, new Set()]));
  for (const name of names) {
    /** Local value for manifest. */
    const manifest = entries.get(name).pkg;
    /** Local value for refs. */
    const refs = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
    };
    // Peer dependencies are consumer contracts, not mandatory build dependencies.
    /** Local value for peers. */
    const peers = Object.entries(manifest.peerDependencies ?? {})
      .filter(
        ([dep]) =>
          entries.has(dep) &&
          manifest.peerDependenciesMeta?.[dep]?.optional !== true &&
          refs[dep] !== undefined
      )
      .map(([dep]) => dep);
    /** Local value for deps. */
    const deps = [...new Set([...Object.keys(refs), ...peers])]
      .filter((dep) => entries.has(dep))
      .sort();
    dependencies.set(name, deps);
    for (const dep of deps) {
      dependents.get(dep).add(name);
    }
  }
  /** DFS state used to detect cycles while producing a stable topological order. */
  const visiting = new Set(),
    /** Nodes already emitted into the topological order. */
    visited = new Set(),
    /** Dependency-first workspace order returned to the scheduler. */
    order = [];
  /**
   * Run the visit callback.
   * @param {unknown} name - Input value for name.
   * @param {unknown} stack - Input value for stack.
   * @returns {unknown} Result produced by visit.
   * @throws {Error} If the callback rejects or validation fails.
   */
  const visit = (name: string, stack: string[] = []): void => {
    if (visiting.has(name)) {
      throw new Error(
        `Workspace dependency cycle: ${[...stack, name].join(' -> ')}`
      );
    }
    if (visited.has(name)) {
      return;
    }
    visiting.add(name);
    for (const dep of dependencies.get(name)) {
      visit(dep, [...stack, name]);
    }
    visiting.delete(name);
    visited.add(name);
    order.push(name);
  };
  names.forEach((name) => visit(name));
  for (const scope of scopes) {
    if (!entries.has(scope)) {
      throw new Error(`Unknown workspace: ${scope}`);
    }
  }
  /** Workspaces admitted by the requested scopes and their required dependencies. */
  const selected = new Set();
  /**
   * Run the add with deps callback.
   * @param {unknown} name - Input value for name.
   * @returns {unknown} Result produced by add with deps.
   */
  const addWithDeps = (name: string): void => {
    if (selected.has(name)) {
      return;
    }
    selected.add(name);
    for (const dep of dependencies.get(name)) {
      addWithDeps(dep);
    }
  };
  if (!scopes.length) {
    names.forEach(addWithDeps);
  } else {
    scopes.forEach(addWithDeps);
  }
  if (includeDependents && scopes.length) {
    /** Breadth-first frontier used to add dependents without changing scope order. */
    const queue = [...scopes];
    while (queue.length) {
      for (const dependent of dependents.get(queue.shift())) {
        if (!selected.has(dependent)) {
          addWithDeps(dependent);
          queue.push(dependent);
        }
      }
    }
  }
  // Only explicitly declared source-build finalizers add peer packages to a scoped plan.
  // Core declarations break the source-only dependency cycle; the normal strict build
  // must run again after these peers finish, before the plan may report success.
  let grew;
  do {
    /** Local value for before. */
    const before = selected.size;
    for (const [name, metadata] of bootstraps) {
      if (selected.has(name)) {
        metadata.dependencies.forEach(addWithDeps);
      }
    }
    grew = selected.size !== before;
  } while (grew);
  /** Local value for ordered. */
  const ordered = order.filter(
    (name) =>
      selected.has(name) &&
      (!requireBuild || entries.get(name).pkg.scripts?.build)
  );
  // Packages without build scripts should not hold up their dependents.
  return {
    ordered,
    dependencies: new Map(
      ordered.map((name) => [
        name,
        dependencies.get(name).filter((dep) => ordered.includes(dep)),
      ])
    ),
    bootstrapScripts: new Map(
      ordered
        .filter((name) => bootstraps.has(name))
        .map((name) => [name, bootstraps.get(name).script])
    ),
    finalize: ordered.filter((name) => bootstraps.has(name)),
  };
}

/**
 * Run ready workspace jobs in dependency order with bounded concurrency.
 *
 * @param {{ordered: string[], dependencies: Map<string, string[]>}} plan - Dependency plan produced by planWorkspaces.
 * @param {{concurrency?: number, run: (name: string, signal: AbortSignal) => Promise<void>, onEvent?: (event: {type: string, name: string}) => void}} options - Scheduler limits and lifecycle callbacks.
 * @returns {Promise<Array<{name: string, ok: true}>>} Completed workspace results in settlement order.
 * @throws {RangeError} If concurrency is outside the supported range.
 * @throws {TypeError} If no build executor is provided.
 * @throws {Error} If a workspace fails or the plan cannot make progress.
 */
/** Perform the execute workspace plan operation.
 * @param {unknown} plan - Input value for plan.
 * @param {string[]} plan.ordered - Dependency-respecting workspace names.
 * @param {Map<string, string[]>} plan.dependencies - Required dependencies for each planned workspace.
 * @param {unknown} root1 - Input value for root1.
 * @param {unknown} root1.concurrency - Input value for concurrency.
 * @param {unknown} root1.run - Input value for run.
 * @param {unknown} root1.onEvent - Input value for on event.
 * @returns {unknown} Result produced by execute workspace plan.
 */
export async function executeWorkspacePlan(
  plan: { ordered: string[]; dependencies: Map<string, string[]> },
  {
    concurrency = DEFAULT_BUILD_CONCURRENCY,
    run,
    onEvent = () => {},
  }: {
    concurrency?: number;
    run?: (name: string, signal: AbortSignal) => Promise<void>;
    onEvent?: (event: {
      type: 'start' | 'done' | 'failed';
      name: string;
    }) => void;
  } = {}
): Promise<Array<{ name: string; ok: true }>> {
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 32
  ) {
    throw new RangeError('Concurrency must be between 1 and 32');
  }
  if (typeof run !== 'function') {
    throw new TypeError('A build executor is required');
  }
  /** Once validated, the executor is stable while jobs settle asynchronously. */
  const executeBuild = run;
  /** Workspaces not yet admitted to the scheduler. */
  const pending = new Set(plan.ordered),
    /** Workspaces whose build promises have settled successfully. */
    finished = new Set<string>(),
    /** In-flight build promises keyed by workspace name. */
    running = new Map<
      string,
      Promise<
        { name: string; ok: true } | { name: string; ok: false; error: unknown }
      >
    >(),
    /** Only successful settlements are returned; failures are thrown after the owned jobs drain. */
    results: Array<{ name: string; ok: true }> = [];
  /** Shared cancellation signal used to stop remaining work after the first failure. */
  const controller = new AbortController();
  let failure: Error | undefined;
  while (pending.size || running.size) {
    if (!failure) {
      for (const name of plan.ordered) {
        if (running.size >= concurrency) {
          break;
        }
        // A malformed or partial plan must not silently launch work out of dependency order.
        /** Required graph entry checked before a workspace may start. */
        const dependencies = plan.dependencies.get(name);
        if (!dependencies) {
          throw new Error(`Missing workspace dependencies for ${name}`);
        }
        if (
          !pending.has(name) ||
          !dependencies.every((dep) => finished.has(dep))
        ) {
          continue;
        }
        pending.delete(name);
        onEvent({ type: 'start', name });
        /** Local value for promise. */
        const promise = Promise.resolve()
          .then(() => executeBuild(name, controller.signal))
          .then(
            () => ({ name, ok: true as const }),
            (error: unknown) => ({ name, ok: false as const, error })
          );
        running.set(name, promise);
      }
    }
    if (!running.size) {
      if (failure) {
        break;
      }
      throw new Error(
        `Workspace build could not progress: ${[...pending].join(', ')}`
      );
    }
    /** Local value for result. */
    const result = await Promise.race(running.values());
    running.delete(result.name);
    if (result.ok) {
      results.push(result);
      finished.add(result.name);
      onEvent({ type: 'done', name: result.name });
    } else if (!failure) {
      failure = new Error(
        `Workspace ${result.name} failed: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
        { cause: result.error }
      );
      controller.abort(failure);
      onEvent({ type: 'failed', name: result.name });
    }
  }
  if (failure) {
    throw failure;
  }
  return results;
}
