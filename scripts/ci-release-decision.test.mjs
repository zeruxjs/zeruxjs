import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { makeReleaseDecision } from './ci-release-decision.mjs';

function fixture(fn) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zerux-ci-verdict-'));
  try {
    mkdirSync(path.join(root, 'packages'), { recursive: true });
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
    for (let i = 0; i < 13; i++) {
      const dir = path.join(root, 'packages', 'p' + i);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: `p${i}`, version: '1.0.0', main: './dist/index.js' }));
    }
    return fn(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const allGreen = { MATRIX_RESULT: 'success', LAB_RESULT: 'success', RUN_FULL_LAB: 'true',
  CI_GITHUB_REF: 'refs/heads/master', GITHUB_ACTIONS: 'true' };

test('final verdict requires every independent proof, including live lab and protected master', () => fixture(root => {
  for (const [key, value] of Object.entries({ MATRIX_RESULT: 'failure', LAB_RESULT: 'skipped',
    RUN_FULL_LAB: 'false', CI_GITHUB_REF: 'refs/heads/dev', GITHUB_ACTIONS: 'false' })) {
    const result = makeReleaseDecision({ root, env: { ...allGreen, [key]: value } });
    assert.equal(result.releaseReady, false, key);
    assert.equal(result.decision, 'NO_GO');
  }
  const result = makeReleaseDecision({ root, env: allGreen });
  assert.equal(result.releaseReady, true);
  assert.equal(result.published, false);
}));

test('alpha version and missing candidate prevent the GO verdict', () => fixture(root => {
  const file = path.join(root, 'packages/p2/package.json');
  writeFileSync(file, JSON.stringify({ name: 'p2', version: '0.0.1-alpha.1' }));
  assert.equal(makeReleaseDecision({root,env:allGreen}).releaseReady, false);
  writeFileSync(file, JSON.stringify({ name: 'p2', version: '1.0.0', private: true }));
  const report = makeReleaseDecision({root,env:allGreen});
  assert.equal(report.publicPackageCount, 12);
  assert.equal(report.releaseReady, false);
}));
