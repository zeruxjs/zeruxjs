import fileIO from './file-io.ts';
/** Local value for destructured values. */
const { readRegularFileSync } = fileIO;
/** Post-install third-party license metadata inspection, not legal clearance. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
/**
 * Local value for license names.
 * @param {unknown} manifest - Input value for manifest.
 * @returns {unknown} Result produced by declared license.
 * @throws {Error} If validation or the delegated operation fails.
 */
const licenseNames = /^(?:LICEN[CS]E|COPYING|NOTICE)(?:[-._].*)?$/i;
/* * @param {unknown} manifest - Input value for manifest.
 * @returns {unknown} Result produced by declared license.
 * Read modern and legacy npm license metadata without inventing a license. */
/**
 * Perform the declared license operation.
 * @param {unknown} manifest - Input value for manifest.
 * @returns {unknown} Result produced by declared license.
 */ function declaredLicense(manifest) {
  if (typeof manifest.license === 'string') {
    return manifest.license;
  }
  if (typeof manifest.license?.type === 'string') {
    return manifest.license.type;
  }
  /** Local value for legacy. */
  const legacy = manifest.licenses
    ?.map((item) => (typeof item === 'string' ? item : item?.type))
    .filter((item) => typeof item === 'string');
  if (legacy?.length === 1) {
    return legacy[0];
  }
  if (legacy?.length) {
    return `(${legacy.join(' OR ')})`;
  }
  return null;
}
/** Perform the inspect installed licenses operation.
 * @param {unknown} root - Input value for root.
 * @param {unknown} lock - Input value for lock.
 * @returns {unknown} Result produced by inspect installed licenses.
 */
export function inspectInstalledLicenses(root, lock) {
  /** Local value for checked. */
  const checked = [],
    missing = [],
    uninstalled = [],
    discrepancies = [],
    optionalNotInstalled = [],
    supplemented = [];
  /** Local value for catalog root. */
  const catalogRoot = path.join(root, 'third-party-licenses');
  let notices = [];
  /** Local value for catalog file. */
  const catalogFile = path.join(catalogRoot, 'manifest.json');
  if (fs.existsSync(catalogFile)) {
    try {
      /** Local value for catalog. */
      const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
      if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.entries)) {
        throw Error('Invalid notice catalog');
      }
      notices = catalog.entries;
    } catch {
      discrepancies.push({
        package: 'third-party-licenses',
        reason: 'Invalid supplemental notice catalog',
      });
    }
  }
  for (const [relative, entry] of Object.entries(lock.packages ?? {})) {
    if (!relative.startsWith('node_modules/') || entry.link) {
      continue;
    }
    /** Local value for dir. */
    const dir = path.resolve(root, relative);
    if (!dir.startsWith(path.resolve(root) + path.sep)) {
      discrepancies.push({
        package: relative,
        reason: 'Lockfile package path escapes workspace',
      });
      continue;
    }
    /** Local value for manifest path. */
    const manifestPath = path.join(dir, 'package.json');
    let manifest;
    try {
      manifest = JSON.parse(
        readRegularFileSync(manifestPath, 1024 * 1024).toString('utf8')
      );
    } catch (error) {
      if (error.code === 'ENOENT') {
        if (entry.optional === true || entry.devOptional === true) {
          optionalNotInstalled.push(relative);
        } else {
          uninstalled.push(relative);
        }
      } else {
        discrepancies.push({
          package: relative,
          reason: 'Invalid installed manifest',
        });
      }
      continue;
    }
    /** Local value for name. */
    const name = manifest.name ?? relative,
      license = declaredLicense(manifest);
    if (entry.version && manifest.version !== entry.version) {
      discrepancies.push({
        package: relative,
        reason: `Version ${manifest.version} differs from lock ${entry.version}`,
      });
    }
    /** Local value for files. */
    const files = fs.readdirSync(dir);
    /** Local value for license files. */
    const licenseFiles = files.filter(
      (item) =>
        licenseNames.test(item) &&
        fs.statSync(path.join(dir, item), { throwIfNoEntry: false })?.isFile()
    );
    if (!licenseFiles.length && license && license !== 'UNLICENSED') {
      /** Local value for notice. */
      const notice = notices.find(
        (item) =>
          item.name === name &&
          item.version === manifest.version &&
          item.license === license
      );
      if (notice) {
        /** Local value for valid path. */
        const validPath =
          typeof notice.file === 'string' &&
          /^notices\/[a-f0-9]{64}\.txt$/.test(notice.file);
        /** Local value for file. */
        const file = validPath ? path.join(catalogRoot, notice.file) : null;
        /** Local value for stat. */
        const stat = file
          ? fs.lstatSync(file, { throwIfNoEntry: false })
          : null;
        if (
          !stat?.isFile() ||
          !fs
            .realpathSync(file)
            .startsWith(fs.realpathSync(catalogRoot) + path.sep) ||
          !/^https:\/\/raw\.githubusercontent\.com\//.test(
            notice.source ?? ''
          ) ||
          crypto
            .createHash('sha256')
            .update(fs.readFileSync(file))
            .digest('hex') !== notice.sha256
        ) {
          discrepancies.push({
            package: name,
            reason:
              'Supplemental notice evidence is missing, unsafe or modified',
          });
        } else {
          /** Local value for relative notice. */
          const relativeNotice = path
            .relative(root, file)
            .split(path.sep)
            .join('/');
          licenseFiles.push(relativeNotice);
          supplemented.push({
            package: name,
            version: manifest.version,
            file: relativeNotice,
            source: notice.source,
          });
        }
      }
    }
    if (!license || license === 'UNLICENSED' || !licenseFiles.length) {
      let reason = 'Missing distributable license/notice file';
      if (!license) {
        reason = 'Missing installed license metadata';
      } else if (license === 'UNLICENSED') {
        reason = 'Unlicensed package';
      }
      missing.push({
        package: name,
        version: manifest.version ?? null,
        license,
        files: licenseFiles,
        reason,
      });
    }
    checked.push({
      name,
      version: manifest.version ?? null,
      license,
      files: licenseFiles,
    });
  }
  return {
    checked: checked.length,
    uninstalled,
    optionalNotInstalled,
    supplemented,
    discrepancies,
    missing,
    ok: !uninstalled.length && !discrepancies.length && !missing.length,
  };
}
