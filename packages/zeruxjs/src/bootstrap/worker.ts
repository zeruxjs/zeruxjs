import path from "node:path";
import { Worker } from "node:worker_threads";

import type { Logger } from "./logger.js";
import type { ZeruxConfig } from "../index.js";
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
    ZeruxWorkerInput
} from "./types.js";

interface WorkerTask {
    id: number;
    payload: unknown;
    timeout?: NodeJS.Timeout;
    resolve(value: unknown): void;
    reject(error: unknown): void;
}

interface ThreadWorkerPoolOptions {
    rootDir: string;
    mode: RuntimeMode;
    config: ZeruxConfig;
    logger: Logger;
    serviceName: string;
    worker: Required<Pick<ZeruxThreadWorkerOptions, "name" | "script">> & ZeruxThreadWorkerOptions;
}

export interface ZeruxWorkerRunResult {
    cleanups: Array<{ name: string; cleanup: ZeruxWorkerCleanup }>;
    stop(): Promise<void>;
}

const toPositiveInteger = (value: unknown, fallback: number) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const resolveThreadWorkerScript = (rootDir: string, script: string | URL) => {
    if (script instanceof URL) return script.href;
    if (script.startsWith("file://")) return script;
    return path.isAbsolute(script) ? script : path.resolve(rootDir, script);
};

const getWorkerExecArgv = () =>
    process.execArgv.filter((arg) => arg !== "--input-type=module" && !arg.startsWith("--input-type="));

/**
 * Normalizes a thread worker registration into the internal options shape.
 *
 * @param name - Registry name supplied by the plugin API.
 * @param worker - Worker script path, file URL, or options object.
 * @returns A normalized thread worker options object.
 */
export const normalizeThreadWorker = (
    name: string,
    worker: ZeruxThreadWorkerInput
): Required<Pick<ZeruxThreadWorkerOptions, "name" | "script">> & ZeruxThreadWorkerOptions => {
    if (typeof worker === "string" || worker instanceof URL) {
        return {
            name,
            script: worker
        };
    }

    return {
        ...worker,
        name: worker.name ?? name
    };
};

/**
 * Manages a named pool of Node.js worker threads for CPU-heavy or isolated tasks.
 */
export class ThreadWorkerPool implements ZeruxThreadWorkerPool {
    readonly name: string;
    readonly minThreads: number;
    readonly maxThreads: number;

    private readonly rootDir: string;
    private readonly mode: RuntimeMode;
    private readonly logger: Logger;
    private readonly serviceName: string;
    private readonly script: string;
    private readonly workerData: unknown;
    private readonly workers = new Set<Worker>();
    private readonly idleWorkers: Worker[] = [];
    private readonly runningTasks = new Map<Worker, WorkerTask>();
    private readonly queue: WorkerTask[] = [];
    private nextTaskId = 1;
    private running = false;

    /**
     * Creates a thread worker pool.
     *
     * @param options - Pool configuration resolved from `zerux.config.ts` and plugin registration.
     */
    constructor(options: ThreadWorkerPoolOptions) {
        const configMinThreads = toPositiveInteger(options.config.worker?.minThreads, 1);
        const configMaxThreads = toPositiveInteger(options.config.worker?.maxThreads, Math.max(configMinThreads, 1));
        const minThreads = toPositiveInteger(options.worker.minThreads, configMinThreads);
        const maxThreads = Math.max(minThreads, toPositiveInteger(options.worker.maxThreads, configMaxThreads));

        this.name = options.worker.name;
        this.rootDir = options.rootDir;
        this.mode = options.mode;
        this.logger = options.logger;
        this.serviceName = options.serviceName;
        this.script = resolveThreadWorkerScript(options.rootDir, options.worker.script);
        this.workerData = options.worker.workerData;
        this.minThreads = minThreads;
        this.maxThreads = maxThreads;
    }

    get size() {
        return this.workers.size;
    }

    start() {
        if (this.running) return;

        this.running = true;
        for (let index = 0; index < this.minThreads; index += 1) {
            this.spawnWorker();
        }
    }

