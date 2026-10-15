/** Privacy-preserving and bounded fleet metric snapshots, stored outside deployment ownership records. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { ensureControlDirectory, controlDirectory, validateControlName } from './local-control.js';
import type { FleetAutoscaleObservation } from './fleet-autoscaler.js';
export interface FleetMetricPoint extends FleetAutoscaleObservation {
  id: string;
}
const MAX_POINTS = 240;
const MAX_BYTES = 65536;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MIN_WRITE_MS = 30000;
export function fleetMetricHistoryPath(dir: string, hostname: string): string {
  validateControlName(hostname);
  return path.join(controlDirectory(dir), createHash('sha256').update(`fleet-metric-history:${hostname}`).digest('hex')+'.json');
}
function valid(point: unknown, now = Date.now()): point is FleetMetricPoint {
  if (!point || typeof point !== 'object') return false;
  const p = point as FleetMetricPoint;
  return typeof p.id === 'string' && /^[a-f0-9]{16}$/.test(p.id) &&
    Number.isSafeInteger(p.sampledAt) && p.sampledAt >= 0 && p.sampledAt <= now + 30000 &&
    ['cpu','memory','rps'].includes(p.metric) && Number.isFinite(p.value) && p.value >= 0 && p.value <= 1_000_000 &&
    Number.isSafeInteger(p.desiredReplicas) && p.desiredReplicas >= 2 && p.desiredReplicas <= 16 &&
    typeof p.downscaleAllowed === 'boolean';
}
export function readFleetMetricHistory(dir: string, hostname: string, now = Date.now()): FleetMetricPoint[] {
  const file = fleetMetricHistoryPath(dir, hostname);
  try {
    ensureControlDirectory(dir);
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || st.size > MAX_BYTES || (st.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && st.uid !== process.getuid())) throw new Error('Unsafe fleet metric history');
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(value) || value.length > MAX_POINTS || !value.every(row => valid(row, now))) {
      throw new Error('Corrupt fleet metric history');
    }
    return value.filter(point => point.sampledAt >= now - RETENTION_MS);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
export class FleetMetricHistory {
  private lastSaved = 0;
  constructor(private readonly dir: string, private readonly hostname: string) {
    const prior = readFleetMetricHistory(dir, hostname);
    this.lastSaved = prior.at(-1)?.sampledAt ?? 0;
  }
  /** Persists at most once every 30s, even when autoscaling samples are frequent. */
  record(observation: FleetAutoscaleObservation, now = Date.now()): boolean {
    if (!valid({ ...observation, id: '0'.repeat(16) }, now)) throw new TypeError('Invalid fleet metric point');
    if (now < this.lastSaved + MIN_WRITE_MS) return false;
    ensureControlDirectory(this.dir, true);
    const file = fleetMetricHistoryPath(this.dir, this.hostname);
    const points = readFleetMetricHistory(this.dir, this.hostname, now)
      .filter(point => point.sampledAt >= now - RETENTION_MS);
    const next: FleetMetricPoint = { ...observation, id: randomBytes(8).toString('hex') };
    const payload = JSON.stringify([...points, next].slice(-MAX_POINTS))+'\n';
    if (Buffer.byteLength(payload) > MAX_BYTES) throw new Error('Fleet metric history size limit exceeded');
    const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd,payload); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      try { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Unsafe fleet metric history symlink'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      fs.renameSync(temporary,file);
      this.lastSaved = now;
      return true;
    } finally { try { fs.unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  }
}
