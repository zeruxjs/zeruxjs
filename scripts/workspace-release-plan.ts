/** Deterministic, no-publish publication plan for package workspaces. */
import { discoverWorkspaces } from './workspace-graph.ts';

/** Perform the plan public releases operation.
 * @param {unknown} entries - Input value for entries.
 * @returns {unknown} Result produced by plan public releases.
 */
export function planPublicReleases(entries) {
  /** Local value for issues. */
  const issues = [],
    warnings = [],
    states = new Map(),
    order = [];
  /** Local value for published. */
  const published = [...entries.values()]
    .filter((entry) => entry.pkg.private !== true)
    .map((entry) => entry.name)
    .sort();
  /** Local value for public set. */
  const publicSet = new Set(published);
  /** Local value for dependencies. */
  const dependencies = new Map();
  for (const name of published) {
    /** Local value for pkg. */
    const pkg = entries.get(name).pkg;
    /** Local value for deps. */
    const deps = [];
    for (const field of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      for (const [dep, version] of Object.entries(pkg[field] ?? {})) {
        if (!entries.has(dep)) {
          continue;
        } // External dependencies are checked in lock audit.
        /** Local value for local. */
        const local = entries.get(dep).pkg;
        /** Local value for optional peer. */
        const optionalPeer =
          field === 'peerDependencies' &&
          pkg.peerDependenciesMeta?.[dep]?.optional === true;
        if (local.private === true) {
          (optionalPeer ? warnings : issues).push({
            package: name,
            dependency: dep,
            code: optionalPeer
              ? 'PRIVATE_OPTIONAL_PEER'
              : 'PRIVATE_REQUIRED_DEPENDENCY',
            field,
          });
        } else if (field !== 'peerDependencies' || !optionalPeer) {
          deps.push(dep);
        }
        if (version !== local.version) {
          issues.push({
            package: name,
            dependency: dep,
            code: 'VERSION_MISMATCH',
            requested: version,
            local: local.version,
          });
        }
      }
    }
    dependencies.set(name, [...new Set(deps)].sort());
  }
  /**
   * Run the visit callback.
   * @param {unknown} name - Input value for name.
   * @param {unknown} stack - Input value for stack.
   * @returns {unknown} Result produced by visit.
   */
  const visit = (name, stack = []) => {
    if (states.get(name) === 2) {
      return;
    }
    if (states.get(name) === 1) {
      issues.push({ code: 'DEPENDENCY_CYCLE', chain: [...stack, name] });
      return;
    }
    states.set(name, 1);
    for (const dep of dependencies.get(name) ?? []) {
      if (publicSet.has(dep)) {
        visit(dep, [...stack, name]);
      }
    }
    states.set(name, 2);
    order.push(name);
  };
  published.forEach((name) => visit(name));
  return {
    schemaVersion: 1,
    ok: issues.length === 0,
    publicPackages: published.length,
    privatePackages: entries.size - published.length,
    issues,
    warnings,
    // These are the dependency-first npm publication phases, not release approval.
    order: order.map((name, i) => ({
      sequence: i + 1,
      name,
      version: entries.get(name).pkg.version,
      dependencies: dependencies.get(name),
    })),
  };
}

/** Perform the plan public releases from root operation.
 * @param {unknown} root - Input value for root.
 * @returns {unknown} Result produced by plan public releases from root.
 */
export function planPublicReleasesFromRoot(root) {
  return planPublicReleases(discoverWorkspaces(root));
}
