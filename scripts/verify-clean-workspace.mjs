#!/usr/bin/env node
/** Non-destructive clean-workspace install/build smoke verification. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectWorkspaceLock } from './workspace-lock.mjs';
import { inspectWorkspaceContracts } from './workspace-contracts.mjs';
import { inspectPackageReleaseSecurity } from './workspace-security-audit.mjs';
import { createCleanWorkspaceSnapshot } from './workspace-snapshot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const allowed = new Set(['--offline', '--keep-on-failure']);
if (args.some(arg => !allowed.has(arg))) {
  console.error('Usage: npm run verify:clean -- [--offline] [--keep-on-failure]');
  process.exit(2);
}
const contracts = inspectWorkspaceContracts(root);
if (!contracts.ok) {
  console.error(`[clean] Invalid package source exports: ${JSON.stringify(contracts.problems)}`);
  process.exit(1);
}
const security = inspectPackageReleaseSecurity(root);
if (!security.ok) { console.error(`[clean] Offline security/API freeze violations: ${JSON.stringify(security.issues)}`); process.exit(1); }
const report = inspectWorkspaceLock(root);
if (!report.ok) {
  console.error('[clean] Cannot verify: package-lock.json is incomplete. Run npm run deps:check for details.');
  process.exit(1);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-workspaces-clean-'));
const dest = path.join(tmp, 'workspace');
let success = false;
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (label, executable, args, timeoutMs = 10 * 60_000) => {
  console.log(`[clean] ${label}`);
  const result = spawnSync(executable, args, { cwd: dest, stdio: 'inherit', timeout: timeoutMs, env: { ...process.env, CI: 'true', npm_config_audit: 'false', npm_config_fund: 'false' } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status ?? result.signal})`);
};
try {
  // Snapshot the entire source checkout, including the application and its
  // root configuration. Never copy local credentials, dist, or node_modules.
  const snapshot = createCleanWorkspaceSnapshot(root, dest);
  console.log(`[clean] Copied ${snapshot.copiedFiles} clean source files`);
  const installArgs = ['ci', '--no-audit', '--no-fund', '--fetch-retries=0'];
  if (args.includes('--offline')) installArgs.push('--offline');
  run('npm ci', command, installArgs);
  if (!args.includes('--offline')) run('online production advisory gate', command, ['run', 'security:online'], 240_000);
  run('installed third-party license artifact metadata inspection', command, ['run', 'license:installed']);
  run('workspace artifact build', command, ['run', 'build:workspaces'], 45 * 60_000);
  run('real public npm tarball consumer (runtime and types)', command, ['run', 'release:public:consumer']);
  run('npm tarball exports, licenses and published-dependency graph', command, ['run', 'release:pack']);
  run('workspace tooling regression tests', command, ['run', 'test:workspace-tools']);
  run('framework lifecycle smoke tests', process.execPath, [
    '--test', 'packages/zeruxjs/test/fetch-route.test.mjs',
    'packages/zeruxjs/test/services-lifecycle.test.mjs',
    'packages/zeruxjs/test/variables.test.mjs'
  ]);
  success = true;
  console.log(args.includes('--offline') ? '[clean] PASS: offline install/build smoke only; online advisory gate NOT run.' : '[clean] PASS: clean npm ci, production advisory check, all workspace builds, and framework smoke tests.');
} catch (error) {
  console.error(`[clean] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (!success && args.includes('--keep-on-failure')) console.error(`[clean] Inspect temporary checkout: ${dest}`);
  else fs.rmSync(tmp, { recursive: true, force: true });
}
