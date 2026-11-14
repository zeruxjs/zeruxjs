export type WatcherEventType = 'new' | 'update' | 'delete';
export interface WatcherEvent {
  /** Forward-slash path relative to the subscribed root. */
  file: string;
  /** Metadata change category; a rename yields delete plus new. */
  type: WatcherEventType;
}
export type WatcherCallback = (
  event: WatcherEvent,
  type: WatcherEventType
) => void;
export interface WatchOptions {
  /** Trailing native-event debounce, integer 0–600000ms; defaults to 60. */
  debounceMs?: number;
  /** Reconcile missed native events; minimum 100ms, default 2000. */
  pollIntervalMs?: number;
  /** Subscriber-only, synchronous predicate on relative paths/parent prefixes. */
  ignored?: (relativePath: string) => boolean;
  /** Isolated subscriber error handler; causes can contain private paths. */
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
