import fs from 'node:fs';
import path from 'node:path';
import { discoverWorkspaces } from './workspace-graph.mjs';

/** Public entrypoints and consumer-facing constraints; source implementations may change without API drift. */
export function capturePublicApi(root) {
  const items = [...discoverWorkspaces(root).values()].map(({ name, pkg }) => ({
    name, version: pkg.version, private: pkg.private === true,
    main: pkg.main ?? null, module: pkg.module ?? null, types: pkg.types ?? null,
    exports: pkg.exports ?? null, bin: pkg.bin ?? null,
    engines: pkg.engines ?? null, peerDependencies: pkg.peerDependencies ?? null,
    peerDependenciesMeta: pkg.peerDependenciesMeta ?? null,
  })).sort((a, b) => a.name.localeCompare(b.name));
  return { schemaVersion: 1, packages: items };
}
const stable = value => JSON.stringify(value, null, 2) + '\n';
const diff = (before, after) => {
  const previous = new Map((before.packages ?? []).map(item => [item.name, item]));
  const current = new Map(after.packages.map(item => [item.name, item]));
  const changes = [];
  for (const key of new Set([...previous.keys(), ...current.keys()])) {
    if (!previous.has(key)) changes.push({ package: key, issue: 'new package requires API review' });
    else if (!current.has(key)) changes.push({ package: key, issue: 'removed package' });
    else if (stable(previous.get(key)) !== stable(current.get(key))) changes.push({ package: key, issue: 'public contract changed; review semver and consumers' });
  }
  return changes.sort((a, b) => a.package.localeCompare(b.package));
};
export function verifyPublicApiFreeze(root, file = path.join(root, 'api-freeze.json')) {
  const observed = capturePublicApi(root);
  let recorded;
  try { recorded = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return { ok: false, issues: [{ issue: 'missing or unreadable committed API freeze' }], count: observed.packages.length }; }
  if (recorded.schemaVersion !== 1 || !Array.isArray(recorded.packages)) return { ok: false, issues: [{ issue: 'unsupported API freeze schema' }], count: observed.packages.length };
  const issues = diff(recorded, observed);
  return { ok: issues.length === 0, issues, count: observed.packages.length };
}
export function writePublicApiFreeze(root, file = path.join(root, 'api-freeze.json')) {
  fs.writeFileSync(file, stable(capturePublicApi(root)));
}
