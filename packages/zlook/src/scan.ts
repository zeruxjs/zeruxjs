import { opendir, lstat } from 'node:fs/promises';
import path from 'node:path';
export interface Entry { mtimeMs: number; size: number }
export interface ScanOptions { maxEntries?: number; signal?: AbortSignal }
/** Redacted message/code; cause is internal and can contain filesystem paths. */
export class ScanError extends Error {
  readonly code: string;
  constructor(code: string, cause?: unknown) { super(`Filesystem scan failed (${code})`, { cause }); this.name = 'ScanError'; this.code = code; }
}
let scanning = 0;
const waiting: (() => void)[] = [];
async function acquire(signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted();
  if (scanning >= 4) {
    if (waiting.length >= 128) throw new ScanError('SCAN_QUEUE_LIMIT');
    await new Promise<void>((resolve, reject) => {
      const wake = () => { signal?.removeEventListener('abort', abort); resolve(); };
      const abort = () => { const index = waiting.indexOf(wake); if (index >= 0) waiting.splice(index, 1); reject(signal!.reason); };
      waiting.push(wake); signal?.addEventListener('abort', abort, { once: true });
    });
  } else scanning++;
  let released = false;
  return () => { if (released) return; released = true; const next = waiting.shift(); if (next) next(); else scanning--; };
}
/** Streaming, bounded traversal. Missing children can race writes; missing roots fail.
 * Symlinks are not followed. Roots/tree mutations are trusted, not a filesystem sandbox.
 */
export async function scan(root: string, ignored: (file: string) => boolean, options: ScanOptions = {}): Promise<Map<string, Entry>> {
  if (typeof root !== 'string' || !root.trim() || typeof ignored !== 'function' || !options || typeof options !== 'object') throw new TypeError('Invalid scan options');
  const maxEntries = options.maxEntries ?? 100000;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 1000000) throw new RangeError('Invalid maxEntries');
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new TypeError('Invalid scan signal');
  const release = await acquire(options.signal);
  try {
    options.signal?.throwIfAborted();
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory()) throw new ScanError('ROOT_NOT_DIRECTORY');
    const entries = new Map<string, Entry>(); const pending = ['']; let visited = 0;
    while (pending.length) {
      options.signal?.throwIfAborted();
      const relative = pending.pop()!;
      try {
        // async iteration closes directory handles on completion, throw and abort.
        if (relative && !(await lstat(path.join(root, relative))).isDirectory()) continue;
        const directory = await opendir(path.join(root, relative));
        for await (const item of directory) {
          options.signal?.throwIfAborted();
          if (++visited > maxEntries) throw new ScanError('SCAN_ENTRY_LIMIT');
          const child = path.join(relative, item.name);
          const ignore: unknown = ignored(child);
          if (typeof ignore !== 'boolean') {
            if (ignore && typeof (ignore as PromiseLike<unknown>).then === 'function') void Promise.resolve(ignore).catch(() => {});
            throw new TypeError('Ignore predicate must return a boolean');
          }
          if (ignore || item.isSymbolicLink()) continue;
          try {
            const entry = await lstat(path.join(root, child));
            if (entry.isDirectory()) pending.push(child);
            else if (entry.isFile()) entries.set(child, { mtimeMs: entry.mtimeMs, size: entry.size });
          } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
        }
      } catch (error) { if (!relative || !['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    }
    options.signal?.throwIfAborted();
    const finalRoot = await lstat(root);
    if (!finalRoot.isDirectory() || finalRoot.ino !== rootStat.ino || finalRoot.dev !== rootStat.dev) throw new ScanError('ROOT_CHANGED');
    return entries;
  } catch (error) {
    if (options.signal?.aborted || error instanceof ScanError) throw error;
    throw new ScanError((error as NodeJS.ErrnoException).code ?? 'SCAN_FAILED', error);
  } finally { release(); }
}
export function* changes(before: Map<string, Entry>, after: Map<string, Entry>) {
  const files = [...new Set([...before.keys(), ...after.keys()])].sort((a,b)=>a.localeCompare(b));
  for (const file of files) {
    const old = before.get(file), value = after.get(file);
    if (!value) yield { file, type: 'delete' as const };
    else if (!old) yield { file, type: 'new' as const };
    else if (old.mtimeMs !== value.mtimeMs || old.size !== value.size) yield { file, type: 'update' as const };
  }
}
export function diff(before: Map<string, Entry>, after: Map<string, Entry>) { return [...changes(before, after)]; }
