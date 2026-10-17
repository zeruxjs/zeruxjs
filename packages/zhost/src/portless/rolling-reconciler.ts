/** Find interrupted rolling controllers in this OS user's private control dir.
 * Reconciliation is serialized with normal rolling startup and refuses to touch
 * live/unverifiable owners; one corrupt record does not hide other orphans. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureControlDirectory, validateControlName } from './local-control.js';
import { generationRecordPath, readGenerationRecord, recoverRollingGenerations, type RecoveryReport } from './generation-registry.js';
import { withOperationLock } from './operation-lock.js';
import { processExists, processIdentity } from './lifecycle.js';

export interface ReconciliationItem {
  hostname: string;
  state: 'live' | 'recoverable' | 'unverifiable' | 'invalid';
  generations: number;
  error?: string;
  recovery?: RecoveryReport;
}
export interface ReconciliationReport {
  scanned: number;
  recovered: number;
  failed: number;
  items: ReconciliationItem[];
}
export interface ReconciliationOptions { dryRun?: boolean; waitMs?: number; maxRecords?: number }
const MAX_RECORD_SIZE = 16_384;

function inspectRecords(stateDir: string, maxRecords: number): ReconciliationItem[] {
  let directory: string;
  try { directory = ensureControlDirectory(stateDir); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files = fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.generations\.json$/.test(name)).sort();
  if (files.length > maxRecords) throw new Error(`Too many rolling generation records (limit ${maxRecords})`);
  const items: ReconciliationItem[] = [];
  for (const filename of files) {
    const file = path.join(directory, filename);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RECORD_SIZE || (stat.mode & 0o077) !== 0 ||
          (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
        throw new Error('Unsafe generation registry file');
      }
      const contents: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      const hostname = (contents as { hostname?: unknown })?.hostname;
      if (typeof hostname !== 'string') throw new Error('Missing generation hostname');
      validateControlName(hostname);
      if (generationRecordPath(stateDir, hostname) !== file) throw new Error('Generation registry filename mismatch');
      const record = readGenerationRecord(stateDir, hostname);
      if (!record) throw new Error('Generation record disappeared during scan');
      const identity = processIdentity(record.owner.pid);
      const state: ReconciliationItem['state'] = identity === record.owner.identity ? 'live' :
        (identity === null && processExists(record.owner.pid)) ? 'unverifiable' : 'recoverable';
      items.push({ hostname, state, generations: record.children.length });
    } catch (error) {
      items.push({ hostname: filename, state: 'invalid', generations: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return items;
}

/** Read-only preview of candidate controllers. No signals or route writes. */
export function inspectRollingControllers(stateDir: string, maxRecords = 128): ReconciliationItem[] {
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 1024) {
    throw new RangeError('maxRecords must be 1–1024');
  }
  return inspectRecords(stateDir, maxRecords);
}

/** Reconcile verified dead owners only. Errors are reported individually.
 * Lock covers the entire scan and recovery to exclude competing startups. */
export async function reconcileRollingControllers(stateDir: string, options: ReconciliationOptions = {}): Promise<ReconciliationReport> {
  const { maxRecords = 128, dryRun = false, waitMs = 5_000 } = options;
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 1024) throw new RangeError('Invalid reconciliation maxRecords');
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 60_000) throw new RangeError('Invalid reconciliation waitMs');
  return withOperationLock(ensureControlDirectory(stateDir, true), async () => {
    const items = inspectRecords(stateDir, maxRecords);
    let recovered = 0;
    let failed = 0;
    for (const item of items) {
      if (item.state === 'invalid' || item.state === 'unverifiable') { failed++; continue; }
      if (item.state !== 'recoverable') continue;
      try {
        item.recovery = await recoverRollingGenerations(stateDir, item.hostname, { dryRun, waitMs });
        if (item.recovery.recovered) recovered++;
      } catch (error) {
        item.error = error instanceof Error ? error.message : String(error);
        failed++;
      }
    }
    return { scanned: items.length, recovered, failed, items };
  });
}
