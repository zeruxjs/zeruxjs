import { readStateFile } from './state-file.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireRouteLock, type RouteLock } from './route-lock.js';
import type { RouteInfo, RouteBackend } from './types.js';
import { validateBackends } from './backend-pool.js';
import { fixOwnership, isErrnoException } from './utils.js';
import { SYSTEM_STATE_DIR } from './cli-utils.js';
import { parseAuthority } from './request-security.js';

/** File permission mode for route and state files. */
export const FILE_MODE = 0o644;

/** Directory permission mode for the user state directory. */
export const DIR_MODE = 0o755;

/** Directory permission mode for the system state directory (world-writable with sticky bit). */
export const SYSTEM_DIR_MODE = 0o1777;

/** File permission mode for shared state files in the system state directory. */
export const SYSTEM_FILE_MODE = 0o666;

export interface RouteMapping extends RouteInfo {
  /** Registration owner PID, or zero for a persistent alias. */
  pid: number;
  /** Optional unique registration ID. Older route records are still valid. */
  leaseId?: string;
}

/** A lease removes only the exact registration that created it. */
export interface RouteLease {
  /** Canonical registered hostname, not an authorization identity. */
  readonly hostname: string;
  /** Captured initial primary port; read current registry state after a pool cutover. */
  readonly port: number;
  /** Registration owner PID, or zero for a persistent alias. */
  readonly pid: number;
  /** Unique registration revision fence; not a remote bearer permission. */
  readonly leaseId: string;
  /** Remove only the exact current registration matching this lease; repeated/superseded cleanup does not affect another owner.
   * @returns {boolean} True only after this lease’s record was actually removed.
   */
  release(): boolean;
  /** Switch targets only while this registration still owns the route; existing accepted connections keep their original backend.
   * @param {readonly RouteBackend[]} backends - One to 32 validated distinct loopback backend records.
   * @returns {boolean} Whether conditional publication succeeded; not an authorization check.
   */
  switchBackends(backends: readonly RouteBackend[]): boolean;
}

/** Maximum registry bytes admitted before JSON decoding and route validation. */
const MAX_ROUTES_FILE_BYTES = 4 * 1024 * 1024;
/** Recognize the supported inert UUID-shaped registration identifier.
 * @param {unknown} value - Untrusted decoded lease ID.
 * @returns {boolean} Whether its shape is supported, without authorizing a caller.
 */
const validLeaseId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);

/** Validate supported persisted route fields after inert JSON decoding without treating numeric PID/lease data as authorization.
 * @param {unknown} value - Unknown decoded route record.
 * @returns {boolean} Whether the implemented route/lease/backend consistency checks pass.
 */
function isValidRoute(value: unknown): value is RouteMapping {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RouteMapping).hostname === 'string' &&
    isValidHostname((value as RouteMapping).hostname) &&
    Number.isInteger((value as RouteMapping).port) &&
    (value as RouteMapping).port >= 1 &&
    (value as RouteMapping).port <= 65535 &&
    Number.isSafeInteger((value as RouteMapping).pid) &&
    (value as RouteMapping).pid >= 0 &&
    ((value as RouteMapping).leaseId === undefined ||
      validLeaseId((value as RouteMapping).leaseId)) &&
    ((value as RouteMapping).backends === undefined ||
      validPersistedBackends(value as RouteMapping))
  );
}

/** Validate optional backend membership and require the primary compatibility port to match the first target.
 * @param {RouteMapping} route - Parsed route with an explicitly present backend list.
 * @returns {boolean} False on invalid/mismatched target metadata, without changing state.
 */
function validPersistedBackends(route: RouteMapping): boolean {
  try {
    /** Detached validated nonempty target list; the shared validator proves its first entry exists. */
    const list = validateBackends(route.backends!);
    return list[0]!.port === route.port;
  } catch {
    return false;
  }
}

/** Reject noncanonical route authorities, including port, user-info, path and control syntax.
 * @param {string} hostname - Untrusted route label to validate, not resolve.
 * @returns {boolean} Whether it is an exact lowercase hostname accepted by the shared authority parser.
 */
function isValidHostname(hostname: string): boolean {
  if (
    !hostname ||
    hostname !== hostname.toLowerCase() ||
    hostname.endsWith('.')
  ) {
    return false;
  }
  /** Parsed canonical hostname authority, with any explicit port rejected. */
  const authority = parseAuthority(hostname);
  return (
    authority !== null &&
    authority.hostname === hostname &&
    authority.port === undefined
  );
}

