import { opendir, lstat } from 'node:fs/promises';
import path from 'node:path';
export interface Entry {
  /** Modification timestamp in milliseconds; unchanged timestamps can hide same-size writes. */
  mtimeMs: number;
  /** File size in bytes, used with modification time to detect updates. */
  size: number;
}
export interface ScanOptions {
  /** Maximum examined directory-entry names, including ignored names. */
  maxEntries?: number;
  /** Cooperative admission/traversal cancellation; native reads may still settle later. */
  signal?: AbortSignal;
}
/** Redacted message/code; cause is internal and can contain filesystem paths. */
export class ScanError extends Error {
  /** Fixed diagnostic category; the inherited cause remains private. */
  readonly code: string;
  /** Create a redacted scan failure while retaining the private underlying cause.
   * @param {string} code - Fixed failure category safe for diagnostics.
   * @param {unknown} cause - Private filesystem or callback failure; do not expose it publicly.
   */
  constructor(code: string, cause?: unknown) {
    super(`Filesystem scan failed (${code})`, { cause });
    this.name = 'ScanError';
    this.code = code;
  }
}
let scanning = 0;
/** FIFO admission waiters; waking transfers an occupied scan slot without increasing concurrency. */
const waiting: (() => void)[] = [];
/** Acquire one of four process-local scan slots or join the bounded FIFO queue.
 * @param {AbortSignal} signal - Optional cancellation of admission waiting.
 * @returns {Promise<() => void>} Idempotent release callback; cancellation does not interrupt an active OS operation.
 */
async function acquire(signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted();
  if (scanning >= 4) {
    if (waiting.length >= 128) {
      throw new ScanError('SCAN_QUEUE_LIMIT');
    }
    await new Promise<void>((resolve, reject) => {
      /** Resume this queued scan and remove its abort listener before transferring the slot.
       * @returns {void} Admission waiting completes.
       */
      const wake = () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      /** Remove only this queued waiter and reject with its caller-owned cancellation reason.
       * @returns {void} The queued operation rejects.
       */
      const abort = () => {
        /** Position of this waiter, if it has not already acquired the transferred slot. */
        const index = waiting.indexOf(wake);
        if (index >= 0) {
          waiting.splice(index, 1);
        }
        reject(signal!.reason);
      };
      waiting.push(wake);
      signal?.addEventListener('abort', abort, { once: true });
    });
  } else {
    scanning++;
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    /** Oldest queued scan receiving the released slot; an empty queue decrements active work. */
    const next = waiting.shift();
    if (next) {
      next();
    } else {
      scanning--;
    }
  };
}
/** Build a complete bounded metadata snapshot without following descendant symlinks. Trusted tree mutation is not a filesystem sandbox.
 * @param {string} root - Trusted directory path; missing roots fail.
 * @param {(file: string) => boolean} ignored - Synchronous pruning predicate receiving native relative paths.
 * @param {ScanOptions} options - Traversal and cancellation policy.
 * @returns {Promise<Map<string, Entry>>} Complete candidate snapshot; failures never return a partial map.
 */
