import fs from "node:fs";
import path from "node:path";

import { startServer } from "zsrv";

import { loadConfig, resolveDefaultEnvFiles, resolveStructure } from "../bootstrap/config.js";
import { loadEnvironmentFiles } from "../bootstrap/env.js";
import { registerProcessExceptionHandlers } from "../bootstrap/exception.js";
import { writeRuntimeManifest } from "../bootstrap/manifest.js";
import { readRuntimeJson, writeRuntimeJson } from "../bootstrap/persist.js";
import { bootstrapApplication } from "../bootstrap/runtime.js";
import { logger } from "../bootstrap/logger.js";
import { runWorkers } from "../bootstrap/worker.js";
import { createHotRuntime } from "../bootstrap/hot-runtime.js";
import { resolveProductionStructure } from "./project-builder.js";
import { createRequestLifecycle } from "../bootstrap/request-lifecycle.js";
import type { ZeruxWorkerRunResult } from "../bootstrap/worker.js";

const parsePort = (value: unknown) => {
    if (value === undefined || value === null || value === "") return undefined;

    const port = Number.parseInt(String(value), 10);
    return Number.isFinite(port) ? port : undefined;
};

const isInsideGeneratedDir = (filePath: string, serviceName: string) => {
    const normalized = filePath.replace(/\\/g, "/");
    const dir = `.${serviceName}`;
    return normalized === dir || normalized.startsWith(`${dir}/`) || normalized.includes(`/${dir}/`);
};

const getProjectName = (rootDir: string) => {
    const packageJsonPath = path.join(rootDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
        return path.basename(rootDir);
    }

    try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        return packageJson.name || path.basename(rootDir);
    } catch {
        return path.basename(rootDir);
    }
};

const writeDevSnapshot = (details: {
    rootDir: string;
    appName: string;
    mode: "dev" | "start";
    manifestPath: string;
    loadedEnvFiles: string[];
    routes: Array<{ path: string; methods: string[] }>;
    workers: string[];
    threadWorkers: string[];
    appPort?: number;
    devtoolsModules?: unknown[];
    serviceName: string;
    reload?: { generation: number; attempts: number; failures: number; rebuilding: boolean; closed: boolean; lastError: string | null };
}) => {
    const outputDir = path.join(details.rootDir, `.${details.serviceName}`);
    const snapshotPath = path.join(outputDir, "dev.json");
    const previous = readRuntimeJson<Record<string, unknown>>(snapshotPath, {});

    writeRuntimeJson(
        snapshotPath,
        JSON.stringify(
            {
                ...previous,
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
                    modules: Array.isArray(details.devtoolsModules) ? details.devtoolsModules : []
                },
                reload: details.reload ?? previous.reload ?? {
                    generation: 1, attempts: 0, failures: 0,
                    rebuilding: false, closed: false, lastError: null
                },
                updatedAt: new Date().toISOString()
            },
            null,
            2
        )
    );

    return snapshotPath;
};

