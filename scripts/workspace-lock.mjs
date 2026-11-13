import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { discoverWorkspaces } from './workspace-graph.mjs';

/** npm lockfile v3 is the only supported format for deterministic workspace repair. */
const declaredFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'bin',
  'engines',
];

/** Perform the read json operation.
 * @param {unknown} file - Input value for file.
 * @returns {unknown} Result produced by read json.
 */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
/** Perform the copy declared operation.
 * @param {unknown} target - Input value for target.
 * @param {unknown} manifest - Input value for manifest.
 * @returns {unknown} Result produced by copy declared.
 */
function copyDeclared(target, manifest) {
  for (const key of declaredFields) {
    /** Local value for value. */
    const value = manifest[key];
    // npm omits empty dependency maps and normalizes bin paths in lockfiles.
    if (
      value === undefined ||
      (key.toLowerCase().endsWith('dependencies') &&
        Object.keys(value).length === 0)
    ) {
      delete target[key];
    } else if (key === 'bin' && value && typeof value === 'object') {
      target[key] = Object.fromEntries(
        Object.entries(value).map(([name, file]) => [
          name,
          file.replace(/^\.\//, ''),
        ])
      );
    } else {
      target[key] = value;
    }
  }
  target.version = manifest.version;
  if (manifest.license === undefined) {
    delete target.license;
  } else {
    target.license = manifest.license;
  }
  return target;
}

/** Perform the sync local lock operation.
 * @param {unknown} root - Input value for root.
 * @param {unknown} root1 - Input value for root1.
 * @param {unknown} root1.write - Input value for write.
 * @returns {unknown} Result produced by sync local lock.
 */
export function syncLocalLock(root, { write = false } = {}) {
  /** Local value for manifest. */
  const manifest = readJson(path.join(root, 'package.json'));
  /** Local value for lock path. */
  const lockPath = path.join(root, 'package-lock.json');
  /** Local value for lock. */
  const lock = readJson(lockPath);
  if (
    lock.lockfileVersion !== 3 ||
    !lock.packages ||
    typeof lock.packages !== 'object'
  ) {
    throw new Error(
      'Expected package-lock.json lockfileVersion 3 with packages; use npm install --package-lock-only to migrate'
    );
  }
  if (!Array.isArray(manifest.workspaces)) {
    throw new Error('Root package.json must declare npm workspaces');
  }
  /** Local value for entries. */
  const entries = discoverWorkspaces(root, { release: false });
  // Compare JSON data, not insertion order. npm may reorder equivalent lockfile
  // properties while preserving the same workspace records.
  /** Local value for original. */
  const original = JSON.parse(JSON.stringify(lock));
  /** Local value for root lock. */
  const rootLock = copyDeclared({ ...lock.packages[''] }, manifest);
  rootLock.name = manifest.name;
  rootLock.workspaces = manifest.workspaces;
  lock.packages[''] = rootLock;
  lock.name = manifest.name;
  lock.version = manifest.version;
  // Use checked-in package manifests as the sole authority for LOCAL workspace metadata.
  // Never invent resolved versions/integrity hashes for third-party packages.
  for (const { name, dir, pkg } of entries.values()) {
    /** Local value for relative. */
    const relative = path.relative(root, dir).split(path.sep).join('/');
    /** Local value for current. */
    const current = lock.packages[relative] ?? {};
    /** Local value for workspace. */
    const workspace = copyDeclared({ ...current }, pkg);
    lock.packages[relative] = workspace;
    /** Local value for link path. */
    const linkPath = `node_modules/${name}`;
    lock.packages[linkPath] = { resolved: relative, link: true };
  }
  // Remove only obsolete LOCAL workspace links. External packages are never
  // rewritten or guessed from source manifests.
  /** Local value for expected links. */
  const expectedLinks = new Set(
    [...entries.values()].map(({ name }) => `node_modules/${name}`)
  );
  for (const [key, value] of Object.entries(lock.packages)) {
    if (
      value?.link === true &&
      key.startsWith('node_modules/') &&
      !expectedLinks.has(key)
    ) {
      delete lock.packages[key];
    }
  }
  // Normalize undefined properties introduced by missing optional manifest
  // fields before comparison; JSON serialization would omit those on write.
  /**
   * Local value for changed.
   * @param {unknown} packages - Input value for packages.
   * @param {unknown} ownerPath - Input value for owner path.
   * @param {unknown} dependency - Input value for dependency.
   * @returns {unknown} Result produced by resolve lock dependency.
   */
  const changed = !isDeepStrictEqual(
    JSON.parse(JSON.stringify(lock)),
    original
  );
  if (write && changed) {
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  }
  return { changed, workspaceCount: entries.size, lock };
}

/* * @param {unknown} packages - Input value for packages.
 * @param {unknown} ownerPath - Input value for owner path.
 * @param {unknown} dependency - Input value for dependency.
 * @returns {unknown} Result produced by resolve lock dependency.
 * Locate the dependency selected by Node/npm for a package-lock v3 entry. */
/**
 * Perform the resolve lock dependency operation.
 * @param {unknown} packages - Input value for packages.
 * @param {unknown} ownerPath - Input value for owner path.
 * @param {unknown} dependency - Input value for dependency.
 * @returns {unknown} Result produced by resolve lock dependency.
 */ function resolveLockDependency(packages, ownerPath, dependency) {
  let parent = ownerPath;
  while (true) {
    /** Local value for candidate. */
    const candidate = `${parent ? parent + '/' : ''}node_modules/${dependency}`;
    if (Object.hasOwn(packages, candidate)) {
      return candidate;
    }
    if (!parent) {
      return null;
    }
    /** Local value for nested. */
    const nested = parent.lastIndexOf('/node_modules/');
    parent = nested >= 0 ? parent.slice(0, nested) : '';
  }
}

/**
 * Validate already locked third-party entries, including nested dependencies.
 * This is a structural audit only: npm ci still performs the authoritative
 * manifest, package-resolution and tarball-integrity checks.
 */
/** Perform the inspect locked external graph operation.
 * @param {unknown} lock - Input value for lock.
 * @returns {unknown} Result produced by inspect locked external graph.
 */
export function inspectLockedExternalGraph(lock) {
  /** Local value for packages. */
  const packages = lock.packages ?? {};
  /** Local value for missing dependencies. */
  const missingDependencies = [];
  /** Local value for insecure resolutions. */
  const insecureResolutions = [];
  /** Local value for malformed entries. */
  const malformedEntries = [];
  for (const [location, record] of Object.entries(packages)) {
    if (!record || typeof record !== 'object') {
      malformedEntries.push(location);
      continue;
    }
    if (record.link) {
      continue;
    }
    for (const dependency of Object.keys(record.dependencies ?? {})) {
      if (!resolveLockDependency(packages, location, dependency)) {
        missingDependencies.push({ owner: location || '(root)', dependency });
      }
    }
    if (!location.includes('node_modules/')) {
      continue;
    }
    if (typeof record.version !== 'string' || !record.version.trim()) {
      malformedEntries.push(location);
      continue;
    }
    if (
      typeof record.resolved === 'string' &&
      /^http:/i.test(record.resolved)
    ) {
      insecureResolutions.push(location);
    }
    if (
      typeof record.resolved === 'string' &&
      /^https?:/i.test(record.resolved) &&
      !/^(?:sha512|sha384|sha256|sha1)-[A-Za-z0-9+/=]+(?:\s|$)/.test(
        record.integrity ?? ''
      )
    ) {
      malformedEntries.push(location);
    }
  }
  return { missingDependencies, insecureResolutions, malformedEntries };
}

/** Strictly diagnoses stale workspace sections and absent EXTERNAL resolutions. */
/** Perform the inspect workspace lock operation.
 * @param {unknown} root - Input value for root.
 * @returns {unknown} Result produced by inspect workspace lock.
 */
export function inspectWorkspaceLock(root) {
  /** Local value for destructured values. */
  const { changed, workspaceCount, lock } = syncLocalLock(root);
  /** Local value for entries. */
  const entries = discoverWorkspaces(root, { release: false });
  /** Local value for manifest. */
  const manifest = readJson(path.join(root, 'package.json'));
  /** Local value for external. */
  const external = new Map();
  /** Local value for external optional. */
  const externalOptional = new Map();
  /** Local value for declared. */
  const declared = [
    ['(root)', manifest],
    ...[...entries.values()].map(({ name, pkg }) => [name, pkg]),
  ];
  /** Local value for all names. */
  const allNames = new Set(entries.keys());
  /** Local value for packages. */
  const packages = lock.packages;
  /** Local value for graph. */
  const graph = inspectLockedExternalGraph(lock);
  /**
   * Run the has external callback.
   * @param {unknown} name - Input value for name.
   * @param {unknown} owner - Input value for owner.
   * @returns {unknown} Result produced by has external.
   */
  const hasExternal = (name, owner) => {
    /** Local value for entry. */
    const entry = entries.get(owner);
    /** Local value for owner path. */
    const ownerPath = entry
      ? path.relative(root, entry.dir).split(path.sep).join('/')
      : '';
    /** Local value for key. */
    const key = resolveLockDependency(packages, ownerPath, name);
    return key !== null && packages[key] && !packages[key].link;
  };
  for (const [owner, pkg] of declared) {
    for (const [kind, target] of [
      ['dependencies', external],
      ['optionalDependencies', externalOptional],
    ]) {
      for (const dep of Object.keys(pkg[kind] ?? {})) {
        if (allNames.has(dep) || hasExternal(dep, owner)) {
          continue;
        }
        if (!target.has(dep)) {
          target.set(dep, new Set());
        }
        target.get(dep).add(owner);
      }
    }
  }
  /**
   * Run the to list callback.
   * @param {unknown} map - Input value for map.
   * @returns {unknown} Result produced by to list.
   */
  const toList = (map) =>
    [...map]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, owners]) => ({ name, requiredBy: [...owners].sort() }));
  return {
    ok:
      !changed &&
      external.size === 0 &&
      graph.missingDependencies.length === 0 &&
      graph.insecureResolutions.length === 0 &&
      graph.malformedEntries.length === 0,
    workspaceCount,
    staleWorkspaceMetadata: changed,
    unresolvedExternal: toList(external),
    unresolvedOptional: toList(externalOptional),
    ...graph,
    note: 'Lockfile-only inspection. npm ci, package tarball resolution, and runtime compatibility MUST be tested separately.',
  };
}
