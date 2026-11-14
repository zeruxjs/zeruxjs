import { randomBytes } from 'node:crypto';
import {
  assertConfigReloadable,
  snapshotConfig,
  ConfigurationError,
} from '../bootstrap/config-validation.js';
import fs from 'node:fs';
import path from 'node:path';

import { startServer } from 'zhost';

import {
  loadConfig,
  resolveDefaultEnvFiles,
  resolveStructure,
} from '../bootstrap/config.js';
import { loadEnvironmentFiles } from '../bootstrap/env.js';
import { registerProcessExceptionHandlers } from '../bootstrap/exception.js';
import { writeRuntimeManifest } from '../bootstrap/manifest.js';
import { readRuntimeJson, writeRuntimeJson } from '../bootstrap/persist.js';
import { bootstrapApplication } from '../bootstrap/runtime.js';
import { logger } from '../bootstrap/logger.js';
import { runWorkers } from '../bootstrap/worker.js';
import { createHotRuntime } from '../bootstrap/hot-runtime.js';
import { resolveProductionStructure } from './project-builder.js';
import { createRequestLifecycle } from '../bootstrap/request-lifecycle.js';
import type { ZeruxWorkerRunResult } from '../bootstrap/worker.js';

/** Validate an optional explicit CLI/configured port without permissive numeric coercion.
 * @param {unknown} value - Port string/number or omitted value.
 * @returns {number | undefined} Integer port from zero through 65535, or undefined.
 */
const parsePort = (value: unknown) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ConfigurationError('INVALID_PORT');
  }
  if (!/^[0-9]+$/.test(String(value))) {
    throw new ConfigurationError('INVALID_PORT');
  }
  /** Numeric port after the exact decimal grammar check. */
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new ConfigurationError('INVALID_PORT');
  }
  return port;
};

/** Exclude the configured runtime-state directory from development reload triggers.
 * @param {string} filePath - Watch event path.
 * @param {string} serviceName - Trusted runtime namespace.
 * @returns {boolean} Whether the path belongs to generated state.
 */
const isInsideGeneratedDir = (filePath: string, serviceName: string) => {
  /** Slash-normalized watch path used for generated-directory matching. */
  const normalized = filePath.replace(/\\/g, '/');
  /** Configured runtime directory basename, not an arbitrary client path. */
  const dir = `.${serviceName}`;
  return (
    normalized === dir ||
    normalized.startsWith(`${dir}/`) ||
    normalized.includes(`/${dir}/`)
  );
};

/** Read a local application display name without executing its manifest.
 * @param {string} rootDir - Trusted project root.
 * @returns {string} Declared application name or directory-name fallback.
 */
const getProjectName = (rootDir: string) => {
  /** Local application manifest path inspected only for the display name. */
  const packageJsonPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return path.basename(rootDir);
  }

  try {
    /** Parsed manifest data, never an executable configuration module. */
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.name || path.basename(rootDir);
  } catch {
    return path.basename(rootDir);
  }
};

/** Write a private atomic devtools orientation snapshot through the shared persistence owner.
 * @param {object} details - Trusted generation preparation metadata.
 * @param {unknown} details.rootDir - Trusted project root.
 * @param {unknown} details.appName - Application display name.
 * @param {unknown} details.mode - Development or production-start mode.
 * @param {unknown} details.manifestPath - Private runtime manifest location.
 * @param {unknown} details.loadedEnvFiles - Private loaded environment file paths.
 * @param {unknown} details.routes - Public route/method orientation without handler code.
 * @param {unknown} details.workers - Registered startup worker names.
 * @param {unknown} details.threadWorkers - Registered thread pool names.
 * @param {unknown} details.appPort - Optional validated application port.
 * @param {unknown} details.devtoolsModules - Optional package/enabled module projection.
 * @param {unknown} details.serviceName - Runtime compatibility namespace.
 * @param {object} details.reload - Optional bounded generation replacement counters.
 * @param {unknown} details.reload.generation - Active generation count.
 * @param {unknown} details.reload.attempts - Reload attempts.
 * @param {unknown} details.reload.failures - Failed preparation count.
 * @param {unknown} details.reload.rebuilding - Whether preparation is pending.
 * @param {unknown} details.reload.closed - Whether replacement ownership has ended.
 * @param {unknown} details.reload.lastError - Safe last failure summary or null.
 * @returns {string} Private devtools snapshot path.
 */
