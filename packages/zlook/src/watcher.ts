import fs from 'node:fs';
import path from 'node:path';
import { scan, changes, ScanError, type Entry } from './scan.js';
import type { WatchOptions, WatcherCallback, WatcherEvent } from './types.js';
interface Subscriber {
  /** Subscriber-owned event handler; returned promises are not awaited. */
  callback: WatcherCallback;
  /** Snapshotted subscriber filter/error/cancellation policy. */
  options: WatchOptions;
  /** Idempotent local subscription disposer. */
  close: () => void;
}
interface Settings {
  /** Trailing native-notification debounce in milliseconds. */
  debounceMs: number;
  /** Periodic reconciliation interval in milliseconds. */
  pollIntervalMs: number;
  /** Examined entry budget per complete scan. */
  maxEntries: number;
  /** Maximum retained changes per reconciliation; overflow advances the full baseline. */
  maxPendingEvents: number;
  /** Disable native notification allocation while retaining polling. */
  pollingOnly: boolean;
}
/** Process-local shared owners keyed by canonical root and scheduling/resource settings. */
const active = new Map<string, SharedWatcher>();
/** Built-in directory segments pruned from every shared scan. */
const DEFAULT_IGNORED = new Set(['.git', 'node_modules', '.svn']);
/** Prune dependency and VCS trees before collecting a shared snapshot.
 * @param {string} file - Native relative path.
 * @returns {boolean} Whether a reserved segment occurs.
 */
const defaultIgnored = (file: string) =>
  file.split(/[\\/]/).some((part) => DEFAULT_IGNORED.has(part));
/** Normalize delivered event paths independently of platform separators.
 * @param {string} file - Native relative path.
 * @returns {string} Forward-slash event path.
 */
const normalized = (file: string) => file.split(path.sep).join('/');
/** Evaluate subscriber-only prefixes without pruning another subscriber’s scan.
 * @param {string} file - Normalized event path.
 * @param {(file: string) => boolean} [ignore] - Synchronous local filter.
 * @returns {boolean} Whether this subscriber excludes the event.
 */
