import { watchDirectory } from 'zlook';
import { buildWorkspaceAssets } from './workspace-assets.ts';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** One explicit app watcher owner; no mutable build configuration is shared between apps. */
interface WorkspaceAssetWatchOptions {
  /** Trusted source app root; generated/public/private state is excluded from subscriptions. */
  root: string;
  /** Borrowed explicit builder; shutdown waits for its actual settlement. */
  build?: (root: string) => Promise<unknown>;
  /** Borrowed fixed-message observer; exceptions are isolated. */
  onError?: (message: string) => void;
  /** Cooperative host cancellation, paired with explicit awaited close. */
  signal?: AbortSignal;
}
/** Own source-only subscriptions and serialized asset rebuilds for one explicit app root.
 * @param {object} root0 - Trusted watcher/build callbacks, never browser configuration.
 * @param {string} root0.root - Exact app source root; public generated output and private data are not watched.
 * @param {Function} root0.build - Explicit trusted builder, invoked initially and after coalesced edits.
 * @param {Function} root0.onError - Isolated safe observer; its exception cannot take ownership of a build.
 * @param {AbortSignal} root0.signal - Host cancellation; close still waits for actual watcher/build settlement.
 * @returns {Promise<object>} Owned close and flush handles; partial startup failure closes acquired watchers.
 */
export async function watchWorkspaceAssets({
  root,
  build = buildWorkspaceAssets,
  onError = () => {},
  signal,
}: WorkspaceAssetWatchOptions) {
  /** Notify a borrowed observer without allowing it to disrupt build ownership.
   * @param {string} message - Fixed safe operational message, never file contents or secrets.
   * @returns {void} Observer exceptions are isolated.
   */
  const report = (message: string) => {
    try {
      onError(message);
    } catch {
      /* Observers cannot own builds. */
    }
  };
  let stopped = false,
    dirty = false,
    running: Promise<void> | undefined;
  /** Owned zlook subscriptions; close awaits each native closed promise. */
  const handles: ReturnType<typeof watchDirectory>[] = [];
  /** Coalesce changed-source bursts into one serialized builder loop.
   * @returns {Promise<void>} Current build-loop settlement, or an immediate result after close.
   */
  const request = (): Promise<void> => {
    if (stopped) {
      return Promise.resolve();
    }
    dirty = true;
    if (!running) {
      running = (async () => {
        while (dirty && !stopped) {
          dirty = false;
          try {
            await build(root);
          } catch {
            report('Asset build failed; previous output retained.');
          }
        }
      })().finally(() => {
        running = undefined;
        if (dirty && !stopped) {
          void request();
        }
      });
    }
    return running!;
  };
  /** Stop new builds, close every watcher and await actual native/build settlement.
   * @returns {Promise<void>} Teardown result; native watcher failures aggregate after all closure attempts.
   */
  const close = async () => {
    if (!stopped) {
      stopped = true;
      signal?.removeEventListener('abort', abort);
      for (const handle of handles) {
        handle.close();
      }
    }
    /** Actual watcher closure outcomes are observed before surfacing aggregate failures. */
    const results = await Promise.allSettled(
      handles.map((handle) => handle.closed)
    );
    await running;
    /** Closure failures are reported after attempting every watcher handle. */
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) {
      throw new AggregateError(
        failures.map((result) => result.reason),
        'Watcher cleanup failed'
      );
    }
  };
  /** Forward host cancellation into owned asynchronous teardown.
   * @returns {void} Signals closure; callers use the close handle to observe settlement/errors.
   */
  const abort = () => {
    void close().catch(() => {});
  };
  try {
    for (const directory of ['client', 'scripts']) {
      handles.push(
        watchDirectory(
          join(root, directory),
          () => {
            void request();
          },
          {
            debounceMs: 100,
            pollIntervalMs: 1000,
            maxEntries: 2000,
            maxPendingEvents: 128,
            ignored: (relative) =>
              !relative.endsWith('.ts') &&
              !relative.endsWith('.mjs') &&
              relative.includes('.'),
            onError: () =>
              report('Source scan failed; prior watcher baseline retained.'),
            signal,
          }
        )
      );
    }
    await Promise.all(handles.map((handle) => handle.ready));
    if (signal?.aborted) {
      await close();
      return { close, flush: async () => {} };
    }
    signal?.addEventListener('abort', abort, { once: true });
    await request();
    return {
      close,
      /** Flush source watcher batches and wait for their current serialized build.
       * @returns {Promise<void>} Current watcher/build settlement, without starting a user app.
       */
      async flush() {
        await Promise.all(handles.map((handle) => handle.flush()));
        await running;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  /** CLI-owned cancellation scope; signals affect only this explicit watcher command. */
  const controller = new AbortController();
  /** Signal only this explicit CLI watcher owner on native termination.
   * @returns {void} Cancellation is followed by awaited owner.close in the CLI finally block.
   */
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  /** Owned CLI lifetime timer, cleared together with process signal listeners. */
  const keepAlive = setInterval(() => {}, 1000);
  let owner: Awaited<ReturnType<typeof watchWorkspaceAssets>> | undefined;
  try {
    owner = await watchWorkspaceAssets({
      root: dirname(dirname(fileURLToPath(import.meta.url))),
      signal: controller.signal,
      onError: (message) => console.error(message),
    });
    console.log(
      'Watching browser sources and build scripts. Generated public output and private data are excluded.'
    );
    if (!controller.signal.aborted) {
      await new Promise((resolve) =>
        controller.signal.addEventListener('abort', resolve, { once: true })
      );
    }
  } finally {
    try {
      await owner?.close();
    } finally {
      clearInterval(keepAlive);
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  }
}
