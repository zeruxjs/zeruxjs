/**
 * npm release readiness audit. Source checks and real npm tarball inventories
 * are intentionally separate: no source-only check is a proof of a publishable
 * build, and this module never publishes, installs or uploads a package.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { npmCommand } from './npm-command.ts';
import { discoverWorkspaces } from './workspace-graph.ts';

/**
 * Run the has file callback.
 * @param {unknown} dir - Input value for dir.
 * @param {unknown} file - Input value for file.
 * @returns {unknown} Result produced by has file.
 */
const hasFile = (dir, file) =>
  fs.statSync(path.join(dir, file), { throwIfNoEntry: false })?.isFile() ===
  true;
/**
 * Run the version is stable callback.
 * @param {unknown} version - Input value for version.
 * @returns {unknown} Result produced by version is stable.
 */
const versionIsStable = (version) =>
  typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version);

/** Perform the collect targets operation.
 * @param {unknown} record - Input value for record.
 * @param {unknown} output - Input value for output.
 * @returns {unknown} Result produced by collect targets.
 */
function collectTargets(record, output = []) {
  if (typeof record === 'string') {
    output.push(record);
  } else if (record && typeof record === 'object') {
    for (const value of Object.values(record)) {
      collectTargets(value, output);
    }
  }
  return output;
}

/**
 * Inspect a single workspace without running npm. `packedFiles` must be the
 * actual array returned by `npm pack --dry-run --json`, not a guessed glob.
 */
/** Perform the inspect publishable package operation.
 * @param {unknown} root0 - Input value for root0.
 * @param {unknown} root0.pkg - Input value for pkg.
 * @param {unknown} root0.name - Input value for name.
 * @param {unknown} root0.dir - Input value for dir.
 * @param {unknown} root0.entries - Input value for entries.
 * @param {unknown} root0.packedFiles - Input value for packed files.
 * @param {unknown} root0.built - Input value for built.
 * @returns {unknown} Result produced by inspect publishable package.
 */
