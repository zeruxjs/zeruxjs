#!/usr/bin/env node
/** Strict result from GitHub's required release matrix and live-lab jobs.
 * This script does NOT publish, sign or approve an npm version.
 * `GO` means the CI evidence permits a maintainer release review, not that
 * any package was published. A local invocation cannot create GitHub evidence.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { discoverWorkspaces } from './workspace-graph.mjs';
import { planPublicReleasesFromRoot } from './workspace-release-plan.mjs';

export function makeReleaseDecision({ root, env = process.env } = {}) {
  const failures = [];
  const requiredSuccess = (field, label) => {
    if (env[field] !== 'success') failures.push(`${label} is ${env[field] || 'missing'} (must be success)`);
  };
  requiredSuccess('MATRIX_RESULT', 'six-platform public-package matrix');
  requiredSuccess('LAB_RESULT', 'full real-provider/browser lab');
  if (env.RUN_FULL_LAB !== 'true') failures.push('full lab was not explicitly requested');
  if (env.CI_GITHUB_REF !== 'refs/heads/master') failures.push('approval must be from the protected master branch');
  if (env.GITHUB_ACTIONS !== 'true') failures.push('must be evaluated in GitHub Actions, not a local shell');
  const plan = planPublicReleasesFromRoot(root);
  if (!plan.ok) failures.push(`public dependency graph failed: ${plan.issues.length} problem(s)`);
  const publicPackages = [...discoverWorkspaces(root).values()].filter(({ pkg }) => pkg.private !== true);
  if (publicPackages.length !== 13) failures.push(`expected 13 approved candidates, found ${publicPackages.length}`);
  for (const item of publicPackages) {
    if (!/^\d+\.\d+\.\d+$/.test(item.pkg.version ?? '')) {
      failures.push(`${item.name} is not a reviewed stable semver candidate (${item.pkg.version ?? 'missing'})`);
    }
  }
  const decision = failures.length ? 'NO_GO' : 'GO_FOR_MAINTAINER_REVIEW';
  return { schemaVersion: 1, decision, releaseReady: !failures.length,
    commit: env.GITHUB_SHA || null, githubRunId: env.GITHUB_RUN_ID || null,
    evidence: { matrix: env.MATRIX_RESULT || null, fullLab: env.LAB_RESULT || null,
      master: env.CI_GITHUB_REF === 'refs/heads/master', githubActions: env.GITHUB_ACTIONS === 'true' },
    publicPackageCount: publicPackages.length, issues: failures, published: false,
    note: 'Requires explicit npm trusted-publisher setup and a separate protected manual publish approval.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== '--json')) {
    console.error('Usage: node scripts/ci-release-decision.mjs [--json]'); process.exit(2);
  }
  const result = makeReleaseDecision({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') });
  console.log(JSON.stringify(result, null, 2));
  if (!result.releaseReady) process.exitCode = 1;
}