    run<TPayload = unknown, TResult = unknown>(
        payload: TPayload,
        options: ZeruxThreadWorkerTaskOptions = {}
    ): Promise<TResult> {
        if (!this.running) {
            this.start();
        }

        return new Promise<TResult>((resolve, reject) => {
            const task: WorkerTask = {
                id: this.nextTaskId,
                payload,
                resolve: resolve as (value: unknown) => void,
                reject
            };
            this.nextTaskId += 1;

            if (options.timeoutMs && options.timeoutMs > 0) {
                task.timeout = setTimeout(() => {
                    const queuedIndex = this.queue.indexOf(task);
                    if (queuedIndex !== -1) {
                        this.queue.splice(queuedIndex, 1);
                        reject(new Error(`Thread worker "${this.name}" task timed out after ${options.timeoutMs}ms.`));
                        return;
                    }

                    for (const [worker, runningTask] of this.runningTasks) {
                        if (runningTask !== task) continue;

                        this.runningTasks.delete(worker);
                        void worker.terminate();
                        break;
                    }

                    reject(new Error(`Thread worker "${this.name}" task timed out after ${options.timeoutMs}ms.`));
                }, options.timeoutMs);
            }

            this.queue.push(task);
            this.dispatch();
        });
    }

    async stop() {
        this.running = false;

        for (const task of this.queue.splice(0)) {
            if (task.timeout) clearTimeout(task.timeout);
            task.reject(new Error(`Thread worker "${this.name}" stopped before task started.`));
        }

        for (const task of this.runningTasks.values()) {
            if (task.timeout) clearTimeout(task.timeout);
            task.reject(new Error(`Thread worker "${this.name}" stopped during task execution.`));
        }
        this.runningTasks.clear();
        await Promise.all([...this.workers].map((worker) => worker.terminate()));
        this.workers.clear();
        this.idleWorkers.length = 0;
    }

    private spawnWorker() {
        const worker = new Worker(new URL("./thread-entry.js", import.meta.url), {
            execArgv: getWorkerExecArgv(),
            workerData: {
                script: this.script,
                mode: this.mode,
                rootDir: this.rootDir,
                serviceName: this.serviceName,
                workerData: this.workerData
            }
        });

        this.workers.add(worker);
        this.idleWorkers.push(worker);

        worker.on("message", (message: { id?: number; result?: unknown; error?: string }) => {
            const task = this.runningTasks.get(worker);
            if (!task || task.id !== message.id) return;

            this.runningTasks.delete(worker);
            if (task.timeout) clearTimeout(task.timeout);

            if (message.error) {
                task.reject(new Error(message.error));
            } else {
                task.resolve(message.result);
            }

            if (this.running) {
                this.idleWorkers.push(worker);
                this.dispatch();
            }
        });

        worker.on("error", (error) => {
            this.failWorker(worker, error instanceof Error ? error : new Error(String(error)));
        });

        worker.on("exit", (code) => {
            this.workers.delete(worker);
            this.removeIdleWorker(worker);

            const task = this.runningTasks.get(worker);
            if (task) {
                this.runningTasks.delete(worker);
                if (task.timeout) clearTimeout(task.timeout);
                task.reject(new Error(`Thread worker "${this.name}" exited with code ${code}.`));
            }

            if (this.running && this.workers.size < this.minThreads) {
                this.spawnWorker();
            }
            if (this.running) this.dispatch();
        });

        return worker;
    }

    private dispatch() {
        while (this.queue.length > 0) {
            let worker = this.idleWorkers.shift();

            if (!worker && this.workers.size < this.maxThreads) {
                worker = this.spawnWorker();
                this.removeIdleWorker(worker);
            }

            if (!worker) return;

            const task = this.queue.shift()!;
            this.runningTasks.set(worker, task);
            worker.postMessage({ id: task.id, payload: task.payload });
        }
    }

    private failWorker(worker: Worker, error: Error) {
        this.workers.delete(worker);
        this.removeIdleWorker(worker);

        const task = this.runningTasks.get(worker);
        if (task) {
            this.runningTasks.delete(worker);
            if (task.timeout) clearTimeout(task.timeout);
            task.reject(error);
        }

        this.logger.error(`Thread worker "${this.name}" failed`, error);
    }

    private removeIdleWorker(worker: Worker) {
        const index = this.idleWorkers.indexOf(worker);
        if (index !== -1) {
            this.idleWorkers.splice(index, 1);
        }
    }
}