export function inspectPublishablePackage({
  pkg,
  name,
  dir,
  entries,
  packedFiles,
  built = false,
}) {
  /** Local value for errors. */
  const errors = [],
    warnings = [];
  if (pkg.private === true) {
    return { name, private: true, publishable: false, errors, warnings };
  }
  /**
   * Run the error callback.
   * @param {unknown} code - Input value for code.
   * @param {unknown} detail - Input value for detail.
   * @returns {unknown} Result produced by error.
   */
  const error = (code, detail) => errors.push({ code, detail });
  if (
    !/^[a-z0-9][a-z0-9-_.]*(?:\/[a-z0-9][a-z0-9-_.]*)?$/.test(
      name.replace(/^@/, '')
    )
  ) {
    error('INVALID_NAME', name);
  }
  if (!pkg.version || typeof pkg.version !== 'string') {
    error('VERSION', 'Missing version');
  } else if (!versionIsStable(pkg.version)) {
    warnings.push({
      code: 'PRERELEASE_VERSION',
      detail: `Version ${pkg.version} is prerelease or not a stable x.y.z version`,
    });
  } else if (pkg.version.startsWith('0.')) {
    warnings.push({
      code: 'PRE_1_SEMVER',
      detail: `Version ${pkg.version} is below 1.0.0; consumer compatibility must be documented`,
    });
  }
  if (!hasFile(dir, 'README.md')) {
    error('README', 'README.md missing');
  }
  /** Local value for licenses. */
  const licenses = fs
    .readdirSync(dir)
    .filter(
      (file) => /^LICEN[CS]E(?:[-.]|$)/i.test(file) && hasFile(dir, file)
    );
  if (!pkg.license || pkg.license === 'UNLICENSED' || !licenses.length) {
    error('LICENSE', 'No declared distributable license file');
  }
  if (
    pkg.license?.includes('Apache-2.0') &&
    !licenses.some((f) => /APACHE/i.test(f))
  ) {
    error('LICENSE_APACHE', 'Apache-2.0 declared without a license copy');
  }
  if (
    /\bMIT\b/.test(pkg.license ?? '') &&
    !licenses.some((f) => /MIT/i.test(f))
  ) {
    error('LICENSE_MIT', 'MIT declared without a license copy');
  }
  if (
    !Array.isArray(pkg.files) ||
    !pkg.files.length ||
    !pkg.files.some((f) => /^dist\/?$/.test(f))
  ) {
    error(
      'PACK_ALLOWLIST',
      'Require an explicit npm files allowlist containing dist'
    );
  }
  for (const field of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
      if (entries.has(dep) && entries.get(dep).pkg.private === true) {
        // Optional peers are not fetched by npm when omitted. Unlike required
        // peers and runtime dependencies, they are an opt-in integration boundary.
        if (
          field === 'peerDependencies' &&
          pkg.peerDependenciesMeta?.[dep]?.optional === true
        ) {
          warnings.push({
            code: 'OPTIONAL_PRIVATE_PEER',
            detail: `${dep} is a private optional integration; consumers cannot opt in until it is published`,
          });
        } else {
          error(
            'PRIVATE_DEPENDENCY',
            `${field}: ${dep} (${range}) is private; cannot be resolved by npm consumers`
          );
        }
      }
      if (
        entries.has(dep) &&
        typeof range === 'string' &&
        range !== '*' &&
        !range.startsWith('workspace:') &&
        range !== entries.get(dep).pkg.version
      ) {
        error(
          'WORKSPACE_VERSION_MISMATCH',
          `${field}: ${dep} requests ${range}, local version is ${entries.get(dep).pkg.version}`
        );
      }
      if (entries.has(dep) && (range === '*' || range === 'workspace:*')) {
        error(
          'UNPINNED_WORKSPACE_DEPENDENCY',
          `${field}: ${dep} uses ${range}; pin a published compatible semver range before release`
        );
      }
    }
  }
  // npm installs published dependencies recursively. A public root can be
  // un-installable even when only one of its public dependencies uses a private
  // workspace: show the complete first-hop path, not just the direct edges.
  /** Local value for seen. */
  const seen = new Set([name]);
  /**
   * Run the follow callback.
   * @param {unknown} current - Input value for current.
   * @param {unknown} lineage - Input value for lineage.
   * @returns {unknown} Result produced by follow.
   */
  const follow = (current, lineage) => {
    /** Local value for manifest. */
    const manifest = entries.get(current)?.pkg;
    if (!manifest) {
      return;
    }
    for (const dep of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    })) {
      if (!entries.has(dep)) {
        continue;
      }
      /** Local value for chain. */
      const chain = [...lineage, dep];
      if (entries.get(dep).pkg.private === true) {
        if (lineage.length > 1) {
          error('TRANSITIVE_PRIVATE_DEPENDENCY', chain.join(' -> '));
        }
      } else if (!seen.has(dep)) {
        seen.add(dep);
        follow(dep, chain);
      }
    }
  };
  follow(name, [name]);
  /** Local value for targets. */
  const targets = [
    ...new Set([
      ...collectTargets(pkg.main),
      ...collectTargets(pkg.types),
      ...collectTargets(pkg.bin),
      ...collectTargets(pkg.exports),
    ]),
  ];
  if (!targets.length) {
    error('NO_ENTRYPOINT', 'No public entry points declared');
  }
  /** Local value for paths. */
  const paths = Array.isArray(packedFiles)
    ? packedFiles.map((x) => (typeof x === 'string' ? x : x?.path))
    : null;
  /** Local value for file set. */
  const fileSet = paths ? new Set(paths) : null;
  if (built && !paths) {
    error(
      'PACK_NOT_VERIFIED',
      'Post-build npm pack --dry-run inventory was not collected'
    );
  }
  if (fileSet) {
    for (const target of targets) {
      if (typeof target !== 'string' || !target.startsWith('./')) {
        error('INVALID_EXPORT', String(target));
        continue;
      }
      if (!fileSet.has(target.slice(2))) {
        if (!built && target.startsWith('./dist/')) {
          warnings.push({
            code: 'NOT_BUILT',
            detail: `${target} is not in this source-only tarball preview`,
          });
        } else {
          error('EXPORT_NOT_PACKED', target);
        }
      }
    }
    if (!fileSet.has('README.md')) {
      error('README_NOT_PACKED', 'README.md missing from tarball');
    }
    if (!licenses.some((license) => fileSet.has(license))) {
      error('LICENSE_NOT_PACKED', 'No declared license included in tarball');
    }
    // Explicit npm bundles include reviewed third-party runtime trees, unlike ordinary source packages.
    /** Local value for has bundles. */
    const hasBundles =
      Array.isArray(pkg.bundleDependencies) &&
      pkg.bundleDependencies.length > 0;
    if (paths.length > (hasBundles ? 10000 : 2000)) {
      error('EXCESSIVE_FILES', `${paths.length} tarball entries`);
    }
    for (const entry of paths) {
      if (
        typeof entry !== 'string' ||
        entry.includes('..') ||
        entry.startsWith('/') ||
        entry.includes('\\')
      ) {
        error('UNSAFE_PACK_PATH', String(entry));
        continue;
      }
      /** Local value for bundled runtime. */
      const bundledRuntime = hasBundles && entry.startsWith('node_modules/');
      if (
        (!hasBundles && /(^|\/)node_modules(\/|$)/i.test(entry)) ||
        /(^|\/)(?:\.env(?:\..*)?|\.git|\.npmrc|\.netrc|\.pypirc)(\/|$)/i.test(
          entry
        ) ||
        (!bundledRuntime &&
          /(^|\/)(?:tests?|__tests__|coverage)(\/|$)/i.test(entry)) ||
        /(?:\.pem|\.key|\.p12|\.tsbuildinfo)$/i.test(entry) ||
        entry.startsWith('src/')
      ) {
        error('UNWANTED_PACK_FILE', entry);
      }
    }
  }
  return {
    name,
    private: false,
    publishable: true,
    version: pkg.version,
    files: paths?.length ?? null,
    errors,
    warnings,
  };
}

