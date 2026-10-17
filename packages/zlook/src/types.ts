export type WatcherEventType = 'new' | 'update' | 'delete';
export interface WatcherEvent { file: string; type: WatcherEventType }
export type WatcherCallback = (event: WatcherEvent, type: WatcherEventType) => void;
export interface WatchOptions {
  debounceMs?: number;
  /** Fallback scan interval; also detects changes missed by native notifications. */
  pollIntervalMs?: number;
  /** Ignore paths relative to the watched root. */
  ignored?: (relativePath: string) => boolean;
  /** Called when watching/scanning fails. */
  onError?: (error: Error) => void;
}
