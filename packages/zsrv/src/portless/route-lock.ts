/** A synchronous, process-identity-verified lock for route registry mutations.
 * Never steal a lock merely because a slow operation exceeded an age threshold.
 * Orphaned directories without a valid owner require manual inspection.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createProcessMarker, markerMatchesProcess, parseProcessMarker, processExists, processIdentity } from './lifecycle.js';

export interface RouteLock { release(): void }
export interface RouteLockOptions { attempts?: number; delayMs?: number }
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms: number) => Atomics.wait(sleepBuffer, 0, 0, ms);

function attemptRecovery(dir: string): boolean {
  const markerPath = path.join(dir, 'owner.json');
  let before: fs.Stats;
  let raw: string;
  try {
    before = fs.lstatSync(dir);
    if (!before.isDirectory() || before.isSymbolicLink()) throw new Error('Unsafe route lock directory');
    const ownerStat = fs.lstatSync(markerPath);
    if (!ownerStat.isFile() || ownerStat.isSymbolicLink() || ownerStat.size > 4096) throw new Error('Unsafe route lock owner');
    raw = fs.readFileSync(markerPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Owner creation could still be underway. Do not steal ownerless directories.
      return false;
    }
    throw error;
  }
  const owner = parseProcessMarker(raw);
  if (!owner) throw new Error('Unverifiable route lock owner; manual inspection required');
  if (processExists(owner.pid)) {
    if (markerMatchesProcess(owner) || processIdentity(owner.pid) === null) return false;
  }
  try {
    const after = fs.lstatSync(dir);
    if (before.ino !== after.ino || before.dev !== after.dev || fs.readFileSync(markerPath, 'utf8') !== raw) return false;
    fs.unlinkSync(markerPath);
    fs.rmdirSync(dir);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTEMPTY' || code === 'EEXIST') return false;
    throw error;
  }
}

export function acquireRouteLock(directory: string, options: RouteLockOptions = {}): RouteLock {
  const attempts = options.attempts ?? 20;
  const delayMs = options.delayMs ?? 50;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 1000 ||
      !Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 5000) throw new RangeError('Invalid route lock timing');
  const lockDir = path.join(directory, 'routes.lock');
  const markerPath = path.join(lockDir, 'owner.json');
  const raw = JSON.stringify(createProcessMarker()) + '\n';
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      fs.mkdirSync(lockDir, 0o700);
      try { fs.writeFileSync(markerPath, raw, { flag: 'wx', mode: 0o600 }); }
      catch (error) { try { fs.rmdirSync(lockDir); } catch {} throw error; }
      const stat = fs.lstatSync(lockDir);
      let released = false;
      return { release() {
        if (released) return;
        released = true;
        try {
          const current = fs.lstatSync(lockDir);
          if (stat.ino !== current.ino || stat.dev !== current.dev ||
              fs.readFileSync(markerPath, 'utf8') !== raw) return;
          fs.unlinkSync(markerPath);
          fs.rmdirSync(lockDir);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT' && code !== 'ENOTEMPTY') throw error;
        }
      }};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (attemptRecovery(lockDir)) continue;
      if (attempt + 1 < attempts) sleep(delayMs);
    }
  }
  throw new Error('Route registry is locked by another process');
}
