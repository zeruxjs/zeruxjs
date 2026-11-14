import { readStateFile } from './state-file.js';
/** Find interrupted rolling controllers in this OS user's private control dir.
 * Reconciliation is serialized with normal rolling startup and refuses to touch
 * live/unverifiable owners; one corrupt record does not hide other orphans. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ensureControlDirectory,
  validateControlName,
} from './local-control.js';
import {
  generationRecordPath,
  readGenerationRecord,
  recoverRollingGenerations,
  type RecoveryReport,
} from './generation-registry.js';
import { withOperationLock } from './operation-lock.js';
import { processExists, processIdentity } from './lifecycle.js';

export interface ReconciliationItem {
  /** Validated route label, or invalid journal filename for a failed record. */
  hostname: string;
  /** Native identity classification; unverifiable live owners must not be recovered. */
  state: 'live' | 'recoverable' | 'unverifiable' | 'invalid';
  /** Count of recorded owned child generations. */
  generations: number;
  /** Optional host-only validation/recovery cause; not public telemetry. */
  error?: string;
  /** Optional explicit per-owner recovery receipt. */
  recovery?: RecoveryReport;
}
export interface ReconciliationReport {
  /** Count of matching bounded journal records inspected. */
  scanned: number;
  /** Count reporting successful recovery; preview may report zero. */
  recovered: number;
  /** Invalid, unverifiable or failed recovery count. */
  failed: number;
  /** Per-owner findings preserving explicit partial failures. */
  items: ReconciliationItem[];
}
export interface ReconciliationOptions {
  /** Preview only when true; default false performs authorized recovery. */
  dryRun?: boolean;
  /** Bounded per-owner termination wait, zero through 60000 milliseconds. */
  waitMs?: number;
  /** One through 1024 candidate files, default 128. */
  maxRecords?: number;
}
/** Maximum one-generation journal representation, 16 KiB. */
const MAX_RECORD_SIZE = 16_384;

/** Scan a bounded sorted set of private generation journals; isolate invalid records rather than hiding other owners.
 * @param {string} stateDir - Trusted private state directory.
 * @param {number} maxRecords - Validated maximum matching journal files.
 * @returns {ReconciliationItem[]} Host-only findings without signals or route changes.
 */
function inspectRecords(
  stateDir: string,
  maxRecords: number
): ReconciliationItem[] {
  let directory: string;
  try {
    directory = ensureControlDirectory(stateDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  /** Sorted fixed-pattern journal filenames; reject excessive cardinality before per-record reads. */
  const files = fs
    .readdirSync(directory)
    .filter((name) => /^[a-f0-9]{64}\.generations\.json$/.test(name))
    .sort();
  if (files.length > maxRecords) {
    throw new Error(
      `Too many rolling generation records (limit ${maxRecords})`
    );
  }
  /** Per-owner diagnostic receipts; one invalid owner does not hide the others. */
  const items: ReconciliationItem[] = [];
  for (const filename of files) {
    /** Fixed candidate path under the verified private directory. */
    const file = path.join(directory, filename);
    try {
      /** Bounded same-inode candidate metadata/bytes awaiting ownership checks. */
      const { stat: stat, bytes } = readStateFile(file, MAX_RECORD_SIZE);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > MAX_RECORD_SIZE ||
        (stat.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && stat.uid !== process.getuid())
      ) {
        throw new Error('Unsafe generation registry file');
      }
      /** Unknown parsed journal envelope used only to identify a validated route. */
      const contents: unknown = JSON.parse(bytes.toString('utf8'));
      /** Unknown hostname validated before computing the expected hashed path. */
      const hostname = (
        contents as {
          /** Validated route label, or invalid journal filename for a failed record. */
          hostname?: unknown;
        }
      )?.hostname;
      if (typeof hostname !== 'string') {
        throw new Error('Missing generation hostname');
      }
      validateControlName(hostname);
      if (generationRecordPath(stateDir, hostname) !== file) {
        throw new Error('Generation registry filename mismatch');
      }
      /** Fully validated generation journal reread through its owning module. */
      const record = readGenerationRecord(stateDir, hostname);
      if (!record) {
        throw new Error('Generation record disappeared during scan');
      }
      /** Current native process identity; a missing value is not proof a live owner is dead. */
      const identity = processIdentity(record.owner.pid);
      /** Live/recoverable/unverifiable classification preserving native identity uncertainty. */
      let state: ReconciliationItem['state'];
      if (identity === record.owner.identity) {
        state = 'live';
      } else if (identity === null && processExists(record.owner.pid)) {
        state = 'unverifiable';
      } else {
        state = 'recoverable';
      }
      items.push({ hostname, state, generations: record.children.length });
    } catch (error) {
      items.push({
        hostname: filename,
        state: 'invalid',
        generations: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return items;
}

/** Preview candidate controller identities without acquiring resources, signalling children or changing routes.
 * @param {string} stateDir - Host-authorized private namespace.
 * @param {number} maxRecords - One through 1024 records, default 128.
 * @returns {ReconciliationItem[]} Bounded read-only findings; unverifiable owners remain ineligible for recovery.
 */
export function inspectRollingControllers(
  stateDir: string,
  maxRecords = 128
): ReconciliationItem[] {
  if (
    !Number.isSafeInteger(maxRecords) ||
    maxRecords < 1 ||
    maxRecords > 1024
  ) {
    throw new RangeError('maxRecords must be 1–1024');
  }
  return inspectRecords(stateDir, maxRecords);
}

/** Hold the shared operation lock throughout bounded inspection and verified-dead-owner recovery; this is an explicit host-authorized process-control operation.
 * @param {string} stateDir - Trusted private namespace containing only host-owned generation journals.
 * @param {ReconciliationOptions} options - Explicit dry-run/wait/count policy; dry-run must be requested by the caller.
 * @returns {Promise<ReconciliationReport>} Per-owner recovered/failed findings; no all-or-nothing cross-owner transaction is claimed.
 */
export async function reconcileRollingControllers(
  stateDir: string,
  options: ReconciliationOptions = {}
): Promise<ReconciliationReport> {
  /** Explicit bounded host reconciliation policy; mutation remains opt-in at the caller boundary. */
  const { maxRecords = 128, dryRun = false, waitMs = 5_000 } = options;
  if (
    !Number.isSafeInteger(maxRecords) ||
    maxRecords < 1 ||
    maxRecords > 1024
  ) {
    throw new RangeError('Invalid reconciliation maxRecords');
  }
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 60_000) {
    throw new RangeError('Invalid reconciliation waitMs');
  }
  return withOperationLock(ensureControlDirectory(stateDir, true), async () => {
    /** Per-owner diagnostic receipts; one invalid owner does not hide the others. */
    const items = inspectRecords(stateDir, maxRecords);
    let recovered = 0;
    let failed = 0;
    for (const item of items) {
      if (item.state === 'invalid' || item.state === 'unverifiable') {
        failed++;
        continue;
      }
      if (item.state !== 'recoverable') {
        continue;
      }
      try {
        item.recovery = await recoverRollingGenerations(
          stateDir,
          item.hostname,
          { dryRun, waitMs }
        );
        if (item.recovery.recovered) {
          recovered++;
        }
      } catch (error) {
        item.error = error instanceof Error ? error.message : String(error);
        failed++;
      }
    }
    return { scanned: items.length, recovered, failed, items };
  });
}