export async function scan(
  root: string,
  ignored: (file: string) => boolean,
  options: ScanOptions = {}
): Promise<Map<string, Entry>> {
  if (
    typeof root !== 'string' ||
    !root.trim() ||
    typeof ignored !== 'function' ||
    !options ||
    typeof options !== 'object'
  ) {
    throw new TypeError('Invalid scan options');
  }
  /** Validated traversal budget, counting ignored names as well as retained files. */
  const maxEntries = options.maxEntries ?? 100000;
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > 1000000
  ) {
    throw new RangeError('Invalid maxEntries');
  }
  if (
    options.signal !== undefined &&
    !(options.signal instanceof AbortSignal)
  ) {
    throw new TypeError('Invalid scan signal');
  }
  /** Idempotent admission lease, released only after traversal actually settles. */
  const release = await acquire(options.signal);
  try {
    options.signal?.throwIfAborted();
    /** Initial root identity used to reject replacement before publishing a snapshot. */
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory()) {
      throw new ScanError('ROOT_NOT_DIRECTORY');
    }
    /** Candidate snapshot; callers receive it only after the entire scan succeeds. */
    const entries = new Map<string, Entry>();
    /** Relative directories awaiting traversal, starting with the root itself. */
    const pending = [''];
    let visited = 0;
    while (pending.length) {
      options.signal?.throwIfAborted();
      /** Next directory relative to the trusted root; child disappearance is tolerated. */
      const relative = pending.pop()!;
      try {
        // async iteration closes directory handles on completion, throw and abort.
        if (
          relative &&
          !(await lstat(path.join(root, relative))).isDirectory()
        ) {
          continue;
        }
        /** Owned streaming directory iterator; for-await closes it on completion or failure. */
        const directory = await opendir(path.join(root, relative));
        for await (const item of directory) {
          options.signal?.throwIfAborted();
          if (++visited > maxEntries) {
            throw new ScanError('SCAN_ENTRY_LIMIT');
          }
          /** Native-platform relative child path supplied to the standalone ignore predicate. */
          const child = path.join(relative, item.name);
          /** Untrusted predicate result checked for a synchronous Boolean before pruning. */
          const ignore: unknown = ignored(child);
          if (typeof ignore !== 'boolean') {
            if (
              ignore &&
              typeof (ignore as PromiseLike<unknown>).then === 'function'
            ) {
              void Promise.resolve(ignore).catch(() => {});
            }
            throw new TypeError('Ignore predicate must return a boolean');
          }
          if (ignore || item.isSymbolicLink()) {
            continue;
          }
          try {
            /** Fresh child metadata; symbolic links are excluded before descending. */
            const entry = await lstat(path.join(root, child));
            if (entry.isDirectory()) {
              pending.push(child);
            } else if (entry.isFile()) {
              entries.set(child, { mtimeMs: entry.mtimeMs, size: entry.size });
            }
          } catch (error) {
            if (
              !['ENOENT', 'ENOTDIR'].includes(
                (error as NodeJS.ErrnoException).code ?? ''
              )
            ) {
              throw error;
            }
          }
        }
      } catch (error) {
        if (
          !relative ||
          !['ENOENT', 'ENOTDIR'].includes(
            (error as NodeJS.ErrnoException).code ?? ''
          )
        ) {
          throw error;
        }
      }
    }
    options.signal?.throwIfAborted();
    /** Post-traversal identity check preventing a replaced root from becoming a valid baseline. */
    const finalRoot = await lstat(root);
    if (
      !finalRoot.isDirectory() ||
      finalRoot.ino !== rootStat.ino ||
      finalRoot.dev !== rootStat.dev
    ) {
      throw new ScanError('ROOT_CHANGED');
    }
    return entries;
  } catch (error) {
    if (options.signal?.aborted || error instanceof ScanError) {
      throw error;
    }
    throw new ScanError(
      (error as NodeJS.ErrnoException).code ?? 'SCAN_FAILED',
      error
    );
  } finally {
    release();
  }
}
/** Yield deterministic new/update/delete changes using size and modification time only.
 * @param {Map<string, Entry>} before - Previous complete snapshot.
 * @param {Map<string, Entry>} after - New complete snapshot.
 * @returns {Generator<WatcherEvent>} Sorted file changes; rename appears as delete plus new.
 */
export function* changes(
  before: Map<string, Entry>,
  after: Map<string, Entry>
) {
  /** Sorted union of snapshot keys, yielding deterministic metadata changes. */
  const files = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) =>
    a.localeCompare(b)
  );
  for (const file of files) {
    /** Previous metadata, absent when the file was newly discovered. */
    const old = before.get(file);
    /** Current metadata, absent when the file disappeared. */
    const value = after.get(file);
    if (!value) {
      yield { file, type: 'delete' as const };
    } else if (!old) {
      yield { file, type: 'new' as const };
    } else if (old.mtimeMs !== value.mtimeMs || old.size !== value.size) {
      yield { file, type: 'update' as const };
    }
  }
}
/** Materialize metadata changes for callers needing an array.
 * @param {Map<string, Entry>} before - Previous complete snapshot.
 * @param {Map<string, Entry>} after - New complete snapshot.
 * @returns {WatcherEvent[]} Deterministically ordered metadata differences.
 */
export function diff(before: Map<string, Entry>, after: Map<string, Entry>) {
  return [...changes(before, after)];
}
