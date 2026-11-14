# zlook

Filesystem watcher for ZeruxJS, with **shared in-process subscriptions**, native notifications and a polling fallback. File metadata changes are reconciled after debouncing, and watchers are disposed when the last subscriber unsubscribes.

```ts
import { startWatcher } from 'zlook';
const stop = startWatcher('src', (event) => console.log(event.file, event.type), {
  debounceMs: 75,
  pollIntervalMs: 1500,
  ignored: (file) => file.endsWith('.log'),
  onError: console.error
});
// During shutdown: stop();
```

Events: `new`, `update`, `delete`; paths use `/` relative to the watched root. Default exclusions: `.git`, `node_modules`, `.svn`. Symbolic links are not traversed. `scan` and `diff` are exported for custom watcher integrations.

**Limitations:** sharing is process-local, not cross-process; polling uses file metadata, so a same-size write preserving modification time may be missed; a complete scan costs O(files). Filesystem read errors are surfaced through `onError`. Watch paths should be trusted; callbacks execute in the caller's process.

### Shared watcher lifecycle

Use `watchDirectory()` when you need to await the baseline scan or force reconciliation:

```ts
import { watchDirectory } from 'zlook';
const watcher = watchDirectory('./src', (event) => console.log(event), {
  ignored: file => file === '.cache' || file.startsWith('.cache/'),
  pollIntervalMs: 2000,
  onError: console.error
});
await watcher.ready;
await watcher.flush();
watcher.close();
```

Subscribers to the same canonical directory and identical scheduling/resource settings share underlying watchers without sharing their ignore rules. `startWatcher()` is retained for existing callers and returns a disposal callback. The scanner does not traverse symlinks.

## Watcher validation

`watchDirectory(root, callback, { debounceMs, pollIntervalMs, onError })`
validates callback/root types and integer millisecond settings before creating
any shared native watcher. Polling must be at least 100ms when configured;
intervals are bounded to ten minutes. Subscriber callbacks remain isolated,
errors are reported through `onError`, and handles must be closed during hot
reload/unmount. Filesystem symlinks are never traversed by the recursive scan.
The fallback polling path is retained for hosts where recursive `fs.watch`
is unsupported. Test with `node --experimental-strip-types --test test/*.test.ts` after building.

## Reconciliation and sharing contract

This is a bounded metadata reconciler, not complete chokidar parity. No independent
rename, directory event, inode tracking, atomic-write or await-write-finish API is
provided. The initial successful scan establishes a silent baseline. A rename
normally produces delete(old path) plus new(new path); only the final observed state
matters. Several writes between snapshots produce at most one update for a path.
A create/delete entirely between scans can be invisible. Events are sorted by
relative path, not write order, and contain file paths only. Modification time and
size comparisons can miss a same-size write with preserved mtime. Directory creation
itself has no event; new files underneath it are included on the next full scan.