/**
 * Normalizes a startup worker registration into the internal worker shape.
 *
 * @param name - Registry name supplied by the plugin API.
 * @param worker - Worker handler or options object.
 * @returns A normalized startup worker.
 */
export const normalizeWorker = (name: string, worker: ZeruxWorkerInput): ZeruxWorker => {
    if (typeof worker === "function") {
        return {
            name,
            start: worker
        };
    }

    const start = worker.start ?? worker.handler;
    if (typeof start !== "function") {
        throw new TypeError(`Worker "${name}" must provide a start or handler function.`);
    }

    return {
        name: worker.name ?? name,
        start,
        meta: worker.meta
    };
};

/**
 * Defines a startup worker that runs before the HTTP server starts.
 *
 * @param name - Unique worker name used in the runtime registry.
 * @param start - Startup function that can return a cleanup callback.
 * @returns A normalized worker definition for `api.addWorker`.
 */
export function defineWorker(name: string, start: ZeruxWorkerHandler): ZeruxWorker;
export function defineWorker(worker: ZeruxWorker): ZeruxWorker;
export function defineWorker(
    nameOrWorker: string | ZeruxWorker,
    start?: ZeruxWorkerHandler
): ZeruxWorker {
    if (typeof nameOrWorker === "string") {
        if (typeof start !== "function") {
            throw new TypeError(`Worker "${nameOrWorker}" must provide a start function.`);
        }

        return {
            name: nameOrWorker,
            start
        };
    }

    return normalizeWorker(nameOrWorker.name, nameOrWorker);
}

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
 * @param name - Unique thread worker pool name.
 * @param script - Worker module path or file URL.
 * @param options - Optional per-pool thread limits and worker data.
 * @returns A thread worker definition for `api.addThreadWorker`.
 */
export const defineThreadWorker = (
    name: string,
    script: string | URL,
    options: Omit<ZeruxThreadWorkerOptions, "name" | "script"> = {}
): ZeruxThreadWorkerOptions => ({
    ...options,
    name,
    script
});

/**
 * Registers a thread worker pool with a plugin or app entry API.
 *
 * @param api - Zerux plugin API.
 * @param name - Unique thread worker pool name.
 * @param worker - Worker script path, file URL, or full options object.
 * @returns Nothing.
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
 * @param runtime - Bootstrapped Zerux runtime.
 * @returns Cleanup manager used during dev reloads and shutdown paths.
 */
export const runWorkers = async (runtime: ZeruxRuntime): Promise<ZeruxWorkerRunResult> => {
    const cleanups: Array<{ name: string; cleanup: ZeruxWorkerCleanup }> = [];

    try {
    for (const [name, worker] of runtime.workers) {
        const context: ZeruxWorkerContext = {
            runtime,
            mode: runtime.mode,
            config: runtime.config,
            structure: runtime.structure,
            logger: runtime.logger,
            env: process.env,
            state: runtime.workerState
        };

        runtime.logger.info(`Starting worker "${name}"`);
        const cleanup = await worker.start(context);

        if (typeof cleanup === "function") {
            cleanups.push({ name, cleanup });
        }
    }

    for (const [name, pool] of runtime.threadWorkers) {
        runtime.logger.info(`Starting thread worker pool "${name}"`, {
            minThreads: pool.minThreads,
            maxThreads: pool.maxThreads
        });
        pool.start();
    }

    } catch (error) {
        // Worker initialization may fail halfway through. Do not leak already
        // started startup workers or thread pools on an unsuccessful bootstrap.
        for (const [, pool] of [...runtime.threadWorkers].reverse()) {
            try { await pool.stop(); } catch (cleanupError) { runtime.logger.error('Failed to rollback thread pool', cleanupError); }
        }
        for (const { name, cleanup } of [...cleanups].reverse()) {
            try { await cleanup(); }
            catch (cleanupError) { runtime.logger.error(`Failed to rollback worker "${name}"`, cleanupError); }
        }
        throw error;
    }

    return {
        cleanups,
        async stop() {
            for (const [name, pool] of [...runtime.threadWorkers].reverse()) {
                try {
                    await pool.stop();
                    runtime.logger.info(`Stopped thread worker pool "${name}"`);
                } catch (error) {
                    runtime.logger.error(`Failed to stop thread worker pool "${name}"`, error);
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
        }
    };
};
