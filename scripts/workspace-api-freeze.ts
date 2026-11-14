import fs from 'node:fs';
import path from 'node:path';
import { discoverWorkspaces } from './workspace-graph.ts';

/** Public entrypoints and consumer-facing constraints; source implementations may change without API drift. */
/** Perform the capture public api operation.
 * @param {unknown} root - Input value for root.
 * @returns {unknown} Result produced by capture public api.
 */
export function capturePublicApi(root) {
  /** Local value for items. */
  const items = [...discoverWorkspaces(root).values()]
    .map(({ name, pkg }) => ({
      name,
      version: pkg.version,
      private: pkg.private === true,
      main: pkg.main ?? null,
      module: pkg.module ?? null,
      types: pkg.types ?? null,
      exports: pkg.exports ?? null,
      bin: pkg.bin ?? null,
      engines: pkg.engines ?? null,
      peerDependencies: pkg.peerDependencies ?? null,
      peerDependenciesMeta: pkg.peerDependenciesMeta ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { schemaVersion: 1, packages: items };
}
/**
 * Run the stable callback.
 * @param {unknown} value - Input value for value.
 * @returns {unknown} Result produced by stable.
 */
const stable = (value) => JSON.stringify(value, null, 2) + '\n';
/**
 * Run the diff callback.
 * @param {unknown} before - Input value for before.
 * @param {unknown} after - Input value for after.
 * @returns {unknown} Result produced by diff.
 */
const diff = (before, after) => {
  /** Local value for previous. */
  const previous = new Map(
    (before.packages ?? []).map((item) => [item.name, item])
  );
  /** Local value for current. */
  const current = new Map(after.packages.map((item) => [item.name, item]));
  /** Local value for changes. */
  const changes = [];
  for (const key of new Set([...previous.keys(), ...current.keys()])) {
    if (!previous.has(key)) {
      changes.push({ package: key, issue: 'new package requires API review' });
    } else if (!current.has(key)) {
      changes.push({ package: key, issue: 'removed package' });
    } else if (stable(previous.get(key)) !== stable(current.get(key))) {
      changes.push({
        package: key,
        issue: 'public contract changed; review semver and consumers',
      });
    }
  }
  return changes.sort((a, b) => a.package.localeCompare(b.package));
};
/** Perform the verify public api freeze operation.
 * @param {unknown} root - Input value for root.
 * @param {unknown} file - Input value for file.
 * @returns {unknown} Result produced by verify public api freeze.
 */
export function verifyPublicApiFreeze(
  root,
  file = path.join(root, 'api-freeze.json')
) {
  /** Local value for observed. */
  const observed = capturePublicApi(root);
  let recorded;
  try {
    recorded = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {
      ok: false,
      issues: [{ issue: 'missing or unreadable committed API freeze' }],
      count: observed.packages.length,
    };
  }
  if (recorded.schemaVersion !== 1 || !Array.isArray(recorded.packages)) {
    return {
      ok: false,
      issues: [{ issue: 'unsupported API freeze schema' }],
      count: observed.packages.length,
    };
  }
  /** Local value for issues. */
  const issues = diff(recorded, observed);
  return { ok: issues.length === 0, issues, count: observed.packages.length };
}
/** Perform the write public api freeze operation.
 * @param {unknown} root - Input value for root.
 * @param {unknown} file - Input value for file.
 * @returns {unknown} Result produced by write public api freeze.
 */
export function writePublicApiFreeze(
  root,
  file = path.join(root, 'api-freeze.json')
) {
  fs.writeFileSync(file, stable(capturePublicApi(root)));
}
