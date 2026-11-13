import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  discoverWorkspaces,
  planWorkspaces,
  executeWorkspacePlan,
  DEFAULT_BUILD_CONCURRENCY,
} from './workspace-graph.mjs';
import { npmCommand } from './npm-command.mjs';

/**
 * Parse the workspace build command's bounded selection and timeout options.
 *
 * @param {string[]} args - Command-line arguments excluding the executable and script name.
 * @returns {{scopes: string[], dryRun: boolean, verify: boolean, includeDependents: boolean, concurrency: number, timeoutMs: number, json: boolean}} Validated build options.
 * @throws {Error} If an option is unknown, missing, or outside its supported range.
 */
/** Perform the parse build options operation.
 * @param {unknown} args - Input value for args.
 * @returns {unknown} Result produced by parse build options.
 */
export function parseBuildOptions(args) {
  /** Mutable command options populated before final range validation. */
  const options = {
    scopes: [],
    dryRun: false,
    verify: false,
    includeDependents: false,
    concurrency: DEFAULT_BUILD_CONCURRENCY,
    timeoutMs: 300_000,
    json: false,
  };
  for (let i = 0; i < args.length; i++) {
    /**
     * Local value for arg.
     * @param {unknown} pkg - Input value for pkg.
     * @returns {unknown} Result produced by artifact targets.
     * @throws {Error} If validation or the delegated operation fails.
     */
    const arg = args[i];
    if (arg === '--scope') {
      if (!args[i + 1]) {
        throw new Error('Missing --scope value');
      }
      options.scopes.push(args[++i]);
    } else if (arg === '--concurrency') {
      if (args[i + 1] === 'auto') {
        options.concurrency = DEFAULT_BUILD_CONCURRENCY;
        i++;
        continue;
      }
      if (!/^[0-9]+$/.test(args[i + 1] ?? '')) {
        throw new Error('Invalid --concurrency value');
      }
      options.concurrency = Number(args[++i]);
    } else if (arg === '--timeout-ms') {
      if (!/^[0-9]+$/.test(args[i + 1] ?? '')) {
        throw new Error('Invalid --timeout-ms value');
      }
      options.timeoutMs = Number(args[++i]);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--verify') {
      options.verify = true;
    } else if (arg === '--with-dependents') {
      options.includeDependents = true;
    } else if (arg === '--json') {
      options.json = true;
    } else {
      throw new Error(`Unknown build option: ${arg}`);
    }
  }
  if (
    !Number.isSafeInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > 32
  ) {
    throw new Error('Concurrency must be 1-32');
  }
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 100 ||
    options.timeoutMs > 3_600_000
  ) {
    throw new Error('Build timeout must be 100–3600000ms');
  }
  return options;
}

/* * @param {unknown} pkg - Input value for pkg.
 * @returns {unknown} Result produced by artifact targets.
 * Confirm the declared local package entrypoints actually exist after a build. */
