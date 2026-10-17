import path from 'node:path';
import { planPublicReleases } from './workspace-release-plan.mjs';

/** Compare stable release versions without numeric precision loss; reads no globals. */
export function compareReleaseVersions(before, after) {
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!stable.test(before) || !stable.test(after)) throw Error('Publishing requires stable major.minor.patch versions');
  const a = before.split('.').map(BigInt), b = after.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/**
 * Select dependency-ordered version bumps under packages, excluding sample paths and private packages.
 * @param root Repository directory; no globals are read.
 * @param entries Discovered release workspace manifests.
 * @param previous Previous manifests keyed by package-relative directory.
 * @param allUnpublished Select all candidates for registry filtering on initial releases/retries.
 * @returns Ordered public release candidates; unchanged versions are excluded on pushes.
 */
export function selectPublishCandidates(root, entries, previous, allUnpublished = false) {
  const eligible = new Map([...entries].filter(([, entry]) => {
    const parts = path.relative(root, entry.dir).split(path.sep);
    return parts[0] === 'packages' && !parts.includes('..') &&
      !parts.slice(1).some(part => part.startsWith('sample')) && entry.pkg.private !== true;
  }));
  // Keep excluded packages private for dependency validation, so a public sample cannot silently become an external edge.
  const graph = new Map([...entries].map(([name, entry]) => [name, eligible.has(name) ? entry :
    { ...entry, pkg: { ...entry.pkg, private: true } }]));
  const plan = planPublicReleases(graph);
  if (!plan.ok) throw Error(`Invalid release dependency graph: ${JSON.stringify(plan.issues)}`);
  return plan.order.filter(item => {
    const entry = eligible.get(item.name);
    compareReleaseVersions(item.version, item.version);
    if (entry.pkg.publishConfig?.access !== 'public') throw Error(`${item.name}: publishConfig.access must be public`);
    const directory = path.relative(root, entry.dir).split(path.sep).join('/');
    const old = previous.get(directory);
    if (!allUnpublished && old?.name === item.name) {
      const comparison = compareReleaseVersions(old.version, item.version);
      if (comparison > 0) throw Error(`${item.name}: version decreased from ${old.version} to ${item.version}`);
      return comparison < 0;
    }
    return true;
  }).map(item => ({ ...item, directory: path.relative(root, eligible.get(item.name).dir).split(path.sep).join('/') }));
}
