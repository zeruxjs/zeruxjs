import path from 'node:path';
import { Worker } from 'node:worker_threads';

import type { Logger } from './logger.js';
import type { ZeruxConfig } from '../index.js';
import type {
  ZeruxPluginApi,
  ZeruxRuntime,
  RuntimeMode,
  ZeruxThreadWorkerInput,
  ZeruxThreadWorkerOptions,
  ZeruxThreadWorkerPool,
  ZeruxThreadWorkerTaskOptions,
  ZeruxWorker,
  ZeruxWorkerCleanup,
  ZeruxWorkerContext,
  ZeruxWorkerHandler,
  ZeruxWorkerInput,
} from './types.js';

interface WorkerTask {
  /** Monotonic pool-local task correlation ID. */
  id: number;
  /** Structured-clone-compatible task input, never executable code selection. */
  payload: unknown;
  /** Owned task deadline timer cleared on terminal handling. */
  timeout?: NodeJS.Timeout;
  /** Settle a correlated native task result.
   * @param {unknown} value - Structured-cloned worker result.
   * @returns {void} Task promise resolution.
   */
  resolve(value: unknown): void;
  /** Settle a correlated task failure without requeueing.
   * @param {unknown} error - Private task/transport failure.
   * @returns {void} Task promise rejection.
   */
  reject(error: unknown): void;
}

interface ThreadWorkerPoolOptions {
  /** Trusted project root for registered worker script resolution. */
  rootDir: string;
  /** Explicit runtime mode controlling development-only loader behavior. */
  mode: RuntimeMode;
  /** Private host configuration used for default thread settings. */
  config: ZeruxConfig;
  /** Borrowed runtime logger; pool does not close it. */
  logger: Logger;
  /** Trusted process loader namespace. */
  serviceName: string;
  /** Explicit host-registered script and thread limits. */
  worker: Required<Pick<ZeruxThreadWorkerOptions, 'name' | 'script'>> &
    ZeruxThreadWorkerOptions;
}

export interface ZeruxWorkerRunResult {
  /** Startup cleanup receipts in acquisition order. */
  cleanups: Array<{
    /** Stable authored worker registration name. */
    name: string; /** Trusted acquired worker cleanup callback. */
    cleanup: ZeruxWorkerCleanup;
  }>;
  /** Reject queued/running tasks, clear their timers and await owned native worker termination.
   * @returns {Promise<void>} Actual native worker termination settlement.
   */
  stop(): Promise<void>;
}

/** Apply the legacy nonnegative parseInt policy for host thread settings.
 * @param {unknown} value - Host-authored thread count candidate.
 * @param {number} fallback - Existing fallback for invalid/negative values.
 * @returns {number} Parsed nonnegative count or fallback; this is not strict decimal validation.
 */
