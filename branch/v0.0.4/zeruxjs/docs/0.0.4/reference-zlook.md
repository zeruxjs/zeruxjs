# Shared file watching

Set up zlook with explicit lifecycle, typed public APIs and deployment boundaries.


## Installation and integration path

```sh
npm install zlook@0.0.3
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

| Option | Accepted TypeScript value | Required | Meaning |
| --- | --- | --- | --- |
| `debounceMs` | `number` | No | Passed using this declared shape; omission is allowed only when marked optional. |
| `pollIntervalMs` | `number` | No | Fallback scan interval; also detects changes missed by native notifications. |
| `ignored` | `(relativePath: string) => boolean` | No | Ignore paths relative to the watched root. |
| `onError` | `(error: Error) => void` | No | Called when watching/scanning fails. |


## Public entry points

Manifest reference for `zlook@0.0.3`.

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# zlook

Filesystem watcher for ZeruxJS, with **shared in-process subscriptions**, native notifications and a polling fallback. File updates are reported once after debouncing, and watchers are disposed when the last subscriber unsubscribes.

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

Events: `new`, `update`, `delete`; paths are relative to the watched root. Default exclusions: `.git`, `node_modules`. Symbolic links are not traversed. `scan` and `diff` are exported for custom watcher integrations.

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

Subscribers to the same directory share underlying watchers without sharing their ignore rules. `startWatcher()` is retained for existing callers and returns a disposal callback. The scanner does not traverse symlinks.

## Watcher validation

`watchDirectory(root, callback, { debounceMs, pollIntervalMs, onError })`
validates callback/root types and integer millisecond settings before creating
any shared native watcher. Polling must be at least 100ms when configured;
intervals are bounded to ten minutes. Subscriber callbacks remain isolated,
errors are reported through `onError`, and handles must be closed during hot
reload/unmount. Filesystem symlinks are never traversed by the recursive scan.
The fallback polling path is retained for hosts where recursive `fs.watch`
is unsupported. Test with `node --test test/*.test.mjs` after building.


## Implementation sources

- [packages/zlook/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zlook/README.md)
- [packages/zlook/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zlook/package.json)
