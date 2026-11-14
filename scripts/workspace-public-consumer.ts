/** Pure, dependency-free public consumer selection/target checks. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';


/** Only the npm lock fields consumed by the isolated installer are modeled. */
type LockedPackage = {
  name?: string;
  version?: string;
  resolved?: string;
  integrity?: string;
  link?: boolean;
  dev?: boolean;
  devOptional?: boolean;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  bundleDependencies?: string[];
  [key: string]: unknown;
};

type WorkspacePackage = LockedPackage & { name: string; version: string };

type NpmOverrides = { [name: string]: string | NpmOverrides };

type RootPackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  overrides?: NpmOverrides;
};

type SourceLock = {
  lockfileVersion: number;
  packages: Record<string, LockedPackage>;
};

type PackedWorkspace = {
  pkg: WorkspacePackage;
  relativeDir: string;
  tarball: string;
  integrity: string;
};

type ConsumerOptions = {
  sourceRoot?: string;
  rootManifest?: RootPackageManifest;
};

/** Validate CLI behavior by flag instead of assuming help includes the version.
 * A creator's --help must offer usage guidance, while --version must report
 * the exact manifest version. These are deliberately separate CLI contracts.
 */
export function assertCreatorCliOutput(
  name: string,
  flag: '--help' | '--version',
  output: string,
  expectedVersion: string
): void {
  const printed = output.trim();
  if (!printed) {
    throw Error(`${name}: CLI ${flag} produced no output`);
  }
  if (flag === '--version') {
    if (printed !== expectedVersion) {
      throw Error(`${name}: CLI --version expected ${expectedVersion}, received ${printed.slice(0, 100)}`);
    }
  } else if (!/(?:usage|options?|commands?|--help|--database|--storage|--base-path|--dry-run|create)/i.test(printed)) {
    throw Error(`${name}: CLI --help missing usage guidance`);
  }
}

/** Public export maps contain strings, conditional objects, and nested arrays. */
type PackageEntrypoints = {
  main?: string;
  types?: string;
  bin?: Record<string, string>;
  exports?: unknown;
};


/**
 * Title: Lock an isolated tarball consumer to the reviewed workspace resolutions.
 * Description: Replaces workspace links with actual archive versions/integrities and retains the reachable external lock graph, so npm ci needs cached tarballs rather than registry metadata.
 * Global Variables: None; filesystem paths are converted to portable file URLs without reading files or environment variables.
 * @param sourceLock Committed package-lock v3 data.
 * @param archives Packed workspace manifests, original relative directories, tarball paths and npm integrity hashes.
 * @param options.sourceRoot Repository directory for resolving committed local archive paths.
 * @param options.rootManifest Root package metadata carrying npm override rules.
 * @returns Consumer manifest and lockfile containing no workspace symlinks.
 */
/** Perform the create consumer lock operation.
 * @param {unknown} sourceLock - Input value for source lock.
 * @param {unknown} archives - Input value for archives.
 * @param {unknown} root2 - Input value for root2.
 * @param {unknown} root2.sourceRoot - Input value for source root.
 * @returns {unknown} Result produced by create consumer lock.
 */