const toPositiveInteger = (value: unknown, fallback: number) => {
  /** Legacy parsed integer retained for compatible thread-count defaults. */
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/** Resolve only a host-registered worker script relative to its project.
 * @param {string} rootDir - Trusted project directory.
 * @param {string | URL} script - Trusted executable worker entry.
 * @returns {string} File URL or absolute local script path.
 */
const resolveThreadWorkerScript = (rootDir: string, script: string | URL) => {
  if (script instanceof URL) {
    return script.href;
  }
  if (script.startsWith('file://')) {
    return script;
  }
  return path.isAbsolute(script) ? script : path.resolve(rootDir, script);
};

/** Forward native execution flags except input-type, which is incompatible with file-backed workers.
 * @returns {string[]} Filtered native worker execution arguments.
 */
const getWorkerExecArgv = () =>
  process.execArgv.filter(
    (arg) => arg !== '--input-type=module' && !arg.startsWith('--input-type=')
  );

/**
 * Normalizes a thread worker registration into the internal options shape.
 *
 * @param {string} name - Registry name supplied by the plugin API.
 * @param {ZeruxThreadWorkerInput} worker - Trusted worker script path, file URL, or descriptor.
 * @returns {Required<Pick<ZeruxThreadWorkerOptions, 'name' | 'script'>> & ZeruxThreadWorkerOptions} Normalized thread worker descriptor.
 */
export const normalizeThreadWorker = (
  name: string,
  worker: ZeruxThreadWorkerInput
): Required<Pick<ZeruxThreadWorkerOptions, 'name' | 'script'>> &
  ZeruxThreadWorkerOptions => {
  if (typeof worker === 'string' || worker instanceof URL) {
    return {
      name,
      script: worker,
    };
  }

  return {
    ...worker,
    name: worker.name ?? name,
  };
};

/**
 * Manages a named pool of Node.js worker threads for CPU-heavy or isolated tasks.
 */
export class ThreadWorkerPool implements ZeruxThreadWorkerPool {
  /** Stable pool name used for registration and redacted diagnostics. */
  readonly name: string;
  /** Normalized minimum native thread count. */
  readonly minThreads: number;
  /** Normalized maximum native threads; no task queue bound is inferred. */
  readonly maxThreads: number;

  /** Trusted script resolution root. */
  private readonly rootDir: string;
  /** Explicit loader mode for worker startup. */
  private readonly mode: RuntimeMode;
  /** Borrowed runtime logger retained for private failure reporting. */
  private readonly logger: Logger;
  /** Trusted native loader compatibility namespace. */
  private readonly serviceName: string;
  /** Resolved explicit executable script, never derived from task payloads. */
  private readonly script: string;
  /** Host initialization data passed once to each native thread. */
  private readonly workerData: unknown;
  /** Owned native threads currently tracked by this pool. */
  private readonly workers = new Set<Worker>();
  /** Available owned threads awaiting assignment. */
  private readonly idleWorkers: Worker[] = [];
  /** At most one correlated task per native thread. */
  private readonly runningTasks = new Map<Worker, WorkerTask>();
  /** Pending task FIFO; this compatibility pool does not impose a capacity cap. */
  private readonly queue: WorkerTask[] = [];
  /** Monotonic pool-local task correlation counter. */
  private nextTaskId = 1;
  /** Whether the pool should dispatch and replenish native threads. */
  private running = false;

  /** Capture explicit host worker settings without starting native threads.
   * @param {ThreadWorkerPoolOptions} options - Resolved runtime and trusted registered worker configuration.
   */
  constructor(options: ThreadWorkerPoolOptions) {
    /** Legacy-normalized configured minimum native thread count. */
    const configMinThreads = toPositiveInteger(
      options.config.worker?.minThreads,
      1
    );
    /** Legacy-normalized configured maximum, at least the configured minimum. */
    const configMaxThreads = toPositiveInteger(
      options.config.worker?.maxThreads,
      Math.max(configMinThreads, 1)
    );
    /** Per-pool minimum overriding host defaults. */
    const minThreads = toPositiveInteger(
      options.worker.minThreads,
      configMinThreads
    );
    /** Per-pool maximum clamped to its minimum; no queued-task capacity is implied. */
    const maxThreads = Math.max(
      minThreads,
      toPositiveInteger(options.worker.maxThreads, configMaxThreads)
    );

    this.name = options.worker.name;
    this.rootDir = options.rootDir;
    this.mode = options.mode;
    this.logger = options.logger;
    this.serviceName = options.serviceName;
    this.script = resolveThreadWorkerScript(
      options.rootDir,
      options.worker.script
    );
    this.workerData = options.worker.workerData;
    this.minThreads = minThreads;
    this.maxThreads = maxThreads;
  }

  /** Read the number of tracked native threads without spawning work.
   * @returns {number} Current native thread count.
   */
  get size() {
    return this.workers.size;
  }

  /** Start the configured minimum native threads once while this pool is running.
   * @returns {void} Thread creation scheduling completion, not handler readiness.
   */
  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    for (let index = 0; index < this.minThreads; index += 1) {
      this.spawnWorker();
    }
  }

  /** Queue one task and optionally reject its wait at a deadline; a running timeout requests native thread termination without awaiting it.
   * @param {TPayload} payload - Structured-clone-compatible task data; never executable script selection.
   * @param {ZeruxThreadWorkerTaskOptions} options - Optional task wait deadline.
   * @returns {Promise<TResult>} Task result or explicit timeout/worker/stop failure.
   */
  run<TPayload = unknown, TResult = unknown>(
    payload: TPayload,
    options: ZeruxThreadWorkerTaskOptions = {}
  ): Promise<TResult> {
    if (!this.running) {
      this.start();
    }

    return new Promise<TResult>((resolve, reject) => {
      /** Task receipt retained until response, timeout, stop or worker failure. */
      const task: WorkerTask = {
        id: this.nextTaskId,
        payload,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      this.nextTaskId += 1;

      if (options.timeoutMs && options.timeoutMs > 0) {
        task.timeout = setTimeout(() => {
          /** Current queued task position; queued timeouts remove work before dispatch. */
          const queuedIndex = this.queue.indexOf(task);
          if (queuedIndex !== -1) {
            this.queue.splice(queuedIndex, 1);
            reject(
              new Error(
                `Thread worker "${this.name}" task timed out after ${options.timeoutMs}ms.`
              )
            );
            return;
          }

          for (const [worker, runningTask] of this.runningTasks) {
            if (runningTask !== task) {
              continue;
            }

            this.runningTasks.delete(worker);
            void worker.terminate();
            break;
          }

          reject(
            new Error(
              `Thread worker "${this.name}" task timed out after ${options.timeoutMs}ms.`
            )
          );
        }, options.timeoutMs);
      }

      this.queue.push(task);
      this.dispatch();
    });
  }

  /** Stop registered work in reverse ownership order; native pool shutdown rejects tasks and awaits worker termination.
   * @returns {Promise<void>} Shutdown settlement; startup cleanup failures follow the runtime logger policy.
   */
  async stop() {
    this.running = false;

    for (const task of this.queue.splice(0)) {
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      task.reject(
        new Error(`Thread worker "${this.name}" stopped before task started.`)
      );
    }

    for (const task of this.runningTasks.values()) {
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      task.reject(
        new Error(`Thread worker "${this.name}" stopped during task execution.`)
      );
    }
    this.runningTasks.clear();
    await Promise.all([...this.workers].map((worker) => worker.terminate()));
    this.workers.clear();
    this.idleWorkers.length = 0;
  }

  /** Create one owned native thread for the trusted configured script and attach correlated result/error/exit handling.
   * @returns {Worker} Owned worker, registered in this pool.
   */
  private spawnWorker() {
    /** Owned native worker for the explicitly registered thread entry. */
    const worker = new Worker(new URL('./thread-entry.js', import.meta.url), {
      execArgv: getWorkerExecArgv(),
      workerData: {
        script: this.script,
        mode: this.mode,
        rootDir: this.rootDir,
        serviceName: this.serviceName,
        workerData: this.workerData,
      },
    });

    this.workers.add(worker);
    this.idleWorkers.push(worker);

    worker.on(
      'message',
      (message: {
        /** Monotonic pool-local task correlation ID. */
        id?: number;
        result?: unknown;
        error?: string;
      }) => {
        /** Task receipt retained until response, timeout, stop or worker failure. */
        const task = this.runningTasks.get(worker);
        if (!task || task.id !== message.id) {
          return;
        }

        this.runningTasks.delete(worker);
        if (task.timeout) {
          clearTimeout(task.timeout);
        }

        if (message.error) {
          task.reject(new Error(message.error));
        } else {
          task.resolve(message.result);
        }

        if (this.running) {
          this.idleWorkers.push(worker);
          this.dispatch();
        }
      }
    );

    worker.on('error', (error) => {
      this.failWorker(
        worker,
        error instanceof Error ? error : new Error(String(error))
      );
    });

    worker.on('exit', (code) => {
      this.workers.delete(worker);
      this.removeIdleWorker(worker);

      /** Task receipt retained until response, timeout, stop or worker failure. */
      const task = this.runningTasks.get(worker);
      if (task) {
        this.runningTasks.delete(worker);
        if (task.timeout) {
          clearTimeout(task.timeout);
        }
        task.reject(
          new Error(`Thread worker "${this.name}" exited with code ${code}.`)
        );
      }

      if (this.running && this.workers.size < this.minThreads) {
        this.spawnWorker();
      }
      if (this.running) {
        this.dispatch();
      }
    });

    return worker;
  }

  /** Assign queued tasks to idle threads, creating threads only up to the configured maximum.
   * @returns {void} Current scheduling completion; the queue itself has no capacity cap.
   */
  private dispatch() {
    while (this.queue.length > 0) {
      let worker = this.idleWorkers.shift();

      if (!worker && this.workers.size < this.maxThreads) {
        worker = this.spawnWorker();
        this.removeIdleWorker(worker);
      }

      if (!worker) {
        return;
      }

      /** Task receipt retained until response, timeout, stop or worker failure. */
      const task = this.queue.shift()!;
      this.runningTasks.set(worker, task);
      worker.postMessage({ id: task.id, payload: task.payload });
    }
  }

  /** Detach a failed native worker and reject its current task without automatic replay.
   * @param {Worker} worker - Owned failed native thread.
   * @param {Error} error - Private failure used to reject the task and log a redacted cause.
   * @returns {void} Failure bookkeeping completion.
   */
  private failWorker(worker: Worker, error: Error) {
    this.workers.delete(worker);
    this.removeIdleWorker(worker);

    /** Task receipt retained until response, timeout, stop or worker failure. */
    const task = this.runningTasks.get(worker);
    if (task) {
      this.runningTasks.delete(worker);
      if (task.timeout) {
        clearTimeout(task.timeout);
      }
      task.reject(error);
    }

    this.logger.error(`Thread worker "${this.name}" failed`, error);
  }

  /** Remove one owned worker from the idle list when it exits or receives work.
   * @param {Worker} worker - Owned native worker identity.
   * @returns {void} Idle-list update completion.
   */
  private removeIdleWorker(worker: Worker) {
    /** Idle worker position removed without disturbing other workers. */
    const index = this.idleWorkers.indexOf(worker);
    if (index !== -1) {
      this.idleWorkers.splice(index, 1);
    }
  }
}

/**
 * Normalizes a startup worker registration into the internal worker shape.
 *
 * @param {string} name - Registry name supplied by the plugin API.
 * @param {ZeruxWorkerInput} worker - Trusted worker handler or descriptor.
 * @returns {ZeruxWorker} Normalized startup worker.
 */
export const normalizeWorker = (
  name: string,
  worker: ZeruxWorkerInput
): ZeruxWorker => {
  if (typeof worker === 'function') {
    return {
      name,
      start: worker,
    };
  }

  /** Trusted startup callback selected from compatible descriptor spellings. */
  const start = worker.start ?? worker.handler;
  if (typeof start !== 'function') {
    throw new TypeError(
      `Worker "${name}" must provide a start or handler function.`
    );
  }

  return {
    name: worker.name ?? name,
    start,
    meta: worker.meta,
  };
};

/** Describe a trusted startup worker without running it; application activation owns execution.
 * @param {string} name - Stable authored worker name.
 * @param {ZeruxWorkerHandler} start - Trusted startup callback returning owned cleanup when needed.
 * @returns {ZeruxWorker} Normalized registration descriptor.
 */
export function defineWorker(
  name: string,
  start: ZeruxWorkerHandler
): ZeruxWorker;
/** Describe a trusted startup worker without running it; application activation owns execution.
 * @param {ZeruxWorker} worker - Explicit authored worker descriptor.
 * @returns {ZeruxWorker} Normalized registration descriptor.
 */
export function defineWorker(worker: ZeruxWorker): ZeruxWorker;
/** Describe a trusted startup worker without running it; application activation owns execution.
 * @param {string | ZeruxWorker} nameOrWorker - Stable name or authored descriptor.
 * @param {ZeruxWorkerHandler} start - Trusted startup callback returning owned cleanup when needed.
 * @returns {ZeruxWorker} Normalized registration descriptor.
 */
export function defineWorker(
  nameOrWorker: string | ZeruxWorker,
  start?: ZeruxWorkerHandler
): ZeruxWorker {
  if (typeof nameOrWorker === 'string') {
    if (typeof start !== 'function') {
      throw new TypeError(
        `Worker "${nameOrWorker}" must provide a start function.`
      );
    }

    return {
      name: nameOrWorker,
      start,
    };
  }

  return normalizeWorker(nameOrWorker.name, nameOrWorker);
}

/** Register trusted startup code without executing it during registration.
 * @param {ZeruxPluginApi} api - Borrowed generation registration authority.
 * @param {string} name - Stable authored worker name.
 * @param {ZeruxWorkerInput} worker - Trusted callback or descriptor.
 * @returns {void} Registration completion.
 */
export const registerWorker = (
  api: ZeruxPluginApi,
  name: string,
  worker: ZeruxWorkerInput
) => {
  api.addWorker(name, worker);
};

/**
 * Defines a thread worker pool backed by Node.js `worker_threads`.
 *
 * @param {string} name - Stable authored thread pool name.
 * @param {string | URL} script - Trusted executable worker module path or file URL.
 * @param {Omit<ZeruxThreadWorkerOptions, 'name' | 'script'>} options - Optional per-pool limits and trusted initialization data.
 * @returns {ZeruxThreadWorkerOptions} Inert registration descriptor.
 */
export const defineThreadWorker = (
  name: string,
  script: string | URL,
  options: Omit<ZeruxThreadWorkerOptions, 'name' | 'script'> = {}
): ZeruxThreadWorkerOptions => ({
  ...options,
  name,
  script,
});

/**
 * Registers a thread worker pool with a plugin or app entry API.
 *
 * @param {ZeruxPluginApi} api - Borrowed trusted generation plugin authority.
 * @param {string} name - Stable authored thread pool name.
 * @param {ZeruxThreadWorkerInput} worker - Trusted worker script or descriptor.
 * @returns {void} Registration completion without starting threads.
 */
export const registerThreadWorker = (
  api: ZeruxPluginApi,
  name: string,
  worker: ZeruxThreadWorkerInput
) => {
  api.addThreadWorker(name, worker);
};

/**
 * Starts all registered startup workers and thread worker pools.
 *
 * @param {ZeruxRuntime} runtime - Prepared private runtime owning worker registrations.
 * @returns {Promise<ZeruxWorkerRunResult>} Cleanup receipt; partial startup failure rolls acquired resources back.
 */
export const runWorkers = async (
  runtime: ZeruxRuntime
): Promise<ZeruxWorkerRunResult> => {
  /** Successfully acquired startup-worker cleanup receipts in acquisition order. */
  const cleanups: Array<{
    /** Stable authored worker registration name. */
    name: string; /** Trusted acquired worker cleanup callback. */
    cleanup: ZeruxWorkerCleanup;
  }> = [];

  try {
    for (const [name, worker] of runtime.workers) {
      /** Private worker context borrowing runtime/services/environment without browser projection. */
      const context: ZeruxWorkerContext = {
        runtime,
        mode: runtime.mode,
        config: runtime.config,
        structure: runtime.structure,
        logger: runtime.logger,
        env: process.env,
        state: runtime.workerState,
      };

      runtime.logger.info(`Starting worker "${name}"`);
      /** Actual startup callback result; only callable cleanup is retained. */
      const cleanup = await worker.start(context);

      if (typeof cleanup === 'function') {
        cleanups.push({ name, cleanup });
      }
    }

    for (const [name, pool] of runtime.threadWorkers) {
      runtime.logger.info(`Starting thread worker pool "${name}"`, {
        minThreads: pool.minThreads,
        maxThreads: pool.maxThreads,
      });
      pool.start();
    }
  } catch (error) {
    // Worker initialization may fail halfway through. Do not leak already
    // started startup workers or thread pools on an unsuccessful bootstrap.
    for (const [, pool] of [...runtime.threadWorkers].reverse()) {
      try {
        await pool.stop();
      } catch (cleanupError) {
        runtime.logger.error('Failed to rollback thread pool', cleanupError);
      }
    }
    for (const { name, cleanup } of [...cleanups].reverse()) {
      try {
        await cleanup();
      } catch (cleanupError) {
        runtime.logger.error(
          `Failed to rollback worker "${name}"`,
          cleanupError
        );
      }
    }
    throw error;
  }

  return {
    cleanups,
    /** Stop registered work in reverse ownership order; native pool shutdown rejects tasks and awaits worker termination.
     * @returns {Promise<void>} Shutdown settlement; startup cleanup failures follow the runtime logger policy.
     */
    async stop() {
      for (const [name, pool] of [...runtime.threadWorkers].reverse()) {
        try {
          await pool.stop();
          runtime.logger.info(`Stopped thread worker pool "${name}"`);
        } catch (error) {
          runtime.logger.error(
            `Failed to stop thread worker pool "${name}"`,
            error
          );
        }
      }

      for (const { name, cleanup } of [...cleanups].reverse()) {
        try {
          await cleanup();
          runtime.logger.info(`Stopped worker "${name}"`);
        } catch (error) {
          runtime.logger.error(`Failed to stop worker "${name}"`, error);
        }
      }

      cleanups.length = 0;
    },
  };
};
