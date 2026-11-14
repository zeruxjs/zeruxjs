---
{
  "title": "Shared file watching",
  "description": "Set up zlook with explicit lifecycle, typed public APIs and deployment boundaries.",
  "section": "Packages",
  "order": 210,
  "package": "zlook",
  "sources": [
    "packages/zlook/README.md",
    "packages/zlook/package.json",
    "packages/zlook/src/scan.ts",
    "packages/zlook/src/watcher.ts",
    "packages/zlook/src/types.ts"
  ],
  "related": [
    "packages",
    "typescript",
    "configuration-reference"
  ]
}
---

## Installation and integration path

```sh
npm install zlook@0.0.4
```

This package has its own public API. Installing it does not create an automatic runtime service key in `zerux.config.js`. Use the framework integration described below or initialize it in the tool/application that owns its lifetime.

## Worked TypeScript setup

```ts
import { watchDirectory } from 'zlook';
const watcher = watchDirectory('./src', event => console.log(event), {
  debounceMs: 100, pollIntervalMs: 2000,
  ignored: file => file === '.cache' || file.startsWith('.cache/'),
  onError: error => console.error(error.message),
});
await watcher.ready;
await watcher.flush();
watcher.close();
await watcher.closed;
```

JavaScript can use the same runtime APIs without type-only statements. Enable JSDoc checking if editor validation is desired; a transpilation step alone does not typecheck the input.

## Usage and configuration

Create one subscriber per development task and await its baseline before relying on changes. Subscribers to the same canonical directory share underlying work while retaining separate ignore rules and callbacks. Sharing is process-local, not a daemon or cross-process lock. Native recursive watching falls back to polling on unsupported hosts.

Ignore generated output to avoid rebuild loops. Watch only trusted source directories and keep callback work debounced; a callback can still be expensive even when the watcher is shared. `ready` establishes the baseline and `flush` forces reconciliation. `startWatcher` remains a simpler API returning a stop callback.

## Public types

```ts
import { watchDirectory } from 'zlook';
type Inputs = Parameters<typeof watchDirectory>;
type Result = Awaited<ReturnType<typeof watchDirectory>>;
```

Use installed public declarations and validate untrusted runtime values separately. Avoid deep source imports; the manifest reference below records the actual exported entry points for this version. Generic helpers may preserve a more useful concrete type at the call site than a broad ReturnType alias.

## Failures, ownership and production use

Close every handle on reload/shutdown. Callback errors and filesystem errors should be surfaced through the configured error handling. Polling observes metadata, so same-size writes with preserved modification time can be missed. A scan is O(files); validate the chosen polling interval against the project size. Verify add/change/delete, ignored paths, symlinks and nested directory changes on the actual operating system.

## Verify the integration

Run the real owning application/tool with a normal input and a failure input. Inspect exit status or typed results, then verify cleanup/restart and the installed production entry point. A successful docs build does not exercise child processes, browser APIs, sockets or filesystem permissions on every supported operating system.

## Option reference

### WatchOptions

| Option             | Accepted TypeScript value           | Required | Meaning                                                                      |
| ------------------ | ----------------------------------- | -------- | ---------------------------------------------------------------------------- |
| `debounceMs`       | `number`                            | No       | Integer 0–600000ms trailing debounce; defaults to 60.                        |
| `pollIntervalMs`   | `number`                            | No       | Fallback scan interval; also detects changes missed by native notifications. |
| `ignored`          | `(relativePath: string) => boolean` | No       | Ignore paths relative to the watched root.                                   |
| `onError`          | `(error: Error) => void`            | No       | Isolated handler for scan/native/callback failures; causes remain private.   |
| `maxEntries`       | `number`                            | No       | Integer 1–1000000 examined names per scan; defaults to 100000.               |
| `maxPendingEvents` | `number`                            | No       | Integer 1–100000 retained changes per reconciliation; defaults to 4096.      |
| `pollingOnly`      | `boolean`                           | No       | Suppresses native allocation; periodic reconciliation remains active.        |
| `signal`           | `AbortSignal`                       | No       | Closes this subscription independently, including during startup.            |

