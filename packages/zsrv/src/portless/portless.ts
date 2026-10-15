// index.ts

export * from "./types.js";
export * from "./proxy.js";
export * from "./routes.js";
export * from "./utils.js";
export * from "./hosts.js";

import chalk from "chalk";
import * as fs from "node:fs";

import {
    createSNICallback,
    ensureCerts,
    isCATrusted,
    trustCA,
} from "./certs.js";

import { createProxyServer } from "./proxy.js";
import { validateProxyBindAddress } from "./proxy-headers.js";
import type { ProxyAdmissionOptions } from './proxy-admission.js';
import { createProxyConnectionControl } from "./proxy-control.js";
import { ensureControlDirectory } from "./local-control.js";
import type { LocalControl } from "./local-control.js";
import type { BackendHealthOptions } from './backend-pool.js';
import { stopMarkedProcess } from "./lifecycle.js";
import { assertStartupOwnership, publishStartupState, recoverInterruptedStartup } from "./startup-state.js";
import { withOperationLock } from "./operation-lock.js";
import { formatUrl, parseHostname } from "./utils.js";
import { syncHostsFile, cleanHostsFile } from "./hosts.js";
import { RouteStore, RouteConflictError } from "./routes.js";

import {
    DEFAULT_HTTPS_PROXY_PORT,
    DEFAULT_TLD,
    discoverState,
    discoverStateWithRecovery,
    findFreePort,
    getDefaultPort,
    injectFrameworkFlags,
    isHttpsEnvEnabled,
    isProxyRunning,
    waitForProxy,
    readTlsMarker,
    readTldFromDir,
    resolveStateDir,
    writeTlsMarker,
    writeTldFile,
} from "./cli-utils.js";

import { inferProjectName, detectWorktreePrefix } from "./auto.js";
import { validateAppPort, exitStatus } from './process-supervisor.js';
import { launchManagedApplication, type RestartPolicy } from './managed-app.js';
import { createRuntimeStatusWriter, listRuntimeStatus } from './runtime-status.js';

const CLI_NAME = "zerux-server";

/* -------------------------------------------------------------------------- */
/*                                  PROXY                                     */
/* -------------------------------------------------------------------------- */

