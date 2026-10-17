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
export function getDefaultBuildConcurrency({ parallelism = availableParallelism(), memoryBytes = totalmem(), memoryLimitBytes = process.constrainedMemory?.() ?? 0 } = {}) {
  const memory = memoryLimitBytes > 0 ? Math.min(memoryBytes, memoryLimitBytes) : memoryBytes;
  const memorySlots = Math.max(1, Math.floor(memory * 0.75 / (512 * 1024 * 1024)));
  return Math.max(1, Math.min(32, parallelism, memorySlots));
}

/** Shared automatic limit for local, test and CI builds. */
export const DEFAULT_BUILD_CONCURRENCY = getDefaultBuildConcurrency();

/**
 * Title: Discover npm workspaces.
 * Description: Reads release packages by default, or every workspace for lock validation.
 * Global Variables: none; reads package manifests below the supplied filesystem root.
 * @param {string} root Repository directory.
 * @param {{release?: boolean}} options Select release patterns or installation patterns.
 * @returns {Map<string, {name: string, dir: string, pkg: object}>} Workspace manifests by name.
 */
export function discoverWorkspaces(root, { release = true } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const patterns = (release ? manifest.releaseWorkspaces : manifest.workspaces) ?? manifest.workspaces ?? [];
  if (!Array.isArray(patterns)) throw new Error('Expected a workspace array');
  const entries = new Map();
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || !pattern.endsWith('/*') || pattern.includes('..')) {
      throw new Error(`Unsupported workspace pattern: ${pattern}`);
    }
    const directory = path.join(root, pattern.slice(0, -2));
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory).sort()) {
      const dir = path.join(directory, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      const file = path.join(dir, 'package.json');
      if (!fs.existsSync(file)) continue;
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!pkg.name || typeof pkg.name !== 'string') throw new Error(`Unnamed package: ${file}`);
      if (entries.has(pkg.name)) throw new Error(`Duplicate workspace name: ${pkg.name}`);
      entries.set(pkg.name, { name: pkg.name, dir, pkg });
    }
  }
  return entries;
}

export function planWorkspaces(entries, { scopes = [], includeDependents = false, requireBuild = true } = {}) {
  const names = [...entries.keys()].sort();
  const dependencies = new Map();
  const dependents = new Map(names.map(name => [name, new Set()]));
  for (const name of names) {
    const manifest = entries.get(name).pkg;
    const refs = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies };
    // Peer dependencies are consumer contracts, not mandatory build dependencies.
    const peers = Object.entries(manifest.peerDependencies ?? {}).filter(([dep]) =>
      entries.has(dep) && manifest.peerDependenciesMeta?.[dep]?.optional !== true &&
      refs[dep] !== undefined).map(([dep]) => dep);
    const deps = [...new Set([...Object.keys(refs), ...peers])].filter(dep => entries.has(dep)).sort();
    dependencies.set(name, deps);
    for (const dep of deps) dependents.get(dep).add(name);
  }
  const visiting = new Set(), visited = new Set(), order = [];
  const visit = (name, stack = []) => {
    if (visiting.has(name)) throw new Error(`Workspace dependency cycle: ${[...stack, name].join(' -> ')}`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dep of dependencies.get(name)) visit(dep, [...stack, name]);
    visiting.delete(name); visited.add(name); order.push(name);
  };
  names.forEach(name => visit(name));
  for (const scope of scopes) if (!entries.has(scope)) throw new Error(`Unknown workspace: ${scope}`);
  const selected = new Set();
  const addWithDeps = name => {
    if (selected.has(name)) return;
    selected.add(name);
    for (const dep of dependencies.get(name)) addWithDeps(dep);
  };
  if (!scopes.length) names.forEach(addWithDeps);
  else scopes.forEach(addWithDeps);
  if (includeDependents && scopes.length) {
    const queue = [...scopes];
    while (queue.length) {
      for (const dependent of dependents.get(queue.shift())) {
        if (!selected.has(dependent)) { addWithDeps(dependent); queue.push(dependent); }
      }
    }
  }
  const ordered = order.filter(name => selected.has(name) && (!requireBuild || entries.get(name).pkg.scripts?.build));
  // Packages without build scripts should not hold up their dependents.
  return { ordered, dependencies: new Map(ordered.map(name => [name, dependencies.get(name).filter(dep => ordered.includes(dep))])) };
}

export async function executeWorkspacePlan(plan, { concurrency = DEFAULT_BUILD_CONCURRENCY, run, onEvent = () => {} } = {}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new RangeError('Concurrency must be between 1 and 32');
  if (typeof run !== 'function') throw new TypeError('A build executor is required');
  const pending = new Set(plan.ordered), finished = new Set(), running = new Map(), results = [];
  const controller = new AbortController();
  let failure;
  while (pending.size || running.size) {
    if (!failure) {
      for (const name of plan.ordered) {
        if (running.size >= concurrency) break;
        if (!pending.has(name) || !plan.dependencies.get(name).every(dep => finished.has(dep))) continue;
        pending.delete(name);
        onEvent({ type: 'start', name });
        const promise = Promise.resolve().then(() => run(name, controller.signal))
          .then(() => ({ name, ok: true }), error => ({ name, ok: false, error }));
        running.set(name, promise);
      }
    }
    if (!running.size) {
      if (failure) break;
      throw new Error(`Workspace build could not progress: ${[...pending].join(', ')}`);
    }
    const result = await Promise.race(running.values());
    running.delete(result.name);
    results.push(result);
    if (result.ok) { finished.add(result.name); onEvent({ type: 'done', name: result.name }); }
    else if (!failure) {
      failure = new Error(`Workspace ${result.name} failed: ${result.error?.message ?? String(result.error)}`, { cause: result.error });
      controller.abort(failure);
      onEvent({ type: 'failed', name: result.name });
    }
  }
  if (failure) throw failure;
  return results;
}