export const server = async (
    mode: "dev" | "start" = "start",
    args: { namedArgs?: Record<string, string | boolean | string[]>; positionalArgs?: string[]; serviceName?: string }
) => {
    const serviceName = args.serviceName ?? "zerux";
    const rootDir = process.cwd();
    console.log(`[zerux] Loading config from ${rootDir}`);
    loadEnvironmentFiles(resolveDefaultEnvFiles(rootDir, mode));
    const loadedConfig = await loadConfig(rootDir, mode);
    const config = mode === "start" ? await resolveProductionStructure(rootDir, serviceName, loadedConfig) : loadedConfig;
    const structure = resolveStructure(rootDir, config, serviceName);

    // Relocate logger to the service directory
    logger.relocate(structure.outputDir);

    const loadedEnvFiles = loadEnvironmentFiles(structure.envFiles);
    registerProcessExceptionHandlers(logger);

    console.log("[zerux] Bootstrapping application");
    let bootstrap = await bootstrapApplication(rootDir, mode, config, structure);
    console.log("[zerux] Application bootstrap complete");
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
            methods: Object.keys(route.methods).sort()
        })),
        workers: [...bootstrap.runtime.workers.keys()].sort(),
        threadWorkers: [...bootstrap.runtime.threadWorkers.keys()].sort(),
        appPort: parsePort(args.namedArgs?.p ?? args.namedArgs?.port ?? config.server?.port),
        devtoolsModules: config.devtools?.modules,
        serviceName
        });
    } catch (error) {
        bootstrap.runtime.closeProtocols();
        await bootstrap.runtime.closeServices().catch(() => {});
        throw error;
    }
    const appName = getProjectName(rootDir);
    const appPort = parsePort(args.namedArgs?.p ?? args.namedArgs?.port ?? config.server?.port);
    const devPort = parsePort(args.namedArgs?.devPort ?? config.server?.devPort);
    let currentHandler = createRequestLifecycle(bootstrap.runtime.createHandler());
    let workerRun: ZeruxWorkerRunResult | null = null;
    try { workerRun = await runWorkers(bootstrap.runtime); }
    catch (error) {
        bootstrap.runtime.closeProtocols();
        await bootstrap.runtime.closeServices().catch(() => {});
        throw error;
    }
    const lifecycle = createHotRuntime({ bootstrap, manifestPath, devDataPath, handler: currentHandler, workerRun }, {
        prepare: async () => {
            loadEnvironmentFiles(resolveDefaultEnvFiles(rootDir, mode));
            const nextConfig = await loadConfig(rootDir, mode);
            const nextStructure = resolveStructure(rootDir, nextConfig, serviceName);
            loadEnvironmentFiles(nextStructure.envFiles);
            const nextBootstrap = await bootstrapApplication(rootDir, mode, nextConfig, nextStructure);
            let nextWorkers: ZeruxWorkerRunResult | null = null;
            try {
                const handler = createRequestLifecycle(nextBootstrap.runtime.createHandler());
                nextWorkers = await runWorkers(nextBootstrap.runtime);
                const nextManifest = writeRuntimeManifest(nextBootstrap.runtime);
                const nextSnapshot = writeDevSnapshot({
                    rootDir, appName: getProjectName(rootDir), mode,
                    manifestPath: nextManifest,
                    loadedEnvFiles: nextStructure.envFiles,
                    routes: nextBootstrap.runtime.routes.map(route => ({
                        path: route.pattern,
                        methods: Object.keys(route.methods).sort()
                    })),
                    workers: [...nextBootstrap.runtime.workers.keys()].sort(),
                    threadWorkers: [...nextBootstrap.runtime.threadWorkers.keys()].sort(),
                    appPort: parsePort(args.namedArgs?.p ?? args.namedArgs?.port ?? nextConfig.server?.port),
                    devtoolsModules: nextConfig.devtools?.modules,
                    serviceName
                });
                return { bootstrap: nextBootstrap, handler, manifestPath: nextManifest,
                    devDataPath: nextSnapshot, workerRun: nextWorkers };
            } catch (error) {
                await nextWorkers?.stop();
                nextBootstrap.runtime.closeProtocols();
                await nextBootstrap.runtime.closeServices();
                throw error;
            }
        },
        activate: next => {
            bootstrap = next.bootstrap;
            manifestPath = next.manifestPath;
            devDataPath = next.devDataPath;
            currentHandler = next.handler;
            workerRun = next.workerRun;
        },
        dispose: async old => {
            await old.handler.drain();
            await old.workerRun?.stop();
            old.bootstrap.runtime.closeProtocols();
            await old.bootstrap.runtime.closeServices();
        }
    });
    const appHandler = async (req: any, res: any) => currentHandler.handle(req, res);


    logger.info("Zerux bootstrap ready", {
        mode,
        appName,
        manifestPath,
        loadedEnvFiles,
        routes: bootstrap.runtime.routes.length,
        workers: bootstrap.runtime.workers.size,
        threadWorkers: bootstrap.runtime.threadWorkers.size
    });

    console.log(`[zerux] Starting ${mode} server`);
    try { await startServer({
        service: serviceName,
        config,
        app: {
            name: appName,
            port: appPort,
            func: appHandler
        },
        dev: mode === "dev" ? {
            port: devPort,
            dataFilePath: devDataPath,
            logFilePath: logger.getFilePath(),
            runtimeManifestPath: manifestPath,
            watchTriggerFunc: (event: { file?: string, type?: string }) => {
                const file = event.file ?? "";
                if (event.type === "resave") return false;
                if (!file) return false;
                if (file.includes("node_modules")) return false;
                if (isInsideGeneratedDir(file, serviceName)) return false;
                if (file.endsWith(".log")) return false;
                return true;
            },
            watchFunc: async () => {
                try { await lifecycle.reload(); }
                finally {
                    try {
                        const snapshot = readRuntimeJson<Record<string, unknown>>(devDataPath, {});
                        writeRuntimeJson(devDataPath, {
                            ...snapshot, reload: lifecycle.status(), updatedAt: new Date().toISOString()
                        });
                    } catch (error) { logger.error('Could not persist hot reload status', error); }
                }
            }
        } : undefined
    }); } catch (error) {
        await lifecycle.close().catch(() => {});
        throw error;
    }

    return new Promise(() => undefined);
};
