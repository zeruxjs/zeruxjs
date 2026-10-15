/** Bounded, private deployment audit trail. History is diagnostic state; it is
 * never used to authorize process termination or route ownership. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { ensureControlDirectory, validateControlName } from './local-control.js';
import type { RollingStatus, RollingDeployResult } from './rolling-app.js';
export type DeploymentOutcome = 'started' | 'deployed' | 'failed' | 'stopped';
export interface DeploymentEvent {
  timestamp: string;
  outcome: DeploymentOutcome;
  generation: number;
  fromPort?: number;
  toPort?: number;
  drained?: boolean;
  error?: string;
}
export interface DeploymentRecord {
  version: 1;
  hostname: string;
  status: RollingStatus;
  history: DeploymentEvent[];
}
const MAX_HISTORY = 50;
const DEFAULT_HISTORY_DAYS = 90;
export interface HistoryRetentionOptions { days?: number; maxEvents?: number }
export interface HistoryPruneResult { hostname: string; removed: number; remaining: number; }
function retention(options: HistoryRetentionOptions = {}) {
  const days = options.days ?? DEFAULT_HISTORY_DAYS;
  const maxEvents = options.maxEvents ?? MAX_HISTORY;
  if (!Number.isSafeInteger(days) || days < 0 || days > 3650 ||
      !Number.isSafeInteger(maxEvents) || maxEvents < 0 || maxEvents > MAX_HISTORY) {
    throw new RangeError('History retention must use 0–3650 days and 0–50 events');
  }
  return { days, maxEvents };
}
function compactHistory(events: DeploymentEvent[], options: HistoryRetentionOptions, now = Date.now()): DeploymentEvent[] {
  const { days, maxEvents } = retention(options);
  const threshold = now - days * 86400_000;
  return events.filter(event => Number.isFinite(Date.parse(event.timestamp)) && Date.parse(event.timestamp) >= threshold).slice(-maxEvents).slice(0, maxEvents);
}
const MAX_FILE_BYTES = 32768;
function filename(stateDir: string, hostname: string): string {
  validateControlName(hostname);
  return path.join(ensureControlDirectory(stateDir), `${createHash('sha256').update(hostname).digest('hex')}.history.json`);
}
function safeRead(file: string): DeploymentRecord | null {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) || st.size > MAX_FILE_BYTES ||
      (typeof process.getuid === 'function' && st.uid !== process.getuid())) throw new Error('Unsafe deployment history file');
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof value !== 'object' || value === null) throw new Error('Invalid deployment history');
    const record = value as DeploymentRecord;
    if (record.version !== 1 || typeof record.hostname !== 'string' || !Array.isArray(record.history) ||
        record.history.length > MAX_HISTORY || !record.status || typeof record.status.phase !== 'string') throw new Error('Invalid deployment history');
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export function readDeploymentHistory(stateDir: string, hostname: string): DeploymentRecord | null {
  validateControlName(hostname);
  try {
    const record = safeRead(filename(stateDir, hostname));
    if (record && record.hostname !== hostname) throw new Error('Deployment history belongs to a different hostname');
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
function atomicWrite(file: string, text: string): void {
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error('Deployment history too large');
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Unsafe deployment history symlink'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    fs.renameSync(tmp, file);
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}
export function createDeploymentHistory(stateDir: string, hostname: string, initial: RollingStatus, options: HistoryRetentionOptions = {}) {
  retention(options);
  ensureControlDirectory(stateDir, true);
  let previous = readDeploymentHistory(stateDir, hostname);
  let status = { ...initial };
  let history: DeploymentEvent[] = compactHistory(previous?.history ?? [], options);
  const save = () => {
    history = compactHistory(history, options);
    atomicWrite(filename(stateDir, hostname), JSON.stringify({ version: 1, hostname, status, history }) + '\n');
  };
  const update = (next: Readonly<RollingStatus>) => { status = { ...next }; save(); };
  const record = (outcome: DeploymentOutcome, details: Partial<RollingDeployResult> & { error?: string } = {}) => {
    const event: DeploymentEvent = { timestamp: new Date().toISOString(), outcome, generation: status.generation,
      ...(details.fromPort !== undefined ? { fromPort: details.fromPort } : {}),
      ...(details.toPort !== undefined ? { toPort: details.toPort } : {}),
      ...(details.drained !== undefined ? { drained: details.drained } : {}),
      ...(details.error !== undefined ? { error: details.error.slice(0, 240) } : {}) };
    history = compactHistory([...history, event], options);
    save();
  };
  save();
  return { update, record, get current(): DeploymentRecord { return { version: 1, hostname, status: { ...status }, history: [...history] }; } };
}

/** Compact only the owner's private history file. CLI coordinates this with
 * controller startup using the shared operation lock. */
export function pruneDeploymentHistory(stateDir: string, hostname: string, options: HistoryRetentionOptions = {}): HistoryPruneResult {
  retention(options);
  const record = readDeploymentHistory(stateDir, hostname);
  if (!record) return { hostname, removed: 0, remaining: 0 };
  const history = compactHistory(record.history, options);
  atomicWrite(filename(stateDir, hostname), JSON.stringify({ ...record, history }) + '\n');
  return { hostname, removed: record.history.length - history.length, remaining: history.length };
}
