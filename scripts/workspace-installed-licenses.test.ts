import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { inspectInstalledLicenses } from './workspace-installed-licenses.ts';
test('installed license review requires matching package manifests and notice files', (t) => {
  /** Local value for root. */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'installed-license-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  /** Local value for p. */
  const p = path.join(root, 'node_modules', 'sample');
  fs.mkdirSync(p, { recursive: true });
  /** Local value for lock. */
  const lock = {
    packages: {
      'node_modules/sample': { version: '1.2.3' },
      'node_modules/missing': { version: '1.0.0' },
      'node_modules/local': { link: true },
    },
  };
  fs.writeFileSync(
    path.join(p, 'package.json'),
    JSON.stringify({ name: 'sample', version: '1.2.3', license: 'MIT' })
  );
  let result = inspectInstalledLicenses(root, lock);
  assert.equal(result.uninstalled.length, 1);
  assert.equal(result.missing.length, 1);
  assert.equal(result.ok, false);
  fs.writeFileSync(path.join(p, 'LICENSE-MIT'), 'MIT license terms');
  result = inspectInstalledLicenses(root, {
    packages: { 'node_modules/sample': { version: '1.2.3' } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.checked, 1);
  /** Local value for optional. */
  const optional = inspectInstalledLicenses(root, {
    packages: {
      'node_modules/sample': { version: '1.2.3' },
      'node_modules/platform-binary': { version: '1.0.0', optional: true },
    },
  });
  assert.equal(optional.ok, true);
  assert.deepEqual(optional.optionalNotInstalled, [
    'node_modules/platform-binary',
  ]);
  fs.writeFileSync(
    path.join(p, 'package.json'),
    JSON.stringify({
      name: 'sample',
      version: '1.2.3',
      licenses: [{ type: 'MIT' }],
    })
  );
  assert.equal(
    inspectInstalledLicenses(root, {
      packages: { 'node_modules/sample': { version: '1.2.3' } },
    }).ok,
    true
  );
  fs.writeFileSync(
    path.join(p, 'package.json'),
    JSON.stringify({ name: 'sample', version: '1.2.3', license: 'MIT' })
  );
  result = inspectInstalledLicenses(root, {
    packages: { 'node_modules/sample': { version: '1.2.4' } },
  });
  assert.equal(result.discrepancies.length, 1);
  /** Local value for escaped. */
  const escaped = inspectInstalledLicenses(root, {
    packages: { 'node_modules/../../../elsewhere': { version: '1.0.0' } },
  });
  assert.equal(escaped.discrepancies.length, 1);
});
test('invalid installed package.json and unlicensed packages fail closed', (t) => {
  /** Local value for root. */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'installed-license-bad-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  /** Local value for dir. */
  const dir = path.join(root, 'node_modules', 'bad');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{broken');
  /** Local value for lock. */
  const lock = { packages: { 'node_modules/bad': { version: '2.0.0' } } };
  assert.equal(inspectInstalledLicenses(root, lock).discrepancies.length, 1);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'bad', version: '2.0.0' })
  );
  assert.equal(inspectInstalledLicenses(root, lock).missing.length, 1);
  // Exact version bindings and immutable contents are required for supplemental evidence.
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'bad', version: '2.0.0', license: 'MIT' })
  );
  /** Local value for catalog. */
  const catalog = path.join(root, 'third-party-licenses');
  fs.mkdirSync(path.join(catalog, 'notices'), { recursive: true });
  /** Local value for terms. */
  const terms = 'Upstream full notice fixture';
  /** Local value for sha256. */
  const sha256 = crypto.createHash('sha256').update(terms).digest('hex');
  /** Local value for file. */
  const file = `notices/${sha256}.txt`;
  fs.writeFileSync(path.join(catalog, file), terms);
  /** Local value for entry. */
  const entry = {
    name: 'bad',
    version: '2.0.0',
    license: 'MIT',
    file,
    sha256,
    source: 'https://raw.githubusercontent.com/example/project/commit/LICENSE',
  };
  /**
   * Run the save callback.
   * @returns {unknown} Result produced by save.
   */
  const save = () =>
    fs.writeFileSync(
      path.join(catalog, 'manifest.json'),
      JSON.stringify({ schemaVersion: 1, entries: [entry] })
    );
  save();
  assert.equal(inspectInstalledLicenses(root, lock).ok, true);
  entry.version = '2.0.1';
  save();
  assert.equal(inspectInstalledLicenses(root, lock).ok, false);
  entry.version = '2.0.0';
  save();
  fs.appendFileSync(path.join(catalog, file), 'tampered');
  assert.equal(inspectInstalledLicenses(root, lock).discrepancies.length, 1);
});
