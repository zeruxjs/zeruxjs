/** Durable, private fleet checkpoint. Persist retry timestamps *before* a
 * replacement attempt to prevent a supervisor restart resetting rate limits. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { ensureControlDirectory, validateControlName } from './local-control.js';
import type { FleetStatus } from './fleet-types.js';
import type { AutoscaleState } from './autoscale-policy.js';

const MAX_BYTES = 65536;
export interface FleetCheckpoint {
  version: 1;
  hostname: string;
  configuration: string;
  owner: { pid: number; identity: string };
  status: FleetStatus;
  attempts: number[];
  autoscale?: { paused: boolean; lastScaledAt: number };
  updatedAt: string;
}
export function fleetStatePath(stateDir: string, hostname: string): string {
  validateControlName(hostname);
  return path.join(ensureControlDirectory(stateDir), `${createHash('sha256').update('fleet:' + hostname).digest('hex')}.fleet.json`);
}
export function fingerprintFleetConfig(command: readonly string[], ports: readonly number[], replicas: number, windowMs: number, autoscale?: unknown): string {
  return createHash('sha256').update(JSON.stringify({ command, ports, replicas, windowMs, autoscale })).digest('hex');
}
function validateSnapshot(value: unknown, hostname: string): value is FleetCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const v = value as FleetCheckpoint;
  return v.version === 1 && v.hostname === hostname && /^[a-f0-9]{64}$/.test(v.configuration) &&
    Number.isSafeInteger(v.owner?.pid) && v.owner.pid > 1 && typeof v.owner.identity === 'string' && v.owner.identity.length > 0 && v.owner.identity.length < 256 &&
    typeof v.updatedAt === 'string' && !Number.isNaN(Date.parse(v.updatedAt)) &&
    !!v.status && v.status.hostname === hostname &&
    ['starting', 'running', 'degraded', 'stopping', 'stopped'].includes(v.status.phase) &&
    Number.isSafeInteger(v.status.generation) && v.status.generation >= 0 &&
    Number.isSafeInteger(v.status.desiredReplicas) && v.status.desiredReplicas >= 2 && v.status.desiredReplicas <= 16 &&
    Array.isArray(v.status.members) && v.status.members.length <= 16 &&
    v.status.members.every(m => Number.isSafeInteger(m.port) && m.port > 0 && m.port <= 65535 &&
      (m.pid === null || Number.isSafeInteger(m.pid) && m.pid > 1) && typeof m.healthy === 'boolean' && typeof m.routed === 'boolean') &&
    (v.autoscale === undefined || (v.autoscale && typeof v.autoscale.paused === 'boolean' &&
      Number.isSafeInteger(v.autoscale.lastScaledAt) && v.autoscale.lastScaledAt >= 0 &&
      v.autoscale.lastScaledAt <= Date.now() + 30_000)) &&
    Array.isArray(v.attempts) && v.attempts.length <= 1000 &&
    v.attempts.every((n, i) => Number.isSafeInteger(n) && n >= 0 && n <= Date.now() + 30_000 && (i === 0 || v.attempts[i - 1] <= n));
}
export function readFleetCheckpoint(stateDir: string, hostname: string): FleetCheckpoint | null {
  try {
    const file = fleetStatePath(stateDir, hostname);
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || st.size > MAX_BYTES || (st.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && st.uid !== process.getuid())) throw new Error('Unsafe fleet checkpoint');
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!validateSnapshot(value, hostname)) throw new Error('Invalid fleet checkpoint');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
function writeCheckpoint(file: string, record: FleetCheckpoint): void {
  const payload = JSON.stringify(record) + '\n';
  if (Buffer.byteLength(payload) > MAX_BYTES) throw new Error('Fleet checkpoint exceeds size limit');
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, payload); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Unsafe fleet checkpoint symlink'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    fs.renameSync(temporary, file);
    try { const fd = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch { /* unsupported filesystems */ }
  } finally { try { fs.unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
}
export function createFleetCheckpointWriter(stateDir: string, hostname: string, configuration: string, identity: string) {
  if (!/^[a-f0-9]{64}$/.test(configuration) || !identity) throw new Error('Invalid fleet checkpoint owner/configuration');
  ensureControlDirectory(stateDir, true);
  const file = fleetStatePath(stateDir, hostname);
  const previous = readFleetCheckpoint(stateDir, hostname);
  if (previous && previous.configuration !== configuration) {
    throw new Error('Fleet configuration differs from retained restart budget; inspect checkpoint before changing deployment');
  }
  let status: FleetStatus | undefined;
  let attempts = previous?.attempts ?? [];
  let autoscale = previous?.autoscale;
  const save = () => {
    if (!status) return;
    writeCheckpoint(file, { version: 1, hostname, configuration, owner: { pid: process.pid, identity },
      status, attempts: [...attempts], autoscale, updatedAt: new Date().toISOString() });
  };
  return {
    restoredAttempts: [...attempts] as readonly number[],
    restoredReplicas: previous?.status.desiredReplicas,
    restoredAutoscale: autoscale ? { ...autoscale } : undefined,
    /** Preserve pause state and cooldown across supervisor restarts. */
    setAutoscale(next: Pick<AutoscaleState, 'paused' | 'lastScaledAt'>) {
      const prior = autoscale;
      autoscale = { paused: next.paused, lastScaledAt: next.lastScaledAt };
      try { save(); } catch (error) { autoscale = prior; throw error; }
    },
    update(next: Readonly<FleetStatus>) { status = structuredClone(next); save(); },
    /** Called synchronously before a restart attempt is made. */
    attempt(next: readonly number[]) {
      const previousAttempts = attempts;
      attempts = [...next];
      try { save(); } catch (error) { attempts = previousAttempts; throw error; }
    },
    get snapshot() { return readFleetCheckpoint(stateDir, hostname); },
  };
}

/** Remove an OFFLINE checkpoint to explicitly accept a changed fleet policy.
 * Callers must hold the private control-directory operation lock and verify
 * that no controller or recovery generations still own the hostname. */
export function removeFleetCheckpoint(stateDir: string, hostname: string): boolean {
  const file = fleetStatePath(stateDir, hostname);
  const current = readFleetCheckpoint(stateDir, hostname);
  if (!current) return false;
  const before = fs.lstatSync(file);
  // Do not unlink a replacement checkpoint written after our read.
  const after = fs.lstatSync(file);
  if (before.ino !== after.ino || before.dev !== after.dev ||
      JSON.stringify(readFleetCheckpoint(stateDir, hostname)) !== JSON.stringify(current)) {
    throw new Error('Fleet checkpoint changed during reset');
  }
  fs.unlinkSync(file);
  return true;
}
