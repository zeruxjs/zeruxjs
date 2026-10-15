import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { acquireRouteLock, type RouteLock } from "./route-lock.js";
import type { RouteInfo, RouteBackend } from "./types.js";
import { validateBackends } from "./backend-pool.js";
import { fixOwnership, isErrnoException } from "./utils.js";
import { SYSTEM_STATE_DIR } from "./cli-utils.js";
import { parseAuthority } from "./request-security.js";

/** File permission mode for route and state files. */
export const FILE_MODE = 0o644;

/** Directory permission mode for the user state directory. */
export const DIR_MODE = 0o755;

/** Directory permission mode for the system state directory (world-writable with sticky bit). */
export const SYSTEM_DIR_MODE = 0o1777;

/** File permission mode for shared state files in the system state directory. */
export const SYSTEM_FILE_MODE = 0o666;

export interface RouteMapping extends RouteInfo {
  pid: number;
  /** Optional unique registration ID. Older route records are still valid. */
  leaseId?: string;
}

/** A lease removes only the exact registration that created it. */
export interface RouteLease {
  readonly hostname: string;
  readonly port: number;
  readonly pid: number;
  readonly leaseId: string;
  release(): boolean;
  /** Atomic traffic handover; fails if this lease was superseded. */
  switchBackends(backends: readonly RouteBackend[]): boolean;
}

const MAX_ROUTES_FILE_BYTES = 4 * 1024 * 1024;
const validLeaseId = (value: unknown): value is string => typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);


/** Runtime check that a parsed JSON value is a valid RouteMapping. */
function isValidRoute(value: unknown): value is RouteMapping {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RouteMapping).hostname === "string" &&
    isValidHostname((value as RouteMapping).hostname) &&
    Number.isInteger((value as RouteMapping).port) &&
    (value as RouteMapping).port >= 1 && (value as RouteMapping).port <= 65535 &&
    Number.isSafeInteger((value as RouteMapping).pid) && (value as RouteMapping).pid >= 0 &&
    ((value as RouteMapping).leaseId === undefined || validLeaseId((value as RouteMapping).leaseId)) &&
    ((value as RouteMapping).backends === undefined || validPersistedBackends((value as RouteMapping)))
  );
}

/** Reject malformed or inconsistent multi-instance route records during writes. */
function validPersistedBackends(route: RouteMapping): boolean {
  try {
    const list = validateBackends(route.backends!);
    return list[0].port === route.port;
  } catch { return false; }
}

/** Route names cannot carry ports, user-info, paths, or control characters. */
function isValidHostname(hostname: string): boolean {
  if (!hostname || hostname !== hostname.toLowerCase() || hostname.endsWith('.')) return false;
  const authority = parseAuthority(hostname);
  return authority !== null && authority.hostname === hostname && authority.port === undefined;
}

function validateRoute(hostname: string, port: number, pid: number): void {
  if (!isValidHostname(hostname)) throw new TypeError(`Invalid route hostname: ${hostname}`);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('Route port must be between 1 and 65535');
  if (!Number.isSafeInteger(pid) || pid < 0) throw new RangeError('Route PID must be a nonnegative safe integer');
}

