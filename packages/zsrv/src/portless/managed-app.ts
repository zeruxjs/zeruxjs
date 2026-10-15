/** Restartable, observable child supervision. Route leases exist only for ready
 * children; manual restarts are serialized and do not consume crash budgets. */
import { launchSupervisedCommand, exitStatus, type ProcessExit, type SupervisedProcess, type SupervisorOptions } from './process-supervisor.js';
import { probeApplicationHealth } from './health.js';
import { serializeExit, type ManagedPhase, type ManagedStatus, type StatusListener } from './managed-status.js';

export type RestartPolicy = 'never' | 'on-failure' | 'always';
export interface ManagedAppOptions extends SupervisorOptions {
    restartPolicy?: RestartPolicy;
    maxRestarts?: number;
    restartWindowMs?: number;
    restartDelayMs?: number;
    maxRestartDelayMs?: number;
    healthIntervalMs?: number;
    unhealthyThreshold?: number;
    /** Publish the route after readiness; return its cleanup closure. */
    onReady?: (process: SupervisedProcess) => void | (() => void) | Promise<void | (() => void)>;
    onRestart?: (attempt: number, delayMs: number, reason: ProcessExit) => void;
    onStatus?: StatusListener;
}
export interface ManagedApp {
    readonly current: SupervisedProcess | undefined;
    readonly running: boolean;
    readonly status: Readonly<ManagedStatus>;
    readonly completed: Promise<ProcessExit>;
    /** Serializes concurrent manual restarts; starts the next child only after the previous exits. */
    restart(): Promise<void>;
    /** Subscribe to subsequent transitions. Returns a cleanup function. */
    subscribe(listener: StatusListener): () => void;
    stop(signal?: NodeJS.Signals): Promise<ProcessExit>;
}

function integer(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
    const n = value ?? fallback;
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
    return n;
}
export function validateManagedOptions(options: ManagedAppOptions): Required<Pick<ManagedAppOptions,
    'restartPolicy' | 'maxRestarts' | 'restartWindowMs' | 'restartDelayMs' | 'maxRestartDelayMs' | 'healthIntervalMs' | 'unhealthyThreshold'>> {
    const restartPolicy = options.restartPolicy ?? 'never';
    if (!['never', 'on-failure', 'always'].includes(restartPolicy)) throw new TypeError('Invalid restart policy');
    const maxRestarts = integer(options.maxRestarts, 3, 0, 100, 'maxRestarts');
    const restartWindowMs = integer(options.restartWindowMs, 60_000, 100, 3_600_000, 'restartWindowMs');
    const restartDelayMs = integer(options.restartDelayMs, 250, 1, 60_000, 'restartDelayMs');
    const maxRestartDelayMs = integer(options.maxRestartDelayMs, 10_000, 1, 120_000, 'maxRestartDelayMs');
    if (maxRestartDelayMs < restartDelayMs) throw new RangeError('maxRestartDelayMs must be >= restartDelayMs');
    const healthIntervalMs = integer(options.healthIntervalMs, options.health?.path ? 10_000 : 0, 0, 300_000, 'healthIntervalMs');
    const unhealthyThreshold = integer(options.unhealthyThreshold, 3, 1, 20, 'unhealthyThreshold');
    if (healthIntervalMs && healthIntervalMs < 100) throw new RangeError('healthIntervalMs must be 0 or >=100');
    if ((healthIntervalMs || options.health?.path) && options.port === undefined) throw new Error('Health monitoring requires an application port');
    return { restartPolicy, maxRestarts, restartWindowMs, restartDelayMs, maxRestartDelayMs, healthIntervalMs, unhealthyThreshold };
}

