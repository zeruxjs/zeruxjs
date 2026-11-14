/**
 * Transactional Section 66 release gate. The checked-in workspace stays
 * untouched until registry-backed dependency installation, all package builds,
 * and smoke tests succeed in a clean, isolated source checkout.
 *
 * The npm CLI, not this module, resolves package versions and SRI hashes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { npmCommand } from './npm-command.ts';
import { createCleanWorkspaceSnapshot } from './workspace-snapshot.ts';
import { inspectWorkspaceLock } from './workspace-lock.ts';
import { inspectWorkspaceContracts } from './workspace-contracts.ts';
import { inspectPackageReleaseSecurity } from './workspace-security-audit.ts';
import { discoverWorkspaces } from './workspace-graph.ts';

/** Local value for release steps. */
const RELEASE_STEPS = Object.freeze([
  // Fail promptly and explicitly when the registry is unavailable. Without
  // this probe, npm's retry/DNS behavior can stall a clean-build gate for
  // many minutes before the actual source checks even begin.
  {
    name: 'Check npm registry connectivity',
    bin: 'npm',
    args: ['ping', '--fetch-retries=0', '--fetch-timeout=6000'],
    timeout: 15_000,
  },
  {
    name: 'Resolve third-party dependency lockfile',
    bin: 'npm',
    args: [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--fetch-retries=1',
    ],
    timeout: 900_000,
  },
  {
    name: 'Verify resolved lockfile',
    bin: 'npm',
    args: ['run', 'deps:check'],
    timeout: 120_000,
  },
  {
    name: 'Verify package contracts',
    bin: 'npm',
    args: ['run', 'contracts:check'],
    timeout: 120_000,
  },
  {
    name: 'Clean dependency install',
    bin: 'npm',
    args: ['ci', '--no-audit', '--no-fund', '--fetch-retries=1'],
    timeout: 1_200_000,
  },
  {
    name: 'Online production advisory gate',
    bin: 'npm',
    args: ['run', 'security:online'],
    timeout: 240_000,
  },
  {
    name: 'Build all workspaces',
    bin: 'npm',
    args: ['run', 'build:workspaces'],
    timeout: 2_700_000,
  },
  {
    name: 'Verify packed npm artifact contents',
    bin: 'npm',
    args: ['run', 'release:pack'],
    timeout: 240_000,
  },
  {
    name: 'Run workspace tooling tests',
    bin: 'npm',
    args: ['run', 'test:workspace-tools'],
    timeout: 240_000,
  },
  {
    name: 'Run framework lifecycle tests',
    bin: 'node',
    args: [
      '--test',
      'packages/zeruxjs/test/fetch-route.test.ts',
      'packages/zeruxjs/test/services-lifecycle.test.ts',
      'packages/zeruxjs/test/variables.test.ts',
    ],
    timeout: 240_000,
  },
]);

/** Perform the hash file operation.
 * @param {unknown} file - Input value for file.
 * @returns {unknown} Result produced by hash file.
 */
function hashFile(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

/** Perform the default run operation.
 * @param {unknown} step - Input value for step.
 * @param {unknown} cwd - Input value for cwd.
 * @returns {unknown} Result produced by default run.
 */
function defaultRun(step, cwd) {
  /** Local value for invocation. */
  const invocation =
    step.bin === 'node'
      ? {
          command: process.execPath,
          args: ['--experimental-strip-types', ...step.args],
        }
      : npmCommand(step.args);
  /** Local value for result. */
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    stdio: 'inherit',
    timeout: step.timeout,
    env: {
      ...process.env,
      CI: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
  });
  if (result.error) {
    throw new Error(
      `${step.name}: ${result.error.message}${step.name === 'Check npm registry connectivity' ? ' (clean install cannot be certified without registry access)' : ''}`
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `${step.name}: exit ${result.status ?? result.signal ?? 'unknown'}${step.name === 'Check npm registry connectivity' ? '; supply working registry access before retrying' : ''}`
    );
  }
}

/** Perform the verify manifests unchanged operation.
 * @param {unknown} original - Input value for original.
 * @param {unknown} staged - Input value for staged.
 * @returns {unknown} Result produced by verify manifests unchanged.
 */