async function startProxyImpl(
    port?: number,
    options?: {
        https?: boolean;
        tld?: string;
        certPath?: string;
        keyPath?: string;
        backendHealth?: BackendHealthOptions;
        bindHost?: string;
        limits?: ProxyAdmissionOptions;
        compression?: import('./proxy-compression.js').ProxyCompressionOptions;
        cache?: import('./proxy-cache.js').ProxyCacheOptions;
    },
    lockHeldDir?: string
): Promise<boolean> {
    try {
        const tld = options?.tld ?? DEFAULT_TLD;
        // Local development services are private by default. Listening on
        // 0.0.0.0/:: requires an explicit choice by the caller.
        const bindHost = validateProxyBindAddress(options?.bindHost ?? process.env.PORTLESS_BIND_HOST ?? '127.0.0.1');
        const useHttps = options?.https ?? isHttpsEnvEnabled();
        const fallbackPort = port ?? getDefaultPort();
        const candidatePorts = port
            ? [port]
            : useHttps
                ? [...new Set([DEFAULT_HTTPS_PROXY_PORT, fallbackPort])]
                : [fallbackPort];

        for (let index = 0; index < candidatePorts.length; index += 1) {
            const proxyPort = candidatePorts[index];
            const stateDir = resolveStateDir(proxyPort);
            const startCandidate = async (): Promise<boolean> => {
                const store = new RouteStore(stateDir);
                store.ensureDir();
                // Readers refuse a half-published transaction; recover under
                // this directory's exclusive lock before probing or publishing.
                recoverInterruptedStartup(stateDir);

                if (await isProxyRunning(proxyPort, useHttps)) {
                    console.log(chalk.yellow(`${CLI_NAME}: Proxy already running on ${proxyPort}`));
                    return true;
                }

                // Do not silently replace the marker of another live (or unverifiable)
                // process, even if the selected protocol probe did not answer.
                assertStartupOwnership(stateDir);

                let tlsOptions: any;
                if (useHttps) {
                    store.ensureDir();

                    if (options?.certPath && options?.keyPath) {
                        tlsOptions = {
                            cert: fs.readFileSync(options.certPath),
                            key: fs.readFileSync(options.keyPath),
                        };
                    } else {
                        const certs = ensureCerts(stateDir, tld);

                        // Trusting a root CA modifies the operating system's
                        // trust store: only the explicit `trust` command does so.
                        const cert = fs.readFileSync(certs.certPath);
                        const key = fs.readFileSync(certs.keyPath);

                        tlsOptions = {
                            cert,
                            key,
                            SNICallback: createSNICallback(stateDir, cert, key, tld),
                        };
                    }
                }

                const server = createProxyServer({
                    getRoutes: () => store.loadRoutes(),
                    proxyPort,
                    tld,
                    onError: (msg) => console.error(chalk.red(msg)),
                    tls: tlsOptions,
                    limits: options?.limits,
                    compression: options?.compression,
                    cache: options?.cache,
                    backendHealth: { ...options?.backendHealth, stateDir: options?.backendHealth?.stateDir ?? ensureControlDirectory(stateDir, true) },
                });

                let proxyControl: LocalControl | undefined;
                // Drain active HTTP requests and WebSocket tunnels on termination.
                // Register only after this candidate successfully starts listening.
                const installShutdown = () => {
                    let shuttingDown = false;
                    const shutdown = () => {
                        if (shuttingDown) return;
                        shuttingDown = true;
                        void server.connectionTracker.drain({ timeoutMs: 10_000 })
                            .then(async () => { await proxyControl?.close(); process.exitCode = 0; })
                            .catch((error) => { console.error(`${CLI_NAME}: shutdown failed:`, error); process.exitCode = 1; });
                    };
                    process.once('SIGTERM', shutdown);
                    process.once('SIGINT', shutdown);
                };

                const started = await new Promise<boolean>((resolve) => {
                    server.once("error", (err: NodeJS.ErrnoException) => {
                        if (!port && index < candidatePorts.length - 1 && (err.code === "EACCES" || err.code === "EADDRINUSE")) {
                            console.warn(
                                chalk.yellow(`${CLI_NAME}: Unable to bind ${proxyPort}; falling back to ${candidatePorts[index + 1]}`)
                            );
                            resolve(false);
                            return;
                        }

                        console.error(chalk.red(`${CLI_NAME}: ${err.message}`));
                        resolve(false);
                    });

                    server.listen(proxyPort, bindHost, () => {
                        void (async () => {
                            proxyControl = await createProxyConnectionControl(stateDir, server.backendConnections, server.backendPool);
                            publishStartupState({ stateDir, port: proxyPort, https: useHttps, tld });
                            installShutdown();
                            console.log(chalk.green(`${CLI_NAME}: Proxy running on ${proxyPort} (${useHttps ? "HTTPS" : "HTTP"})`));
                            resolve(true);
                        })().catch(async (error) => {
                            console.error(chalk.red(`${CLI_NAME}: Cannot publish startup state: ${error instanceof Error ? error.message : String(error)}`));
                            // Prevent an orphan listener after failed state publication.
                            await proxyControl?.close().catch(() => {});
                            server.close();
                            if ('closeAllConnections' in server && typeof server.closeAllConnections === 'function') {
                                server.closeAllConnections();
                            }
                            resolve(false);
                        });
                    });
                });

                return started;
            };
            const started = lockHeldDir === stateDir
                ? await startCandidate()
                : await withOperationLock(stateDir, startCandidate);
            if (started) return true;
        }

        return false;
    } catch (err) {
        console.error(chalk.red(`${CLI_NAME}: ${err instanceof Error ? err.message : String(err)}`));
        return false;
    }
}

/** Each candidate port is serialized under its own actual state directory,
 * including HTTPS fallback from a privileged port to a user-level port. */
