import { readStateFile } from './state-file.js';
/** Cross-process serialization of proxy startup and restart operations.
 * A lock is never stolen from a live or unverifiable owner.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createProcessMarker,
  markerMatchesProcess,
  parseProcessMarker,
  processExists,
  processIdentity,
  type ProcessMarker,
} from './lifecycle.js';

export interface OperationLockOptions {
  /** Acquisition timeout in milliseconds, zero through 300000; does not evict a live owner. */
  timeoutMs?: number;
  /** Poll interval in milliseconds, one through 5000. */
  pollMs?: number;
}
export interface OperationLock {
  /** Owned lock path for host diagnostics, not an authorization token. */
  readonly filename: string;
  /** Release this process marker only while its exact bytes are still present.
   * @returns {void} Idempotent conditional removal; unexpected filesystem errors remain visible.
   */
  release(): void;
}
/** Yield between finite lock polls.
 * @param {number} ms Bounded remaining acquisition delay.
 * @returns {Promise<void>} Settles on the owned one-shot timer. */
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Validate finite lock acquisition and poll budgets without changing filesystem state.
 * @param {OperationLockOptions} options - Trusted optional bounded host timing settings.
 * @returns {Required<OperationLockOptions>} Normalized integer deadlines and poll intervals.
 */
function validate(
  options: OperationLockOptions
): Required<OperationLockOptions> {
  /** Validated total acquisition wait budget. */
  const timeoutMs = options.timeoutMs ?? 10_000;
  /** Validated maximum delay between acquisition attempts. */
  const pollMs = options.pollMs ?? 75;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > 300_000 ||
    !Number.isSafeInteger(pollMs) ||
    pollMs < 1 ||
    pollMs > 5_000
  ) {
    throw new RangeError('Invalid proxy operation lock timing');
  }
  return { timeoutMs, pollMs };
}

/** Remove a proven-dead/reused-PID lock only if its inode and bytes still match; missing native identity for a live PID fails closed.
 * @param {string} filename - Fixed lock file beneath the host-owned state directory.
 * @returns {boolean} Whether the file is now absent; false means ownership is live, racing or unverifiable.
 */
function removeStaleLock(filename: string): boolean {
  let raw: string;
  let before: fs.Stats;
  try {
    /** Same-inode bounded lock bytes and metadata used for race checks. */
    const opened = readStateFile(filename, 4096);
    before = opened.stat;
    raw = opened.bytes.toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return true;
    }
    throw error;
  }
  /** Parsed owner marker requiring native identity verification. */
  const marker = parseProcessMarker(raw);
  if (!marker) {
    throw new Error(
      'Unverifiable proxy operation lock; manual inspection required'
    );
  }
  if (processExists(marker.pid) && markerMatchesProcess(marker)) {
    return false;
  }
  // Fail closed when identity cannot be read for an otherwise live process.
  if (processExists(marker.pid) && !markerMatchesProcess(marker)) {
    // A distinct process now owns the PID: the recorded owner is gone.
    // An unavailable fingerprint must not be mistaken for PID reuse.
    if (processIdentity(marker.pid) === null) {
      return false;
    }
  }
  try {
    /** Same-inode bounded lock bytes and metadata used for race checks. */
    const opened = readStateFile(filename, 4096);
    /** Current lock metadata compared before removing a stale file. */
    const after = opened.stat;
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      opened.bytes.toString('utf8') !== raw
    ) {
      return false;
    }
    fs.unlinkSync(filename);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return true;
    }
    throw error;
  }
}

/** Acquire a private startup/restart mutex with finite asynchronous polling; callers own safe state-directory policy.
 * @param {string} stateDir - Trusted host-owned proxy state directory.
 * @param {OperationLockOptions} options - Bounded wait and poll policy; a long-lived owner is never stolen on timeout.
 * @returns {Promise<OperationLock>} Owned file lock handle; release from finally after the protected operation.
 */
export async function acquireOperationLock(
  stateDir: string,
  options: OperationLockOptions = {}
): Promise<OperationLock> {
  /** Validated finite acquisition and poll settings. */
  const { timeoutMs, pollMs } = validate(options);
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  /** Fixed private startup/restart mutex filename. */
  const filename = path.join(stateDir, '.proxy-operation.lock');
  /** Native current process marker, not just a numeric PID. */
  const owner: ProcessMarker = createProcessMarker();
  /** Exact serialized owner bytes used for conditional release. */
  const raw = JSON.stringify(owner) + '\n';
  /** Local acquisition cutoff; it never authorizes breaking an existing lock. */
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      /** Owned exclusively created marker descriptor, closed on both write success and failure. */
      const fd = fs.openSync(filename, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, raw);
        fs.fsyncSync(fd);
      } catch (error) {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(filename);
        } catch {
          /* This optional failure is intentionally ignored. */
        }
        throw error;
      }
      fs.closeSync(fd);
      let released = false;
      return {
        filename,
        /** Release this process marker only while its exact bytes are still present.
         * @returns {void} Idempotent conditional removal; unexpected filesystem errors remain visible.
         */ release() {
          if (released) {
            return;
          }
          released = true;
          try {
            if (readStateFile(filename, 4096).bytes.toString('utf8') === raw) {
              fs.unlinkSync(filename);
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw error;
            }
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      if (removeStaleLock(filename)) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Proxy operation already in progress: ${filename}`);
      }
      await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    }
  }
}

/** Run one explicit trusted operation under the process-identity lock and always release ownership afterward.
 * @param {string} stateDir - Trusted host-owned proxy state directory.
 * @param {() => Promise<T>} operation - Trusted host callback invoked once; no automatic replay on failure.
 * @param {OperationLockOptions} options - Optional bounded acquisition timing.
 * @returns {Promise<T>} The callback result, preserving rejection and visible release failures.
 */
export async function withOperationLock<T>(
  stateDir: string,
  operation: () => Promise<T>,
  options?: OperationLockOptions
): Promise<T> {
  /** Acquired ownership handle released even if the operation rejects. */
  const lock = await acquireOperationLock(stateDir, options);
  try {
    return await operation();
  } finally {
    lock.release();
  }
}
