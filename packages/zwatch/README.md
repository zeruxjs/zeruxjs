# zwatch

Filesystem watcher for ZeruxJS, with **shared in-process subscriptions**, native notifications and a polling fallback. File updates are reported once after debouncing, and watchers are disposed when the last subscriber unsubscribes.

```ts
import { startWatcher } from 'zwatch';
const stop = startWatcher('src', (event) => console.log(event.file, event.type), {
  debounceMs: 75,
  pollIntervalMs: 1500,
  ignored: (file) => file.endsWith('.log'),
  onError: console.error
});
// During shutdown: stop();
```

Events: `new`, `update`, `delete`; paths are relative to the watched root. Default exclusions: `.git`, `node_modules`. Symbolic links are not traversed. `scan` and `diff` are exported for custom watcher integrations.

**Limitations:** sharing is process-local, not cross-process; polling uses file metadata, so a same-size write preserving modification time may be missed; a complete scan costs O(files). Filesystem read errors are surfaced through `onError`. Watch paths should be trusted; callbacks execute in the caller's process.

### Shared watcher lifecycle

Use `watchDirectory()` when you need to await the baseline scan or force reconciliation:

```ts
import { watchDirectory } from 'zwatch';
const watcher = watchDirectory('./src', (event) => console.log(event), {
  ignored: file => file === '.cache' || file.startsWith('.cache/'),
  pollIntervalMs: 2000,
  onError: console.error
});
await watcher.ready;
await watcher.flush();
watcher.close();
```

Subscribers to the same directory share underlying watchers without sharing their ignore rules. `startWatcher()` is retained for existing callers and returns a disposal callback. The scanner does not traverse symlinks.