export async function portlessProxy(port?: number, options?: { https?: boolean; tld?: string; certPath?: string; keyPath?: string; backendHealth?: BackendHealthOptions; bindHost?: string; limits?: ProxyAdmissionOptions; compression?: import('./proxy-compression.js').ProxyCompressionOptions; cache?: import('./proxy-cache.js').ProxyCacheOptions }): Promise<boolean> {
    try {
        return await startProxyImpl(port, options);
    } catch (error) {
        console.error(chalk.red(`${CLI_NAME}: Startup coordination failed: ${error instanceof Error ? error.message : String(error)}`));
        return false;
    }
}

/* -------------------------------------------------------------------------- */
/*                                  STOP                                      */
/* -------------------------------------------------------------------------- */

export async function portlessStop(): Promise<boolean> {
    try {
        const { dir, port, tls } = await discoverStateWithRecovery();
        return await withOperationLock(dir, async () => {
            const store = new RouteStore(dir);
            if (!fs.existsSync(store.pidPath)) {
                if (await isProxyRunning(port, tls)) {
                    console.error(chalk.red(`${CLI_NAME}: Proxy is listening without a verifiable PID marker; refusing to claim it stopped`));
                    return false;
                }
                console.log(chalk.yellow(`${CLI_NAME}: Proxy not running`));
                return true;
            }

            const outcome = await stopMarkedProcess(store.pidPath, () => isProxyRunning(port, tls));
            if (outcome === 'unverified') {
                console.error(chalk.red(`${CLI_NAME}: Process identity or endpoint could not be verified; refusing to signal`));
                return false;
            }
            if (outcome === 'timeout') {
                console.error(chalk.red(`${CLI_NAME}: Shutdown timed out; PID marker retained for inspection`));
                return false;
            }
            console.log(chalk.green(`${CLI_NAME}: Proxy status: ${outcome}`));
            return true;
        });
    } catch (err) {
        console.error(chalk.red(`${CLI_NAME}: Failed to stop proxy: ${err instanceof Error ? err.message : String(err)}`));
        return false;
    }
}

/** Restart an already running proxy after verifying and stopping its process.
 * If no proxy is running, start it normally. Never start a second listener when
 * the existing process cannot be verified or has not fully stopped.
 */
export async function portlessRestart(options?: { port?: number; https?: boolean; waitMs?: number; backendHealth?: BackendHealthOptions }): Promise<boolean> {
    try {
        const state = await discoverStateWithRecovery();
        return await withOperationLock(state.dir, async () => {
        const store = new RouteStore(state.dir);
        if (fs.existsSync(store.pidPath)) {
            const outcome = await stopMarkedProcess(store.pidPath, () => isProxyRunning(state.port, state.tls), { waitMs: options?.waitMs });
            if (outcome !== 'stopped' && outcome !== 'stale' && outcome !== 'missing') {
                console.error(chalk.red(`${CLI_NAME}: Restart refused: ${outcome}`));
                return false;
            }
        } else if (await isProxyRunning(state.port, state.tls)) {
            console.error(chalk.red(`${CLI_NAME}: Unmanaged proxy listening; restart refused`));
            return false;
        }
        return await startProxyImpl(options?.port ?? state.port, { https: options?.https ?? state.tls, tld: state.tld, backendHealth: options?.backendHealth }, state.dir);
        });
    } catch (err) {
        console.error(chalk.red(`${CLI_NAME}: Restart failed: ${err instanceof Error ? err.message : String(err)}`));
        return false;
    }
}

/* -------------------------------------------------------------------------- */
/*                                   RUN                                      */
/* -------------------------------------------------------------------------- */