const writeDevSnapshot = (details: {
  rootDir: string;
  appName: string;
  mode: 'dev' | 'start';
  manifestPath: string;
  loadedEnvFiles: string[];
  routes: Array<{ path: string; methods: string[] }>;
  workers: string[];
  threadWorkers: string[];
  appPort?: number;
  devtoolsModules?: unknown[];
  serviceName: string;
  reload?: {
    generation: number;
    attempts: number;
    failures: number;
    rebuilding: boolean;
    closed: boolean;
    lastError: string | null;
  };
}) => {
  /** Private runtime-state directory inside the selected project. */
  const outputDir = path.join(details.rootDir, `.${details.serviceName}`);
  /** Private devtools JSON destination, written by the bounded persistence utility. */
  const snapshotPath = path.join(outputDir, 'dev.json');

  writeRuntimeJson(snapshotPath, {
    appName: details.appName,
    mode: details.mode,
    rootDir: details.rootDir,
    manifestPath: details.manifestPath,
    logFilePath: logger.getFilePath(),
    loadedEnvFiles: details.loadedEnvFiles,
    routes: details.routes,
    workers: details.workers,
    threadWorkers: details.threadWorkers,
    appPort: details.appPort,
    devtools: {
      modules: Array.isArray(details.devtoolsModules)
        ? details.devtoolsModules.map((item: any) => ({
            package: item.package,
            enabled: item.enabled,
          }))
        : [],
    },
    reload: details.reload ?? {
      generation: 1,
      attempts: 0,
      failures: 0,
      rebuilding: false,
      closed: false,
      lastError: null,
    },
    updatedAt: new Date().toISOString(),
  });

  return snapshotPath;
};

/** Prepare configured runtime/services/workers and delegate listener ownership to zhost.
 * @param {string} mode - Explicit development or production-start mode.
 * @param {object} args - Parsed trusted CLI arguments.
 * @param {object} args.namedArgs - Parsed option names and primitive values.
 * @param {string[]} args.positionalArgs - Parsed positional arguments.
 * @param {string} args.serviceName - Optional trusted runtime namespace.
 * @returns {Promise<unknown>} Long-lived command lifetime; startup failures propagate after owned rollback.
 */