const excluded = (file: string, ignore?: (file: string) => boolean) => {
  if (!ignore) {
    return false;
  }
  /** Ancestor segments tested from outermost directory through the full file path. */
  const segments = file.split('/');
  for (let index = 1; index <= segments.length; index++) {
    /** User callback result; promises are observed for rejection but do not become permissions. */
    const result: unknown = ignore(segments.slice(0, index).join('/'));
    if (typeof result !== 'boolean') {
      if (
        result &&
        typeof (result as PromiseLike<unknown>).then === 'function'
      ) {
        void Promise.resolve(result).catch(() => {});
      } // Invalid async predicates are reported below, never used as permission.
      throw new TypeError('Ignore predicate must return a boolean');
    }
    if (result) {
      return true;
    }
  }
  return false;
};
export interface WatcherDiagnostics {
  /** Number of current subscribers sharing this owner. */
  readonly subscriptions: number;
  /** Number of owned native watch handles (zero or one). */
  readonly nativeHandles: number;
  /** Number of active polling timers (zero or one). */
  readonly pollingHandles: number;
  /** Number of active debounce timers (zero or one). */
  readonly debounceHandles: number;
  /** Whether startup or a reconciliation is currently running. */
  readonly scanning: boolean;
  /** Number of shared trailing refreshes (zero or one). */
  readonly pendingScans: number;
  /** Total scan attempts including startup. */
  readonly scans: number;
  /** Failed scan attempts, distinct from subscriber callback errors. */
  readonly scanErrors: number;
  /** Merged requests/notifications; not a count of filesystem writes. */
  readonly coalesced: number;
  /** Events omitted due to overflow; filtered events are not drops. */
  readonly dropped: number;
  /** Retained shared events counted before subscriber filtering. */
  readonly emitted: number;
  /** Whether this shared owner has been stopped. */
  readonly closed: boolean;
  /** Fixed historical scan/native failure category without paths. */
  readonly lastErrorCode?: string;
}
export interface WatchHandle {
  /** Baseline attempt completed; errors are reported, not emitted as an empty tree. */
  readonly ready: Promise<void>;
  /** Request one subscriber-filtered reconciliation without growing an unbounded queue.
   * @returns {Promise<WatcherEvent[]>} Visible retained changes or an empty result after failure/close.
   */
  flush(): Promise<WatcherEvent[]>;
  /** Fence future work and release owned timers, registry membership and native resources.
   * @returns {void} Idempotent immediate close; await the subscription closed promise for settlement.
   */
  close(): void;
  /** Await startup/in-flight scan cleanup after close; never closes other subscriptions. */
  readonly closed: Promise<void>;
  /** Snapshot fixed counters without paths or private error causes.
   * @returns {WatcherDiagnostics} Immutable shared-owner counters.
   */
  diagnostics(): WatcherDiagnostics;
}
/** Own one canonical root/settings lifecycle until its last subscriber leaves. */
class SharedWatcher {
  /** Independent listeners currently borrowing this shared owner. */
  private subscriptions = new Set<Subscriber>();
  /** Owned native handle; notifications only request complete reconciliation. */
  private native?: fs.FSWatcher;
  /** Single trailing debounce timer. */
  private timer?: NodeJS.Timeout;
  /** Periodic fallback timer, including on native-capable hosts. */
  private polling?: NodeJS.Timeout;
  /** Last complete successful metadata baseline; failures leave it unchanged. */
  private snapshot = new Map<string, Entry>();
  /** Shared scan cancellation controller, aborted after the last subscriber leaves. */
  private controller = new AbortController();
  /** Actually unsettled reconciliation, retaining its capacity until completion. */
  private running?: Promise<WatcherEvent[]>;
  /** One coalesced refresh request waiting for the active reconciliation. */
  private trailing?: {
    promise: Promise<WatcherEvent[]>;
    resolve: (events: WatcherEvent[]) => void;
  };
  /** Immediate fence preventing late startup/scan work from allocating new handles. */
  private stopped = false;
  /** Whether a successful silent baseline has been established. */
  private initialized = false;
  /** Startup attempt remains in flight until its scan settles. */
  private initializing = true;
  /** Prevent repeated native backend allocation after unsupported/error outcomes. */
  private nativeAttempted = false;
  /** Settlement of the most recently owned native handle close event. */
  private nativeClosed = Promise.resolve();
  /** Historical private scan/native failure; diagnostics expose only its fixed category. */
  private lastError?: Error;
  /** Fixed path-free counters scoped to this shared owner. */
  private counters = {
    scans: 0,
    scanErrors: 0,
    coalesced: 0,
    dropped: 0,
    emitted: 0,
  };
  /** Initial baseline attempt, including failures reported through subscriber handlers. */
  readonly ready: Promise<void>;
  /** Own one shared scan/native lifecycle for an exact identity.
   * @param {string} root - Canonical existing root or resolved missing-root path.
   * @param {string} key - Registry identity used for compare-and-remove cleanup.
   * @param {Settings} settings - Validated timing and resource budgets.
   */
  constructor(
    readonly root: string,
    private key: string,
    private settings: Settings
  ) {
    this.ready = this.initialize();
  }
  /** Snapshot fixed counters without paths or private error causes.
   * @returns {WatcherDiagnostics} Immutable shared-owner counters.
   */
  diagnostics(): WatcherDiagnostics {
    return Object.freeze({
      ...this.counters,
      subscriptions: this.subscriptions.size,
      nativeHandles: Number(!!this.native),
      pollingHandles: Number(!!this.polling),
      debounceHandles: Number(!!this.timer),
      scanning: this.initializing || !!this.running,
      pendingScans: Number(!!this.trailing),
      closed: this.stopped,
      ...(this.lastError && {
        lastErrorCode:
          this.lastError instanceof ScanError
            ? this.lastError.code
            : 'WATCH_FAILED',
      }),
    });
  }
  /** Notify error handlers independently so a throwing handler cannot stop another subscriber.
   * @param {unknown} error - Private scan or callback cause.
   * @param {Subscriber} sub - Optional single subscriber receiving its own callback/filter failure.
   * @returns {void} No error-handler exception escapes.
   */
  private error(error: unknown, sub?: Subscriber) {
    /** Validated numeric setting or private Error instance forwarded only to the owning error handler. */
    const value =
      error instanceof Error
        ? error
        : new Error('Watcher callback failed', { cause: error });
    for (const subscriber of sub ? [sub] : [...this.subscriptions]) {
      try {
        subscriber.options.onError?.(value);
      } catch {
        /* Keep error handlers isolated. */
      }
    }
  }
  /** Apply a subscriber’s synchronous ignore policy to a shared event batch.
   * @param {WatcherEvent[]} events - Shared retained events.
   * @param {Subscriber} sub - Subscriber whose prefixes are checked.
   * @returns {WatcherEvent[]} Visible events, or none if this subscriber’s predicate fails.
   */
  private filter(events: WatcherEvent[], sub: Subscriber): WatcherEvent[] {
    try {
      return events.filter(
        (event) => !excluded(event.file, sub.options.ignored)
      );
    } catch (error) {
      this.error(error, sub);
      return [];
    }
  }
  /** Attach an independent listener and return its cleanup/flush handle.
   * @param {WatcherCallback} callback - Receives frozen event copies; async work remains caller-owned.
   * @param {WatchOptions} options - Snapshotted local callback, filter and cancellation policy.
   * @returns {WatchHandle} Subscriber handle borrowing the shared watcher until close.
   */
  subscribe(callback: WatcherCallback, options: WatchOptions): WatchHandle {
    if (this.stopped) {
      throw new Error('Cannot subscribe to a closed watcher');
    }
    let disposed = false;
    let resolveClosed!: () => void;
    /** Subscriber-local completion promise, resolving after shared cleanup only for the last subscriber. */
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    /** Independent subscription with its own callback, abort listener and close fence. */
    const sub: Subscriber = {
      callback,
      options,
      close: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        options.signal?.removeEventListener('abort', sub.close);
        this.subscriptions.delete(sub);
        if (!this.subscriptions.size) {
          this.close();
          void this.settled().then(resolveClosed);
        } else {
          resolveClosed();
        }
      },
    };
    this.subscriptions.add(sub);
    options.signal?.addEventListener('abort', sub.close, { once: true });
    if (options.signal?.aborted) {
      sub.close();
    }
    if (this.lastError) {
      queueMicrotask(() => {
        if (!disposed) {
          this.error(this.lastError, sub);
        }
      });
    }
    return {
      ready: this.ready,
      closed,
      close: sub.close,
      diagnostics: () => this.diagnostics(),
      flush: async () => {
        if (disposed) {
          return [];
        }
        /** Retained complete-scan changes; subscriber filters are applied only during delivery. */
        const events = await this.refresh();
        return disposed ? [] : this.filter(events, sub);
      },
    };
  }
  /** Await actual owned startup, scan and native-close settlement.
   * @returns {Promise<void>} Cleanup completion; arbitrary consumer callback promises are not drained.
   */
  private async settled() {
    await this.ready;
    await this.running;
    await this.nativeClosed;
  }
  /** Detach and close the owned native handle once.
   * @returns {void} Native close settlement is tracked separately.
   */
  private releaseNative() {
    /** Detach the owned native handle before closing so repeated cleanup cannot close it twice. */
    const native = this.native;
    this.native = undefined;
    native?.close();
  }
  /** Attempt native notifications once; polling remains the fallback after failure.
   * @returns {void} No native handle is allocated when closed or explicitly polling-only.
   */
  private attachNative() {
    if (this.stopped || this.nativeAttempted || this.settings.pollingOnly) {
      return;
    }
    this.nativeAttempted = true;
    try {
      this.native = fs.watch(this.root, { recursive: true }, () =>
        this.schedule()
      );
      this.nativeClosed = new Promise<void>((resolve) =>
        this.native!.once('close', resolve)
      );
      this.native.on('error', (error) => {
        this.releaseNative();
        this.lastError = new ScanError(
          (error as NodeJS.ErrnoException).code ?? 'NATIVE_WATCH_FAILED',
          error
        );
        this.error(this.lastError);
      });
    } catch (error) {
      this.lastError = new ScanError(
        (error as NodeJS.ErrnoException).code ?? 'NATIVE_UNAVAILABLE',
        error
      );
      this.error(this.lastError);
    }
  }
  /** Attempt a silent initial baseline and install periodic reconciliation while open.
   * @returns {Promise<void>} Baseline attempt completion, including reported failures.
   */
  private async initialize() {
    this.counters.scans++;
    try {
      this.snapshot = await scan(this.root, defaultIgnored, {
        ...this.settings,
        signal: this.controller.signal,
      });
      if (!this.stopped) {
        this.initialized = true;
        this.attachNative();
      }
    } catch (error) {
      if (!this.stopped) {
        this.counters.scanErrors++;
        this.lastError = error as Error;
        this.error(error);
      }
    }
    this.initializing = false;
    if (!this.stopped) {
      this.polling = setInterval(
        () => this.schedule(0),
        this.settings.pollIntervalMs
      );
      this.polling.unref();
    }
  }
  /** Coalesce notifications behind one trailing debounce timer.
   * @param {number} delay - Delay in milliseconds; polling requests use zero.
   * @returns {void} Timer ownership stays with this shared watcher.
   */
  private schedule(delay = this.settings.debounceMs) {
    if (this.stopped) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.counters.coalesced++;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, delay);
    this.timer.unref();
  }
  /** Coalesce one active and at most one trailing complete-snapshot reconciliation.
   * @returns {Promise<WatcherEvent[]>} Retained events; errors preserve the baseline and resolve empty.
   */
  refresh(): Promise<WatcherEvent[]> {
    if (this.stopped) {
      return Promise.resolve([]);
    }
    if (this.running) {
      this.counters.coalesced++;
      if (!this.trailing) {
        let resolve!: (events: WatcherEvent[]) => void;
        /** Single trailing refresh promise shared by additional requests during an active scan. */
        const promise = new Promise<WatcherEvent[]>((done) => {
          resolve = done;
        });
        this.trailing = { promise, resolve };
      }
      return this.trailing.promise;
    }
    /** Reconcile one complete candidate before replacing the baseline and notifying subscribers.
     * @returns {Promise<WatcherEvent[]>} Retained shared events or an empty array on failure/close.
     */
    const run = async (): Promise<WatcherEvent[]> => {
      await this.ready;
      if (this.stopped) {
        return [];
      }
      this.counters.scans++;
      try {
        /** Complete candidate snapshot; failed scans never replace the existing baseline. */
        const next = await scan(this.root, defaultIgnored, {
          ...this.settings,
          signal: this.controller.signal,
        });
        if (this.stopped) {
          return [];
        }
        /** Retained complete-scan changes; subscriber filters are applied only during delivery. */
        const events: WatcherEvent[] = [];
        let dropped = 0;
        if (this.initialized) {
          for (const change of changes(this.snapshot, next)) {
            if (events.length < this.settings.maxPendingEvents) {
              events.push({ file: normalized(change.file), type: change.type });
            } else {
              dropped++;
            }
          }
        }
        this.snapshot = next;
        this.initialized = true;
        this.attachNative();
        if (dropped) {
          this.counters.dropped += dropped;
          this.error(new ScanError('PENDING_EVENT_LIMIT'));
        }
        this.counters.emitted += events.length;
        for (const sub of [...this.subscriptions]) {
          for (const event of this.filter(events, sub)) {
            if (!this.subscriptions.has(sub)) {
              break;
            }
            try {
              /** User callback result; promises are observed for rejection but do not become permissions. */
              const result: unknown = sub.callback(
                Object.freeze({ ...event }),
                event.type
              );
              if (
                result &&
                typeof (result as PromiseLike<unknown>).then === 'function'
              ) {
                Promise.resolve(result).catch((error) =>
                  this.error(error, sub)
                );
              }
            } catch (error) {
              this.error(error, sub);
            }
          }
        }
        return events;
      } catch (error) {
        if (!this.stopped) {
          this.counters.scanErrors++;
          this.lastError = error as Error;
          this.error(error);
        }
        return [];
      }
    };
    this.running = run().finally(() => {
      this.running = undefined;
      /** Pending refresh detached before starting the next reconciliation. */
      const trailing = this.trailing;
      this.trailing = undefined;
      if (trailing) {
        if (this.stopped) {
          trailing.resolve([]);
        } else {
          void this.refresh().then(trailing.resolve);
        }
      }
    });
    return this.running;
  }
  /** Fence future work and release owned timers, registry membership and native resources.
   * @returns {void} Idempotent immediate close; await the subscription closed promise for settlement.
   */
  close() {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.controller.abort();
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = undefined;
    if (this.polling) {
      clearInterval(this.polling);
    }
    this.polling = undefined;
    this.releaseNative();
    if (active.get(this.key) === this) {
      active.delete(this.key);
    }
  }
}
/** Share canonical roots only when scheduling/resource settings match; ignore policies remain local.
 * @param {string} rootDir - Trusted source directory; a missing root may recover on polling.
 * @param {WatcherCallback} callback - Subscriber callback receiving frozen event copies.
 * @param {WatchOptions} options - Validated resource, scheduling and subscriber policy.
 * @returns {WatchHandle} Independently disposable subscription; await closed after closing.
 */
