import { readStateFile } from './state-file.js';
/** Bounded, private deployment audit trail. History is diagnostic state; it is
 * never used to authorize process termination or route ownership. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import {
  ensureControlDirectory,
  validateControlName,
} from './local-control.js';
import type { RollingStatus, RollingDeployResult } from './rolling-app.js';
export type DeploymentOutcome = 'started' | 'deployed' | 'failed' | 'stopped';
export interface DeploymentEvent {
  /** Host-clock ISO UTC event time; not external delivery evidence. */
  timestamp: string;
  /** Fixed local deployment lifecycle outcome. */
  outcome: DeploymentOutcome;
  /** Controller-local generation associated with this observation. */
  generation: number;
  /** Optional validated prior loopback generation port. */
  fromPort?: number;
  /** Optional validated replacement loopback generation port. */
  toPort?: number;
  /** Whether accepted old-generation connections drained before their deadline. */
  drained?: boolean;
  /** Optional bounded host-only failure text; caller must omit private payloads and credentials. */
  error?: string;
}
export interface DeploymentRecord {
  /** Persisted history schema version, currently one. */
  version: 1;
  /** Host-authorized operational route label. */
  hostname: string;
  /** Last stored rolling-controller observation; never authority to signal a PID. */
  status: RollingStatus;
  /** Bounded local diagnostic events; not a distributed durable audit service. */
  history: DeploymentEvent[];
}
/** Maximum supported local diagnostic history records. */
const MAX_HISTORY = 50;
/** Default local history retention age in days. */
const DEFAULT_HISTORY_DAYS = 90;
export interface HistoryRetentionOptions {
  /** Retention age in whole days, zero through 3650; zero removes older observations. */
  days?: number;
  /** Maximum retained event count, zero through fifty. */
  maxEvents?: number;
}
export interface HistoryPruneResult {
  /** Host-authorized operational route label. */
  hostname: string;
  /** Number of diagnostic events removed by this explicit local compaction. */
  removed: number;
  /** Number of diagnostic events kept after compaction. */
  remaining: number;
}
/** Validate explicit local diagnostic retention bounds without modifying persisted state.
 * @param {HistoryRetentionOptions} options - Trusted age/count settings, default ninety days and fifty events.
 * @returns {{ days: number; maxEvents: number }} Validated detached retention policy.
 */
function retention(options: HistoryRetentionOptions = {}) {
  /** Validated whole-day retention age. */
  const days = options.days ?? DEFAULT_HISTORY_DAYS;
  /** Validated retained record cap, including explicit zero. */
  const maxEvents = options.maxEvents ?? MAX_HISTORY;
  if (
    !Number.isSafeInteger(days) ||
    days < 0 ||
    days > 3650 ||
    !Number.isSafeInteger(maxEvents) ||
    maxEvents < 0 ||
    maxEvents > MAX_HISTORY
  ) {
    throw new RangeError(
      'History retention must use 0–3650 days and 0–50 events'
    );
  }
  return { days, maxEvents };
}
/** Filter invalid/expired timestamps and retain the newest bounded tail in existing event order.
 * @param {DeploymentEvent[]} events - Borrowed diagnostic event sequence.
 * @param {HistoryRetentionOptions} options - Trusted bounded retention policy.
 * @param {number} now - Host-clock epoch milliseconds, default current time.
 * @returns {DeploymentEvent[]} Copied retained event list; individual trusted records are not deep-cloned.
 */
