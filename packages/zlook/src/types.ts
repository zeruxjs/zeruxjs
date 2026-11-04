export type WatcherEventType = 'new' | 'update' | 'delete';
export interface WatcherEvent { file: string; type: WatcherEventType }
export type WatcherCallback = (event: WatcherEvent, type: WatcherEventType) => void;
export interface WatchOptions {
  debounceMs?: number;
  /** Reconcile missed native events; minimum 100ms, default 2000. */
  pollIntervalMs?: number;
  /** Subscriber-only, synchronous predicate on relative paths/parent prefixes. */
  ignored?: (relativePath: string) => boolean;
  onError?: (error: Error) => void;
  /** Directory entries examined per scan, including ignored entry names. */
  maxEntries?: number;
  /** Maximum events retained/delivered per reconciliation. Overflow is reported. */
  maxPendingEvents?: number;
  /** Disable native notifications explicitly; polling remains active. */
  pollingOnly?: boolean;
  /** Aborts this subscription, including during startup. */
  signal?: AbortSignal;
}