export async function portlessRun(
    commandArgs: string[],
    options?: {
        name?: string;
        force?: boolean;
        appPort?: number;
        readyTimeoutMs?: number;
        shutdownTimeoutMs?: number;
        waitForReady?: boolean;
        healthPath?: string;
        healthTimeoutMs?: number;
        healthIntervalMs?: number;
        unhealthyThreshold?: number;
        restartPolicy?: RestartPolicy;
        maxRestarts?: number;
        restartDelayMs?: number;
        restartWindowMs?: number;
        reloadSignal?: boolean;
    }
): Promise<boolean> {
    try {
        if (!commandArgs.length) throw new Error('No application command provided');
        // Validate before registering routes or spawning anything.
        if (options?.appPort !== undefined) validateAppPort(options.appPort);
        const inferred = options?.name ? { name: options.name } : inferProjectName();
        const worktree = detectWorktreePrefix();
        const finalName = worktree ? `${worktree.prefix}.${inferred.name}` : inferred.name;
        const { dir, port, tls, tld } = await discoverStateWithRecovery();
        const store = new RouteStore(dir);

        if (!(await isProxyRunning(port, tls))) {
            if (!(await portlessProxy(port, { https: tls, tld })) || !(await waitForProxy(port, undefined, undefined, tls))) {
                throw new Error('Proxy did not become ready; refusing to start application');
            }
        }
        const hostname = parseHostname(finalName, tld);
        const appPort = options?.appPort ?? await findFreePort();
        validateAppPort(appPort);
        const url = formatUrl(hostname, port, tls);
        // Pass an independent argv: automatic framework flag injection must not
        // change the argument array supplied by a library caller.
        const argv = [...commandArgs];
        injectFrameworkFlags(argv, appPort);

        // The managed controller owns the whole lifespan, including delayed
        // restarts. A lease exists only while its child has passed readiness.
        let reportStatus: ((status: import('./managed-status.js').ManagedStatus) => void) | undefined;
        try { reportStatus = createRuntimeStatusWriter(dir, hostname); }
        catch (error) { console.warn(`${CLI_NAME}: Runtime status unavailable: ${error instanceof Error ? error.message : String(error)}`); }
        const supervised = await launchManagedApplication(argv, {
            port: options?.waitForReady === false ? undefined : appPort,
            readyTimeoutMs: options?.readyTimeoutMs,
            shutdownTimeoutMs: options?.shutdownTimeoutMs,
            health: options?.healthPath ? { path: options.healthPath, timeoutMs: options.healthTimeoutMs } : undefined,
            healthIntervalMs: options?.healthIntervalMs,
            unhealthyThreshold: options?.unhealthyThreshold,
            restartPolicy: options?.restartPolicy,
            maxRestarts: options?.maxRestarts,
            restartDelayMs: options?.restartDelayMs,
            restartWindowMs: options?.restartWindowMs,
            env: { ...process.env, PORT: appPort.toString(), HOST: '127.0.0.1', PORTLESS_URL: url },
            onStatus: reportStatus,
            onReady: () => {
                const lease = store.registerRoute(hostname, appPort, process.pid, options?.force);
                console.log(chalk.cyan(`${CLI_NAME}: ${url} -> 127.0.0.1:${appPort}`));
                return () => lease.release();
            },
            onExit: result => { process.exitCode = exitStatus(result); },
            onRestart: (attempt, ms, result) => {
                console.warn(chalk.yellow(`${CLI_NAME}: App exited (${exitStatus(result)}); restarting (attempt ${attempt}) in ${ms}ms`));
            },
        });
        // Keep the managed handle alive through its signal listeners. The
        // controller releases the route before every restart or terminal exit.
        if (options?.reloadSignal && process.platform !== 'win32') {
            const reload = () => {
                void supervised.restart().then(() => console.log(`${CLI_NAME}: ${hostname} restarted`))
                    .catch(error => console.error(`${CLI_NAME}: Reload failed: ${error instanceof Error ? error.message : String(error)}`));
            };
            process.on('SIGUSR2', reload);
            void supervised.completed.finally(() => process.removeListener('SIGUSR2', reload));
        }
        void supervised.completed;
        return true;
    } catch (err) {
        console.error(chalk.red(`${CLI_NAME}: ${err instanceof Error ? err.message : String(err)}`));
        return false;
    }
}

/* -------------------------------------------------------------------------- */
/*                                  UTILS                                     */
/* -------------------------------------------------------------------------- */

