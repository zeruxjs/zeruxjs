/** Legacy process-scoped hosting commands; scoped library servers use the explicit owned server APIs. */

export * from './types.js';
export * from './proxy.js';
export * from './routes.js';
export * from './utils.js';
export * from './hosts.js';

import chalk from 'chalk';
import * as fs from 'node:fs';

import { createSNICallback, ensureCerts, trustCA } from './certs.js';

import { createProxyServer } from './proxy.js';
import { validateProxyBindAddress } from './proxy-headers.js';
import type { ProxyAdmissionOptions } from './proxy-admission.js';
import { createProxyConnectionControl } from './proxy-control.js';
import { ensureControlDirectory } from './local-control.js';
import type { LocalControl } from './local-control.js';
import type { ProxyServerOptions } from './types.js';
import type { BackendHealthOptions } from './backend-pool.js';
import { stopMarkedProcess } from './lifecycle.js';
import {
  assertStartupOwnership,
  publishStartupState,
  recoverInterruptedStartup,
} from './startup-state.js';
import { withOperationLock } from './operation-lock.js';
import { formatUrl, parseHostname } from './utils.js';
import { syncHostsFile, cleanHostsFile } from './hosts.js';
import { RouteStore } from './routes.js';

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
  resolveStateDir,
} from './cli-utils.js';

import { inferProjectName, detectWorktreePrefix } from './auto.js';
import { validateAppPort, exitStatus } from './process-supervisor.js';
import { launchManagedApplication, type RestartPolicy } from './managed-app.js';
import {
  createRuntimeStatusWriter,
  listRuntimeStatus,
} from './runtime-status.js';

/** Fixed operator-facing executable label; no request data chooses a command. */
const CLI_NAME = 'zerux-server';

/* -------------------------------------------------------------------------- */
/*                                  PROXY                                     */
/* -------------------------------------------------------------------------- */

