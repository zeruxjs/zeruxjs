import { fileURLToPath } from 'node:url';
/** Absolute script filename for explicit child-process entrypoints. */
const __filename = fileURLToPath(import.meta.url);
/** Directory anchor for repository-owned paths. */
const __dirname = path.dirname(__filename);
/** Local value for fs. */
import fs from 'node:fs';
/** Local value for path. */
import path from 'node:path';

/** Local value for state file. */
const STATE_FILE = path.join(__dirname, '../.dev-container/.env-state.json');

/** Perform the get folders operation.
 * @param {unknown} dirsToScan - Input value for dirs to scan.
 * @param {unknown} scriptName - Input value for script name.
 * @param {unknown} ignorePrivate - Input value for ignore private.
 * @returns {unknown} Result produced by get folders.
 */
function getFolders(
  dirsToScan: readonly string[],
  scriptName: string | null,
  ignorePrivate = false
): Folder[] {
  /** Local value for targets. */
  const targets: Folder[] = [];

  /**
   * Run the scan callback.
   * @param {unknown} dir - Input value for dir.
   * @param {unknown} depth - Input value for depth.
   * @returns {unknown} Result produced by scan.
   */
  const scan = (dir: string, depth = 1): void => {
    if (!fs.existsSync(dir) || depth > 4) {
      return;
    }
    /** Local value for entries. */
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }

        /** Local value for full path. */
        const fullPath = path.join(dir, entry.name);
        /** Local value for pkg path. */
        const pkgPath = path.join(fullPath, 'package.json');

        if (fs.existsSync(pkgPath)) {
          try {
            /** Local value for pkg. */
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (ignorePrivate && pkg.private === true) {
              // Skip private
            } else if (
              !scriptName ||
              (pkg.scripts && pkg.scripts[scriptName])
            ) {
              targets.push({
                dir: fullPath,
                pkgName: pkg.name || entry.name,
              });
            }
          } catch (e) {
            /* Best-effort cleanup/discovery may already be unavailable; the owning operation handles its outcome. */
          }
        } else {
          scan(fullPath, depth + 1);
        }
      }
    }
  };

  dirsToScan.forEach((dir) => scan(dir));
  return targets;
}

/** Perform the get safe name operation.
 * @param {unknown} pkgName - Input value for pkg name.
 * @returns {unknown} Result produced by get safe name.
 */
function getSafeName(pkgName: string): string {
  // Replace '/' and '@' with '-' and remove leading dashes
  return pkgName.replace(/[@/]/g, '-').replace(/^-+/, '');
}

/** Perform the read state operation.
 * @returns {unknown} Result produced by read state.
 */
function readState(): EnvironmentState {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return parseState(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
    } catch (e) {
      /* Best-effort cleanup/discovery may already be unavailable; the owning operation handles its outcome. */
    }
  }
  return { type: null, processes: [] };
}

/** Perform the write state operation.
 * @param {unknown} state - Input value for state.
 * @returns {unknown} Result produced by write state.
 */
function writeState(state: EnvironmentState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Perform the stop process operation.
 * @param {unknown} processInfo - Input value for process info.
 * @returns {unknown} Result produced by stop process.
 */
function stopProcess(processInfo: TrackedProcess): boolean {
  if (
    !Number.isSafeInteger(processInfo.pid) ||
    !processInfo.pid ||
    processInfo.pid <= 0
  ) {
    return false;
  }
  try {
    process.kill(-processInfo.pid, 'SIGKILL');
    return true;
  } catch (e) {
    try {
      process.kill(processInfo.pid, 'SIGKILL');
      return true;
    } catch (err) {
      return false;
    }
  }
}

export {
  getFolders,
  getSafeName,
  readState,
  writeState,
  stopProcess,
  STATE_FILE,
};

/** Named workspace discovered from a manifest without executing it. */
export interface Folder {
  /** Absolute workspace directory. */
  dir: string;
  /** Display name from the manifest. */
  pkgName: string;
}
/** A child process explicitly started by the environment CLI. */
export interface TrackedProcess {
  /** Human-readable workspace identifier. */
  name: string;
  /** Filename-safe log prefix. */
  safeName: string;
  /** Child working directory. */
  dir: string;
  /** Native PID, absent when spawn failed before process creation. */
  pid: number | undefined;
  /** Observed listeners; these are display information, not authorization. */
  ports: Array<number | { port: number; protocol: string }>;
  /** Transient stdout-discovery marker. */
  foundAppPort?: boolean;
  /** Transient devtools-discovery marker. */
  foundDevPort?: boolean;
}
/** Local process inventory; never a remote process-control contract. */
export interface EnvironmentState {
  /** Last explicitly selected operation. */
  type: 'dev' | 'start' | null;
  /** Children owned by the local environment CLI. */
  processes: TrackedProcess[];
}
/** Validate persisted process state before using PIDs or paths.
 * @param {unknown} value - Parsed JSON; no code is evaluated.
 * @returns {EnvironmentState} Validated inventory or an error consumed by readState.
 */
function parseState(value: unknown): EnvironmentState {
  if (
    !value ||
    typeof value !== 'object' ||
    !('type' in value) ||
    !('processes' in value) ||
    ![null, 'dev', 'start'].includes(value.type as string | null) ||
    !Array.isArray(value.processes)
  ) {
    throw new Error('Invalid environment state');
  }
  for (const processInfo of value.processes) {
    if (
      !processInfo ||
      typeof processInfo !== 'object' ||
      typeof processInfo.name !== 'string' ||
      typeof processInfo.safeName !== 'string' ||
      typeof processInfo.dir !== 'string' ||
      !Number.isSafeInteger(processInfo.pid) ||
      processInfo.pid <= 0 ||
      !Array.isArray(processInfo.ports)
    ) {
      throw new Error('Invalid tracked process');
    }
    for (const port of processInfo.ports) {
      if (
        typeof port !== 'number' &&
        (!port ||
          typeof port !== 'object' ||
          !Number.isInteger(port.port) ||
          typeof port.protocol !== 'string')
      ) {
        throw new Error('Invalid tracked port');
      }
    }
  }
  return value as EnvironmentState;
}
