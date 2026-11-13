#!/usr/bin/env node
/**
 * Offline source-only preflight in an isolated source snapshot.
 * Does NOT install dependencies, compile packages or certify production builds.
 * Use `verify:clean` for that stricter release gate.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectWorkspaceLock } from './workspace-lock.mjs';
import { discoverWorkspaces } from './workspace-graph.mjs';
import { inspectWorkspaceContracts } from './workspace-contracts.mjs';
import { inspectPackageReleaseSecurity } from './workspace-security-audit.mjs';
import { createCleanWorkspaceSnapshot } from './workspace-snapshot.mjs';

/** Local value for root. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Local value for args. */
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--keep-on-failure')) {
  console.error('Usage: npm run verify:source -- [--keep-on-failure]');
  process.exit(2);
}
/** Local value for tmp. */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-source-preflight-'));
/** Local value for dest. */
const dest = path.join(tmp, 'source');
let passed = false;
try {
  /** Local value for snapshot. */
  const snapshot = createCleanWorkspaceSnapshot(root, dest);
  /**
   * Run the run callback.
   * @param {unknown} label - Input value for label.
   * @param {unknown} commandArgs - Input value for command args.
   * @param {unknown} root2 - Input value for root2.
   * @param {unknown} root2.json - Input value for json.
   * @returns {unknown} Result produced by run.
   * @throws {Error} If the callback rejects or validation fails.
   */
  const run = (label, commandArgs, { json = false } = {}) => {
    /** Local value for result. */
    const result = spawnSync(process.execPath, commandArgs, {
      cwd: dest,
      encoding: 'utf8',
      timeout: 120_000,
    });
    if (result.error || result.status !== 0) {
      // Node's test reporter writes failures to stdout; an empty stderr must not hide them.
      /** Local value for details. */
      const details = [
        result.error?.message,
        result.stderr?.trim(),
        result.stdout?.trim(),
      ]
        .filter(Boolean)
        .join('\n');
      throw new Error(
        `${label} (exit ${result.status}, signal ${result.signal ?? 'none'}):\n${details}`
      );
    }
    if (!json) {
      process.stdout.write(result.stdout);
    }
    return result.stdout;
  };
  run('owned package version policy', ['scripts/check-package-versions.mjs']);
  /** Local value for test output. */
  const testOutput = run('workspace tool regressions', [
    '--test',
    '--test-reporter=tap',
    'scripts/workspace-build.test.mjs',
    'scripts/workspace-lock.test.mjs',
    'scripts/workspace-snapshot.test.mjs',
    'scripts/workspace-contracts.test.mjs',
    'scripts/workspace-release.test.mjs',
    'scripts/doctor.test.mjs',
    'scripts/workspace-api-freeze.test.mjs',
    'scripts/workspace-security-audit.test.mjs',
    'scripts/workspace-package-release.test.mjs',
    'scripts/workspace-public-consumer.test.mjs',
    'scripts/integration-lab-core.test.mjs',
    'scripts/workspace-installed-licenses.test.mjs',
    'scripts/workspace-version-policy.test.mjs',
  ]);
  /** Local value for build. */
  const build = JSON.parse(
    run(
      'workspace build order',
      ['scripts/build-workspaces.mjs', '--dry-run', '--json'],
      { json: true }
    )
  );
  /** Local value for report. */
  const report = inspectWorkspaceLock(dest);
  /** Local value for contracts. */
  const contracts = inspectWorkspaceContracts(dest);
  /** Local value for security. */
  const security = inspectPackageReleaseSecurity(dest);
  if (!security.ok) {
    throw new Error(
      `Offline package security preflight: ${JSON.stringify(security.issues)}`
    );
  }
  if (!contracts.ok) {
    throw new Error(
      `Package source contract violations: ${JSON.stringify(contracts.problems)}`
    );
  }
  if (
    report.staleWorkspaceMetadata ||
    report.malformedEntries.length ||
    report.insecureResolutions.length
  ) {
    throw new Error('Source lock metadata failed structural checks');
  }
  /** Local value for buildable count. */
  const buildableCount = [...discoverWorkspaces(dest).values()].filter(
    (entry) => !!entry.pkg.scripts?.build
  ).length;
  if (
    !Array.isArray(build.planned) ||
    build.planned.length !== buildableCount
  ) {
    throw new Error(
      `Build plan missing a buildable package: ${build.planned?.length} of ${buildableCount}`
    );
  }
  passed = true;
  /** Local value for passed count. */
  const passedCount = Number(testOutput.match(/# pass (\d+)/)?.[1] ?? 0);
  console.log(
    `[source] PASS: ${snapshot.copiedFiles} isolated source files, ${report.workspaceCount} package contracts, ${build.planned.length} build targets, ${passedCount} tool tests`
  );
  if (!report.ok) {
    console.log(
      `[source] UNRESOLVED: ${report.unresolvedExternal.length} external packages; npm ci/full build NOT verified`
    );
  }
  console.log(
    '[source] API freeze + offline supply-chain structural review: PASS (online advisories/scan NOT run)'
  );
  console.log(
    '[source] This command is a source-only preflight; run verify:clean before production release.'
  );
} catch (error) {
  console.error(
    `[source] FAIL: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
} finally {
  if (!passed && args.includes('--keep-on-failure')) {
    console.error(`[source] Inspect: ${dest}`);
  } else {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
