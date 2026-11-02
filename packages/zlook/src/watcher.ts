import fs from 'node:fs';
import path from 'node:path';
import { scan, changes, ScanError, type Entry } from './scan.js';
import type { WatchOptions, WatcherCallback, WatcherEvent } from './types.js';
interface Subscriber { callback: WatcherCallback; options: WatchOptions; close: () => void }
interface Settings { debounceMs: number; pollIntervalMs: number; maxEntries: number; maxPendingEvents: number; pollingOnly: boolean }
const active = new Map<string, SharedWatcher>();
const DEFAULT_IGNORED = new Set(['.git', 'node_modules', '.svn']);
const defaultIgnored = (file: string) => file.split(/[\\/]/).some(part => DEFAULT_IGNORED.has(part));
const normalized = (file: string) => file.split(path.sep).join('/');
const excluded = (file: string, ignore?: (file: string) => boolean) => {
  if (!ignore) return false;
  const segments = file.split('/');
  for (let index = 1; index <= segments.length; index++) {
    const result: unknown = ignore(segments.slice(0, index).join('/'));
    if (typeof result !== 'boolean') {
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(() => {}); // Invalid async predicates are reported below, never used as permission.
      throw new TypeError('Ignore predicate must return a boolean');
    }
    if (result) return true;
  }
  return false;
};
export interface WatcherDiagnostics {
  readonly subscriptions: number; readonly nativeHandles: number; readonly pollingHandles: number;
  readonly debounceHandles: number; readonly scanning: boolean; readonly pendingScans: number;
  readonly scans: number; readonly scanErrors: number; readonly coalesced: number;
  readonly dropped: number; readonly emitted: number; readonly closed: boolean;
  readonly lastErrorCode?: string;
}
export interface WatchHandle {
  /** Baseline attempt completed; errors are reported, not emitted as an empty tree. */
  readonly ready: Promise<void>;
  /** Coalesces concurrent requests into at most one trailing scan. Subscriber-filtered. */
  flush(): Promise<WatcherEvent[]>;
  close(): void;
  /** Await startup/in-flight scan cleanup after close; never closes other subscriptions. */
  readonly closed: Promise<void>;
  diagnostics(): WatcherDiagnostics;
}
class SharedWatcher {
  private subscriptions = new Set<Subscriber>();
  private native?: fs.FSWatcher;
  private timer?: NodeJS.Timeout;
  private polling?: NodeJS.Timeout;
  private snapshot = new Map<string, Entry>();
  private controller = new AbortController();
  private running?: Promise<WatcherEvent[]>;
  private trailing?: { promise: Promise<WatcherEvent[]>; resolve: (events: WatcherEvent[]) => void };
  private stopped = false;
  private initialized = false;
  private initializing = true;
  private nativeAttempted = false;
  private nativeClosed = Promise.resolve();
  private lastError?: Error;
  private counters = { scans: 0, scanErrors: 0, coalesced: 0, dropped: 0, emitted: 0 };
  readonly ready: Promise<void>;
  constructor(readonly root: string, private key: string, private settings: Settings) { this.ready = this.initialize(); }
  diagnostics(): WatcherDiagnostics {
    return Object.freeze({ ...this.counters, subscriptions: this.subscriptions.size, nativeHandles: Number(!!this.native), pollingHandles: Number(!!this.polling), debounceHandles: Number(!!this.timer), scanning: this.initializing || !!this.running, pendingScans: Number(!!this.trailing), closed: this.stopped, ...(this.lastError && {lastErrorCode: this.lastError instanceof ScanError ? this.lastError.code : 'WATCH_FAILED'}) });
  }
  private error(error: unknown, sub?: Subscriber) {
    const value = error instanceof Error ? error : new Error('Watcher callback failed', {cause:error});
    for (const subscriber of sub ? [sub] : [...this.subscriptions]) { try { subscriber.options.onError?.(value); } catch { /* Keep error handlers isolated. */ } }
  }
  private filter(events: WatcherEvent[], sub: Subscriber): WatcherEvent[] {
    try { return events.filter(event => !excluded(event.file, sub.options.ignored)); }
    catch (error) { this.error(error, sub); return []; }
  }
  subscribe(callback: WatcherCallback, options: WatchOptions): WatchHandle {
    if (this.stopped) throw new Error('Cannot subscribe to a closed watcher');
    let disposed = false; let resolveClosed!: () => void;
    const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
    const sub: Subscriber = { callback, options, close: () => {
      if (disposed) return; disposed = true;
      options.signal?.removeEventListener('abort', sub.close);
      this.subscriptions.delete(sub);
      if (!this.subscriptions.size) {
        this.close();
        void this.settled().then(resolveClosed);
      } else resolveClosed();
    } };
    this.subscriptions.add(sub);
    options.signal?.addEventListener('abort', sub.close, {once:true});
    if (options.signal?.aborted) sub.close();
    if (this.lastError) queueMicrotask(() => { if (!disposed) this.error(this.lastError, sub); });
    return { ready: this.ready, closed, close: sub.close, diagnostics: () => this.diagnostics(), flush: async () => { if (disposed) return []; const events = await this.refresh(); return disposed ? [] : this.filter(events, sub); } };
  }
  private async settled() { await this.ready; await this.running; await this.nativeClosed; }
  private releaseNative() { const native = this.native; this.native = undefined; native?.close(); }
  private attachNative() {
    if (this.stopped || this.nativeAttempted || this.settings.pollingOnly) return;
    this.nativeAttempted = true;
    try {
      this.native = fs.watch(this.root, {recursive:true}, () => this.schedule());
      this.nativeClosed = new Promise<void>(resolve => this.native!.once('close',resolve));
      this.native.on('error', error => { this.releaseNative(); this.lastError = new ScanError((error as NodeJS.ErrnoException).code ?? 'NATIVE_WATCH_FAILED', error); this.error(this.lastError); });
    } catch (error) { this.lastError = new ScanError((error as NodeJS.ErrnoException).code ?? 'NATIVE_UNAVAILABLE', error); this.error(this.lastError); }
  }
  private async initialize() {
    this.counters.scans++;
    try { this.snapshot = await scan(this.root, defaultIgnored, {...this.settings,signal:this.controller.signal}); if (!this.stopped) { this.initialized = true; this.attachNative(); } }
    catch (error) { if (!this.stopped) { this.counters.scanErrors++; this.lastError = error as Error; this.error(error); } }
    this.initializing = false;
    if (!this.stopped) { this.polling = setInterval(() => this.schedule(0), this.settings.pollIntervalMs); this.polling.unref(); }
  }
  private schedule(delay = this.settings.debounceMs) {
    if (this.stopped) return;
    if (this.timer) { clearTimeout(this.timer); this.counters.coalesced++; }
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, delay); this.timer.unref();
  }
  refresh(): Promise<WatcherEvent[]> {
    if (this.stopped) return Promise.resolve([]);
    if (this.running) {
      this.counters.coalesced++;
      if (!this.trailing) { let resolve!: (events: WatcherEvent[]) => void; const promise = new Promise<WatcherEvent[]>(done => { resolve = done; }); this.trailing = {promise,resolve}; }
      return this.trailing.promise;
    }
    const run = async (): Promise<WatcherEvent[]> => {
      await this.ready; if (this.stopped) return [];
      this.counters.scans++;
      try {
        const next = await scan(this.root, defaultIgnored, {...this.settings,signal:this.controller.signal});
        if (this.stopped) return [];
        const events: WatcherEvent[] = []; let dropped = 0;
        if (this.initialized) for (const change of changes(this.snapshot, next)) { if (events.length < this.settings.maxPendingEvents) events.push({file:normalized(change.file),type:change.type}); else dropped++; }
        this.snapshot = next; this.initialized = true;
        this.attachNative();
        if (dropped) { this.counters.dropped += dropped; this.error(new ScanError('PENDING_EVENT_LIMIT')); }
        this.counters.emitted += events.length;
        for (const sub of [...this.subscriptions]) for (const event of this.filter(events, sub)) {
          if (!this.subscriptions.has(sub)) break;
          try { const result:unknown = sub.callback(Object.freeze({...event}), event.type); if (result && typeof (result as PromiseLike<unknown>).then === 'function') Promise.resolve(result).catch(error => this.error(error, sub)); }
          catch (error) { this.error(error, sub); }
        }
        return events;
      } catch (error) { if (!this.stopped) {this.counters.scanErrors++;this.lastError = error as Error;this.error(error);} return []; }
    };
    this.running = run().finally(() => {
      this.running = undefined;
      const trailing = this.trailing; this.trailing = undefined;
      if (trailing) { if (this.stopped) trailing.resolve([]); else void this.refresh().then(trailing.resolve); }
    });
    return this.running;
  }
  close() {
    if (this.stopped) return; this.stopped = true; this.controller.abort();
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    if (this.polling) clearInterval(this.polling); this.polling = undefined;
    this.releaseNative();
    if (active.get(this.key) === this) active.delete(this.key);
  }
}
/** Share canonical roots only when scheduling/resource settings match. Ignore rules stay local. */
export function watchDirectory(rootDir: string, callback: WatcherCallback, options: WatchOptions = {}): WatchHandle {
  if (typeof rootDir !== 'string' || !rootDir.trim() || rootDir.includes('\0')) throw new TypeError('Watcher root must be a directory path');
  if (typeof callback !== 'function') throw new TypeError('Watcher callback is required');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Invalid watch options');
  for (const name of ['ignored','onError'] as const) if (options[name] !== undefined && typeof options[name] !== 'function') throw new TypeError(`Invalid ${name}`);
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) throw new TypeError('Invalid watcher signal');
  if (options.pollingOnly !== undefined && typeof options.pollingOnly !== 'boolean') throw new TypeError('Invalid pollingOnly');
  const settings: Settings = {debounceMs:options.debounceMs ?? 60,pollIntervalMs:options.pollIntervalMs ?? 2000,maxEntries:options.maxEntries ?? 100000,maxPendingEvents:options.maxPendingEvents ?? 4096,pollingOnly:options.pollingOnly ?? false};
  for (const name of ['debounceMs','pollIntervalMs','maxEntries','maxPendingEvents'] as const) {
    const value = settings[name], min = name === 'debounceMs' ? 0 : name === 'pollIntervalMs' ? 100 : 1, max = name === 'maxEntries' ? 1000000 : name === 'maxPendingEvents' ? 100000 : 600000;
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`Invalid ${name}`);
  }
  let root = path.resolve(rootDir);
  try { root = fs.realpathSync(root); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ScanError((error as NodeJS.ErrnoException).code ?? 'ROOT_FAILED',error); }
  const key = JSON.stringify([root,settings]);
  let watcher = active.get(key);
  if (!watcher) {watcher = new SharedWatcher(root,key,settings);active.set(key,watcher);}
  return watcher.subscribe(callback,Object.freeze({...options}));
}
export function startWatcher(rootDir: string, callback?: WatcherCallback, options: WatchOptions = {}): () => void {
  if (callback === undefined) return () => {};
  return watchDirectory(rootDir, callback, options).close;
}
export function activeWatcherCount(): number { return active.size; }
/** Aggregated counts only; no absolute/relative file paths or error causes. */
export function watcherDiagnostics(): readonly WatcherDiagnostics[] {return Object.freeze([...active.values()].map(watcher=>watcher.diagnostics()));}