/** Write to a same-directory temporary file, sync, rename, then sync the directory. */
function writeRoutesAtomic(filename: string, routes: RouteMapping[], mode: number): void {
  const tmp = `${filename}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(tmp, 'wx', mode);
    fs.writeFileSync(fd, JSON.stringify(routes, null, 2));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, filename);
    try {
      const dirFd = fs.openSync(path.dirname(filename), 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch { /* Some platforms do not support directory fsync. */ }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch (err) {
      if (!isErrnoException(err) || err.code !== 'ENOENT') throw err;
    }
  }
}

/**
 * Thrown when a route is already registered by a live process and --force
 * was not specified.
 */
export class RouteConflictError extends Error {
  readonly hostname: string;
  readonly existingPid: number;

  constructor(hostname: string, existingPid: number) {
    super(
      existingPid === 0
        ? `"${hostname}" is already registered as a persistent alias. Use --force to override.`
        : `"${hostname}" is already registered by a running process (PID ${existingPid}). Use --force to override.`
    );
    this.name = "RouteConflictError";
    this.hostname = hostname;
    this.existingPid = existingPid;
  }
}

/**
 * Manages route mappings stored as a JSON file on disk.
 * Supports file locking and stale-route cleanup.
 */
export class RouteStore {
  /** The state directory path. */
  readonly dir: string;
  private readonly routesPath: string;
  private readonly lockPath: string;
  readonly pidPath: string;
  readonly portFilePath: string;
  private readonly onWarning: ((message: string) => void) | undefined;
  private heldLock: RouteLock | undefined;

  constructor(dir: string, options?: { onWarning?: (message: string) => void }) {
    this.dir = dir;
    this.routesPath = path.join(dir, "routes.json");
    this.lockPath = path.join(dir, "routes.lock");
    this.pidPath = path.join(dir, "proxy.pid");
    this.portFilePath = path.join(dir, "proxy.port");
    this.onWarning = options?.onWarning;
  }

  private isSystemDir(): boolean {
    return this.dir === SYSTEM_STATE_DIR;
  }

  private get dirMode(): number {
    return this.isSystemDir() ? SYSTEM_DIR_MODE : DIR_MODE;
  }

  private get fileMode(): number {
    return this.isSystemDir() ? SYSTEM_FILE_MODE : FILE_MODE;
  }

  ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true, mode: this.dirMode });
    }
    // Never chmod or write through a symlink to a different state directory.
    const stat = fs.lstatSync(this.dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe route state directory');
    try {
      fs.chmodSync(this.dir, this.dirMode);
    } catch {
      // May fail if directory is owned by another user (e.g. root); non-fatal
    }
    fixOwnership(this.dir);
  }

  getRoutesPath(): string {
    return this.routesPath;
  }

  // -- Locking ---------------------------------------------------------------

  private acquireLock(): boolean {
    this.heldLock = acquireRouteLock(this.dir);
    return true;
  }

  private releaseLock(): void {
    const lock = this.heldLock;
    this.heldLock = undefined;
    lock?.release();
  }

  // -- Route I/O -------------------------------------------------------------

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // EPERM means the process exists but we cannot signal it.
      return isErrnoException(error) && error.code === 'EPERM';
    }
  }

  /**
   * Load routes from disk, filtering out stale entries whose owning process
   * is no longer alive. Stale-route cleanup is only persisted when the caller
   * already holds the lock (i.e. inside addRoute/removeRoute) to avoid
   * unprotected concurrent writes.
   */
  loadRoutes(persistCleanup = false): RouteMapping[] {
    if (persistCleanup && !this.heldLock) throw new Error('Route cleanup requires holding the route lock');
    // The public reader remains tolerant for the UI; mutations fail closed.
    // Never treat invalid on-disk state as an empty registry during a write.
    try {
      const stat = fs.lstatSync(this.routesPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ROUTES_FILE_BYTES) {
        throw new Error('Unsafe or oversized routes registry');
      }
      const raw = fs.readFileSync(this.routesPath, 'utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        if (persistCleanup) throw new Error(`Invalid JSON in route registry: ${this.routesPath}`);
        this.onWarning?.(`Corrupted routes file (invalid JSON): ${this.routesPath}`);
        return [];
      }
      if (!Array.isArray(parsed)) {
        if (persistCleanup) throw new Error(`Invalid route registry: expected an array (${this.routesPath})`);
        this.onWarning?.(`Corrupted routes file (expected array): ${this.routesPath}`);
        return [];
      }
      const routes: RouteMapping[] = parsed.filter(isValidRoute);
      if (persistCleanup && (routes.length !== parsed.length ||
          new Set(routes.map(route => route.hostname)).size !== routes.length)) {
        throw new Error('Invalid or duplicate route records; refusing to overwrite registry');
      }
      // Filter out stale routes whose owning process is no longer alive
      const alive = routes.filter((r) => r.pid === 0 || this.isProcessAlive(r.pid));
      if (persistCleanup && alive.length !== routes.length) {
        // Persist the cleaned-up list so stale entries don't accumulate.
        // Only safe when caller holds the lock.
        try {
          writeRoutesAtomic(this.routesPath, alive, this.fileMode);
        } catch {
          // Write may fail (permissions); non-fatal
        }
      }
      return alive;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      if (persistCleanup) throw error;
      this.onWarning?.(`Unable to read route registry: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private saveRoutes(routes: RouteMapping[]): void {
    writeRoutesAtomic(this.routesPath, routes, this.fileMode);
    fixOwnership(this.routesPath);
  }

  private register(hostname: string, port: number, pid: number, force: boolean, leaseId?: string, backends?: RouteBackend[]): void {
    validateRoute(hostname, port, pid);
    const validTargets = backends ? validateBackends(backends) : undefined;
    if (validTargets && validTargets[0].port !== port) throw new TypeError('Primary route port must match the first backend');
    this.ensureDir();
    if (!this.acquireLock()) throw new Error('Failed to acquire route lock');
    try {
      const routes = this.loadRoutes(true);
      const existing = routes.find(route => route.hostname === hostname);
      if (existing && existing.pid !== pid && existing.pid !== 0 && this.isProcessAlive(existing.pid) && !force) {
        throw new RouteConflictError(hostname, existing.pid);
      }
      // An alias (pid=0) is persistent and must not be silently replaced either.
      if (existing && existing.pid === 0 && !force && (pid !== 0 || existing.port !== port)) {
        throw new RouteConflictError(hostname, 0);
      }
      const next = routes.filter(route => route.hostname !== hostname);
      next.push({ hostname, port, pid, ...(leaseId ? { leaseId } : {}), ...(validTargets ? { backends: validTargets } : {}) });
      this.saveRoutes(next);
    } finally { this.releaseLock(); }
  }

  /** Legacy registration API, retained for existing callers and route formats. */
  addRoute(hostname: string, port: number, pid: number, force = false): void {
    this.register(hostname, port, pid, force);
  }

  /** Register an app and return a revocable lease. A superseded process cannot
   * delete a replacement route, even if both processes share the same PID. */
  registerRoute(hostname: string, port: number, pid: number, force = false): RouteLease {
    return this.createLease(hostname, [{ port }], pid, force, false);
  }

  /** Register a pool of loopback backends, preserving the legacy primary `port`. */
  registerPoolRoute(hostname: string, backends: readonly RouteBackend[], pid: number, force = false): RouteLease {
    return this.createLease(hostname, backends, pid, force, true);
  }

  private createLease(hostname: string, backends: readonly RouteBackend[], pid: number, force: boolean, pool: boolean): RouteLease {
    const valid = validateBackends(backends);
    const leaseId = randomUUID();
    this.register(hostname, valid[0].port, pid, force, leaseId, pool ? valid : undefined);
    let released = false;
    return { hostname, port: valid[0].port, pid, leaseId,
      release: () => {
        if (released) return false;
        const removed = this.removeRouteIfOwned(hostname, leaseId);
        if (removed) released = true;
        return removed;
      },
      switchBackends: targets => this.replacePoolBackendsIfOwned(hostname, leaseId, targets),
    };
  }

  /** Atomic, conditional cutover. Active requests retain their chosen upstream;
   * subsequent requests see the new pool on the next route-file read. */
  replacePoolBackendsIfOwned(hostname: string, leaseId: string, backends: readonly RouteBackend[]): boolean {
    if (!isValidHostname(hostname) || !validLeaseId(leaseId)) throw new TypeError('Invalid route lease');
    const valid = validateBackends(backends);
    this.ensureDir();
    this.acquireLock();
    try {
      const routes = this.loadRoutes(true);
      const route = routes.find(item => item.hostname === hostname && item.leaseId === leaseId);
      if (!route) return false;
      const next = routes.map(item => item === route ? { ...route, port: valid[0].port, backends: valid } : item);
      this.saveRoutes(next);
      return true;
    } finally { this.releaseLock(); }
  }

  /** Conditional cleanup, serialized with registration under the same lock. */
  removeRouteIfOwned(hostname: string, leaseId: string): boolean {
    if (!isValidHostname(hostname) || !validLeaseId(leaseId)) throw new TypeError('Invalid route lease');
    this.ensureDir();
    if (!this.acquireLock()) throw new Error('Failed to acquire route lock');
    try {
      const routes = this.loadRoutes(true);
      if (!routes.some(route => route.hostname === hostname && route.leaseId === leaseId)) return false;
      this.saveRoutes(routes.filter(route => !(route.hostname === hostname && route.leaseId === leaseId)));
      return true;
    } finally { this.releaseLock(); }
  }

  removeRoute(hostname: string): void {
    if (!isValidHostname(hostname)) throw new TypeError('Invalid route hostname');
    this.ensureDir();
    if (!this.acquireLock()) {
      throw new Error("Failed to acquire route lock");
    }
    try {
      const routes = this.loadRoutes(true).filter((r) => r.hostname !== hostname);
      this.saveRoutes(routes);
    } finally {
      this.releaseLock();
    }
  }
}
