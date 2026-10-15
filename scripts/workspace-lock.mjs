import fs from 'node:fs';
import path from 'node:path';
import { discoverWorkspaces } from './workspace-graph.mjs';

/** npm lockfile v3 is the only supported format for deterministic workspace repair. */
const declaredFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'bin', 'engines'];

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function normalize(obj) { return JSON.stringify(obj ?? {}); }
function copyDeclared(target, manifest) {
  for (const key of declaredFields) {
    if (manifest[key] === undefined) delete target[key];
    else target[key] = manifest[key];
  }
  target.version = manifest.version;
  if (manifest.license === undefined) delete target.license;
  else target.license = manifest.license;
  return target;
}

export function syncLocalLock(root, { write = false } = {}) {
  const manifest = readJson(path.join(root, 'package.json'));
  const lockPath = path.join(root, 'package-lock.json');
  const lock = readJson(lockPath);
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object') {
    throw new Error('Expected package-lock.json lockfileVersion 3 with packages; use npm install --package-lock-only to migrate');
  }
  if (!Array.isArray(manifest.workspaces)) throw new Error('Root package.json must declare npm workspaces');
  const entries = discoverWorkspaces(root);
  const original = JSON.stringify(lock);
  const rootLock = copyDeclared({ ...lock.packages[''] }, manifest);
  rootLock.name = manifest.name;
  rootLock.workspaces = manifest.workspaces;
  lock.packages[''] = rootLock;
  lock.name = manifest.name;
  lock.version = manifest.version;
  // Use checked-in package manifests as the sole authority for LOCAL workspace metadata.
  // Never invent resolved versions/integrity hashes for third-party packages.
  for (const { name, dir, pkg } of entries.values()) {
    const relative = path.relative(root, dir).split(path.sep).join('/');
    const current = lock.packages[relative] ?? {};
    const workspace = copyDeclared({ ...current }, pkg);
    if (name.startsWith('@')) workspace.name = name;
    lock.packages[relative] = workspace;
    const linkPath = `node_modules/${name}`;
    lock.packages[linkPath] = { resolved: relative, link: true };
  }
  // Remove only obsolete LOCAL workspace links. External packages are never
  // rewritten or guessed from source manifests.
  const expectedLinks = new Set([...entries.values()].map(({ name }) => `node_modules/${name}`));
  for (const [key, value] of Object.entries(lock.packages)) {
    if (value?.link === true && key.startsWith('node_modules/') && !expectedLinks.has(key)) {
      delete lock.packages[key];
    }
  }
  const changed = JSON.stringify(lock) !== original;
  if (write && changed) fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  return { changed, workspaceCount: entries.size, lock };
}

/** Locate the dependency selected by Node/npm for a package-lock v3 entry. */
function resolveLockDependency(packages, ownerPath, dependency) {
  let parent = ownerPath;
  while (true) {
    const candidate = `${parent ? parent + '/' : ''}node_modules/${dependency}`;
    if (Object.hasOwn(packages, candidate)) return candidate;
    if (!parent) return null;
    const nested = parent.lastIndexOf('/node_modules/');
    parent = nested >= 0 ? parent.slice(0, nested) : '';
  }
}

/**
 * Validate already locked third-party entries, including nested dependencies.
 * This is a structural audit only: npm ci still performs the authoritative
 * manifest, package-resolution and tarball-integrity checks.
 */
export function inspectLockedExternalGraph(lock) {
  const packages = lock.packages ?? {};
  const missingDependencies = [];
  const insecureResolutions = [];
  const malformedEntries = [];
  for (const [location, record] of Object.entries(packages)) {
    if (!record || typeof record !== 'object') {
      malformedEntries.push(location); continue;
    }
    if (record.link) continue;
    for (const dependency of Object.keys(record.dependencies ?? {})) {
      if (!resolveLockDependency(packages, location, dependency)) {
        missingDependencies.push({ owner: location || '(root)', dependency });
      }
    }
    if (!location.includes('node_modules/')) continue;
    if (typeof record.version !== 'string' || !record.version.trim()) {
      malformedEntries.push(location); continue;
    }
    if (typeof record.resolved === 'string' && /^http:/i.test(record.resolved)) insecureResolutions.push(location);
    if (typeof record.resolved === 'string' && /^https?:/i.test(record.resolved) &&
      !/^(?:sha512|sha384|sha256|sha1)-[A-Za-z0-9+/=]+(?:\s|$)/.test(record.integrity ?? '')) {
      malformedEntries.push(location);
    }
  }
  return { missingDependencies, insecureResolutions, malformedEntries };
}

/** Strictly diagnoses stale workspace sections and absent EXTERNAL resolutions. */
export function inspectWorkspaceLock(root) {
  const { changed, workspaceCount, lock } = syncLocalLock(root);
  const entries = discoverWorkspaces(root);
  const manifest = readJson(path.join(root, 'package.json'));
  const external = new Map();
  const externalOptional = new Map();
  const declared = [['(root)', manifest], ...[...entries.values()].map(({ name, pkg }) => [name, pkg])];
  const allNames = new Set(entries.keys());
  const packages = lock.packages;
  const graph = inspectLockedExternalGraph(lock);
  const hasExternal = (name, owner) => {
    const entry = entries.get(owner);
    const ownerPath = entry ? path.relative(root, entry.dir).split(path.sep).join('/') : '';
    const key = resolveLockDependency(packages, ownerPath, name);
    return key !== null && packages[key] && !packages[key].link;
  };
  for (const [owner, pkg] of declared) {
    for (const [kind, target] of [['dependencies', external], ['optionalDependencies', externalOptional]]) {
      for (const dep of Object.keys(pkg[kind] ?? {})) {
        if (allNames.has(dep) || hasExternal(dep, owner)) continue;
        if (!target.has(dep)) target.set(dep, new Set());
        target.get(dep).add(owner);
      }
    }
  }
  const toList = map => [...map].sort(([a], [b]) => a.localeCompare(b)).map(([name, owners]) => ({ name, requiredBy: [...owners].sort() }));
  return {
    ok: !changed && external.size === 0 && graph.missingDependencies.length === 0 && graph.insecureResolutions.length === 0 && graph.malformedEntries.length === 0,
    workspaceCount,
    staleWorkspaceMetadata: changed,
    unresolvedExternal: toList(external),
    unresolvedOptional: toList(externalOptional),
    ...graph,
    note: 'Lockfile-only inspection. npm ci, package tarball resolution, and runtime compatibility MUST be tested separately.'
  };
}