/** Await initial readiness before returning. No listener or route leaks on failure. */
export async function launchManagedApplication(argv: readonly string[], options: ManagedAppOptions = {}): Promise<ManagedApp> {
    const config = validateManagedOptions(options);
    const { onReady, onRestart, onStatus, ...other } = options;
    let active: SupervisedProcess | undefined;
    let stopping = false;
    let settled = false;
    let resolveDone!: (result: ProcessExit) => void;
    let wakeDelay: (() => void) | undefined;
    let releaseRoute: (() => void) | undefined;
    let monitor: ReturnType<typeof setInterval> | undefined;
    let failingHealth = false;
    let automaticRestarts = 0;
    let generation = 0;
    let lastExit: ManagedStatus['lastExit'] = null;
    const subscribers = new Set<StatusListener>();
    let snapshot: ManagedStatus = Object.freeze({phase: 'starting' as ManagedPhase, pid: null, generation: 0,
        automaticRestarts: 0, lastExit: null, updatedAt: new Date().toISOString()});
    let manual: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } | undefined;
    const restartTimes: number[] = [];
    const completed = new Promise<ProcessExit>(resolve => { resolveDone = resolve; });
    const update = (phase: ManagedPhase, pid: number | null = active?.child.pid ?? null) => {
        snapshot = Object.freeze({ phase, pid, generation, automaticRestarts, lastExit, updatedAt: new Date().toISOString() });
        for (const listener of [...subscribers, ...(onStatus ? [onStatus] : [])]) {
            try { listener(snapshot); } catch (error) { console.error('Managed app status callback failed:', error); }
        }
    };
    const clearMonitor = () => { if (monitor) clearInterval(monitor); monitor = undefined; };
    const release = () => {
        const fn = releaseRoute;
        releaseRoute = undefined;
        if (fn) { try { fn(); } catch (error) { console.error('Managed app route cleanup failed:', error); } }
    };
    const rejectManual = (error: Error) => { const m = manual; manual = undefined; m?.reject(error); };
    const acceptManual = () => { const m = manual; manual = undefined; m?.resolve(); };
    const onSignalInt = () => { void stop('SIGINT'); };
    const onSignalTerm = () => { void stop('SIGTERM'); };
    const finish = (result: ProcessExit) => {
        if (settled) return;
        settled = true;
        clearMonitor();
        release();
        active = undefined;
        lastExit = serializeExit(result);
        update('stopped', null);
        subscribers.clear();
        process.removeListener('SIGINT', onSignalInt);
        process.removeListener('SIGTERM', onSignalTerm);
        rejectManual(new Error('Application stopped before manual restart completed'));
        resolveDone(result);
        try { options.onExit?.(result); } catch (error) { console.error('Managed app exit callback failed:', error); }
    };
    const stop = (signal: NodeJS.Signals = 'SIGTERM'): Promise<ProcessExit> => {
        if (!stopping && !settled) {
            stopping = true;
            update('stopping');
            rejectManual(new Error('Manual restart cancelled by shutdown'));
            wakeDelay?.();
            if (active?.running) void active.stop(signal).catch(error => console.error('Managed app stop failed:', error));
        }
        return completed;
    };
    const restart = (): Promise<void> => {
        if (stopping || settled) return Promise.reject(new Error('Cannot restart a stopped application'));
        if (manual) return manual.promise;
        let resolve!: () => void;
        let reject!: (error: Error) => void;
        const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
        manual = { promise, resolve, reject };
        update('restarting');
        wakeDelay?.();
        if (active?.running) void active.stop('SIGTERM').catch(error => rejectManual(error instanceof Error ? error : new Error(String(error))));
        return promise;
    };
    const handle: ManagedApp = {
        get current() { return active; }, get running() { return !settled; }, get status() { return snapshot; },
        completed, restart, stop,
        subscribe(listener) {
            subscribers.add(listener);
            return () => { subscribers.delete(listener); };
        },
    };
    const spawn = async () => {
        const child = await launchSupervisedCommand(argv, { ...other, forwardSignals: false, onExit: undefined });
        active = child;
        if (stopping || !child.running) {
            if (child.running) await child.stop();
            throw new Error('Application exited before route publication');
        }
        try {
            const disposal = await onReady?.(child);
            releaseRoute = typeof disposal === 'function' ? disposal : undefined;
            if (stopping || !child.running) throw new Error('Application exited while publishing route');
        } catch (error) {
            if (child.running) await child.stop();
            release();
            throw error;
        }
        generation++;
        update('running');
        return child;
    };
    const monitorHealth = (child: SupervisedProcess) => {
        if (!config.healthIntervalMs || options.port === undefined) return;
        let pending = false;
        let failures = 0;
        monitor = setInterval(() => {
            if (pending || !child.running || stopping || manual) return;
            pending = true;
            void probeApplicationHealth(options.port!, options.health).then(ok => {
                if (!child.running || stopping || manual) return;
                failures = ok ? 0 : failures + 1;
                if (failures >= config.unhealthyThreshold) {
                    failingHealth = true;
                    clearMonitor();
                    void child.stop();
                }
            }).catch(() => {
                if (!child.running || stopping || manual) return;
                if (++failures >= config.unhealthyThreshold) {
                    failingHealth = true;
                    clearMonitor();
                    void child.stop();
                }
            }).finally(() => { pending = false; });
        }, config.healthIntervalMs);
        monitor.unref?.();
    };
    const pause = (ms: number) => new Promise<void>(resolve => {
        const timer = setTimeout(() => { wakeDelay = undefined; resolve(); }, ms);
        wakeDelay = () => { clearTimeout(timer); wakeDelay = undefined; resolve(); };
    });
    update('starting', null);
    const first = await spawn();
    if (options.forwardSignals !== false) {
        process.on('SIGINT', onSignalInt);
        process.on('SIGTERM', onSignalTerm);
    }
    void (async () => {
        let child = first;
        let finalExit: ProcessExit = { code: null, signal: null, error: new Error('Application stopped') };
        for (;;) {
            failingHealth = false;
            monitorHealth(child);
            const result = await child.completed;
            clearMonitor();
            release();
            active = undefined;
            finalExit = failingHealth ? { ...result, error: new Error('Application failed health checks') } : result;
            lastExit = serializeExit(finalExit);
            if (stopping) break;
            if (manual) {
                update('restarting', null);
                try {
                    child = await spawn();
                    acceptManual();
                    continue;
                } catch (error) {
                    finalExit = { code: null, signal: null, error: error instanceof Error ? error : new Error(String(error)) };
                    rejectManual(finalExit.error!);
                    break;
                }
            }
            if (config.restartPolicy === 'never' || (config.restartPolicy === 'on-failure' && exitStatus(finalExit) === 0)) break;
            const now = Date.now();
            while (restartTimes.length && restartTimes[0] <= now - config.restartWindowMs) restartTimes.shift();
            if (restartTimes.length >= config.maxRestarts) {
                finalExit = { ...finalExit, error: new Error(`Restart budget exhausted (${config.maxRestarts} in ${config.restartWindowMs}ms)`) };
                break;
            }
            const attempt = restartTimes.length + 1;
            restartTimes.push(now);
            automaticRestarts++;
            const backoff = Math.min(config.maxRestartDelayMs, config.restartDelayMs * 2 ** Math.min(attempt - 1, 16));
            update('restarting', null);
            try { onRestart?.(attempt, backoff, finalExit); } catch (error) { console.error('Restart notification failed:', error); }
            await pause(backoff);
            if (stopping) break;
            if (manual) {
                try { child = await spawn(); acceptManual(); continue; }
                catch (error) {
                    finalExit = { code: null, signal: null, error: error instanceof Error ? error : new Error(String(error)) };
                    rejectManual(finalExit.error!);
                    break;
                }
            }
            try {
                child = await spawn();
                // A manual restart requested during readiness takes precedence.
                if (manual && child.running) void child.stop();
            }
            catch (error) {
                finalExit = { code: null, signal: null, error: error instanceof Error ? error : new Error(String(error)) };
                // Failed launches consume the same automatic restart budget.
                child = { child: first.child, completed: Promise.resolve(finalExit), running: false, stop: async () => finalExit };
            }
        }
        finish(finalExit);
    })().catch(error => finish({ code: null, signal: null, error: error instanceof Error ? error : new Error(String(error)) }));
    return handle;
}