/** Inspect current and recent per-user managed application snapshots. */
export async function portlessStatus(name?: string, json = false): Promise<boolean> {
    try {
        const { dir, tld } = await discoverState();
        const hostname = name ? parseHostname(name, tld) : undefined;
        const items = listRuntimeStatus(dir, hostname);
        if (json) console.log(JSON.stringify(items, null, 2));
        else if (!items.length) console.log(`${CLI_NAME}: No application status records`);
        else for (const item of items) {
            const state = item.alive ? item.status.phase : (item.status.phase === 'stopped' ? 'stopped' : 'stale');
            console.log(`${item.hostname} | ${state} | PID ${item.ownerPid} | child ${item.status.pid ?? '-'} | generation ${item.status.generation} | auto-restarts ${item.status.automaticRestarts}`);
        }
        return true;
    } catch (error) {
        console.error(chalk.red(`${CLI_NAME}: Status failed: ${error instanceof Error ? error.message : String(error)}`));
        return false;
    }
}

export async function portlessList(): Promise<boolean> {
    try {
        const { dir, port, tls } = await discoverState();
        const store = new RouteStore(dir);

        const routes = store.loadRoutes();
        routes.forEach((r) => {
            const destinations = r.backends?.map(backend => `localhost:${backend.port}${backend.weight ? ` (weight ${backend.weight})` : ''}`).join(', ')
                ?? `localhost:${r.port}`;
            console.log(`${formatUrl(r.hostname, port, tls)} -> ${destinations}`);
        });
        return true;
    } catch (err) {
        console.error(chalk.red(`${CLI_NAME}: ${err instanceof Error ? err.message : String(err)}`));
        return false;
    }
}

export async function portlessAlias(
    name: string,
    port?: number,
    options?: {
        remove?: boolean;
        force?: boolean;
    }
): Promise<boolean> {
    try {
        const { dir, tld } = await discoverState();

        const store = new RouteStore(dir, {
            onWarning: (msg) => console.warn(chalk.yellow(msg)),
        });

        const hostname = parseHostname(name, tld);

        // REMOVE
        if (options?.remove) {
            const routes = store.loadRoutes();
            const exists = routes.find((r) => r.hostname === hostname && r.pid === 0);

            if (!exists) {
                throw new Error(`Alias not found: ${hostname}`);
            }

            store.removeRoute(hostname);
            console.log(chalk.green(`${CLI_NAME}: Removed alias ${hostname}`));
            return true;
        }

        // ADD
        if (!port) {
            throw new Error("Port is required for alias");
        }

        if (port < 1 || port > 65535) {
            throw new Error(`Invalid port: ${port}`);
        }

        store.addRoute(hostname, port, 0, options?.force);

        console.log(
            chalk.green(`${CLI_NAME}: Alias ${hostname} -> 127.0.0.1:${port}`)
        );
        return true;
    } catch (err) {
        console.error(chalk.red(`${CLI_NAME}: ${err instanceof Error ? err.message : String(err)}`));
        return false;
    }
}

export async function portlessGet(name: string): Promise<string | false> {
    try {
        const { port, tls, tld } = await discoverState();
        return formatUrl(parseHostname(name, tld), port, tls);
    } catch {
        return false;
    }
}

export function portlessHosts(action: "sync" | "clean" = "sync"): boolean {
    try {
        if (action === "clean") return cleanHostsFile();

        const stateDir = fs.existsSync(resolveStateDir(DEFAULT_HTTPS_PROXY_PORT))
            ? resolveStateDir(DEFAULT_HTTPS_PROXY_PORT)
            : resolveStateDir(getDefaultPort());
        const store = new RouteStore(stateDir);
        return syncHostsFile(store.loadRoutes().map((r) => r.hostname));
    } catch {
        return false;
    }
}

export async function portlessTrust(): Promise<boolean> {
    try {
        const { dir } = await discoverState();
        const result = trustCA(dir);
        if (result.error) {
            console.error(chalk.red(`${CLI_NAME}: ${result.error}`));
        }
        return result.trusted;
    } catch {
        return false;
    }
}
