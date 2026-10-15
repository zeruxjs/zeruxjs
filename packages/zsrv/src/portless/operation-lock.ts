/** Cross-process serialization of proxy startup and restart operations.
 * A lock is never stolen from a live or unverifiable owner.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createProcessMarker, markerMatchesProcess, parseProcessMarker, processExists, processIdentity, type ProcessMarker } from './lifecycle.js';

export interface OperationLockOptions { timeoutMs?: number; pollMs?: number }
export interface OperationLock { readonly filename: string; release(): void }
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function validate(options: OperationLockOptions): Required<OperationLockOptions> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pollMs = options.pollMs ?? 75;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 300_000 ||
      !Number.isSafeInteger(pollMs) || pollMs < 1 || pollMs > 5_000)
    throw new RangeError('Invalid proxy operation lock timing');
  return { timeoutMs, pollMs };
}

/** Atomically remove a stale lock only if the same inode and content remain.
 * Never unlink a live owner's lock, even when a long operation exceeds the timeout.
 */
function removeStaleLock(filename: string): boolean {
  let raw: string;
  let before: fs.Stats;
  try {
    before = fs.lstatSync(filename);
    if (!before.isFile() || before.isSymbolicLink()) throw new Error('Unsafe proxy operation lock type');
    raw = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
  const marker = parseProcessMarker(raw);
  if (!marker) throw new Error('Unverifiable proxy operation lock; manual inspection required');
  if (processExists(marker.pid) && markerMatchesProcess(marker)) return false;
  // Fail closed when identity cannot be read for an otherwise live process.
  if (processExists(marker.pid) && !markerMatchesProcess(marker)) {
    // A distinct process now owns the PID: the recorded owner is gone.
    // An unavailable fingerprint must not be mistaken for PID reuse.
    if (processIdentity(marker.pid) === null) return false;
  }
  try {
    const after = fs.lstatSync(filename);
    if (before.dev !== after.dev || before.ino !== after.ino || fs.readFileSync(filename, 'utf8') !== raw) return false;
    fs.unlinkSync(filename);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

export async function acquireOperationLock(stateDir: string, options: OperationLockOptions = {}): Promise<OperationLock> {
  const { timeoutMs, pollMs } = validate(options);
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const filename = path.join(stateDir, '.proxy-operation.lock');
  const owner: ProcessMarker = createProcessMarker();
  const raw = JSON.stringify(owner) + '\n';
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = fs.openSync(filename, 'wx', 0o600);
      try { fs.writeFileSync(fd, raw); fs.fsyncSync(fd); }
      catch (error) { fs.closeSync(fd); try { fs.unlinkSync(filename); } catch {} throw error; }
      fs.closeSync(fd);
      let released = false;
      return { filename, release() {
        if (released) return;
        released = true;
        try { if (fs.readFileSync(filename, 'utf8') === raw) fs.unlinkSync(filename); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (removeStaleLock(filename)) continue;
      if (Date.now() >= deadline) throw new Error(`Proxy operation already in progress: ${filename}`);
      await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    }
  }
}

export async function withOperationLock<T>(stateDir: string, operation: () => Promise<T>, options?: OperationLockOptions): Promise<T> {
  const lock = await acquireOperationLock(stateDir, options);
  try { return await operation(); }
  finally { lock.release(); }
}