/** Validate route metadata before lock acquisition or registry mutation.
 * @param {string} hostname - Validated host-authorized route label; never a request-selected management permission.
 * @param {number} port - Validated loopback application port.
 * @param {number} pid - Registration owner PID, or zero for a persistent alias.
 * @returns {void} Throws on malformed hostname, TCP port or owner PID.
 */
function validateRoute(hostname: string, port: number, pid: number): void {
  if (!isValidHostname(hostname)) {
    throw new TypeError(`Invalid route hostname: ${hostname}`);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError('Route port must be between 1 and 65535');
  }
  if (!Number.isSafeInteger(pid) || pid < 0) {
    throw new RangeError('Route PID must be a nonnegative safe integer');
  }
}

/** Write configured-mode route bytes through an exclusive same-directory temporary file, fsync and rename under the caller’s route lock.
 * @param {string} filename - Host-owned fixed registry destination.
 * @param {RouteMapping[]} routes - Trusted candidate route list assembled under the lock.
 * @param {number} mode - Existing host-selected user/shared route-file permission mode.
 * @returns {void} Closes owned descriptors and cleans its temporary file; directory fsync is best-effort.
 */
function writeRoutesAtomic(
  filename: string,
  routes: RouteMapping[],
  mode: number
): void {
  /** Exclusive same-directory candidate filename; its random suffix is not an authentication token. */
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
      /** Owned directory descriptor used only for best-effort post-rename fsync. */
      const dirFd = fs.openSync(path.dirname(filename), 'r', 0o600);
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch {
      /* Some platforms do not support directory fsync. */
    }
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
    try {
      fs.unlinkSync(tmp);
    } catch (err) {
      if (!isErrnoException(err) || err.code !== 'ENOENT') {
        // eslint-disable-next-line no-unsafe-finally -- Preserve the existing policy of surfacing private temporary-file cleanup failures.
        throw err;
      }
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

  /**
   * Explain a protected existing registration to a trusted local operator.
   * @param {string} hostname - Conflicting validated route label.
   * @param {number} existingPid - Observed owner PID; zero denotes a persistent alias.
   */
  constructor(hostname: string, existingPid: number) {
    super(
      existingPid === 0
        ? `"${hostname}" is already registered as a persistent alias. Use --force to override.`
        : `"${hostname}" is already registered by a running process (PID ${existingPid}). Use --force to override.`
    );
    this.name = 'RouteConflictError';
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

  /**
   * Bind host-owned route paths without creating directories or acquiring a lock.
   * @param {string} dir - Explicit trusted state root; shared/user permission policies remain distinct.
   * @param {{onWarning?: (message: string) => void}} options - Optional host diagnostic sink.
   * @param {(message: string) => void} options.onWarning - Internal warning callback; paths must not be published as public telemetry.
   */
  constructor(
    dir: string,
    options?: { onWarning?: (message: string) => void }
  ) {
    this.dir = dir;
    this.routesPath = path.join(dir, 'routes.json');
    this.lockPath = path.join(dir, 'routes.lock');
    this.pidPath = path.join(dir, 'proxy.pid');
    this.portFilePath = path.join(dir, 'proxy.port');
    this.onWarning = options?.onWarning;
  }

  /** Recognize only the exact configured shared state path when selecting legacy permission modes.
   * @returns {boolean} Whether this store uses the maintained shared-directory policy.
   */
  private isSystemDir(): boolean {
    return this.dir === SYSTEM_STATE_DIR;
  }

  /**
   * Read the configured user/shared directory permission policy.
   * @returns {number} Existing selected directory mode.
   */
  private get dirMode(): number {
    return this.isSystemDir() ? SYSTEM_DIR_MODE : DIR_MODE;
  }

  /**
   * Read the configured user/shared route-file permission policy.
   * @returns {number} Existing selected file mode.
   */
  private get fileMode(): number {
    return this.isSystemDir() ? SYSTEM_FILE_MODE : FILE_MODE;
  }

  /** Create/check the host-selected route directory without following a leaf symlink, then apply the existing permission/ownership compatibility policy.
   * @returns {void} Native failures propagate except the existing best-effort chmod/sudo ownership paths.
   */
  ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true, mode: this.dirMode });
    }
    // Never chmod or write through a symlink to a different state directory.
    /** Metadata from the route directory or bounded opened registry inode. */
    const stat = fs.lstatSync(this.dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Unsafe route state directory');
    }
    try {
      fs.chmodSync(this.dir, this.dirMode);
    } catch {
      // May fail if directory is owned by another user (e.g. root); non-fatal
    }
    fixOwnership(this.dir);
  }

  /** Expose the fixed registry path without reading or mutating its contents.
   * @returns {string} Store-owned routes.json path.
   */
  getRoutesPath(): string {
    return this.routesPath;
  }

  // -- Locking ---------------------------------------------------------------

  /** Acquire the existing route-lock lease before mutations and retain its release handle locally.
   * @returns {boolean} True after acquisition; the owning lock helper throws on failure.
   */
  private acquireLock(): boolean {
    this.heldLock = acquireRouteLock(this.dir);
    return true;
  }

  /** Detach and release only this store’s currently held route lock.
   * @returns {void} No-op without a retained lock handle.
   */
  private releaseLock(): void {
    /** Current owned lock handle detached before release to prevent repeated cleanup. */
    const lock = this.heldLock;
    this.heldLock = undefined;
    lock?.release();
  }

  // -- Route I/O -------------------------------------------------------------

  /** Probe process existence with signal zero, treating permission denial as alive to avoid erasing another owner’s route.
   * @param {number} pid - Previously validated positive registration PID; persistent aliases bypass this probe.
   * @returns {boolean} Liveness observation only, not proof of process identity or management authority.
   */
  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // EPERM means the process exists but we cannot signal it.
      return isErrnoException(error) && error.code === 'EPERM';
    }
  }

  /** Read a bounded inode and filter dead owners; tolerant reads report/omit corrupt data, while locked mutation reads fail closed.
   * @param {boolean} persistCleanup - Explicitly persist stale cleanup only while this store holds its route lock.
   * @returns {RouteMapping[]} Detached parsed live routes; optional stale-cleanup write failure remains best-effort.
   */
  loadRoutes(persistCleanup = false): RouteMapping[] {
    if (persistCleanup && !this.heldLock) {
      throw new Error('Route cleanup requires holding the route lock');
    }
    // The public reader remains tolerant for the UI; mutations fail closed.
    // Never treat invalid on-disk state as an empty registry during a write.
    try {
      /** Bounded bytes and metadata read from the same opened inode. */
      const { stat, bytes } = readStateFile(
        this.routesPath,
        MAX_ROUTES_FILE_BYTES
      );
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > MAX_ROUTES_FILE_BYTES
      ) {
        throw new Error('Unsafe or oversized routes registry');
      }
      /** Inert UTF-8 registry text; never evaluated as JavaScript. */
      const raw = bytes.toString('utf8');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        if (persistCleanup) {
          throw new Error(`Invalid JSON in route registry: ${this.routesPath}`);
        }
        this.onWarning?.(
          `Corrupted routes file (invalid JSON): ${this.routesPath}`
        );
        return [];
      }
      if (!Array.isArray(parsed)) {
        if (persistCleanup) {
          throw new Error(
            `Invalid route registry: expected an array (${this.routesPath})`
          );
        }
        this.onWarning?.(
          `Corrupted routes file (expected array): ${this.routesPath}`
        );
        return [];
      }
      /** Validated parsed routes or locked mutation candidates owned by this operation. */
      const routes: RouteMapping[] = parsed.filter(isValidRoute);
      if (
        persistCleanup &&
        (routes.length !== parsed.length ||
          new Set(routes.map((route) => route.hostname)).size !== routes.length)
      ) {
        throw new Error(
          'Invalid or duplicate route records; refusing to overwrite registry'
        );
      }
      // Filter out stale routes whose owning process is no longer alive
      /** Routes whose owner is currently live, plus explicit persistent aliases. */
      const alive = routes.filter(
        (r) => r.pid === 0 || this.isProcessAlive(r.pid)
      );
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
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      if (persistCleanup) {
        throw error;
      }
      this.onWarning?.(
        `Unable to read route registry: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  /** Persist a trusted locked candidate and apply the existing sudo ownership compatibility helper.
   * @param {RouteMapping[]} routes - Candidate route list assembled while the route lock is held.
   * @returns {void} Native write failures propagate; does not acquire a separate lock.
   */
  private saveRoutes(routes: RouteMapping[]): void {
    writeRoutesAtomic(this.routesPath, routes, this.fileMode);
    fixOwnership(this.routesPath);
  }

  /** Serialize explicit registration under the route lock, protecting live owners and persistent aliases unless a trusted force override is supplied.
   * @param {string} hostname - Validated host-authorized route label; never a request-selected management permission.
   * @param {number} port - Validated loopback application port.
   * @param {number} pid - Registration owner PID, or zero for a persistent alias.
   * @param {boolean} force - Explicit trusted operator override; never inferred from browser claims.
   * @param {string} leaseId - Exact existing registration identifier, used as a conditional revision fence.
   * @param {RouteBackend[]} backends - One to 32 validated distinct loopback backend records.
   * @returns {void} Publishes the candidate atomically or throws before replacing incompatible registry state.
   */
  private register(
    hostname: string,
    port: number,
    pid: number,
    force: boolean,
    leaseId?: string,
    backends?: RouteBackend[]
  ): void {
    validateRoute(hostname, port, pid);
    /** Optional detached validated pool with a guaranteed first backend. */
    const validTargets = backends ? validateBackends(backends) : undefined;
    if (validTargets && validTargets[0]!.port !== port) {
      throw new TypeError('Primary route port must match the first backend');
    }
    this.ensureDir();
    if (!this.acquireLock()) {
      throw new Error('Failed to acquire route lock');
    }
    try {
      /** Validated parsed routes or locked mutation candidates owned by this operation. */
      const routes = this.loadRoutes(true);
      /** Current same-host registration checked before any replacement. */
      const existing = routes.find((route) => route.hostname === hostname);
      if (
        existing &&
        existing.pid !== pid &&
        existing.pid !== 0 &&
        this.isProcessAlive(existing.pid) &&
        !force
      ) {
        throw new RouteConflictError(hostname, existing.pid);
      }
      // An alias (pid=0) is persistent and must not be silently replaced either.
      if (
        existing &&
        existing.pid === 0 &&
        !force &&
        (pid !== 0 || existing.port !== port)
      ) {
        throw new RouteConflictError(hostname, 0);
      }
      /** Complete next registry candidate assembled before atomic publication. */
      const next = routes.filter((route) => route.hostname !== hostname);
      next.push({
        hostname,
        port,
        pid,
        ...(leaseId ? { leaseId } : {}),
        ...(validTargets ? { backends: validTargets } : {}),
      });
      this.saveRoutes(next);
    } finally {
      this.releaseLock();
    }
  }

  /** Retain legacy registration semantics without returning a conditional ownership handle.
   * @param {string} hostname - Validated host-authorized route label; never a request-selected management permission.
   * @param {number} port - Validated loopback application port.
   * @param {number} pid - Registration owner PID, or zero for a persistent alias.
   * @param {boolean} force - Explicit trusted operator override; never inferred from browser claims.
   * @returns {void} Persists through the same validated locked registration path.
   */
  addRoute(hostname: string, port: number, pid: number, force = false): void {
    this.register(hostname, port, pid, force);
  }

  /** Register one backend and return a conditional cleanup/cutover handle; a superseded lease cannot erase its replacement.
   * @param {string} hostname - Validated host-authorized route label; never a request-selected management permission.
   * @param {number} port - Validated loopback application port.
   * @param {number} pid - Registration owner PID, or zero for a persistent alias.
   * @param {boolean} force - Explicit trusted operator override; never inferred from browser claims.
   * @returns {RouteLease} Owned registration handle; retain and release at the registration owner’s lifecycle.
   */
  registerRoute(
    hostname: string,
    port: number,
    pid: number,
    force = false
  ): RouteLease {
    return this.createLease(hostname, [{ port }], pid, force, false);
  }

  /** Register a validated pool while retaining the first backend as the legacy primary port.
   * @param {string} hostname - Validated host-authorized route label; never a request-selected management permission.
   * @param {readonly RouteBackend[]} backends - One to 32 validated distinct loopback backend records.
   * @param {number} pid - Registration owner PID, or zero for a persistent alias.
   * @param {boolean} force - Explicit trusted operator override; never inferred from browser claims.
   * @returns {RouteLease} Conditional registration lease, separate from host authorization.
   */
  registerPoolRoute(
    hostname: string,
    backends: readonly RouteBackend[],
    pid: number,
    force = false
  ): RouteLease {
    return this.createLease(hostname, backends, pid, force, true);
  }

  /** Create a random registration identity, persist its validated targets and expose only ownership-fenced mutation callbacks.
   * @param {string} hostname - Validated host-authorized route label; never a request-selected management permission.
   * @param {readonly RouteBackend[]} backends - One to 32 validated distinct loopback backend records.
   * @param {number} pid - Registration owner PID, or zero for a persistent alias.
   * @param {boolean} force - Explicit trusted operator override; never inferred from browser claims.
   * @param {boolean} pool - Whether to persist the explicit pool list alongside the compatibility primary port.
   * @returns {RouteLease} Captured initial registration metadata and conditional release/cutover callbacks.
   */
  private createLease(
    hostname: string,
    backends: readonly RouteBackend[],
    pid: number,
    force: boolean,
    pool: boolean
  ): RouteLease {
    /** Detached nonempty validated backend list whose first port is guaranteed. */
    const valid = validateBackends(backends);
    /** New random registration revision identity, separate from host management authorization. */
    const leaseId = randomUUID();
    this.register(
      hostname,
      valid[0]!.port,
      pid,
      force,
      leaseId,
      pool ? valid : undefined
    );
    let released = false;
    return {
      hostname,
      port: valid[0]!.port,
      pid,
      leaseId,
      release: () => {
        if (released) {
          return false;
        }
        /** Observed result of ownership-fenced removal, not merely an attempted cleanup. */
        const removed = this.removeRouteIfOwned(hostname, leaseId);
        if (removed) {
          released = true;
        }
        return removed;
      },
      switchBackends: (targets) =>
        this.replacePoolBackendsIfOwned(hostname, leaseId, targets),
    };
  }

  /** Validate and atomically publish a new pool under the shared lock only when the route still matches this lease.
   * @param {string} hostname - Validated host-authorized route label; never a request-selected management permission.
   * @param {string} leaseId - Exact existing registration identifier, used as a conditional revision fence.
   * @param {readonly RouteBackend[]} backends - One to 32 validated distinct loopback backend records.
   * @returns {boolean} False for superseded ownership, true after publication.
   */
  replacePoolBackendsIfOwned(
    hostname: string,
    leaseId: string,
    backends: readonly RouteBackend[]
  ): boolean {
    if (!isValidHostname(hostname) || !validLeaseId(leaseId)) {
      throw new TypeError('Invalid route lease');
    }
    /** Detached nonempty validated backend list whose first port is guaranteed. */
    const valid = validateBackends(backends);
    this.ensureDir();
    this.acquireLock();
    try {
      /** Validated parsed routes or locked mutation candidates owned by this operation. */
      const routes = this.loadRoutes(true);
      /** Exact route/lease match required before replacing its backend membership. */
      const route = routes.find(
        (item) => item.hostname === hostname && item.leaseId === leaseId
      );
      if (!route) {
        return false;
      }
      /** Complete next registry candidate assembled before atomic publication. */
      const next = routes.map((item) =>
        item === route
          ? { ...route, port: valid[0]!.port, backends: valid }
          : item
      );
      this.saveRoutes(next);
      return true;
    } finally {
      this.releaseLock();
    }
  }

  /** Serialize conditional cleanup with registration under the same route lock.
   * @param {string} hostname - Validated host-authorized route label; never a request-selected management permission.
   * @param {string} leaseId - Exact existing registration identifier, used as a conditional revision fence.
   * @returns {boolean} False for an absent/superseded lease, true after its record is removed.
   */
  removeRouteIfOwned(hostname: string, leaseId: string): boolean {
    if (!isValidHostname(hostname) || !validLeaseId(leaseId)) {
      throw new TypeError('Invalid route lease');
    }
    this.ensureDir();
    if (!this.acquireLock()) {
      throw new Error('Failed to acquire route lock');
    }
    try {
      /** Validated parsed routes or locked mutation candidates owned by this operation. */
      const routes = this.loadRoutes(true);
      if (
        !routes.some(
          (route) => route.hostname === hostname && route.leaseId === leaseId
        )
      ) {
        return false;
      }
      this.saveRoutes(
        routes.filter(
          (route) => !(route.hostname === hostname && route.leaseId === leaseId)
        )
      );
      return true;
    } finally {
      this.releaseLock();
    }
  }

  /** Explicit unconditional host maintenance removal under the route lock; HTTP callers require separate fresh authorization.
   * @param {string} hostname - Validated host-authorized route label; never a request-selected management permission.
   * @returns {void} Removes the named record without pretending a caller-provided hostname proves ownership.
   */
  removeRoute(hostname: string): void {
    if (!isValidHostname(hostname)) {
      throw new TypeError('Invalid route hostname');
    }
    this.ensureDir();
    if (!this.acquireLock()) {
      throw new Error('Failed to acquire route lock');
    }
    try {
      /** Validated parsed routes or locked mutation candidates owned by this operation. */
      const routes = this.loadRoutes(true).filter(
        (r) => r.hostname !== hostname
      );
      this.saveRoutes(routes);
    } finally {
      this.releaseLock();
    }
  }
}