export function createConsumerLock(
  sourceLock: SourceLock,
  archives: PackedWorkspace[],
  { sourceRoot, rootManifest }: ConsumerOptions = {}
) {
  if (sourceLock.lockfileVersion !== 3 || !sourceLock.packages) {
    throw Error('Consumer requires the committed v3 workspace lock');
  }
  /**
   * Run the package name callback.
   * @param {unknown} location - Input value for location.
   * @returns {unknown} Result produced by package name.
   */
  const packageName = (location: string) =>
    location.slice(
      location.lastIndexOf('node_modules/') + 'node_modules/'.length
    );
  /** Local value for resolutions. */
  const resolutions = new Map<string, LockedPackage>();
  for (const [location, record] of Object.entries(sourceLock.packages)) {
    if (
      location.includes('node_modules/') &&
      !record.link &&
      record.resolved &&
      record.integrity
    ) {
      resolutions.set(
        `${record.name ?? packageName(location)}@${record.version}`,
        record
      );
    }
  }
  /** Local value for available. */
  const available: Record<string, LockedPackage> = {};
  for (const [location, record] of Object.entries(sourceLock.packages)) {
    if (location.startsWith('node_modules/') && !record.link) {
      available[location] = { ...record };
    }
  }
  /** Local value for dependencies. */
  const dependencies: Record<string, string> = {};
  for (const { pkg, relativeDir, tarball, integrity } of archives) {
    if (!integrity) {
      throw Error(`${pkg.name}: packed archive integrity is missing`);
    }
    /** Local value for location. */
    const location = `node_modules/${pkg.name}`;
    /** Local value for resolved. */
    const resolved = pathToFileURL(tarball).href;
    dependencies[pkg.name] = resolved;
    const workspaceRecord = sourceLock.packages[relativeDir];
    if (!workspaceRecord) {
      throw Error(`${pkg.name}: workspace missing from committed lock`);
    }
    /** Local value for record. */
    const record: LockedPackage = {
      ...workspaceRecord,
      version: pkg.version,
      resolved,
      integrity,
    };
    delete record.devDependencies;
    delete record.link;
    available[location] = record;
    // npm may install a workspace's runtime dependencies below its local directory.
    for (const [key, nested] of Object.entries(sourceLock.packages)) {
      if (key.startsWith(`${relativeDir}/node_modules/`) && !nested.link) {
        available[location + key.slice(relativeDir.length)] = { ...nested };
      }
    }
  }
  /** Local value for node types. */
  const nodeTypes = available['node_modules/@types/node'];
  if (!nodeTypes?.version || !nodeTypes.resolved || !nodeTypes.integrity) {
    throw Error(
      'Missing locked @types/node consumer baseline; clean npm ci is required'
    );
  }
  dependencies['@types/node'] = nodeTypes.version;
  // A package-lock records the result of npm overrides, but not the rules that
  // produced it. A standalone consumer must retain those rules or npm ci will
  // reject valid overridden resolutions (e.g. minimatch 11 in ESLint tooling).
  // Translate $direct-dependency references against the ORIGINAL root rather
  // than adding unrelated development dependencies to this runtime consumer.
  const rootDependencies = {
    ...rootManifest?.dependencies,
    ...rootManifest?.devDependencies,
    ...rootManifest?.optionalDependencies,
    ...rootManifest?.peerDependencies,
  };
  const rewriteOverride = (value: unknown): string | NpmOverrides => {
    if (typeof value === 'string') {
      let spec = value;
      if (spec.startsWith('$')) {
        const dependency = spec.slice(1);
        if (!Object.hasOwn(rootDependencies, dependency)) {
          throw Error(
            `Consumer override references missing root dependency: ${dependency}`
          );
        }
        const original = rootDependencies[dependency];
        if (!original) {
          throw Error(
            `Consumer override has no root dependency specification: ${dependency}`
          );
        }
        spec = original;
      }
      if (spec.startsWith('file:') && !spec.startsWith('file://')) {
        if (!sourceRoot) {
          throw Error('Local consumer override requires sourceRoot');
        }
        const base = path.resolve(sourceRoot);
        const target = path.resolve(base, spec.slice('file:'.length));
        if (!target.startsWith(base + path.sep)) {
          throw Error('Local consumer override escapes sourceRoot');
        }
        return pathToFileURL(target).href;
      }
      return spec;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw Error('Malformed root npm override');
    }
    return Object.fromEntries(
      Object.entries(value).map(([name, spec]) => [name, rewriteOverride(spec)])
    );
  };
  const overrides = rootManifest?.overrides
    ? rewriteOverride(rootManifest.overrides)
    : undefined;
  /** Local value for manifest. */
  const manifest = {
    name: 'zerux-public-package-consumer',
    private: true,
    type: 'module',
    dependencies,
    ...(overrides ? { overrides } : {}),
  };
  /** Local value for packages. */
  const packages: Record<string, LockedPackage> = { '': manifest };
  /** Local value for queue. */
  const queue = Object.keys(dependencies).map((name) => `node_modules/${name}`);
  while (queue.length) {
    /** Local value for location. */
    const location = queue.pop();
    if (!location || Object.hasOwn(packages, location)) {
      continue;
    }
    /** Local value for record. */
    const record = available[location];
    if (!record) {
      throw Error(
        `Consumer dependency lacks a committed resolution: ${location}`
      );
    }
    /** Local value for locked. */
    const locked = { ...record };
    if (!locked.resolved || !locked.integrity) {
      // npm can omit these fields for a repeated nested version. Reuse only an identical package/version already recorded in the committed lock.
      /** Local value for resolution. */
      const resolution = resolutions.get(
        `${record.name ?? packageName(location)}@${record.version}`
      );
      if (!resolution) {
        throw Error(
          `Consumer dependency lacks a complete committed resolution: ${location}`
        );
      }
      locked.resolved ??= resolution.resolved;
      locked.integrity ??= resolution.integrity;
    }
    if (!locked.resolved) {
      throw Error(`Consumer dependency has no archive: ${location}`);
    }
    // A committed build-input archive lives in the source repository, not in the isolated consumer.
    if (
      locked.resolved.startsWith('file:') &&
      !locked.resolved.startsWith('file://')
    ) {
      if (!sourceRoot) {
        throw Error(`Local consumer archive requires sourceRoot: ${location}`);
      }
      /** Local value for local. */
      const local = path.resolve(
        sourceRoot,
        locked.resolved.slice('file:'.length)
      );
      if (!local.startsWith(path.resolve(sourceRoot) + path.sep)) {
        throw Error(`Local consumer archive escapes sourceRoot: ${location}`);
      }
      locked.resolved = pathToFileURL(local).href;
    }
    // These are production consumer dependencies even if used only for development in the source workspace.
    delete locked.dev;
    delete locked.devOptional;
    packages[location] = locked;
    for (const name of Object.keys({
      ...record.dependencies,
      ...record.optionalDependencies,
      ...record.peerDependencies,
    })) {
      let parent = location;
      let found;
      while (true) {
        /** Local value for candidate. */
        const candidate = `${parent ? parent + '/' : ''}node_modules/${name}`;
        if (Object.hasOwn(available, candidate)) {
          found = candidate;
          break;
        }
        if (!parent) {
          break;
        }
        /** Local value for nested. */
        const nested = parent.lastIndexOf('/node_modules/');
        parent = nested < 0 ? '' : parent.slice(0, nested);
      }
      if (found) {
        queue.push(found);
      } else if (
        !Object.hasOwn(record.optionalDependencies ?? {}, name) &&
        record.peerDependenciesMeta?.[name]?.optional !== true &&
        !record.bundleDependencies?.includes(name)
      ) {
        throw Error(
          `Consumer dependency lacks a committed resolution: ${location} -> ${name}`
        );
      }
    }
  }
  return {
    manifest,
    lock: { name: manifest.name, lockfileVersion: 3, requires: true, packages },
  };
}
/** Perform the check consumer selection operation.
 * @param {unknown} plan - Input value for plan.
 * @param {unknown} only - Input value for only.
 * @returns {unknown} Result produced by check consumer selection.
 */
