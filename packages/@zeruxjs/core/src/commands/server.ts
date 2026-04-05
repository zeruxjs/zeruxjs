import fs from "node:fs";
import path from "node:path";

import { startServer } from "@zeruxjs/server";

import { loadConfig, resolveStructure } from "../bootstrap/config.js";
import { loadEnvironmentFiles } from "../bootstrap/env.js";
import { registerProcessExceptionHandlers } from "../bootstrap/exception.js";
import { writeRuntimeManifest } from "../bootstrap/manifest.js";
import { bootstrapApplication } from "../bootstrap/runtime.js";
import { logger } from "../bootstrap/logger.js";

const parsePort = (value: unknown) => {
    if (value === undefined || value === null || value === "") return undefined;

    const port = Number.parseInt(String(value), 10);
    return Number.isFinite(port) ? port : undefined;
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

export const server = async (
    mode: "dev" | "start" = "start",
    args: { namedArgs?: Record<string, string | boolean | string[]>; positionalArgs?: string[] }
) => {
    const rootDir = process.cwd();
    const config = await loadConfig(rootDir, mode);
    const structure = resolveStructure(rootDir, config);

    const loadedEnvFiles = loadEnvironmentFiles(structure.envFiles);
    registerProcessExceptionHandlers(logger);

    let bootstrap = await bootstrapApplication(rootDir, mode, config, structure);
    let manifestPath = writeRuntimeManifest(bootstrap.runtime);
    const appName = getProjectName(rootDir);
    const appPort = parsePort(args.namedArgs?.p ?? args.namedArgs?.port ?? config.server?.port);
    const devPort = parsePort(args.namedArgs?.devPort ?? config.server?.devPort);
    let currentHandler = bootstrap.runtime.createHandler();
    const appHandler = async (req: any, res: any) => currentHandler(req, res);

    logger.info("Zerux bootstrap ready", {
        mode,
        appName,
        manifestPath,
        loadedEnvFiles,
        routes: bootstrap.runtime.routes.length
    });

    await startServer({
        service: "zerux",
        config,
        app: {
            name: appName,
            port: appPort,
            func: appHandler
        },
        dev: mode === "dev" ? {
            port: devPort,
            func: (_req: any, res: any) => {
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({
                    app: appName,
                    mode,
                    manifestPath,
                    routes: bootstrap.runtime.routes.map((route) => ({
                        path: route.pattern,
                        methods: Object.keys(route.methods).sort()
                    }))
                }));
            },
            watchTriggerFunc: (event: { file?: string }) => {
                const file = event.file ?? "";
                if (!file) return false;
                if (file.includes("node_modules")) return false;
                if (file.includes(`${path.sep}.zerux${path.sep}`)) return false;
                if (file.endsWith(".log")) return false;
                return true;
            },
            watchFunc: async () => {
                const nextConfig = await loadConfig(rootDir, mode);
                const nextStructure = resolveStructure(rootDir, nextConfig);
                loadEnvironmentFiles(nextStructure.envFiles);

                bootstrap = await bootstrapApplication(rootDir, mode, nextConfig, nextStructure);
                manifestPath = writeRuntimeManifest(bootstrap.runtime);
                currentHandler = bootstrap.runtime.createHandler();
            }
        } : undefined
    });

    return new Promise(() => undefined);
};
