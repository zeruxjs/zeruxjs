#!/usr/bin/env node
/** Non-destructive clean-workspace install/build smoke verification. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectWorkspaceLock } from './workspace-lock.ts';
import { inspectWorkspaceContracts } from './workspace-contracts.ts';
import { inspectPackageReleaseSecurity } from './workspace-security-audit.ts';
import { createCleanWorkspaceSnapshot } from './workspace-snapshot.ts';

/** Local value for root. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Local value for args. */
const args = process.argv.slice(2);
/** Local value for allowed. */
const allowed = new Set(['--offline', '--keep-on-failure']);
if (args.some((arg) => !allowed.has(arg))) {
  console.error(
    'Usage: npm run verify:clean -- [--offline] [--keep-on-failure]'
  );
  process.exit(2);
}
/** Local value for contracts. */
const contracts = inspectWorkspaceContracts(root);
if (!contracts.ok) {
  console.error(
    `[clean] Invalid package source exports: ${JSON.stringify(contracts.problems)}`
  );
  process.exit(1);
}
/** Local value for security. */
const security = inspectPackageReleaseSecurity(root);
if (!security.ok) {
  console.error(
    `[clean] Offline security/API freeze violations: ${JSON.stringify(security.issues)}`
  );
  process.exit(1);
}
/** Local value for report. */
const report = inspectWorkspaceLock(root);
if (!report.ok) {
  console.error(
    '[clean] Cannot verify: package-lock.json is incomplete. Run npm run deps:check for details.'
  );
  process.exit(1);
}
/** Local value for tmp. */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-workspaces-clean-'));
/** Local value for dest. */
const dest = path.join(tmp, 'workspace');
let success = false;
/** Local value for command. */
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
/**
 * Run the run callback.
 * @param {unknown} label - Input value for label.
 * @param {unknown} executable - Input value for executable.
 * @param {unknown} args - Input value for args.
 * @param {unknown} timeoutMs - Input value for timeout ms.
 * @returns {unknown} Result produced by run.
 * @throws {Error} If the callback rejects or validation fails.
 */
const run = (label, executable, args, timeoutMs = 10 * 60_000) => {
  console.log(`[clean] ${label}`);
  /** Local value for result. */
  const result = spawnSync(executable, args, {
    cwd: dest,
    stdio: 'inherit',
    timeout: timeoutMs,
    env: {
      ...process.env,
      CI: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status ?? result.signal})`);
  }
};
try {
  // Snapshot the entire source checkout, including the application and its
  // root configuration. Never copy local credentials, dist, or node_modules.
  /** Local value for snapshot. */
  const snapshot = createCleanWorkspaceSnapshot(root, dest);
  console.log(`[clean] Copied ${snapshot.copiedFiles} clean source files`);
  /** Local value for install args. */
  const installArgs = ['ci', '--no-audit', '--no-fund', '--fetch-retries=0'];
  if (args.includes('--offline')) {
    installArgs.push('--offline');
  }
  run('npm ci', command, installArgs);
  if (!args.includes('--offline')) {
    run(
      'online production advisory gate',
      command,
      ['run', 'security:online'],
      240_000
    );
  }
  run('installed third-party license artifact metadata inspection', command, [
    'run',
    'license:installed',
  ]);
  run(
    'workspace artifact build',
    command,
    ['run', 'build:workspaces'],
    45 * 60_000
  );
  run('real public npm tarball consumer (runtime and types)', command, [
    'run',
    'release:public:consumer',
  ]);
  run('npm tarball exports, licenses and published-dependency graph', command, [
    'run',
    'release:pack',
  ]);
  run('workspace tooling regression tests', command, [
    'run',
    'test:workspace-tools',
  ]);
  run('framework lifecycle smoke tests', process.execPath, [
    '--experimental-strip-types',
    '--test',
    'packages/zeruxjs/test/fetch-route.test.ts',
    'packages/zeruxjs/test/services-lifecycle.test.ts',
    'packages/zeruxjs/test/variables.test.ts',
  ]);
  success = true;
  console.log(
    args.includes('--offline')
      ? '[clean] PASS: offline install/build smoke only; online advisory gate NOT run.'
      : '[clean] PASS: clean npm ci, production advisory check, all workspace builds, and framework smoke tests.'
  );
} catch (error) {
  console.error(
    `[clean] FAIL: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
} finally {
  if (!success && args.includes('--keep-on-failure')) {
    console.error(`[clean] Inspect temporary checkout: ${dest}`);
  } else {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