## Bounded reconciliation and subscriber isolation

Sharing identity is the canonical existing root plus debounceMs, pollIntervalMs,
maxEntries, maxPendingEvents and pollingOnly. Missing roots use a resolved lexical
path until a new subscription canonicalizes them. Distinct settings do not change
another subscriber's timing. Options are snapshotted; ignore/error/signal handlers
stay local. Built-in .git/node_modules/.svn segments are pruned. Custom synchronous
pure ignored predicates match normalized relative paths and ancestor prefixes, filter
callbacks and flush results, and do not prune the shared scan. Configure dist/build
explicitly to prevent rebuild loops. New subscribers cannot hide another's files.

Only new/update/delete file events exist: rename is delete+new, directories produce
no standalone event, and bursts reconcile final metadata. Baseline scan is silent.
A create/delete between scans or same-size write preserving mtime may be missed.
Events are path-sorted, not chronological. This is not full chokidar parity.

Defaults are debounce 60ms, polling 2000ms, maxEntries 100000, maxPendingEvents 4096.
Entry bound is 1–1000000; event bound is 1–100000. Streaming traversal counts examined
entry names, including ignored names but not their pruned contents. There are at most
four process-local scans, 128 admission waiters, and one active/one trailing refresh
per identity. Additional refresh requests share work instead of growing a queue.
Exported scan(root, ignored, {maxEntries, signal}) uses the same admission limit.
It has no default ignores and rejects filesystem failures; watcher failures report
through onError and flush resolves empty while preserving the previous baseline.

Missing roots, permission errors and limits never become synthetic deletes. Missing
children may race writes and are tolerated. Failed startup still resolves ready after
reporting; a later successful poll establishes a silent baseline. ScanError exposes a
redacted message/code; raw cause is internal and can contain private paths. Descendant
symlinks are not traversed; trusted root aliases are canonicalized. These checks are
not a sandbox against concurrent malicious tree replacement.

```ts
import { watchDirectory } from 'zlook';
const watcher = watchDirectory('./src', event => console.log(event.type, event.file), {
  ignored: file => ['dist', 'build', '.cache'].includes(file),
  maxEntries: 100000, maxPendingEvents: 4096,
  onError: error => console.error(error.message)
});
try {
  await watcher.ready;
  await watcher.flush();
  console.log(watcher.diagnostics());
} finally { watcher.close(); await watcher.closed; }
```

A subscription accepts signal and closes independently on abort. close is idempotent
before/during startup. The last subscriber aborts traversal, removes registry membership,
cancels timers and releases its native handle once. Await closed to observe scan/native
cleanup. An OS read already in flight cannot be forcibly interrupted. Async consumer
callbacks are not awaited; their owner must serialize/cancel that separate work.

Native events reset a trailing debounce; periodic polling can request reconciliation
sooner. pollingOnly=true forces fallback. A failed native backend is reported and not
recreated repeatedly; polling continues. See [Node watch caveats](https://nodejs.org/api/fs.html#caveats)
and [directory iteration](https://nodejs.org/api/fs.html#fspromisesopendirpath-options).
No Windows/macOS/network filesystem parity is claimed by local Node tests.

watcherDiagnostics and handle.diagnostics contain counts and lastErrorCode, not paths
or causes. activeWatcherCount counts shared identities, not subscribers or individual
handles. scans includes startup, scanErrors counts failed scans, emitted counts retained
shared events before filters, coalesced counts merged notification/refresh requests,
and dropped counts overflow only. On overflow the sorted first maxPendingEvents changes
are delivered and PENDING_EVENT_LIMIT is reported; the full baseline advances, so
omitted changes are not replayed. Perform full application reconciliation after that
error. Ignore-filtered changes are not drops, and coalescing cannot measure write counts.
Tests exercise permission denial, fallback failure, overflow, burst/rename, independent
ignores, startup cancellation and offline installed public declarations. No app is started.