export function checkConsumerSelection(
  plan: { ok: boolean; order: { name: string }[] },
  only?: string
): string[] {
  if (!plan.ok) {
    throw Error('Public dependency graph failed');
  }
  /** Local value for available. */
  const available = plan.order.map((item) => item.name);
  if (!only) {
    return available;
  }
  /** Local value for chosen. */
  const chosen = only.split(',');
  if (
    !chosen.length ||
    chosen.some((item) => !item || !available.includes(item)) ||
    new Set(chosen).size !== chosen.length
  ) {
    throw Error('Unknown, empty or duplicate public package name');
  }
  return available.filter((name) => chosen.includes(name));
}
/** Perform the collect operation.
 * @param {unknown} record - Input value for record.
 * @param {unknown} output - Input value for output.
 * @returns {unknown} Result produced by collect.
 */
function collect(record: unknown, output: string[] = []): string[] {
  if (typeof record === 'string') {
    output.push(record);
  } else if (record && typeof record === 'object') {
    for (const value of Object.values(record)) {
      collect(value, output);
    }
  }
  return output;
}
/** Perform the check entry targets operation.
 * @param {unknown} dir - Input value for dir.
 * @param {unknown} pkg - Input value for pkg.
 * @returns {unknown} Result produced by check entry targets.
 */
export function checkEntryTargets(dir: string, pkg: PackageEntrypoints): string[] {
  /** Local value for targets. */
  const targets = [
    ...new Set([
      ...collect(pkg.main),
      ...collect(pkg.types),
      ...collect(pkg.bin),
      ...collect(pkg.exports),
    ]),
  ];
  if (!targets.length) {
    return ['No declared package entry points'];
  }
  /** Local value for root. */
  const root = path.resolve(dir);
  return targets
    .filter((target) => {
      if (
        typeof target !== 'string' ||
        !target.startsWith('./') ||
        target.includes('\\') ||
        target.includes('\0')
      ) {
        return true;
      }
      /** Local value for segments. */
      const segments = target.slice(2).split('/');
      if (
        segments.some(
          (segment) => segment === '.' || segment === '..' || segment === ''
        )
      ) {
        return true;
      }
      /** Local value for output. */
      const output = path.resolve(dir, target);
      // Assets such as JSON schemas are valid exports; reject symlinks and escapes for every target.
      return (
        !output.startsWith(root + path.sep) ||
        !fs.lstatSync(output, { throwIfNoEntry: false })?.isFile() ||
        !fs.realpathSync(output).startsWith(fs.realpathSync(root) + path.sep)
      );
    })
    .map((target) => String(target));
}
