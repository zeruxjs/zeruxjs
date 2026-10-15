/** Private, bounded audit trail for fleet lifecycle and scaling decisions. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { ensureControlDirectory, controlDirectory, validateControlName } from './local-control.js';
export type FleetEventKind = 'start' | 'phase' | 'scale' | 'replacement' | 'budget' | 'autoscale' | 'stop' | 'failure';
export interface FleetEvent {
  id: string;
  at: string;
  kind: FleetEventKind;
  message: string;
  desiredReplicas: number;
  generation: number;
}
const MAX_EVENTS = 100;
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 65536;
export function fleetHistoryPath(stateDir: string, hostname: string): string {
  validateControlName(hostname);
  return path.join(controlDirectory(stateDir), createHash('sha256').update(`history:${hostname}`).digest('hex') + '.fleet-history.json');
}
function isEvent(value: any): value is FleetEvent {
  return value && typeof value === 'object' && /^[a-f0-9]{24}$/.test(value.id) &&
    typeof value.at === 'string' && Number.isFinite(Date.parse(value.at)) &&
    ['start','phase','scale','replacement','budget','autoscale','stop','failure'].includes(value.kind) &&
    typeof value.message === 'string' && value.message.length <= 512 &&
    Number.isSafeInteger(value.desiredReplicas) && value.desiredReplicas >= 2 && value.desiredReplicas <= 16 &&
    Number.isSafeInteger(value.generation) && value.generation >= 0;
}
export function readFleetHistory(stateDir: string, hostname: string): FleetEvent[] {
  const filename = fleetHistoryPath(stateDir, hostname);
  try {
    ensureControlDirectory(stateDir);
    const info = fs.lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES || (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('Unsafe fleet history file');
    const content: unknown = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!Array.isArray(content) || content.length > MAX_EVENTS || !content.every(isEvent)) throw new Error('Invalid fleet history');
    return content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
export function appendFleetHistory(stateDir: string, hostname: string, event: Omit<FleetEvent, 'id' | 'at'>, now = Date.now()): FleetEvent {
  if (!isEvent({ ...event, id: '0'.repeat(24), at: new Date(now).toISOString() })) throw new TypeError('Invalid fleet event');
  ensureControlDirectory(stateDir, true);
  const filename = fleetHistoryPath(stateDir, hostname);
  const entry: FleetEvent = { ...event, id: randomBytes(12).toString('hex'), at: new Date(now).toISOString() };
  const history = [...readFleetHistory(stateDir, hostname).filter(item => Date.parse(item.at) >= now - MAX_AGE), entry].slice(-MAX_EVENTS);
  const payload = JSON.stringify(history) + '\n';
  if (Buffer.byteLength(payload) > MAX_BYTES) throw new Error('Fleet event history exceeds size limit');
  const temp = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, payload); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { if (fs.lstatSync(filename).isSymbolicLink()) throw new Error('Unsafe fleet history symlink'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    fs.renameSync(temp, filename);
  } finally { try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  return entry;
}
