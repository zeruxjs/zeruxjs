import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectOwnedPackageVersions } from './workspace-version-policy.mjs';

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-owned-versions-'));
  const save = (filename, value) => {
    const file = path.join(root, filename);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  };
  try {
    save('packages/core/package.json', { name: '@zeruxjs/core', version: '0.0.1' });
    save('packages/@zenixjs/core/package.json', { name: '@zenixjs/core', version: '0.0.1', private: true });
    save('apps/sample/package.json', { name: 'sample', version: '1.0.0', dependencies: { '@zeruxjs/core': '0.0.1', 'third-party': '^9.0.0' } });
    run(root, save);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('owned versions include nested private packages but exclude application and third-party versions', () => {
  withFixture(root => {
    const report = inspectOwnedPackageVersions(root);
    assert.equal(report.ok, true);
    assert.equal(report.packageCount, 2);
  });
});

test('a prerelease owned package version is rejected', () => {
  withFixture((root, save) => {
    save('packages/core/package.json', { name: '@zeruxjs/core', version: '0.0.1-alpha.2' });
    assert.ok(inspectOwnedPackageVersions(root).issues.some(item => item.issue === 'owned package version mismatch'));
  });
});

test('application references to owned packages must be exact, not wildcard', () => {
  withFixture((root, save) => {
    save('apps/sample/package.json', { name: 'sample', version: '1.0.0', dependencies: { '@zeruxjs/core': '*' } });
    assert.ok(inspectOwnedPackageVersions(root).issues.some(item => item.issue === 'owned dependency version mismatch'));
  });
});

test('independent stable version bumps require matching internal references',()=>{
  withFixture((root,save)=>{
    save('packages/core/package.json',{name:'@zeruxjs/core',version:'0.0.2'});
    assert.equal(inspectOwnedPackageVersions(root).ok,false);
    save('apps/sample/package.json',{name:'sample',version:'1.0.0',dependencies:{'@zeruxjs/core':'0.0.2'}});
    assert.equal(inspectOwnedPackageVersions(root).ok,true);
    assert.equal(inspectOwnedPackageVersions(root,'0.0.1').ok,false);
  });
});