Native notifications reset a trailing debounce timer (default 60ms). Polling also
requests full reconciliation (default 2000ms) and remains enabled even with native
support. Poll requests can advance an outstanding debounce; it is not a guarantee
that every write waits the entire debounce period. `pollingOnly: true` explicitly
disables native handles. On native construction/error failure, onError receives a
redacted ScanError and polling continues; native setup is attempted at most once
per shared watcher, never repeatedly recreated after backend failure. See
[Node fs.watch caveats](https://nodejs.org/api/fs.html#caveats) for platform/network
filesystem limitations. No platform or chokidar parity is implied.

Identity consists of fs.realpath(root) plus debounceMs, pollIntervalMs, maxEntries,
maxPendingEvents and pollingOnly. Missing roots temporarily use the resolved lexical
path; create a new subscription to canonicalize an alias after it becomes available.
Different settings get separate underlying watchers. This changes older behavior
where a new subscriber could silently shorten everyone's timing. Options are
snapshotted, and ignored/onError/signal remain subscriber-specific. Close old handles
on reload; subscribing again without disposing is intentionally another subscriber.
Process-local sharing is not cross-process watcher deduplication.

Built-in .git/node_modules/.svn directory segments are pruned from all scans.
Subscriber ignored predicates are synchronous, pure functions receiving normalized
relative paths, including ancestor prefixes. Ignoring dist also hides dist/file.js
for that subscriber only. Custom ignores filter callback **and flush results**;
they do not prune the shared baseline or reduce shared scan cost. New subscribers
cannot hide files from existing ones. Returning a Promise/non-boolean or throwing
reports an error only to that subscriber and suppresses its batch; other subscribers
continue. Generated dist/build/.cache paths are not excluded globally: configure
them explicitly to avoid rebuild loops. This is predicate matching, not glob syntax.
Callback events are frozen copies; subscriber mutation cannot corrupt another's data.
Async callback rejection is reported, but callback promises are not awaited or
serialized. Long-running consumers must serialize/cancel their own work; close does
not wait for arbitrary user callback promises.

## Bounds, failures and ownership

| Setting/resource        | Default                                      | Bound/behavior                                                                                          |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| maxEntries              | 100000                                       | 1–1000000 directory entries examined per scan, including ignored names but not their pruned descendants |
| maxPendingEvents        | 4096                                         | 1–100000 retained events per reconciliation                                                             |
| debounceMs              | 60                                           | 0–600000 integer milliseconds                                                                           |
| pollIntervalMs          | 2000                                         | 100–600000 integer milliseconds                                                                         |
| Scan concurrency        | 4                                            | Process-local limit shared by exported scan and watcher scans                                           |
| Scan admission queue    | 128                                          | Excess calls fail with SCAN_QUEUE_LIMIT; queued abort removes admission                                 |
| Reconciliation requests | One active, one trailing per shared identity | Additional requests share a trailing promise, not an unbounded promise chain                            |

Traversal uses streaming opendir iteration (directory handles close on completion,
throw and cancellation), lstat and bounded pending directories. Descendant symlinks
are not followed, including cycles. watchDirectory canonicalizes trusted root aliases;
standalone scan rejects a symlink root. Direct scan takes an optional third
`{maxEntries, signal}` argument and rejects failures; it has no global ignore defaults.
Only the watcher supplies built-in exclusions. Paths/trees must be trusted: these
checks are not a race-free sandbox against concurrent malicious symlink replacement.
See [Node opendir](https://nodejs.org/api/fs.html#fspromisesopendirpath-options).

Root canonicalization failures other than ENOENT throw a redacted ScanError before
allocating a subscription. A child disappearing with ENOENT/ENOTDIR is a tolerated scan race. Missing roots,
permission failures, limits and other filesystem failures report through onError
on each failed attempt. A failed scan retains the last complete baseline and emits
no synthetic mass deletes. If startup fails, ready still resolves after reporting
its error for compatibility; the first later successful scan establishes a silent
baseline. Polling can recover a missing root. No empty snapshot is claimed as a
successful scan. ScanError.message/code omit paths; its cause can contain private
paths and must remain internal. Callbacks receive relative paths, which may still
be sensitive. Callback/ignore errors are application errors and may contain private
messages; do not blindly publish errors or causes.

On event overflow, the sorted first maxPendingEvents file changes are delivered,
remaining changes are counted as dropped and PENDING_EVENT_LIMIT is reported. The
complete snapshot still advances: dropped changes are not replayed by the next
flush. Perform application-level full reconciliation after overflow or increase
the explicit bound. Coalescing scan requests never increments dropped; it represents
shared work, not a known lost file event. Native notification coalescing cannot
measure how many filesystem writes occurred. A flush while scanning waits for the
single trailing reconciliation; concurrent flushes can share that result. A closed
subscriber's flush returns empty. An already-running flush may finish its shared
scan, but closing prevents further callback delivery.

```ts
import { watchDirectory, activeWatcherCount } from 'zlook';
const controller = new AbortController();
const watcher = watchDirectory('./src', event => console.log(event.type, event.file), {
  signal: controller.signal,
  ignored: file => ['dist', 'build', '.cache'].includes(file),
  maxEntries: 100000, maxPendingEvents: 4096,
  onError: error => console.error(error.message)
});
try {
  await watcher.ready;
  await watcher.flush();
  console.log(watcher.diagnostics()); // Counts and error code; no paths or causes.
} finally {
  watcher.close(); // Or controller.abort(); only this subscription is closed.
  await watcher.closed;
}
console.log(activeWatcherCount());
```

close is idempotent and can run before ready. The last subscriber immediately
removes shared registry membership, aborts queued/in-flight traversal at cooperative
checkpoints, cancels timers and closes its native handle exactly once. Await closed
for scan cleanup and the native close event; OS filesystem operations already in
progress cannot be forcibly interrupted. Closing one subscriber does not cancel
another's shared scan. startWatcher retains its disposal-function API; use
watchDirectory for awaitable cleanup. Unref'ed native scheduling/poll timers do not
keep a process alive by themselves; a live native watcher can do so.

## Diagnostics and verification

handle.diagnostics() returns a frozen count snapshot even after closing.
watcherDiagnostics() returns active shared identities' snapshots without root/file
paths. activeWatcherCount counts shared registry entries, not subscriptions or scan
slots; await closed when verifying resource cleanup. Counters are per shared lifetime:
scans includes the baseline attempt, scanErrors counts failed scans, emitted counts
retained shared file events before subscriber filters, coalesced counts merged
notification/refresh requests, and dropped counts event overflow only. nativeHandles,
pollingHandles, debounceHandles, scanning, pendingScans, subscriptions, closed and
historical lastErrorCode describe current resources/last failure. scanning also
includes a scan awaiting admission; it is not a count of active OS reads. Ignore-filtered
changes are not dropped. A closed subscription sharing an active watcher can still
observe its aggregate diagnostics; subscription closed is its own lifecycle promise.

Focused Node checks cover burst writes, rename/delete/nested changes, build/dependency
ignores, missing roots, unprivileged permission denial, symlink containment, queue
limits, native-backend failure, startup abort, listener/handle cleanup and an offline
npm-installed declaration consumer using shared TypeScript tooling. No live provider
or browser is needed. Windows/macOS/network filesystems and real kernel-event-loss
behavior need platform-specific verification; mocked native failure proves only the
polling fallback path. Full scan costs O(entries) and no performance gain is claimed.

### Reading and maintaining the watcher

`src/scan.ts` owns process-local scan admission and complete candidate snapshots.
`src/watcher.ts` owns shared root/settings identities, timers and native handles;
subscriber ignore policies are applied after scanning so they cannot hide files
from another subscriber. Failed scans keep the last complete baseline. Metadata
comparison uses size and modification time, not a content hash.

Use `watchDirectory` when teardown must be awaited: call `close()` and then await
`closed`. This drains owned startup/scans/native handles, but does not await promises
returned by consumer callbacks; the consumer must cancel and drain that work. The
legacy `startWatcher` returns a stop function only, and an omitted callback remains
an inert compatibility call. Retain that disposer rather than inventing a handle API.