/**
 * Perform the artifact targets operation.
 * @param {unknown} pkg - Input value for pkg.
 * @returns {unknown} Result produced by artifact targets.
 */ function artifactTargets(pkg) {
  /** Entrypoint paths collected from all supported package manifest fields. */
  const files = new Set();
  for (const value of [pkg.main, pkg.types]) {
    if (typeof value === 'string') {
      files.add(value);
    }
  }
  /**
   * Run the walk callback.
   * @param {unknown} value - Input value for value.
   * @returns {unknown} Result produced by walk.
   */
  const walk = (value) => {
    if (typeof value === 'string') {
      if (value.startsWith('./')) {
        files.add(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };
  walk(pkg.exports);
  walk(pkg.bin);
  return [...files].sort();
}

/**
 * Verify that every declared built entrypoint is a real package-local file.
 *
 * @param {Map<string, {dir: string, pkg: object}>} entries - Workspace manifests indexed by package name.
 * @param {string[]} ordered - Dependency-ordered packages selected for verification.
 * @returns {string[]} Human-readable missing or unsafe target descriptions.
 */
/** Perform the verify workspace artifacts operation.
 * @param {unknown} entries - Input value for entries.
 * @param {unknown} ordered - Input value for ordered.
 * @returns {unknown} Result produced by verify workspace artifacts.
 */
export function verifyWorkspaceArtifacts(entries, ordered) {
  /** Missing, non-file, escaping, or symlinked artifact descriptions. */
  const missing = [];
  for (const name of ordered) {
    /** Local value for destructured values. */
    const { dir, pkg } = entries.get(name);
    for (const target of artifactTargets(pkg)) {
      /** Local value for dest. */
      const dest = path.resolve(dir, target);
      if (
        !dest.startsWith(dir + path.sep) ||
        !fs.existsSync(dest) ||
        !fs.lstatSync(dest).isFile() ||
        !fs.realpathSync(dest).startsWith(fs.realpathSync(dir) + path.sep)
      ) {
        missing.push(`${name}: ${target}`);
      }
    }
  }
  return missing;
}

/** Terminate the entire npm process group on cancellation or timeout (POSIX).
 * Windows uses the spawned npm process kill. Build durations are bounded so CI
 * cannot remain hung forever when a package build stops making progress.
 */
/**
 * Execute one workspace build with parent cancellation and a hard timeout.
 *
 * @param {string} root - Repository root used as the child working directory.
 * @param {string} name - Workspace package name passed to npm.
 * @param {AbortSignal} signal - Scheduler cancellation signal.
 * @param {number} timeoutMs - Maximum build duration in milliseconds.
 * @param {string} script - Validated package build script name.
 * @returns {Promise<void>} Resolves only after the child exits successfully.
 * @throws {TypeError} If the build script name is invalid.
 * @throws {RangeError} If the timeout is outside the supported range.
 * @throws {Error} If npm exits unsuccessfully or cancellation occurs.
 */
/** Perform the run npm workspace build operation.
 * @param {unknown} root - Input value for root.
 * @param {unknown} name - Input value for name.
 * @param {unknown} signal - Input value for signal.
 * @param {unknown} timeoutMs - Input value for timeout ms.
 * @param {unknown} script - Input value for script.
 * @returns {unknown} Result produced by run npm workspace build.
 */
export function runNpmWorkspaceBuild(
  root,
  name,
  signal,
  timeoutMs = 300_000,
  script = 'build'
) {
  if (typeof script !== 'string' || !/^build(?::[a-z0-9-]+)?$/.test(script)) {
    throw new TypeError('Invalid workspace build script');
  }
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 3_600_000
  ) {
    throw new RangeError('Build timeout must be 100–3600000ms');
  }
  return new Promise((resolve, reject) => {
    /** Local abort source combining the timeout and parent cancellation. */
    const controller = new AbortController();
    /** Platform-specific npm command resolved by the repository helper. */
    const npm = npmCommand(['run', script, '--workspace', name]);
    /** Child process group owning the package build. */
    const child = spawn(npm.command, npm.args, {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      detached: process.platform !== 'win32',
    });
    /** Prevent timeout, abort, and child-exit races from settling twice. */
    let settled = false;
    /** Hard upper bound preventing a hung compiler from blocking the scheduler. */
    const timeout = setTimeout(
      () =>
        controller.abort(
          new Error(`Build timed out after ${timeoutMs}ms: ${name}`)
        ),
      timeoutMs
    );
    /**
     * Run the kill callback.
     * @returns {unknown} Result produced by kill.
     */
    const kill = () => {
      if (!child.pid) {
        return;
      }
      try {
        if (process.platform === 'win32') {
          child.kill('SIGTERM');
        } else {
          process.kill(-child.pid, 'SIGTERM');
        }
      } catch (error) {
        if (error.code !== 'ESRCH') {
          child.kill('SIGTERM');
        }
      }
    };
    /**
     * Run the abort from parent callback.
     * @returns {unknown} Result produced by abort from parent.
     */
    const abortFromParent = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abortFromParent, { once: true });
    controller.signal.addEventListener('abort', kill, { once: true });
    if (signal?.aborted) {
      abortFromParent();
    }
    /**
     * Run the finish callback.
     * @param {unknown} error - Input value for error.
     * @returns {unknown} Result produced by finish.
     */
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortFromParent);
      controller.signal.removeEventListener('abort', kill);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    child.once('error', (error) => finish(controller.signal.reason ?? error));
    child.once('close', (code, exitSignal) =>
      finish(
        controller.signal.reason ??
          (code === 0 ? null : new Error(`Exited ${code ?? exitSignal}`))
      )
    );
  });
}

