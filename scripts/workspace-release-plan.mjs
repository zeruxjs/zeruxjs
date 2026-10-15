/** Deterministic, no-publish publication plan for package workspaces. */
import { discoverWorkspaces } from './workspace-graph.mjs';

export function planPublicReleases(entries) {
  const issues = [], warnings = [], states = new Map(), order = [];
  const published = [...entries.values()].filter(entry => entry.pkg.private !== true)
    .map(entry => entry.name).sort();
  const publicSet = new Set(published);
  const dependencies = new Map();
  for (const name of published) {
    const pkg = entries.get(name).pkg;
    const deps = [];
    for (const field of ['dependencies','optionalDependencies','peerDependencies']) {
      for (const [dep, version] of Object.entries(pkg[field] ?? {})) {
        if (!entries.has(dep)) continue; // External dependencies are checked in lock audit.
        const local = entries.get(dep).pkg;
        const optionalPeer = field === 'peerDependencies' && pkg.peerDependenciesMeta?.[dep]?.optional === true;
        if (local.private === true) {
          (optionalPeer ? warnings : issues).push({ package: name, dependency: dep,
            code: optionalPeer ? 'PRIVATE_OPTIONAL_PEER' : 'PRIVATE_REQUIRED_DEPENDENCY', field });
        } else if (field !== 'peerDependencies' || !optionalPeer) deps.push(dep);
        if (version !== local.version) issues.push({ package: name, dependency: dep, code: 'VERSION_MISMATCH', requested: version, local: local.version });
      }
    }
    dependencies.set(name, [...new Set(deps)].sort());
  }
  const visit = (name, stack = []) => {
    if (states.get(name) === 2) return;
    if (states.get(name) === 1) { issues.push({ code:'DEPENDENCY_CYCLE', chain: [...stack,name] }); return; }
    states.set(name, 1);
    for (const dep of dependencies.get(name) ?? []) if (publicSet.has(dep)) visit(dep,[...stack,name]);
    states.set(name,2); order.push(name);
  };
  published.forEach(name => visit(name));
  return {
    schemaVersion: 1, ok: issues.length === 0, publicPackages: published.length,
    privatePackages: entries.size - published.length, issues, warnings,
    // These are the dependency-first npm publication phases, not release approval.
    order: order.map((name,i) => ({ sequence:i+1, name,
      version:entries.get(name).pkg.version, dependencies:dependencies.get(name) }))
  };
}

export function planPublicReleasesFromRoot(root) { return planPublicReleases(discoverWorkspaces(root)); }