function verifyManifestsUnchanged(original, staged) {
  /** Local value for original root. */
  const originalRoot = path.join(original, 'package.json');
  if (hashFile(originalRoot) !== hashFile(path.join(staged, 'package.json'))) {
    throw new Error(
      'npm changed the root package manifest; refusing to commit a mismatched lockfile'
    );
  }
  for (const { dir } of discoverWorkspaces(original).values()) {
    /** Local value for relative. */
    const relative = path.relative(original, dir);
    if (
      hashFile(path.join(dir, 'package.json')) !==
      hashFile(path.join(staged, relative, 'package.json'))
    ) {
      throw new Error(`npm changed a workspace manifest: ${relative}`);
    }
  }
}

/**
 * Finalize the workspace release operation after validating the staged lockfile.
 *
 * @param {string} root - Workspace root with package.json and package-lock.json.
 * @param {{run?: (step: {name: string, bin: string, args: string[], timeout: number}, cwd: string) => void, keepOnFailure?: boolean, writeLock?: boolean, onStep?: (name: string) => void}} options - Release execution options.
 * @returns {void} Completes after the staged release operation is finalized.
 */
export function finalizeWorkspaceRelease(root, options = {}) {
  /** Local value for source. */
  const source = path.resolve(root);
  /** Local value for current lock. */
  const currentLock = path.join(source, 'package-lock.json');
  /** Local value for before lock. */
  const beforeLock = hashFile(currentLock);
  /** Local value for before manifest. */
  const beforeManifest = hashFile(path.join(source, 'package.json'));
  /** Local value for source contracts. */
  const sourceContracts = inspectWorkspaceContracts(source);
  if (!sourceContracts.ok) {
    throw new Error(
      `Source package exports are invalid: ${JSON.stringify(sourceContracts.problems)}`
    );
  }
  /** Local value for security. */
  const security = inspectPackageReleaseSecurity(source);
  if (!security.ok) {
    throw new Error(
      `Offline security/API freeze violations: ${JSON.stringify(security.issues)}`
    );
  }
  /** Local value for tmp. */
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), 'zerux-section66-release-')
  );
  /** Local value for stage. */
  const stage = path.join(tmp, 'checkout');
  let passed = false;
  try {
    createCleanWorkspaceSnapshot(source, stage);
    for (const step of RELEASE_STEPS) {
      options.onStep?.(step.name);
      (options.run ?? defaultRun)(step, stage);
      if (step.bin === 'npm' && step.args[0] === 'install') {
        verifyManifestsUnchanged(source, stage);
        /** Local value for deps. */
        const deps = inspectWorkspaceLock(stage);
        if (!deps.ok) {
          throw new Error(
            `Resolved lockfile failed verification: ${JSON.stringify(deps)}`
          );
        }
      }
    }
    verifyManifestsUnchanged(source, stage);
    /** Local value for deps. */
    const deps = inspectWorkspaceLock(stage);
    /** Local value for contracts. */
    const contracts = inspectWorkspaceContracts(stage);
    if (!deps.ok || !contracts.ok || !inspectPackageReleaseSecurity(stage).ok) {
      throw new Error(
        'Post-build lockfile, security/API freeze or package export checks failed'
      );
    }
    if (
      hashFile(currentLock) !== beforeLock ||
      hashFile(path.join(source, 'package.json')) !== beforeManifest
    ) {
      throw new Error(
        'Source changed during verification; refusing to overwrite the package-lock.json'
      );
    }
    // Commit only after the full clean release gate succeeds. The staged
    // lockfile is already generated by npm and checked for integrity metadata.
    if (options.writeLock !== false) {
      /** Local value for pending. */
      const pending = path.join(
        source,
        `.package-lock.section66-${process.pid}-${crypto.randomBytes(5).toString('hex')}.tmp`
      );
      try {
        fs.copyFileSync(path.join(stage, 'package-lock.json'), pending);
        fs.renameSync(pending, currentLock);
      } finally {
        fs.rmSync(pending, { force: true });
      }
    }
    passed = true;
    return {
      ok: true,
      checks: RELEASE_STEPS.map((step) => step.name),
      lockfileWritten: options.writeLock !== false,
    };
  } finally {
    if (!passed && options.keepOnFailure) {
      process.stderr.write(`[release] Failed checkout retained at ${stage}\n`);
    } else {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

export { RELEASE_STEPS };
