export {
  startWatcher,
  watchDirectory,
  activeWatcherCount,
  watcherDiagnostics,
} from './watcher.js';
export { scan, diff, ScanError } from './scan.js';
export type {
  WatcherEvent,
  WatcherEventType,
  WatcherCallback,
  WatchOptions,
} from './types.js';
export type { WatchHandle, WatcherDiagnostics } from './watcher.js';
export type { ScanOptions, Entry } from './scan.js';