function compactHistory(
  events: DeploymentEvent[],
  options: HistoryRetentionOptions,
  now = Date.now()
): DeploymentEvent[] {
  /** Validated age/count bounds used for deterministic compaction. */
  const { days, maxEvents } = retention(options);
  /** Host-clock minimum retained event timestamp. */
  const threshold = now - days * 86400_000;
  return events
    .filter(
      (event) =>
        Number.isFinite(Date.parse(event.timestamp)) &&
        Date.parse(event.timestamp) >= threshold
    )
    .slice(-maxEvents)
    .slice(0, maxEvents);
}
/** Maximum individual diagnostic history representation, 32 KiB. */
const MAX_FILE_BYTES = 32768;
/** Validate the route name and derive its hashed path in the existing owner-private control directory.
 * @param {string} stateDir - Host-owned state directory.
 * @param {string} hostname - Validated authorized operational label.
 * @returns {string} Hashed local history filename; missing/unsafe control directories fail.
 */
function filename(stateDir: string, hostname: string): string {
  validateControlName(hostname);
  return path.join(
    ensureControlDirectory(stateDir),
    `${createHash('sha256').update(hostname).digest('hex')}.history.json`
  );
}
/** Read bounded private no-follow history bytes with existing V1 envelope validation; stored events/status are diagnostic, never process authority.
 * @param {string} file - Trusted fixed hashed path in the private namespace.
 * @returns {DeploymentRecord | null} Parsed supported envelope or null only for absence; this is not full semantic status validation.
 */
