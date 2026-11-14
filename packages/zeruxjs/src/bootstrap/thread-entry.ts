import { fileURLToPath, pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';

import { registerLoader } from '../loader/register-loader.js';

interface ThreadBootstrapData {
  /** Host-selected executable worker module path or file URL. */
  script: string;
  /** Explicit runtime mode controlling development-only source loading. */
  mode: 'dev' | 'start';
  /** Trusted project source root, used only by the development loader. */
  rootDir: string;
  /** Host-selected loader compatibility label. */
  serviceName: string;
  /** Host-provided initialization payload; application handlers own its validation. */
  workerData?: unknown;
}

type ThreadHandler = (
  payload: unknown,
  context: {
    /** Explicit runtime mode controlling development-only source loading. */
    mode: 'dev' | 'start';
    /** Trusted project source root, used only by the development loader. */
    rootDir: string;
    /** Host-provided initialization payload; application handlers own its validation. */
    workerData?: unknown;
    /** Borrowed worker process environment; never a public configuration projection. */
    env: NodeJS.ProcessEnv;
  }
) => Promise<unknown> | unknown;

/** Trusted parent bootstrap data for this dedicated worker thread; never model or request-provided code. */
const data = workerData as ThreadBootstrapData;

registerLoader(
  data.serviceName,
  data.mode === 'dev' ? { sourceRoot: data.rootDir } : {}
);

/** Convert the explicitly configured worker script to a module URL, adding a development cache key.
 * @param {string} script - Host-selected file path or file URL.
 * @returns {string} Module URL used only for the registered worker.
 */
const toModuleUrl = (script: string) => {
  /** Per-call script URL; development query changes do not modify the configured path. */
  const moduleUrl = script.startsWith('file://')
    ? new URL(script)
    : pathToFileURL(script);

  if (data.mode === 'dev') {
    moduleUrl.searchParams.set('t', `${Date.now()}`);
  }

  return moduleUrl.href;
};

/** Import the host-approved worker script and select one supported handler export.
 * @returns {Promise<ThreadHandler>} Callable handler or a startup rejection for invalid modules.
 */
const loadHandler = async (): Promise<ThreadHandler> => {
  /** Trusted worker module imported once during thread startup. */
  const module = await import(toModuleUrl(data.script));
  /** Supported callable export, or the validated handler retained by this thread. */
  const handler =
    module.default ?? module.handler ?? module.process ?? module.run;

  if (typeof handler !== 'function') {
    throw new TypeError(
      `Thread worker "${fileURLToPath(toModuleUrl(data.script))}" must export default, handler, process, or run function.`
    );
  }

  return handler as ThreadHandler;
};

/** Supported callable export, or the validated handler retained by this thread. */
const handler = await loadHandler();

parentPort?.on('message', async (message: { id: number; payload: unknown }) => {
  try {
    /** Handler result correlated with the parent request ID; serialization remains native worker messaging. */
    const result = await handler(message.payload, {
      mode: data.mode,
      rootDir: data.rootDir,
      workerData: data.workerData,
      env: process.env,
    });

    parentPort?.postMessage({
      id: message.id,
      result,
    });
  } catch (error) {
    parentPort?.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
