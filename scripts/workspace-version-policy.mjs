import fs from 'node:fs';
import path from 'node:path';

/** Check every owned package, including packages nested outside root npm workspaces. */
export function inspectOwnedPackageVersions(root, expectedVersion = '0.0.1') {
  const packageRoot = path.join(root, 'packages');
  const manifests = [];
  function visit(folder) {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      const directory = path.join(folder, entry.name);
      const manifest = path.join(directory, 'package.json');
      if (fs.existsSync(manifest)) manifests.push(manifest);
      else visit(directory);
    }
  }
  visit(packageRoot);
  const issues = [], packages = new Map();
  for (const file of manifests) {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    const location = path.relative(root, file).split(path.sep).join('/');
    if (!pkg.name || packages.has(pkg.name)) {
      issues.push({ file: location, issue: 'missing or duplicate package name' });
      continue;
    }
    packages.set(pkg.name, { file: location, version: pkg.version });
    if (pkg.version !== expectedVersion) {
      issues.push({ file: location, issue: 'owned package version mismatch', found: pkg.version ?? null, expected: expectedVersion });
    }
  }
  for (const file of [...manifests, ...fs.readdirSync(path.join(root, 'apps'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(root, 'apps', entry.name, 'package.json'))
    .filter(file => fs.existsSync(file))]) {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    const location = path.relative(root, file).split(path.sep).join('/');
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, version] of Object.entries(pkg[field] ?? {})) {
        if (packages.has(name) && version !== expectedVersion) {
          issues.push({ file: location, field, dependency: name, found: version, expected: expectedVersion, issue: 'owned dependency version mismatch' });
        }
      }
    }
  }
  return { ok: issues.length === 0, expectedVersion, packageCount: packages.size, issues };
}
