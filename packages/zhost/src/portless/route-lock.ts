import { readStateFile } from './state-file.js';
/** A synchronous, process-identity-verified lock for route registry mutations.
 * Never steal a lock merely because a slow operation exceeded an age threshold.
 * Orphaned directories without a valid owner require manual inspection.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createProcessMarker,
  markerMatchesProcess,
  parseProcessMarker,
  processExists,
  processIdentity,
} from './lifecycle.js';

export interface RouteLock {
  /** Idempotently release only this unchanged owner record and directory inode.
   * @returns {void} Does not delete a competing owner; unexpected filesystem errors propagate.
   */
  release(): void;
}
export interface RouteLockOptions {
  /** One through one thousand synchronous attempts, default twenty. */
  attempts?: number;
  /** Zero through five thousand milliseconds between attempts, default fifty. */
  delayMs?: number;
}
/** One local word used for bounded synchronous Atomics.wait; never shared as a cross-process lock. */
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
/** Block this thread between bounded route-lock attempts.
 * @param {number} ms Validated finite delay in milliseconds.
 * @returns {string} Native Atomics.wait result; callers only need completion. */
const sleep = (ms: number) => Atomics.wait(sleepBuffer, 0, 0, ms);

/** Remove only a proven-dead or reused-PID lock whose directory inode and owner bytes remain unchanged; ownerless/unverifiable locks require operator inspection.
 * @param {string} dir - Host-owned route-lock directory.
 * @returns {boolean} True only after removal, false for absent/in-progress/racing/live locks.
 */
function attemptRecovery(dir: string): boolean {
  /** Fixed owner marker beneath the trusted lock directory. */
  const markerPath = path.join(dir, 'owner.json');
  let before: fs.Stats;
  let raw: string;
  try {
    before = fs.lstatSync(dir);
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw new Error('Unsafe route lock directory');
    }
    raw = readStateFile(markerPath, 4096).bytes.toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Owner creation could still be underway. Do not steal ownerless directories.
      return false;
    }
    throw error;
  }
  /** Parsed process marker whose PID and native identity must be checked together. */
  const owner = parseProcessMarker(raw);
  if (!owner) {
    throw new Error(
      'Unverifiable route lock owner; manual inspection required'
    );
  }
  if (processExists(owner.pid)) {
    if (markerMatchesProcess(owner) || processIdentity(owner.pid) === null) {
      return false;
    }
  }
  try {
    /** Current directory inode/device, compared before deleting recorded ownership. */
    const after = fs.lstatSync(dir);
    if (
      before.ino !== after.ino ||
      before.dev !== after.dev ||
      readStateFile(markerPath, 4096).bytes.toString('utf8') !== raw
    ) {
      return false;
    }
    fs.unlinkSync(markerPath);
    fs.rmdirSync(dir);
    return true;
  } catch (error) {
    /** Native filesystem failure code used only for specific expected races. */
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTEMPTY' || code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

/** Synchronously acquire a bounded process-identity lock for host-authorized route mutations; never break a lock solely because it is old.
 * @param {string} directory - Existing trusted route-registry directory.
 * @param {RouteLockOptions} options - Bounded synchronous retry count and per-attempt sleep; this can block the event loop.
 * @returns {RouteLock} Owned conditional release handle; use finally to release after mutation.
 */
export function acquireRouteLock(
  directory: string,
  options: RouteLockOptions = {}
): RouteLock {
  /** Validated maximum synchronous acquisition attempts. */
  const attempts = options.attempts ?? 20;
  /** Validated bounded blocking delay between acquisition attempts. */
  const delayMs = options.delayMs ?? 50;
  if (
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    attempts > 1000 ||
    !Number.isSafeInteger(delayMs) ||
    delayMs < 0 ||
    delayMs > 5000
  ) {
    throw new RangeError('Invalid route lock timing');
  }
  /** Fixed route-lock directory under the host-controlled route registry. */
  const lockDir = path.join(directory, 'routes.lock');
  /** Fixed owner marker beneath the trusted lock directory. */
  const markerPath = path.join(lockDir, 'owner.json');
  /** Exact new owner bytes retained for conditional release. */
  const raw = JSON.stringify(createProcessMarker()) + '\n';
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      fs.mkdirSync(lockDir, 0o700);
      try {
        fs.writeFileSync(markerPath, raw, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        try {
          fs.rmdirSync(lockDir);
        } catch {
          /* This optional failure is intentionally ignored. */
        }
        throw error;
      }
      /** Acquired directory identity retained to avoid deleting a replacement lock. */
      const stat = fs.lstatSync(lockDir);
      let released = false;
      return {
        /** Idempotently release only this unchanged owner record and directory inode.
         * @returns {void} Does not delete a competing owner; unexpected filesystem errors propagate.
         */
        release() {
          if (released) {
            return;
          }
          released = true;
          try {
            /** Current directory identity checked before release. */
            const current = fs.lstatSync(lockDir);
            if (
              stat.ino !== current.ino ||
              stat.dev !== current.dev ||
              readStateFile(markerPath, 4096).bytes.toString('utf8') !== raw
            ) {
              return;
            }
            fs.unlinkSync(markerPath);
            fs.rmdirSync(lockDir);
          } catch (error) {
            /** Native filesystem failure code used only for specific expected races. */
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== 'ENOENT' && code !== 'ENOTEMPTY') {
              throw error;
            }
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      if (attemptRecovery(lockDir)) {
        continue;
      }
      if (attempt + 1 < attempts) {
        sleep(delayMs);
      }
    }
  }
  throw new Error('Route registry is locked by another process');
}