/** Attempt process-scoped proxy startup under each candidate’s actual operation lock, refusing live/unverifiable existing ownership before publication.
 * @param {number} port - Optional explicit candidate port; absence retains the existing HTTPS fallback order.
 * @param {{
        https?: boolean;
        tld?: string;
        certPath?: string;
        keyPath?: string;
        backendHealth?: BackendHealthOptions;
        bindHost?: string;
        limits?: ProxyAdmissionOptions;
        compression?: import('./proxy-compression.js').ProxyCompressionOptions;
        cache?: import('./proxy-cache.js').ProxyCacheOptions;
    }} options - Explicit trusted listener/application policy; credentials and lifecycle permissions stay host-owned.
 * @param {boolean | undefined} options.https - Explicit TLS mode; no system trust is installed automatically.
 * @param {string | undefined} options.tld - Host-controlled proxy suffix, validated by its owning startup/certificate policy.
 * @param {string | undefined} options.certPath - Trusted local custom certificate path, used only with an explicit matching keyPath.
 * @param {string | undefined} options.keyPath - Trusted local private-key path; never included in public config/log payloads.
 * @param {BackendHealthOptions | undefined} options.backendHealth - Explicit loopback probe/checkpoint policy delegated to the backend owner.
 * @param {string | undefined} options.bindHost - Explicit trusted bind address, defaulting to loopback through the shared validator.
 * @param {ProxyAdmissionOptions | undefined} options.limits - Host-owned admission ceilings.
 * @param {import('./proxy-compression.js').ProxyCompressionOptions | undefined} options.compression - Existing single response-layer compression policy.
 * @param {import('./proxy-cache.js').ProxyCacheOptions | undefined} options.cache - Explicit public-response cache policy; this does not authorize personalized caching.
 * @param {string} lockHeldDir - Optional exact state root whose operation lock this lifecycle command already owns.
 * @returns {Promise<boolean>} Listener/control/publication receipt; false reports startup failure rather than claiming a running owned server handle.
 */
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
    /** Host-configured suffix captured from one explicit/default state view. */
    const tld = options?.tld ?? DEFAULT_TLD;
    // Local development services are private by default. Listening on
    // 0.0.0.0/:: requires an explicit choice by the caller.
    /** Validated explicit bind literal; no forwarded header chooses listener exposure. */
    const bindHost = validateProxyBindAddress(
      options?.bindHost ?? process.env.PORTLESS_BIND_HOST ?? '127.0.0.1'
    );
    /** Explicit host TLS setting, independent of installing platform trust. */
    const useHttps = options?.https ?? isHttpsEnvEnabled();
    /** Existing explicit/default candidate retained for HTTPS permission/bind fallback. */
    const fallbackPort = port ?? getDefaultPort();
    /** Dense fixed candidate list, preserving the legacy explicit-versus-HTTPS fallback order. */
    const candidatePorts = (() => {
      if (port) {
        return [port];
      }
      if (useHttps) {
        return [...new Set([DEFAULT_HTTPS_PROXY_PORT, fallbackPort])];
      }
      return [fallbackPort];
    })();

    for (let index = 0; index < candidatePorts.length; index += 1) {
      /** Candidate proven present by loop bounds, reused consistently for binding and publication. */
      const proxyPort = candidatePorts[index]!;
      /** Actual candidate state root whose operation lock fences startup/publication. */
      const stateDir = resolveStateDir(proxyPort);
      /** Attempt one fixed proxy/listener/control publication under its actual directory lock.
       * @returns {Promise<boolean>} Existing startup receipt without taking over unverifiable ownership.
       */
      const startCandidate = async (): Promise<boolean> => {
        /** Host-selected route-file wrapper; individual mutations acquire their own route lock. */
        const store = new RouteStore(stateDir);
        store.ensureDir();
        // Readers refuse a half-published transaction; recover under
        // this directory's exclusive lock before probing or publishing.
        recoverInterruptedStartup(stateDir);

        if (await isProxyRunning(proxyPort, useHttps)) {
          console.log(
            chalk.yellow(`${CLI_NAME}: Proxy already running on ${proxyPort}`)
          );
          return true;
        }

        // Do not silently replace the marker of another live (or unverifiable)
        // process, even if the selected protocol probe did not answer.
        assertStartupOwnership(stateDir);

        let tlsOptions: ProxyServerOptions['tls'];
        if (useHttps) {
          store.ensureDir();

          if (options?.certPath && options?.keyPath) {
            tlsOptions = {
              cert: fs.readFileSync(options.certPath),
              key: fs.readFileSync(options.keyPath),
            };
          } else {
            /** Local certificate/key paths from explicit private-state generation; no system trust operation occurs here. */
            const certs = ensureCerts(stateDir, tld);

            // Trusting a root CA modifies the operating system's
            // trust store: only the explicit `trust` command does so.
            /** Local certificate bytes passed only to native TLS context creation. */
            const cert = fs.readFileSync(certs.certPath);
            /** Private local key bytes, never logged or serialized into status. */
            const key = fs.readFileSync(certs.keyPath);

            tlsOptions = {
              cert,
              key,
              SNICallback: createSNICallback(stateDir, cert, key, tld),
            };
          }
        }

        /** Process-scoped proxy listener candidate; native close/lifecycle APIs own connection draining. */
        const server = createProxyServer({
          getRoutes: () => store.loadRoutes(),
          proxyPort,
          tld,
          onError: (msg) => console.error(chalk.red(msg)),
          tls: tlsOptions,
          limits: options?.limits,
          compression: options?.compression,
          cache: options?.cache,
          backendHealth: {
            ...options?.backendHealth,
            stateDir:
              options?.backendHealth?.stateDir ??
              ensureControlDirectory(stateDir, true),
          },
        });

        let proxyControl: LocalControl | undefined;
        // Drain active HTTP requests and WebSocket tunnels on termination.
        // Register only after this candidate successfully starts listening.
        /** Install legacy process-lifetime signal handlers only after successful listener publication.
         * @returns {void} Captures this candidate’s native drain/control ownership.
         */
        const installShutdown = () => {
          let shuttingDown = false;
          /** Share one signal-driven native drain/control-close request for this legacy proxy process.
           * @returns {void} Repeated signals do not start overlapping drains.
           */
          const shutdown = () => {
            if (shuttingDown) {
              return;
            }
            shuttingDown = true;
            void server.connectionTracker
              .drain({ timeoutMs: 10_000 })
              .then(async () => {
                await proxyControl?.close();
                process.exitCode = 0;
              })
              .catch((error) => {
                console.error(`${CLI_NAME}: shutdown failed:`, error);
                process.exitCode = 1;
              });
          };
          process.once('SIGTERM', shutdown);
          process.once('SIGINT', shutdown);
        };

        /** Observed candidate/listener publication or coordinated startup receipt. */
        const started = await new Promise<boolean>((resolve) => {
          server.once('error', (err: NodeJS.ErrnoException) => {
            if (
              !port &&
              index < candidatePorts.length - 1 &&
              (err.code === 'EACCES' || err.code === 'EADDRINUSE')
            ) {
              console.warn(
                chalk.yellow(
                  `${CLI_NAME}: Unable to bind ${proxyPort}; falling back to ${candidatePorts[index + 1]}`
                )
              );
              resolve(false);
              return;
            }

            console.error(chalk.red(`${CLI_NAME}: ${err.message}`));
            resolve(false);
          });

          server.listen(proxyPort, bindHost, () => {
            void (async () => {
              proxyControl = await createProxyConnectionControl(
                stateDir,
                server.backendConnections,
                server.backendPool
              );
              publishStartupState({
                stateDir,
                port: proxyPort,
                https: useHttps,
                tld,
              });
              installShutdown();
              console.log(
                chalk.green(
                  `${CLI_NAME}: Proxy running on ${proxyPort} (${useHttps ? 'HTTPS' : 'HTTP'})`
                )
              );
              resolve(true);
            })().catch(async (error) => {
              console.error(
                chalk.red(
                  `${CLI_NAME}: Cannot publish startup state: ${error instanceof Error ? error.message : String(error)}`
                )
              );
              // Prevent an orphan listener after failed state publication.
              await proxyControl?.close().catch(() => {});
              server.close();
              if (
                'closeAllConnections' in server &&
                typeof server.closeAllConnections === 'function'
              ) {
                server.closeAllConnections();
              }
              resolve(false);
            });
          });
        });

        return started;
      };
      /** Observed candidate/listener publication or coordinated startup receipt. */
      const started =
        lockHeldDir === stateDir
          ? await startCandidate()
          : await withOperationLock(stateDir, startCandidate);
      if (started) {
        return true;
      }
    }

    return false;
  } catch (err) {
    console.error(
      chalk.red(
        `${CLI_NAME}: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    return false;
  }
}

/** Start the legacy process-scoped proxy command, serializing each actual state-directory candidate independently.
 * @param {number} port - Optional explicit proxy port; dedicated CLI parsing validates operator tokens.
 * @param {{ https?: boolean; tld?: string; certPath?: string; keyPath?: string; backendHealth?: BackendHealthOptions; bindHost?: string; limits?: ProxyAdmissionOptions; compression?: import('./proxy-compression.js').ProxyCompressionOptions; cache?: import('./proxy-cache.js').ProxyCacheOptions }} options - Explicit trusted listener/application policy; credentials and lifecycle permissions stay host-owned.
 * @param {boolean | undefined} options.https - Explicit TLS mode; no system trust is installed automatically.
 * @param {string | undefined} options.tld - Host-controlled proxy suffix, validated by its owning startup/certificate policy.
 * @param {string | undefined} options.certPath - Trusted local custom certificate path, used only with an explicit matching keyPath.
 * @param {string | undefined} options.keyPath - Trusted local private-key path; never included in public config/log payloads.
 * @param {BackendHealthOptions | undefined} options.backendHealth - Explicit loopback probe/checkpoint policy delegated to the backend owner.
 * @param {string | undefined} options.bindHost - Explicit trusted bind address, defaulting to loopback through the shared validator.
 * @param {ProxyAdmissionOptions | undefined} options.limits - Host-owned admission ceilings.
 * @param {import('./proxy-compression.js').ProxyCompressionOptions | undefined} options.compression - Existing single response-layer compression policy.
 * @param {import('./proxy-cache.js').ProxyCacheOptions | undefined} options.cache - Explicit public-response cache policy; this does not authorize personalized caching.
 * @returns {Promise<boolean>} True for a started/already observed proxy, false on failure; library scopes should retain createProxyServer handles instead.
 */
export async function portlessProxy(
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
  }
): Promise<boolean> {
  try {
    return await startProxyImpl(port, options);
  } catch (error) {
    console.error(
      chalk.red(
        `${CLI_NAME}: Startup coordination failed: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*                                  STOP                                      */
/* -------------------------------------------------------------------------- */

/** Explicit operator lifecycle command: recover under the operation lock and stop only a separately verified marked process/endpoint.
 * @returns {Promise<boolean>} False for unverifiable ownership or timeout, retaining evidence instead of claiming the proxy stopped.
 */
export async function portlessStop(): Promise<boolean> {
  try {
    /** Consistent discovered state retained under the lifecycle operation lock. */
    const { dir, port, tls } = await discoverStateWithRecovery();
    return await withOperationLock(dir, async () => {
      /** Host-selected route-file wrapper; individual mutations acquire their own route lock. */
      const store = new RouteStore(dir);
      if (!fs.existsSync(store.pidPath)) {
        if (await isProxyRunning(port, tls)) {
          console.error(
            chalk.red(
              `${CLI_NAME}: Proxy is listening without a verifiable PID marker; refusing to claim it stopped`
            )
          );
          return false;
        }
        console.log(chalk.yellow(`${CLI_NAME}: Proxy not running`));
        return true;
      }

      /** Verified marked-process stop outcome; unknown/timeout never authorizes a replacement listener. */
      const outcome = await stopMarkedProcess(store.pidPath, () =>
        isProxyRunning(port, tls)
      );
      if (outcome === 'unverified') {
        console.error(
          chalk.red(
            `${CLI_NAME}: Process identity or endpoint could not be verified; refusing to signal`
          )
        );
        return false;
      }
      if (outcome === 'timeout') {
        console.error(
          chalk.red(
            `${CLI_NAME}: Shutdown timed out; PID marker retained for inspection`
          )
        );
        return false;
      }
      console.log(chalk.green(`${CLI_NAME}: Proxy status: ${outcome}`));
      return true;
    });
  } catch (err) {
    console.error(
      chalk.red(
        `${CLI_NAME}: Failed to stop proxy: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    return false;
  }
}

/** Explicitly verify and stop the prior proxy before starting a replacement, refusing unmanaged or incompletely stopped listeners.
 * @param {{ port?: number; https?: boolean; waitMs?: number; backendHealth?: BackendHealthOptions }} options - Optional trusted restart port/TLS/deadline/health policy.
 * @param {number | undefined} options.port - Optional explicit replacement listener port.
 * @param {boolean | undefined} options.https - Explicit TLS mode; no system trust is installed automatically.
 * @param {number | undefined} options.waitMs - Bounded marked-process shutdown wait delegated to the lifecycle owner.
 * @param {BackendHealthOptions | undefined} options.backendHealth - Explicit loopback probe/checkpoint policy delegated to the backend owner.
 * @returns {Promise<boolean>} Restart/start receipt, with lock coordination and refusal preserved.
 */
export async function portlessRestart(options?: {
  port?: number;
  https?: boolean;
  waitMs?: number;
  backendHealth?: BackendHealthOptions;
}): Promise<boolean> {
  try {
    /** One consistent discovered proxy view or a derived private operator status label. */
    const state = await discoverStateWithRecovery();
    return await withOperationLock(state.dir, async () => {
      /** Host-selected route-file wrapper; individual mutations acquire their own route lock. */
      const store = new RouteStore(state.dir);
      if (fs.existsSync(store.pidPath)) {
        /** Verified marked-process stop outcome; unknown/timeout never authorizes a replacement listener. */
        const outcome = await stopMarkedProcess(
          store.pidPath,
          () => isProxyRunning(state.port, state.tls),
          { waitMs: options?.waitMs }
        );
        if (
          outcome !== 'stopped' &&
          outcome !== 'stale' &&
          outcome !== 'missing'
        ) {
          console.error(chalk.red(`${CLI_NAME}: Restart refused: ${outcome}`));
          return false;
        }
      } else if (await isProxyRunning(state.port, state.tls)) {
        console.error(
          chalk.red(`${CLI_NAME}: Unmanaged proxy listening; restart refused`)
        );
        return false;
      }
      return await startProxyImpl(
        options?.port ?? state.port,
        {
          https: options?.https ?? state.tls,
          tld: state.tld,
          backendHealth: options?.backendHealth,
        },
        state.dir
      );
    });
  } catch (err) {
    console.error(
      chalk.red(
        `${CLI_NAME}: Restart failed: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*                                   RUN                                      */
/* -------------------------------------------------------------------------- */

/** Launch a trusted process-lifetime managed command and publish a route only after readiness; preserve caller argv by injecting flags into a copy.
 * @param {string[]} commandArgs - Explicit trusted executable tokens, never model/request-derived commands.
 * @param {{
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
    }} options - Trusted app naming, port, restart/health policy and opt-in reload signal.
 * @param {string | undefined} options.name - Explicit host app label; absence permits inert local project-name inference.
 * @param {boolean | undefined} options.force - Trusted operator override; never a browser role/group claim.
 * @param {number | undefined} options.appPort - Validated intended loopback child port; no existing app is stopped to acquire it.
 * @param {number | undefined} options.readyTimeoutMs - Child readiness timeout in milliseconds.
 * @param {number | undefined} options.shutdownTimeoutMs - Native graceful child shutdown deadline in milliseconds.
 * @param {boolean | undefined} options.waitForReady - Whether the legacy command waits for the selected local readiness port.
 * @param {string | undefined} options.healthPath - Validated local HTTP health path; no arbitrary destination is fetched.
 * @param {number | undefined} options.healthTimeoutMs - Per-probe HTTP timeout in milliseconds.
 * @param {number | undefined} options.healthIntervalMs - Periodic child health interval in milliseconds.
 * @param {number | undefined} options.unhealthyThreshold - Consecutive failures before stopping this owned child.
 * @param {RestartPolicy | undefined} options.restartPolicy - Explicit bounded automatic process restart policy, separate from request replay.
 * @param {number | undefined} options.maxRestarts - Automatic attempt cap within the configured window.
 * @param {number | undefined} options.restartDelayMs - Initial automatic replacement delay in milliseconds.
 * @param {number | undefined} options.restartWindowMs - Sliding automatic restart accounting window in milliseconds.
 * @param {boolean | undefined} options.reloadSignal - Explicit POSIX SIGUSR2 manual-reload listener, removed on manager completion.
 * @returns {Promise<boolean>} Startup receipt; the retained legacy manager owns later route/restart/signal cleanup through its terminal lifecycle.
 */
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
    if (!commandArgs.length) {
      throw new Error('No application command provided');
    }
    // Validate before registering routes or spawning anything.
    if (options?.appPort !== undefined) {
      validateAppPort(options.appPort);
    }
    /** Explicit host label or inert local project-name inference, never remote role metadata. */
    const inferred = options?.name
      ? { name: options.name }
      : inferProjectName();
    /** Optional sanitized local linked-checkout naming prefix. */
    const worktree = detectWorktreePrefix();
    /** Composed host project/worktree label before shared hostname validation. */
    const finalName = worktree
      ? `${worktree.prefix}.${inferred.name}`
      : inferred.name;
    /** One consistent discovered listener/origin/suffix view. */
    const { dir, port, tls, tld } = await discoverStateWithRecovery();
    /** Host-selected route-file wrapper; individual mutations acquire their own route lock. */
    const store = new RouteStore(dir);

    if (!(await isProxyRunning(port, tls))) {
      if (
        !(await portlessProxy(port, { https: tls, tld })) ||
        !(await waitForProxy(port, undefined, undefined, tls))
      ) {
        throw new Error(
          'Proxy did not become ready; refusing to start application'
        );
      }
    }
    /** Normalized host-controlled app/alias label under the configured suffix. */
    const hostname = parseHostname(finalName, tld);
    /** Validated child port selected without stopping another application. */
    const appPort = options?.appPort ?? (await findFreePort());
    validateAppPort(appPort);
    /** Configured host URL printed only after this ready child’s conditional route publication. */
    const url = formatUrl(hostname, port, tls);
    // Pass an independent argv: automatic framework flag injection must not
    // change the argument array supplied by a library caller.
    /** Independent trusted argument copy, preserving the library caller’s original array. */
    const argv = [...commandArgs];
    injectFrameworkFlags(argv, appPort);

    // The managed controller owns the whole lifespan, including delayed
    // restarts. A lease exists only while its child has passed readiness.
    let reportStatus:
      | ((status: import('./managed-status.js').ManagedStatus) => void)
      | undefined;
    try {
      reportStatus = createRuntimeStatusWriter(dir, hostname);
    } catch (error) {
      console.warn(
        `${CLI_NAME}: Runtime status unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    /** Owned process-lifetime managed handle; readiness publication returns its route cleanup callback. */
    const supervised = await launchManagedApplication(argv, {
      port: options?.waitForReady === false ? undefined : appPort,
      readyTimeoutMs: options?.readyTimeoutMs,
      shutdownTimeoutMs: options?.shutdownTimeoutMs,
      health: options?.healthPath
        ? { path: options.healthPath, timeoutMs: options.healthTimeoutMs }
        : undefined,
      healthIntervalMs: options?.healthIntervalMs,
      unhealthyThreshold: options?.unhealthyThreshold,
      restartPolicy: options?.restartPolicy,
      maxRestarts: options?.maxRestarts,
      restartDelayMs: options?.restartDelayMs,
      restartWindowMs: options?.restartWindowMs,
      env: {
        ...process.env,
        PORT: appPort.toString(),
        HOST: '127.0.0.1',
        PORTLESS_URL: url,
      },
      onStatus: reportStatus,
      onReady: () => {
        /** Exact ready-generation route lease whose cleanup is returned to the managed owner. */
        const lease = store.registerRoute(
          hostname,
          appPort,
          process.pid,
          options?.force
        );
        console.log(chalk.cyan(`${CLI_NAME}: ${url} -> 127.0.0.1:${appPort}`));
        return () => lease.release();
      },
      onExit: (result) => {
        process.exitCode = exitStatus(result);
      },
      onRestart: (attempt, ms, result) => {
        console.warn(
          chalk.yellow(
            `${CLI_NAME}: App exited (${exitStatus(result)}); restarting (attempt ${attempt}) in ${ms}ms`
          )
        );
      },
    });
    // Keep the managed handle alive through its signal listeners. The
    // controller releases the route before every restart or terminal exit.
    if (options?.reloadSignal && process.platform !== 'win32') {
      /** Request one explicit manual restart of this owned app, reporting failure without replaying requests.
       * @returns {void} Its process listener is removed after manager completion.
       */
      const reload = () => {
        void supervised
          .restart()
          .then(() => console.log(`${CLI_NAME}: ${hostname} restarted`))
          .catch((error) =>
            console.error(
              `${CLI_NAME}: Reload failed: ${error instanceof Error ? error.message : String(error)}`
            )
          );
      };
      process.on('SIGUSR2', reload);
      void supervised.completed.finally(() =>
        process.removeListener('SIGUSR2', reload)
      );
    }
    void supervised.completed;
    return true;
  } catch (err) {
    console.error(
      chalk.red(
        `${CLI_NAME}: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*                                  UTILS                                     */
/* -------------------------------------------------------------------------- */

/** Print host-operator diagnostic snapshots, distinguishing stale identity from live manager state without treating it as application health.
 * @param {string} name - Optional exact app name normalized under the configured suffix.
 * @param {boolean} json - Whether to print private operator JSON instead of human-readable output.
 * @returns {Promise<boolean>} Inspection success receipt; output requires separate authorization/redaction before any public UI exposure.
 */
export async function portlessStatus(
  name?: string,
  json = false
): Promise<boolean> {
  try {
    /** Consistent host state root and suffix used for naming/inspection. */
    const { dir, tld } = await discoverState();
    /** Normalized host-controlled app/alias label under the configured suffix. */
    const hostname = name ? parseHostname(name, tld) : undefined;
    /** Bounded private runtime diagnostic records, not a public analytics dataset. */
    const items = listRuntimeStatus(dir, hostname);
    if (json) {
      console.log(JSON.stringify(items, null, 2));
    } else if (!items.length) {
      console.log(`${CLI_NAME}: No application status records`);
    } else {
      for (const item of items) {
        /** One consistent discovered proxy view or a derived private operator status label. */
        const state = (() => {
          if (item.alive) {
            return item.status.phase;
          }
          if (item.status.phase === 'stopped') {
            return 'stopped';
          }
          return 'stale';
        })();
        console.log(
          `${item.hostname} | ${state} | PID ${item.ownerPid} | child ${item.status.pid ?? '-'} | generation ${item.status.generation} | auto-restarts ${item.status.automaticRestarts}`
        );
      }
    }
    return true;
  } catch (error) {
    console.error(
      chalk.red(
        `${CLI_NAME}: Status failed: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    return false;
  }
}

/** Print current host route mappings and configured URLs without mutating registration state.
 * @returns {Promise<boolean>} True after inspection, false for state/discovery errors.
 */
export async function portlessList(): Promise<boolean> {
  try {
    /** Consistent discovered state retained under the lifecycle operation lock. */
    const { dir, port, tls } = await discoverState();
    /** Host-selected route-file wrapper; individual mutations acquire their own route lock. */
    const store = new RouteStore(dir);

    /** Current parsed route mappings; read access does not authorize later mutation. */
    const routes = store.loadRoutes();
    routes.forEach((r) => {
      /** Human-readable backend ports/weights from the validated route view. */
      const destinations =
        r.backends
          ?.map(
            (backend) =>
              `localhost:${backend.port}${backend.weight ? ` (weight ${backend.weight})` : ''}`
          )
          .join(', ') ?? `localhost:${r.port}`;
      console.log(`${formatUrl(r.hostname, port, tls)} -> ${destinations}`);
    });
    return true;
  } catch (err) {
    console.error(
      chalk.red(
        `${CLI_NAME}: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    return false;
  }
}

/** Explicit trusted operator maintenance for persistent aliases; this legacy path is distinct from generation-owned conditional leases.
 * @param {string} name - Host-authorized alias label.
 * @param {number} port - Target loopback port required for adding an alias.
 * @param {{
        remove?: boolean;
        force?: boolean;
    }} options - Explicit removal/force maintenance choices.
 * @param {boolean | undefined} options.remove - Explicit persistent-alias removal request, not a generic route-ownership token.
 * @param {boolean | undefined} options.force - Trusted operator override; never a browser role/group claim.
 * @returns {Promise<boolean>} Maintenance receipt; an initial alias read is not an atomic ownership fence across a later mutation.
 */
export async function portlessAlias(
  name: string,
  port?: number,
  options?: {
    remove?: boolean;
    force?: boolean;
  }
): Promise<boolean> {
  try {
    /** Consistent host state root and suffix used for naming/inspection. */
    const { dir, tld } = await discoverState();

    /** Host-selected route-file wrapper; individual mutations acquire their own route lock. */
    const store = new RouteStore(dir, {
      onWarning: (msg) => console.warn(chalk.yellow(msg)),
    });

    /** Normalized host-controlled app/alias label under the configured suffix. */
    const hostname = parseHostname(name, tld);

    // REMOVE
    if (options?.remove) {
      /** Current parsed route mappings; read access does not authorize later mutation. */
      const routes = store.loadRoutes();
      /** Read-only persistent-alias candidate; later legacy maintenance is not a CAS lease operation. */
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
      throw new Error('Port is required for alias');
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
    console.error(
      chalk.red(
        `${CLI_NAME}: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    return false;
  }
}

/** Format a name under the discovered proxy origin/suffix without proving that a matching route currently exists.
 * @param {string} name - Host-controlled app/alias label.
 * @returns {Promise<string | false>} Configured URL proposal, or false on invalid name/state; not access permission or a live-route guarantee.
 */
export async function portlessGet(name: string): Promise<string | false> {
  try {
    /** Consistent configured origin fields used only to format a URL proposal. */
    const { port, tls, tld } = await discoverState();
    return formatUrl(parseHostname(name, tld), port, tls);
  } catch {
    return false;
  }
}

/** Explicit operator hosts-file mutation using current route names; never invoked by imports or this package’s synthetic qualification.
 * @param {"sync" | "clean"} action - Explicit hosts-file operation, defaulting to sync.
 * @returns {boolean} Native update/removal receipt, false when unavailable or denied.
 */
export function portlessHosts(action: 'sync' | 'clean' = 'sync'): boolean {
  try {
    if (action === 'clean') {
      return cleanHostsFile();
    }

    /** Actual candidate state root whose operation lock fences startup/publication. */
    const stateDir = fs.existsSync(resolveStateDir(DEFAULT_HTTPS_PROXY_PORT))
      ? resolveStateDir(DEFAULT_HTTPS_PROXY_PORT)
      : resolveStateDir(getDefaultPort());
    /** Host-selected route-file wrapper; individual mutations acquire their own route lock. */
    const store = new RouteStore(stateDir);
    return syncHostsFile(store.loadRoutes().map((r) => r.hostname));
  } catch {
    return false;
  }
}

/** Explicit operator CA-trust installation command; modifies the platform trust store and may require OS privileges.
 * @returns {Promise<boolean>} Platform installation receipt; never part of automated readability/fixture checks.
 */
export async function portlessTrust(): Promise<boolean> {
  try {
    /** Trusted discovered state root for an explicit operator trust operation. */
    const { dir } = await discoverState();
    /** Explicit platform trust-installation receipt, never generated by package qualification. */
    const result = trustCA(dir);
    if (result.error) {
      console.error(chalk.red(`${CLI_NAME}: ${result.error}`));
    }
    return result.trusted;
  } catch {
    return false;
  }
}