/**
 * Discover, schedule, execute, and optionally verify a workspace build plan.
 *
 * @param {string} root - Repository root containing the workspace manifest.
 * @param {{scopes?: string[], includeDependents?: boolean, requireBuild?: boolean, dryRun?: boolean, verify?: boolean, concurrency?: number, timeoutMs?: number}} options - Build selection and execution options.
 * @param {{run?: (name: string, signal: AbortSignal) => Promise<void>, onEvent?: (event: {type: string, name: string}) => void}} hooks - Optional injected executor and event sink for tests.
 * @returns {Promise<{planned: string[], completed: string[], missing: string[], finalization: string[]}>} Build plan and completion summary.
 */
/** Perform the run workspace build operation.
 * @param {unknown} root - Input value for root.
 * @param {unknown} options - Input value for options.
 * @param {unknown} root2 - Input value for root2.
 * @param {unknown} root2.run - Input value for run.
 * @param {unknown} root2.onEvent - Input value for on event.
 * @returns {unknown} Result produced by run workspace build.
 */
export async function runWorkspaceBuild(root, options, { run, onEvent } = {}) {
  /** Local value for entries. */
  const entries = discoverWorkspaces(root);
  /** Local value for plan. */
  const plan = planWorkspaces(entries, options);
  if (options.dryRun) {
    return {
      planned: plan.ordered,
      completed: [],
      missing: [],
      finalization: plan.finalize,
    };
  }
  /**
   * Execute one selected workspace build using the injected runner or npm.
   *
   * @param {string} name - Workspace package name selected by the plan.
   * @param {AbortSignal} signal - Scheduler cancellation signal.
   * @param {string} script - Package build script selected for this workspace.
   * @returns {Promise<void>} Resolves after the workspace build settles successfully.
   */
  const execute =
    run ??
    ((name, signal, script = 'build') =>
      runNpmWorkspaceBuild(root, name, signal, options.timeoutMs, script));
  /** Local value for results. */
  const results = await executeWorkspacePlan(plan, {
    concurrency: options.concurrency,
    run: (name, signal) =>
      execute(name, signal, plan.bootstrapScripts.get(name) ?? 'build'),
    onEvent,
  });
  /** Local value for finalized. */
  const finalized = [],
    finalizationController = new AbortController();
  for (const name of plan.finalize) {
    onEvent?.({ type: 'finalize', name });
    try {
      await execute(name, finalizationController.signal, 'build');
      finalized.push(name);
    } catch (error) {
      finalizationController.abort(error);
      throw new Error(
        `Workspace ${name} final build failed: ${error?.message ?? String(error)}`,
        { cause: error }
      );
    }
  }
  /** Local value for missing. */
  const missing = options.verify
    ? verifyWorkspaceArtifacts(entries, plan.ordered)
    : [];
  if (missing.length) {
    throw new Error('Missing built entrypoints:\n' + missing.join('\n'));
  }
  return {
    planned: plan.ordered,
    completed: results.map((result) => result.name),
    missing,
    finalized,
  };
}