function safeRead(file: string): DeploymentRecord | null {
  try {
    /** Bounded same-inode history metadata and bytes requiring owner/mode checks. */
    const { stat: st, bytes } = readStateFile(file, MAX_FILE_BYTES);
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.mode & 0o077 ||
      st.size > MAX_FILE_BYTES ||
      (typeof process.getuid === 'function' && st.uid !== process.getuid())
    ) {
      throw new Error('Unsafe deployment history file');
    }
    /** Unknown parsed diagnostic envelope validated before use. */
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (typeof value !== 'object' || value === null) {
      throw new Error('Invalid deployment history');
    }
    /** Supported local diagnostic record read before compaction. */
    const record = value as DeploymentRecord;
    if (
      record.version !== 1 ||
      typeof record.hostname !== 'string' ||
      !Array.isArray(record.history) ||
      record.history.length > MAX_HISTORY ||
      !record.status ||
      typeof record.status.phase !== 'string'
    ) {
      throw new Error('Invalid deployment history');
    }
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
/** Read host-private diagnostic history and verify that its envelope hostname matches the requested route.
 * @param {string} stateDir - Host-owned private state directory.
 * @param {string} hostname - Authorized bounded route name.
 * @returns {DeploymentRecord | null} Supported history envelope or null when absent; native/validation failures remain explicit.
 */
export function readDeploymentHistory(
  stateDir: string,
  hostname: string
): DeploymentRecord | null {
  validateControlName(hostname);
  try {
    /** Supported local diagnostic record read before compaction. */
    const record = safeRead(filename(stateDir, hostname));
    if (record && record.hostname !== hostname) {
      throw new Error('Deployment history belongs to a different hostname');
    }
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
/** Replace a bounded private diagnostic file using exclusive same-directory staging and fsync; temporary unlink remains best-effort legacy cleanup.
 * @param {string} file - Trusted fixed destination inside the private control namespace.
 * @param {string} text - Complete diagnostic JSON representation bounded before writing.
 * @returns {void} Commits rename or throws; caller owns single-writer coordination.
 */
function atomicWrite(file: string, text: string): void {
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) {
    throw new Error('Deployment history too large');
  }
  /** Exclusive same-directory private staging path. */
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    /** Owned staging descriptor closed after file fsync. */
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      if (fs.lstatSync(file).isSymbolicLink()) {
        throw new Error('Unsafe deployment history symlink');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    fs.renameSync(tmp, file);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* This optional failure is intentionally ignored. */
    }
  }
}
/** Load and immediately persist compacted controller history; callbacks synchronously write under the host’s controller/operation ownership.
 * @param {string} stateDir - Host-owned private state directory.
 * @param {string} hostname - Authorized bounded operational label.
 * @param {RollingStatus} initial - Trusted rolling status copied shallowly for the first snapshot.
 * @param {HistoryRetentionOptions} options - Validated age/count policy; no automatic background retention runs.
 * @returns {{ update: (next: Readonly<RollingStatus>) => void; record: (outcome: DeploymentOutcome, details?: Partial<RollingDeployResult> & { error?: string }) => void; readonly current: DeploymentRecord }} Local writer callbacks and copied envelope; nested event records remain borrowed trusted values.
 */
export function createDeploymentHistory(
  stateDir: string,
  hostname: string,
  initial: RollingStatus,
  options: HistoryRetentionOptions = {}
) {
  retention(options);
  ensureControlDirectory(stateDir, true);
  /** Optional prior same-host diagnostic envelope. */
  const previous = readDeploymentHistory(stateDir, hostname);
  let status = { ...initial };
  let history: DeploymentEvent[] = compactHistory(
    previous?.history ?? [],
    options
  );
  /** Compact the current local history and atomically persist one complete envelope.
   * @returns {void} Synchronous persistence failures reach the owning controller. */
  const save = () => {
    history = compactHistory(history, options);
    atomicWrite(
      filename(stateDir, hostname),
      JSON.stringify({ version: 1, hostname, status, history }) + '\n'
    );
  };
  /** Copy a trusted controller observation and synchronously persist it.
   * @param {Readonly<RollingStatus>} next New host-controller status.
   * @returns {void} Saves the new observation or throws. */
  const update = (next: Readonly<RollingStatus>) => {
    status = { ...next };
    save();
  };
  /**
   * Append one trusted bounded deployment outcome and synchronously persist it.
   * @param {DeploymentOutcome} outcome Fixed supported lifecycle outcome.
   * @param {Partial<RollingDeployResult> & { error?: string }} details Trusted cutover facts; omit secrets.
   * @returns {void} Commits the next diagnostic snapshot or throws.
   */
  const record = (
    outcome: DeploymentOutcome,
    details: Partial<RollingDeployResult> & {
      /** Optional bounded host-only failure text; caller must omit private payloads and credentials. */
      error?: string;
    } = {}
  ) => {
    /** New timestamped diagnostic event with optional bounded failure text. */
    const event: DeploymentEvent = {
      timestamp: new Date().toISOString(),
      outcome,
      generation: status.generation,
      ...(details.fromPort !== undefined ? { fromPort: details.fromPort } : {}),
      ...(details.toPort !== undefined ? { toPort: details.toPort } : {}),
      ...(details.drained !== undefined ? { drained: details.drained } : {}),
      ...(details.error !== undefined
        ? { error: details.error.slice(0, 240) }
        : {}),
    };
    history = compactHistory([...history, event], options);
    save();
  };
  save();
  return {
    update,
    record,
    get current(): DeploymentRecord {
      return {
        version: 1,
        hostname,
        status: { ...status },
        history: [...history],
      };
    },
  };
}

/** Explicitly compact one owner-private diagnostic history; CLI callers coordinate this with startup using the operation lock.
 * @param {string} stateDir - Host-owned private state directory.
 * @param {string} hostname - Authorized operational route name.
 * @param {HistoryRetentionOptions} options - Explicit bounded retention policy.
 * @returns {HistoryPruneResult} Per-file removal counts; no application data or live processes are changed.
 */
export function pruneDeploymentHistory(
  stateDir: string,
  hostname: string,
  options: HistoryRetentionOptions = {}
): HistoryPruneResult {
  retention(options);
  /** Supported local diagnostic record read before compaction. */
  const record = readDeploymentHistory(stateDir, hostname);
  if (!record) {
    return { hostname, removed: 0, remaining: 0 };
  }
  /** Compacted copied event list for explicit retention. */
  const history = compactHistory(record.history, options);
  atomicWrite(
    filename(stateDir, hostname),
    JSON.stringify({ ...record, history }) + '\n'
  );
  return {
    hostname,
    removed: record.history.length - history.length,
    remaining: history.length,
  };
}
