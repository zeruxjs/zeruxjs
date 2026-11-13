import { watchDirectory } from 'zlook';
import { buildWorkspaceAssets } from './workspace-assets.mjs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function watchWorkspaceAssets({
  root,
  build = buildWorkspaceAssets,
  onError = () => {},
  signal,
}) {
  const report = (message) => {
    try {
      onError(message);
    } catch {
      /* Observers cannot own builds. */
    }
  };
  let stopped = false,
    dirty = false,
    running;
  const handles = [];
  const request = () => {
    if (stopped) return Promise.resolve();
    dirty = true;
    if (!running)
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
        if (dirty && !stopped) void request();
      });
    return running;
  };
  const close = async () => {
    if (!stopped) {
      stopped = true;
      signal?.removeEventListener('abort', abort);
      for (const handle of handles) handle.close();
    }
    const results = await Promise.allSettled(
      handles.map((handle) => handle.closed)
    );
    await running;
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        'Watcher cleanup failed'
      );
  };
  const abort = () => {
    void close().catch(() => {});
  };
  try {
    for (const directory of ['client', 'scripts'])
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
    await Promise.all(handles.map((handle) => handle.ready));
    if (signal?.aborted) {
      await close();
      return { close, flush: async () => {} };
    }
    signal?.addEventListener('abort', abort, { once: true });
    await request();
    return {
      close,
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
  const controller = new AbortController(),
    stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const keepAlive = setInterval(() => {}, 1000);
  let owner;
  try {
    owner = await watchWorkspaceAssets({
      root: dirname(dirname(fileURLToPath(import.meta.url))),
      signal: controller.signal,
      onError: (message) => console.error(message),
    });
    console.log(
      'Watching browser sources and build scripts. Generated public output and private data are excluded.'
    );
    if (!controller.signal.aborted)
      await new Promise((resolve) =>
        controller.signal.addEventListener('abort', resolve, { once: true })
      );
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
