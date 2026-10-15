import fs from 'node:fs';
import path from 'node:path';
import { scan, diff, type Entry } from './scan.js';
import type { WatchOptions, WatcherCallback, WatcherEvent } from './types.js';

interface Subscriber { callback: WatcherCallback; options: WatchOptions }
const active = new Map<string, SharedWatcher>();
const DEFAULT_IGNORED = new Set(['.git', 'node_modules', '.svn']);
const defaultIgnored = (file: string) => file.split(/[\\/]/).some(part => DEFAULT_IGNORED.has(part));
const normalized = (file: string) => file.split(path.sep).join('/');
const excluded = (relative: string, ignore?: (path: string) => boolean) => {
  if (!ignore) return false;
  const segments = normalized(relative).split('/');
  for (let i = 1; i <= segments.length; i++) {
    if (ignore(segments.slice(0, i).join('/'))) return true;
  }
  return false;
};

export interface WatchHandle {
  /** Initial directory snapshot has been read (or its error reported). */
  readonly ready: Promise<void>;
  /** Immediately scan the tree; concurrent scans serialize and are not dropped. */
  flush(): Promise<WatcherEvent[]>;
  /** Idempotent subscription disposal. */
  close(): void;
}

class SharedWatcher {
  private subscriptions = new Set<Subscriber>();
  private native?: fs.FSWatcher;
  private timer?: NodeJS.Timeout;
  private polling?: NodeJS.Timeout;
  private snapshot = new Map<string, Entry>();
  private pendingScan: Promise<WatcherEvent[]> = Promise.resolve([]);
  private closed = false;
  private initialized = false;
  private initialError: Error | undefined;
  readonly ready: Promise<void>;

  constructor(readonly root: string, private readonly key: string) {
    this.ready = this.initialize();
  }

  subscribe(callback: WatcherCallback, options: WatchOptions): WatchHandle {
    if (this.closed) throw new Error('Cannot subscribe to a closed watcher');
    const subscription = { callback, options };
    this.subscriptions.add(subscription);
    if (this.initialError) queueMicrotask(() => {if (this.subscriptions.has(subscription)) {try {options.onError?.(this.initialError!);} catch { /* callback isolation */ }}});
    this.restartPolling();
    let disposed = false;
    return {
      ready: this.ready,
      flush: () => this.refresh(),
      close: () => {
        if (disposed) return;
        disposed = true;
        this.subscriptions.delete(subscription);
        if (this.subscriptions.size === 0) this.close();
        else this.restartPolling();
      }
    };
  }

  private report(error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    for (const { options } of [...this.subscriptions]) {
      try { options.onError?.(err); } catch { /* isolate subscriber failures */ }
    }
  }

  private async initialize() {
    try {
      // Take an unfiltered snapshot. Filtering at subscription time prevents one
      // subscriber from hiding files that another subscriber needs to observe.
      this.snapshot = await scan(this.root, defaultIgnored);
      if (this.closed) return;
      this.initialized = true;
      try {
        this.native = fs.watch(this.root, { recursive: true }, () => this.schedule());
        this.native.on('error', error => {
          this.report(error);
          this.native?.close();
          this.native = undefined; // periodic scans continue on unsupported platforms
        });
      } catch (error) { this.initialError = error instanceof Error?error:new Error(String(error)); this.report(error); }
    } catch (error) { this.initialError = error instanceof Error?error:new Error(String(error)); this.report(error); }
    this.restartPolling();
  }

  private restartPolling() {
    if (this.polling) clearInterval(this.polling);
    if (this.closed || this.subscriptions.size === 0) return;
    const delays = [...this.subscriptions].map(s => Math.max(100, s.options.pollIntervalMs ?? 2000));
    const interval = Math.min(...delays);
    this.polling = setInterval(() => this.schedule(0), interval);
    this.polling.unref?.();
  }

  private schedule(delay?: number) {
    if (this.closed || !this.subscriptions.size) return;
    if (this.timer) clearTimeout(this.timer);
    const ms = delay ?? Math.max(0, Math.min(...[...this.subscriptions].map(s => s.options.debounceMs ?? 60)));
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, ms);
    this.timer.unref?.();
  }

  refresh(): Promise<WatcherEvent[]> {
    if (this.closed) return Promise.resolve([]);
    const execute = async (): Promise<WatcherEvent[]> => {
      await this.ready;
      if (this.closed) return [];
      try {
        const next = await scan(this.root, defaultIgnored);
        if (this.closed) return [];
        const changes = this.initialized ? diff(this.snapshot, next) : [];
        this.snapshot = next;
        this.initialized = true;
        for (const change of changes) {
          const event: WatcherEvent = { file: normalized(change.file), type: change.type };
          for (const sub of [...this.subscriptions]) {
            if (!this.subscriptions.has(sub) || excluded(event.file, sub.options.ignored)) continue;
            try { sub.callback(event, event.type); } catch (error) { this.report(error); }
          }
        }
        return changes.map(c => ({ file: normalized(c.file), type: c.type }));
      } catch (error) { this.report(error); return []; }
    };
    // One scan at a time: a later flush always observes the filesystem *after*
    // the previous scan, even if a native notification arrives during scanning.
    this.pendingScan = this.pendingScan.then(execute, execute);
    return this.pendingScan;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.polling) clearInterval(this.polling);
    this.native?.close();
    if (active.get(this.key) === this) active.delete(this.key);
    this.subscriptions.clear();
  }
}

/** Share one native watcher per root while preserving per-subscriber ignore rules. */
export function watchDirectory(rootDir: string, callback: WatcherCallback, options: WatchOptions = {}): WatchHandle {
  if (typeof rootDir !== 'string' || !rootDir.trim()) throw new TypeError('Watcher root must be a directory path');
  if (typeof callback !== 'function') throw new TypeError('Watcher callback is required');
  for (const [label,value] of [['debounceMs', options.debounceMs],['pollIntervalMs',options.pollIntervalMs]] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > 600_000 || (label === 'pollIntervalMs' && value < 100))) throw new RangeError(`Invalid ${label}`);
  }
  const root = path.resolve(rootDir);
  const key = process.platform === 'win32' ? root.toLowerCase() : root;
  let watcher = active.get(key);
  if (!watcher) { watcher = new SharedWatcher(root, key); active.set(key, watcher); }
  return watcher.subscribe(callback, options);
}

/** Backwards-compatible unsubscribe callback API. */
export function startWatcher(rootDir: string, callback?: WatcherCallback, options: WatchOptions = {}): () => void {
  if (!callback) return () => {};
  return watchDirectory(rootDir, callback, options).close;
}

export function activeWatcherCount(): number { return active.size; }
