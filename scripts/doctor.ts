#!/usr/bin/env node
/** Read-only offline developer environment diagnostic, not a release certificate. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectWorkspaceLock } from './workspace-lock.ts';
import { inspectWorkspaceContracts } from './workspace-contracts.ts';
import { discoverWorkspaces, planWorkspaces } from './workspace-graph.ts';

/**
 * Collect offline source, lockfile, and build-plan diagnostics.
 *
 * @param {string} root - Repository root to inspect without mutating.
 * @returns {{node: string, platform: string, architecture: string, workspaces: number, plannedBuilds: number, sourceContracts: {ok: boolean, problems: object[]}, lock: object, readyForCleanInstall: boolean, note: string}} Diagnostic report.
 */
/** Perform the inspect developer workspace operation.
 * @param {unknown} root - Input value for root.
 * @returns {unknown} Result produced by inspect developer workspace.
 */
export function inspectDeveloperWorkspace(root: string) {
  /** Source and lock diagnostics are intentionally separate so failures remain actionable. */
  const lock = inspectWorkspaceLock(root);
  /** Local value for contracts. */
  const contracts = inspectWorkspaceContracts(root);
  /** Local value for entries. */
  const entries = discoverWorkspaces(root);
  /** Local value for plan. */
  const plan = planWorkspaces(entries);
  return {
    node: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    workspaces: entries.size,
    plannedBuilds: plan.ordered.length,
    sourceContracts: { ok: contracts.ok, problems: contracts.problems },
    lock: {
      ok: lock.ok,
      staleMetadata: lock.staleWorkspaceMetadata,
      unresolvedExternal: lock.unresolvedExternal,
      missingDependencyEdges: lock.missingDependencies,
      malformedEntries: lock.malformedEntries,
      insecureResolutions: lock.insecureResolutions,
    },
    readyForCleanInstall: lock.ok && contracts.ok,
    note: 'Offline source and lock diagnostics only. Clean npm ci, builds, test execution and live services require separate verification.',
  };
}
/**
 * Run the developer diagnostic CLI with human-readable or JSON output.
 *
 * @param {string[]} argv - Supported command-line flags.
 * @param {string} root - Repository root to inspect.
 * @param {(message: string) => void} log - Output sink for successful diagnostics.
 * @param {(message: string) => void} errorLog - Output sink for invalid input and failures.
 * @returns {number} Process exit code; strict mode fails when clean-install readiness is false.
 */
/** Perform the doctor main operation.
 * @param {unknown} argv - Input value for argv.
 * @param {unknown} root - Input value for root.
 * @param {unknown} log - Input value for log.
 * @param {unknown} errorLog - Input value for error log.
 * @returns {unknown} Result produced by doctor main.
 */
export function doctorMain(
  argv: string[] = [],
  root: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  log: (message: string) => void = console.log,
  errorLog: (message: string) => void = console.error
) {
  if (argv.some((v) => !['--json', '--strict'].includes(v))) {
    errorLog('Usage: node --experimental-strip-types scripts/doctor.ts [--json] [--strict]');
    return 2;
  }
  try {
    /** Local value for report. */
    const report = inspectDeveloperWorkspace(root);
    if (argv.includes('--json')) {
      log(JSON.stringify(report, null, 2));
    } else {
      log(
        `[doctor] Node ${report.node} / ${report.platform}-${report.architecture}`
      );
      log(
        `[doctor] ${report.workspaces} workspaces; ${report.plannedBuilds} build targets; source contracts: ${report.sourceContracts.ok ? 'PASS' : 'FAIL'}`
      );
      log(
        `[doctor] Lockfile: ${report.lock.ok ? 'PASS' : 'BLOCKED'} (${report.lock.unresolvedExternal.length} unresolved third-party packages)`
      );
      log(
        '[doctor] This diagnostic does not run npm ci, TypeScript builds, browsers, or live provider tests.'
      );
    }
    return argv.includes('--strict') && !report.readyForCleanInstall ? 1 : 0;
  } catch (error) {
    errorLog(
      `[doctor] ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = doctorMain(process.argv.slice(2));
}
