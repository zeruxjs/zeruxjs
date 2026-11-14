import { readStateFile } from './state-file.js';
/** Privacy-preserving and bounded fleet metric snapshots, stored outside deployment ownership records. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {
  ensureControlDirectory,
  controlDirectory,
  validateControlName,
} from './local-control.js';
import type { FleetAutoscaleObservation } from './fleet-autoscaler.js';
export interface FleetMetricPoint extends FleetAutoscaleObservation {
  /** Random opaque observation identifier; not an authentication token. */
  id: string;
}
/** Retain at most 240 aggregate observations per fleet. */
const MAX_POINTS = 240;
/** Reject metric snapshots larger than 64 KiB. */
const MAX_BYTES = 65536;
/** Keep at most one day of aggregate observations. */
const RETENTION_MS = 24 * 60 * 60 * 1000;
/** Throttle successful disk writes to at most one per thirty seconds. */
const MIN_WRITE_MS = 30000;
/** Derive a validated fleet-specific metric filename without creating directories.
 * @param {string} dir - Host-owned private state directory.
 * @param {string} hostname - Validated host-authorized fleet route name.
 * @returns {string} Deterministic hashed private state path; this helper does not create a file.
 */
export function fleetMetricHistoryPath(dir: string, hostname: string): string {
  validateControlName(hostname);
  return path.join(
    controlDirectory(dir),
    createHash('sha256')
      .update(`fleet-metric-history:${hostname}`)
      .digest('hex') + '.json'
  );
}
/** Check the supported bounded metric record shape without trusting persisted JSON.
 * @param {unknown} point - Unknown parsed record.
 * @param {number} now - Host-supplied epoch milliseconds, defaulting to the current clock.
 * @returns {boolean} Whether this record satisfies identifier, time, metric and capacity bounds.
 */
function valid(point: unknown, now = Date.now()): point is FleetMetricPoint {
  if (!point || typeof point !== 'object') {
    return false;
  }
  /** Unknown object narrowed to the supported persisted shape only through subsequent checks. */
  const p = point as FleetMetricPoint;
  return (
    typeof p.id === 'string' &&
    /^[a-f0-9]{16}$/.test(p.id) &&
    Number.isSafeInteger(p.sampledAt) &&
    p.sampledAt >= 0 &&
    p.sampledAt <= now + 30000 &&
    ['cpu', 'memory', 'rps'].includes(p.metric) &&
    Number.isFinite(p.value) &&
    p.value >= 0 &&
    p.value <= 1_000_000 &&
    Number.isSafeInteger(p.desiredReplicas) &&
    p.desiredReplicas >= 2 &&
    p.desiredReplicas <= 16 &&
    typeof p.downscaleAllowed === 'boolean'
  );
}
/** Read bounded owner-private metric history and discard expired observations; corrupt or unsafe files fail closed.
 * @param {string} dir - Host-owned private state directory.
 * @param {string} hostname - Validated host-authorized fleet route name.
 * @param {number} now - Host-supplied epoch milliseconds, defaulting to the current clock.
 * @returns {FleetMetricPoint[]} Validated recent observations, or an empty array only when the file is absent.
 */
export function readFleetMetricHistory(
  dir: string,
  hostname: string,
  now = Date.now()
): FleetMetricPoint[] {
  /** Validated hashed path beneath the host-owned control directory. */
  const file = fleetMetricHistoryPath(dir, hostname);
  try {
    ensureControlDirectory(dir);
    /** Same-inode bounded file bytes and metadata; subsequent mode/owner checks remain mandatory. */
    const { stat: st, bytes } = readStateFile(file, MAX_BYTES);
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.size > MAX_BYTES ||
      (st.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && st.uid !== process.getuid())
    ) {
      throw new Error('Unsafe fleet metric history');
    }
    /** Untrusted parsed snapshot staged for complete validation before returning. */
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      !Array.isArray(value) ||
      value.length > MAX_POINTS ||
      !value.every((row) => valid(row, now))
    ) {
      throw new Error('Corrupt fleet metric history');
    }
    return value.filter((point) => point.sampledAt >= now - RETENTION_MS);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
/** Single-writer private aggregate snapshot owner; no background work is started. */
export class FleetMetricHistory {
  /** Last successful persisted sample timestamp used for local write throttling. */
  private lastSaved = 0;
  /** Load the last retained sample time; no timer or watcher is started.
   * @param {string} dir - Host-owned private state directory.
   * @param {string} hostname - Validated host-authorized fleet route name.
   */
  constructor(
    private readonly dir: string,
    private readonly hostname: string
  ) {
    /** Validated existing observations used only to initialize local write throttling. */
    const prior = readFleetMetricHistory(dir, hostname);
    this.lastSaved = prior.at(-1)?.sampledAt ?? 0;
  }
  /** Atomically replace bounded private metric history at most once per thirty seconds; no distributed writer lock is implied.
   * @param {FleetAutoscaleObservation} observation - Host-owned bounded autoscale observation, never request payloads.
   * @param {number} now - Host-supplied epoch milliseconds, defaulting to the current clock.
   * @returns {boolean} True after rename commits, false when throttled; persistence failures throw.
   */
  record(observation: FleetAutoscaleObservation, now = Date.now()): boolean {
    if (!valid({ ...observation, id: '0'.repeat(16) }, now)) {
      throw new TypeError('Invalid fleet metric point');
    }
    if (now < this.lastSaved + MIN_WRITE_MS) {
      return false;
    }
    ensureControlDirectory(this.dir, true);
    /** Validated hashed path beneath the host-owned control directory. */
    const file = fleetMetricHistoryPath(this.dir, this.hostname);
    /** Validated retained prior points; this read-modify-write requires a single host writer. */
    const points = readFleetMetricHistory(this.dir, this.hostname, now).filter(
      (point) => point.sampledAt >= now - RETENTION_MS
    );
    /** Detached aggregate observation with a fresh opaque identifier. */
    const next: FleetMetricPoint = {
      ...observation,
      id: randomBytes(8).toString('hex'),
    };
    /** Bounded JSON snapshot with a stable trailing newline. */
    const payload = JSON.stringify([...points, next].slice(-MAX_POINTS)) + '\n';
    if (Buffer.byteLength(payload) > MAX_BYTES) {
      throw new Error('Fleet metric history size limit exceeded');
    }
    /** Exclusive same-directory staging file for atomic rename. */
    const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      /** Owned private staging descriptor, always closed after write/fsync. */
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, payload);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      try {
        if (fs.lstatSync(file).isSymbolicLink()) {
          throw new Error('Unsafe fleet metric history symlink');
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
      fs.renameSync(temporary, file);
      this.lastSaved = now;
      return true;
    } finally {
      try {
        fs.unlinkSync(temporary);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          // eslint-disable-next-line no-unsafe-finally -- Cleanup failures intentionally propagate so private temporary-file cleanup failures are visible.
          throw error;
        }
      }
    }
  }
}
