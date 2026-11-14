import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
/** Explicit installed package identity and inert export-map snapshot. */
export interface PackageExportContract {
  /** Declared installed package name verified against its manifest. */
  readonly name: string;
  /** Raw JSON export-map data; conditions and target existence are not certified. */
  readonly exports: unknown;
}
/** Read explicitly selected installed manifests without executing their entry points.
 * @param {string} cwd - Trusted project directory resolved against the current process working directory.
 * @param {readonly string[]} packages - Explicit installed package names; no package discovery or source fallback is performed.
 * @returns {readonly PackageExportContract[]} Frozen selected package contracts; missing/invalid manifests reject instead of guessing.
 * @throws {Error} For invalid selection, missing packages or unsafe/malformed manifests; descriptors are always closed.
 */
export function readPackageExportContracts(
  cwd: string,
  packages: readonly string[]
): readonly PackageExportContract[] {
  if (
    typeof cwd !== 'string' ||
    !Array.isArray(packages) ||
    packages.length > 64
  ) {
    throw new TypeError('lint: invalid package contract selection');
  }
  /** Project-relative resolver used only to locate explicitly selected installed manifests. */
  const require = createRequire(path.join(path.resolve(cwd), 'package.json'));
  return Object.freeze(
    [...new Set(packages)].map((name) => {
      if (
        typeof name !== 'string' ||
        !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(name)
      ) {
        throw new TypeError('lint: invalid package name');
      }
      // directory is an installed resolver search root, not an application module to execute.
      for (const directory of require.resolve.paths(name) ?? []) {
        /** Installed package manifest candidate; package entry-point code is never imported. */
        const file = path.join(directory, name, 'package.json');
        let fd: number;
        try {
          fd = fs.openSync(
            file,
            fs.constants.O_RDONLY |
              fs.constants.O_NOFOLLOW |
              fs.constants.O_NONBLOCK
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            continue;
          }
          throw error;
        }
        let manifest;
        try {
          /** Metadata from the same open manifest descriptor used for reading. */
          const stat = fs.fstatSync(fd);
          if (!stat.isFile() || stat.size > 1024 * 1024) {
            throw new Error('lint: invalid installed package manifest');
          }
          /** Bounded manifest buffer with one extra byte to detect growth during the read. Actual manifest bytes read; growth beyond the inspected size rejects configuration. */
          const bytes = Buffer.alloc(stat.size + 1),
            size = fs.readSync(fd, bytes, 0, bytes.length, 0);
          if (size > stat.size) {
            throw new Error('lint: installed manifest changed');
          }
          manifest = JSON.parse(bytes.subarray(0, size).toString('utf8'));
        } finally {
          fs.closeSync(fd);
        }
        if (manifest.name !== name) {
          throw new Error('lint: installed package identity mismatch');
        }
        return Object.freeze({ name, exports: manifest.exports });
      }
      throw new Error(
        `lint: declared package contract is not installed: ${name}`
      );
    })
  );
}
/** Prove absent or explicitly denied exports without guessing runtime conditions.
 * @param {string} specifier - Literal module specifier inspected as data only.
 * @param {readonly PackageExportContract[]} contracts - Explicit installed export-map snapshots, owned by the configured host.
 * @returns {boolean} True only when the selected export map proves the requested subpath absent or denied.
 */
export function deniedSubpath(
  specifier: string,
  contracts: readonly PackageExportContract[]
): boolean {
  /** Selected installed package owning this literal specifier, if known. */
  const contract = contracts.find(
    (item) => specifier === item.name || specifier.startsWith(item.name + '/')
  );
  if (!contract || contract.exports === undefined) {
    return false;
  }
  /** Normalized export-map key for the requested public entry. Stored export-map data; conditions remain runtime-owned rather than guessed. */
  const subpath =
      specifier === contract.name
        ? '.'
        : './' + specifier.slice(contract.name.length + 1),
    value = contract.exports;
  if (value === null) {
    return true;
  }
  if (typeof value === 'string' || Array.isArray(value)) {
    return subpath !== '.';
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  /** Own export-map entries inspected for exact and wildcard subpath policy. */
  const entries = Object.entries(value);
  if (!entries.some(([key]) => key.startsWith('.'))) {
    return subpath !== '.';
  }
  if (Object.hasOwn(value, subpath)) {
    return (value as Record<string, unknown>)[subpath] === null;
  }
  /** Matching single-wildcard exports, ordered by Node-style specificity before denial. */
  const patterns = entries.filter(
    ([key]) =>
      key.startsWith('./') &&
      key.split('*').length === 2 &&
      // The exact two-piece check above proves both split entries exist.
      subpath.startsWith(key.split('*')[0]!) &&
      subpath.endsWith(key.split('*')[1]!)
  );
  patterns.sort(
    ([a], [b]) => b.indexOf('*') - a.indexOf('*') || b.length - a.length
  );
  return !patterns.length || patterns[0]![1] === null;
}