/** Perform the npm pack dry run operation.
 * @param {unknown} dir - Input value for dir.
 * @param {unknown} root1 - Input value for root1.
 * @param {unknown} root1.timeout - Input value for timeout.
 * @returns {unknown} Result produced by npm pack dry run.
 */
export function npmPackDryRun(dir, { timeout = 30_000 } = {}) {
  /** Local value for npm. */
  const npm = npmCommand([
    'pack',
    '--dry-run',
    '--json',
    '--ignore-scripts',
    '--offline',
  ]);
  /** Local value for result. */
  const result = spawnSync(npm.command, npm.args, {
    cwd: dir,
    encoding: 'utf8',
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_ignore_scripts: 'true',
      npm_config_offline: 'true',
    },
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `npm pack dry-run failed: ${String(result.error?.message ?? result.stderr ?? result.status).slice(0, 300)}`
    );
  }
  /** Local value for parsed. */
  const parsed = JSON.parse(result.stdout);
  // npm versions may return an array or an object keyed by workspace name.
  /** Local value for data. */
  const data = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? Object.values(parsed)
      : [];
  if (data.length !== 1 || !Array.isArray(data[0]?.files)) {
    throw new Error('npm pack returned an invalid file inventory');
  }
  return data[0].files;
}

/** Perform the inspect publishable workspaces operation.
 * @param {unknown} root - Input value for root.
 * @param {unknown} root1 - Input value for root1.
 * @param {unknown} root1.built - Input value for built.
 * @param {unknown} root1.npmPack - Input value for npm pack.
 * @returns {unknown} Result produced by inspect publishable workspaces.
 */
export function inspectPublishableWorkspaces(
  root,
  { built = false, npmPack = npmPackDryRun } = {}
) {
  /** Local value for entries. */
  const entries = discoverWorkspaces(root);
  /** Local value for packages. */
  const packages = [];
  for (const [, entry] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    if (entry.pkg.private) {
      packages.push(inspectPublishablePackage({ ...entry, entries }));
      continue;
    }
    let packedFiles, packFailure;
    try {
      packedFiles = npmPack(entry.dir);
    } catch (e) {
      packFailure = String(e?.message ?? e);
    }
    /** Local value for item. */
    const item = inspectPublishablePackage({
      ...entry,
      entries,
      packedFiles,
      built,
    });
    if (packFailure) {
      item.errors.push({ code: 'PACK_FAILED', detail: packFailure });
    }
    packages.push(item);
  }
  /** Local value for public packages. */
  const publicPackages = packages.filter((pkg) => pkg.publishable);
  return {
    schemaVersion: 1,
    mode: built ? 'built-artifacts-required' : 'source-preflight-only',
    checkedWorkspaces: entries.size,
    publicPackages: publicPackages.length,
    privatePackages: packages.length - publicPackages.length,
    ok: publicPackages.every((pkg) => pkg.errors.length === 0),
    stableCandidate: publicPackages.every(
      (pkg) =>
        pkg.errors.length === 0 &&
        !pkg.warnings.some((w) => w.code === 'PRERELEASE_VERSION')
    ),
    packages,
  };
}