export const server = async (
  mode: 'dev' | 'start' = 'start',
  args: {
    namedArgs?: Record<string, string | boolean | string[]>;
    positionalArgs?: string[];
    serviceName?: string;
  }
) => {
  /** Trusted CLI runtime namespace, default zerux. */
  const serviceName = args.serviceName ?? 'zerux';
  /** Caller working directory selected as the application project root. */
  const rootDir = process.cwd();
  console.log(`[zerux] Loading config from ${rootDir}`);
  loadEnvironmentFiles(resolveDefaultEnvFiles(rootDir, mode));
  /** Explicit validated CLI port overrides applied during configuration loading. */
  const overrides = {
    server: {
      port: parsePort(args.namedArgs?.p ?? args.namedArgs?.port),
      devPort: parsePort(args.namedArgs?.devPort),
    },
  };
  /** Private host configuration loaded before runtime/service acquisition. */
  const loadedConfig = await loadConfig(rootDir, mode, { overrides });
  let savedConfig = snapshotConfig(loadedConfig);
  /** Stable application correlation across development generations, without user identity. */
  const applicationId =
    loadedConfig.observability?.applicationId ??
    randomBytes(12).toString('hex');
  /** Production-manifest-resolved or development source configuration. */
  const config =
    mode === 'start'
      ? await resolveProductionStructure(rootDir, serviceName, loadedConfig)
      : loadedConfig;
  /** Resolved private project discovery and runtime output paths. */
  const structure = resolveStructure(rootDir, config, serviceName);

  // Relocate logger to the service directory
  logger.relocate(structure.outputDir);

  /** Explicit host environment files loaded for the selected structure. */
  const loadedEnvFiles = loadEnvironmentFiles(structure.envFiles);
  registerProcessExceptionHandlers(logger);

  console.log('[zerux] Bootstrapping application');
  config.observability = { ...config.observability, applicationId };
  let bootstrap = await bootstrapApplication(rootDir, mode, config, structure);
  console.log('[zerux] Application bootstrap complete');
  let manifestPath: string;
  let devDataPath: string;
  try {
    manifestPath = writeRuntimeManifest(bootstrap.runtime);
    devDataPath = writeDevSnapshot({
      rootDir,
      appName: getProjectName(rootDir),
      mode,
      manifestPath,
      loadedEnvFiles,
      routes: bootstrap.runtime.routes.map((route) => ({
        path: route.pattern,
        methods: Object.keys(route.methods).sort(),
      })),
      workers: [...bootstrap.runtime.workers.keys()].sort(),
      threadWorkers: [...bootstrap.runtime.threadWorkers.keys()].sort(),
      appPort: parsePort(
        args.namedArgs?.p ?? args.namedArgs?.port ?? config.server?.port
      ),
      devtoolsModules: config.devtools?.modules,
      serviceName,
    });
  } catch (error) {
    bootstrap.runtime.closeProtocols();
    await bootstrap.runtime.closeServices().catch(() => {});
    throw error;
  }
  /** Manifest-derived application display name for the hosting owner. */
  const appName = getProjectName(rootDir);
  /** Validated application port selected by CLI precedence over host configuration. */
  const appPort = parsePort(
    args.namedArgs?.p ?? args.namedArgs?.port ?? config.server?.port
  );
  /** Validated optional development proxy port. */
  const devPort = parsePort(args.namedArgs?.devPort ?? config.server?.devPort);
  let currentHandler = createRequestLifecycle(
    bootstrap.runtime.createHandler()
  );
  let workerRun: ZeruxWorkerRunResult | null = null;
  try {
    workerRun = await runWorkers(bootstrap.runtime);
  } catch (error) {
    bootstrap.runtime.closeProtocols();
    await bootstrap.runtime.closeServices().catch(() => {});
    throw error;
  }
  /** Owned generation replacement coordinator retaining last good runtime on preparation failure. */
  const lifecycle = createHotRuntime(
    {
      bootstrap,
      manifestPath,
      devDataPath,
      handler: currentHandler,
      workerRun,
      configSnapshot: savedConfig,
    },
    {
      prepare: async () => {
        loadEnvironmentFiles(resolveDefaultEnvFiles(rootDir, mode));
        /** Fresh candidate configuration checked for reload compatibility before acquisition. */
        const nextConfig = await loadConfig(rootDir, mode, { overrides });
        assertConfigReloadable(savedConfig, nextConfig);
        /** Pre-acquisition configuration snapshot retained only on successful activation. */
        const candidateConfig = snapshotConfig(nextConfig);
        nextConfig.observability = {
          ...nextConfig.observability,
          applicationId,
        };
        /** Candidate private project discovery layout. */
        const nextStructure = resolveStructure(
          rootDir,
          nextConfig,
          serviceName
        );
        loadEnvironmentFiles(nextStructure.envFiles);
        /** Prepared candidate runtime with delayed compatibility activation. */
        const nextBootstrap = await bootstrapApplication(
          rootDir,
          mode,
          nextConfig,
          nextStructure,
          {},
          { deferActivation: true }
        );
        let nextWorkers: ZeruxWorkerRunResult | null = null;
        try {
          /** Candidate native request lifecycle owner, drained before dependent services close. */
          const handler = createRequestLifecycle(
            nextBootstrap.runtime.createHandler()
          );
          nextWorkers = await runWorkers(nextBootstrap.runtime);
          /** Prepared candidate private runtime manifest path. */
          const nextManifest = writeRuntimeManifest(nextBootstrap.runtime);
          /** Prepared candidate private devtools orientation snapshot. */
          const nextSnapshot = writeDevSnapshot({
            rootDir,
            appName: getProjectName(rootDir),
            mode,
            manifestPath: nextManifest,
            loadedEnvFiles: nextStructure.envFiles,
            routes: nextBootstrap.runtime.routes.map((route) => ({
              path: route.pattern,
              methods: Object.keys(route.methods).sort(),
            })),
            workers: [...nextBootstrap.runtime.workers.keys()].sort(),
            threadWorkers: [
              ...nextBootstrap.runtime.threadWorkers.keys(),
            ].sort(),
            appPort: parsePort(
              args.namedArgs?.p ??
                args.namedArgs?.port ??
                nextConfig.server?.port
            ),
            devtoolsModules: nextConfig.devtools?.modules,
            serviceName,
          });
          return {
            bootstrap: nextBootstrap,
            handler,
            manifestPath: nextManifest,
            devDataPath: nextSnapshot,
            workerRun: nextWorkers,
            configSnapshot: candidateConfig,
          };
        } catch (error) {
          await nextWorkers?.stop();
          nextBootstrap.runtime.closeProtocols();
          await nextBootstrap.runtime.closeServices();
          throw error;
        }
      },
      activate: (next) => {
        next.bootstrap.runtime.activateServices();
        savedConfig = next.configSnapshot;
        bootstrap = next.bootstrap;
        manifestPath = next.manifestPath;
        devDataPath = next.devDataPath;
        currentHandler = next.handler;
        workerRun = next.workerRun;
      },
      dispose: async (old) => {
        await old.handler.drain();
        await old.workerRun?.stop();
        old.bootstrap.runtime.closeProtocols();
        await old.bootstrap.runtime.closeServices();
      },
    }
  );
  /** Forward native requests to the currently active generation handler.
   * @param {unknown} req - Native incoming request forwarded without rewriting.
   * @param {unknown} res - Native response forwarded without rewriting.
   * @returns {Promise<void>} Active generation request handling settlement.
   */
  const appHandler = async (req: any, res: any) =>
    currentHandler.handle(req, res);

  logger.info('Zerux bootstrap ready', {
    mode,
    appName,
    manifestPath,
    loadedEnvFiles,
    routes: bootstrap.runtime.routes.length,
    workers: bootstrap.runtime.workers.size,
    threadWorkers: bootstrap.runtime.threadWorkers.size,
  });

  console.log(`[zerux] Starting ${mode} server`);
  try {
    await startServer({
      service: serviceName,
      config,
      app: {
        name: appName,
        port: appPort,
        func: appHandler,
      },
      dev:
        mode === 'dev'
          ? {
              watchIgnoredPaths: [
                `.${serviceName}`,
                ...(config.server?.watchIgnoredPaths ?? []),
              ],
              port: devPort,
              dataFilePath: devDataPath,
              logFilePath: logger.getFilePath(),
              runtimeManifestPath: manifestPath,
              watchTriggerFunc: (event: { file?: string; type?: string }) => {
                /** Watch event path, filtered before any candidate reload is requested. */
                const file = event.file ?? '';
                if (event.type === 'resave') {
                  return false;
                }
                if (!file) {
                  return false;
                }
                if (file.includes('node_modules')) {
                  return false;
                }
                if (isInsideGeneratedDir(file, serviceName)) {
                  return false;
                }
                if (file.endsWith('.log')) {
                  return false;
                }
                return true;
              },
              watchFunc: async () => {
                try {
                  await lifecycle.reload();
                } finally {
                  try {
                    /** Existing private snapshot merged with current bounded reload counters. */
                    const snapshot = readRuntimeJson<Record<string, unknown>>(
                      devDataPath,
                      {}
                    );
                    writeRuntimeJson(devDataPath, {
                      ...snapshot,
                      reload: lifecycle.status(),
                      updatedAt: new Date().toISOString(),
                    });
                  } catch (error) {
                    logger.error('Could not persist hot reload status', error);
                  }
                }
              },
            }
          : undefined,
    });
  } catch (error) {
    await lifecycle.close().catch(() => {});
    throw error;
  }

  return new Promise(() => undefined);
};
