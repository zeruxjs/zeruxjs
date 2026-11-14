import { readStateFile } from './state-file.js';
/** Private, bounded audit trail for fleet lifecycle and scaling decisions. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {
  ensureControlDirectory,
  controlDirectory,
  validateControlName,
} from './local-control.js';
export type FleetEventKind =
  | 'start'
  | 'phase'
  | 'scale'
  | 'replacement'
  | 'budget'
  | 'autoscale'
  | 'stop'
  | 'failure';
export interface FleetEvent {
  /** Random record identifier, not a replay or authorization credential. */
  id: string;
  /** Host-clock ISO UTC occurrence timestamp. */
  at: string;
  /** Allowlisted lifecycle event category. */
  kind: FleetEventKind;
  /** Host-only operational explanation bounded to 512 characters; callers must omit secrets. */
  message: string;
  /** Validated desired capacity from two through sixteen. */
  desiredReplicas: number;
  /** Nonnegative controller generation associated with this event. */
  generation: number;
}
/** Retain at most one hundred lifecycle records per fleet. */
const MAX_EVENTS = 100;
/** Drop records older than thirty days when appending new history. */
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
/** Reject persisted histories larger than 64 KiB. */
const MAX_BYTES = 65536;
/** Derive a validated host-private lifecycle history filename without touching disk.
 * @param {string} stateDir - Host-owned private state directory.
 * @param {string} hostname - Validated host-authorized fleet route name.
 * @returns {string} Deterministic hashed private state path; this helper does not create a file.
 */
export function fleetHistoryPath(stateDir: string, hostname: string): string {
  validateControlName(hostname);
  return path.join(
    controlDirectory(stateDir),
    createHash('sha256').update(`history:${hostname}`).digest('hex') +
      '.fleet-history.json'
  );
}
/** Validate the supported small inert lifecycle record before accepting persisted history.
 * @param {any} value - Unknown JSON record; no property is executed.
 * @returns {boolean} Whether supported identifiers, dates, event kinds and capacity fields are valid.
 */
function isEvent(value: any): value is FleetEvent {
  return (
    value &&
    typeof value === 'object' &&
    /^[a-f0-9]{24}$/.test(value.id) &&
    typeof value.at === 'string' &&
    Number.isFinite(Date.parse(value.at)) &&
    [
      'start',
      'phase',
      'scale',
      'replacement',
      'budget',
      'autoscale',
      'stop',
      'failure',
    ].includes(value.kind) &&
    typeof value.message === 'string' &&
    value.message.length <= 512 &&
    Number.isSafeInteger(value.desiredReplicas) &&
    value.desiredReplicas >= 2 &&
    value.desiredReplicas <= 16 &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 0
  );
}
/** Read a bounded private lifecycle history, rejecting corrupt, foreign-owned or permissive files.
 * @param {string} stateDir - Host-owned private state directory.
 * @param {string} hostname - Validated host-authorized fleet route name.
 * @returns {FleetEvent[]} Validated records, or an empty array only for absent history.
 */
export function readFleetHistory(
  stateDir: string,
  hostname: string
): FleetEvent[] {
  /** Validated hashed file inside the host-owned private control directory. */
  const filename = fleetHistoryPath(stateDir, hostname);
  try {
    ensureControlDirectory(stateDir);
    /** Bounded same-inode file bytes and metadata awaiting ownership checks. */
    const { stat: info, bytes } = readStateFile(filename, MAX_BYTES);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > MAX_BYTES ||
      (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid())
    ) {
      throw new Error('Unsafe fleet history file');
    }
    /** Unknown JSON staged for complete array/record validation. */
    const content: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      !Array.isArray(content) ||
      content.length > MAX_EVENTS ||
      !content.every(isEvent)
    ) {
      throw new Error('Invalid fleet history');
    }
    return content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
/** Append a validated lifecycle record through same-directory atomic rename with age/count/byte bounds; callers own single-writer coordination.
 * @param {string} stateDir - Host-owned private state directory.
 * @param {string} hostname - Validated host-authorized fleet route name.
 * @param {Omit<FleetEvent, 'id' | 'at'>} event - Inert host-authored operational metadata, excluding credentials and request content.
 * @param {number} now - Host-supplied epoch milliseconds, defaulting to the current clock.
 * @returns {FleetEvent} Committed record with locally generated identifier and timestamp.
 */
export function appendFleetHistory(
  stateDir: string,
  hostname: string,
  event: Omit<FleetEvent, 'id' | 'at'>,
  now = Date.now()
): FleetEvent {
  if (
    !isEvent({ ...event, id: '0'.repeat(24), at: new Date(now).toISOString() })
  ) {
    throw new TypeError('Invalid fleet event');
  }
  ensureControlDirectory(stateDir, true);
  /** Validated hashed file inside the host-owned private control directory. */
  const filename = fleetHistoryPath(stateDir, hostname);
  /** New validated event with fresh opaque identifier and host-clock timestamp. */
  const entry: FleetEvent = {
    ...event,
    id: randomBytes(12).toString('hex'),
    at: new Date(now).toISOString(),
  };
  /** Age-filtered and count-bounded next record list; no payload bodies are retained. */
  const history = [
    ...readFleetHistory(stateDir, hostname).filter(
      (item) => Date.parse(item.at) >= now - MAX_AGE
    ),
    entry,
  ].slice(-MAX_EVENTS);
  /** Complete bounded next JSON representation. */
  const payload = JSON.stringify(history) + '\n';
  if (Buffer.byteLength(payload) > MAX_BYTES) {
    throw new Error('Fleet event history exceeds size limit');
  }
  /** Exclusive same-directory staging filename for the next snapshot. */
  const temp = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    /** Owned private descriptor closed before rename, including write failure. */
    const fd = fs.openSync(temp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, payload);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      if (fs.lstatSync(filename).isSymbolicLink()) {
        throw new Error('Unsafe fleet history symlink');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    fs.renameSync(temp, filename);
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // eslint-disable-next-line no-unsafe-finally -- Cleanup failures intentionally propagate so private temporary-file cleanup failures are visible.
        throw error;
      }
    }
  }
  return entry;
}