export function watchDirectory(
  rootDir: string,
  callback: WatcherCallback,
  options: WatchOptions = {}
): WatchHandle {
  if (
    typeof rootDir !== 'string' ||
    !rootDir.trim() ||
    rootDir.includes('\0')
  ) {
    throw new TypeError('Watcher root must be a directory path');
  }
  if (typeof callback !== 'function') {
    throw new TypeError('Watcher callback is required');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Invalid watch options');
  }
  for (const name of ['ignored', 'onError'] as const) {
    if (options[name] !== undefined && typeof options[name] !== 'function') {
      throw new TypeError(`Invalid ${name}`);
    }
  }
  if (
    options.signal !== undefined &&
    !(options.signal instanceof AbortSignal)
  ) {
    throw new TypeError('Invalid watcher signal');
  }
  if (
    options.pollingOnly !== undefined &&
    typeof options.pollingOnly !== 'boolean'
  ) {
    throw new TypeError('Invalid pollingOnly');
  }
  /** Validated immutable scheduling/resource values forming shared-owner identity. */
  const settings: Settings = {
    debounceMs: options.debounceMs ?? 60,
    pollIntervalMs: options.pollIntervalMs ?? 2000,
    maxEntries: options.maxEntries ?? 100000,
    maxPendingEvents: options.maxPendingEvents ?? 4096,
    pollingOnly: options.pollingOnly ?? false,
  };
  for (const name of [
    'debounceMs',
    'pollIntervalMs',
    'maxEntries',
    'maxPendingEvents',
  ] as const) {
    /** Validated numeric setting being checked against its dedicated range. */
    const value = settings[name];
    /** Minimum accepted value for the selected setting. */
    let min = 1;
    if (name === 'debounceMs') {
      min = 0;
    } else if (name === 'pollIntervalMs') {
      min = 100;
    }
    /** Maximum accepted value for the selected setting. */
    let max = 600000;
    if (name === 'maxEntries') {
      max = 1000000;
    } else if (name === 'maxPendingEvents') {
      max = 100000;
    }
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new RangeError(`Invalid ${name}`);
    }
  }
  let root = path.resolve(rootDir);
  try {
    root = fs.realpathSync(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new ScanError(
        (error as NodeJS.ErrnoException).code ?? 'ROOT_FAILED',
        error
      );
    }
  }
  /** Canonical root and resource settings identity, excluding subscriber-specific callbacks. */
  const key = JSON.stringify([root, settings]);
  let watcher = active.get(key);
  if (!watcher) {
    watcher = new SharedWatcher(root, key, settings);
    active.set(key, watcher);
  }
  return watcher.subscribe(callback, Object.freeze({ ...options }));
}
/** Preserve the legacy disposer API; an omitted callback allocates no resources.
 * @param {string} rootDir - Trusted source directory.
 * @param {WatcherCallback} callback - Optional listener; omission intentionally returns an inert disposer.
 * @param {WatchOptions} options - Validated watcher policy when a callback is supplied.
 * @returns {() => void} Idempotent stop callback; use watchDirectory for awaitable cleanup.
 */
export function startWatcher(
  rootDir: string,
  callback?: WatcherCallback,
  options: WatchOptions = {}
): () => void {
  if (callback === undefined) {
    return () => {};
  }
  return watchDirectory(rootDir, callback, options).close;
}
/** Count shared root/settings identities rather than subscribers or OS handles.
 * @returns {number} Current process-local registry size.
 */
export function activeWatcherCount(): number {
  return active.size;
}
/** Snapshot all shared-owner counters without paths or causes.
 * @returns {readonly WatcherDiagnostics[]} Immutable array of immutable per-owner diagnostics.
 */
export function watcherDiagnostics(): readonly WatcherDiagnostics[] {
  return Object.freeze(
    [...active.values()].map((watcher) => watcher.diagnostics())
  );
}
