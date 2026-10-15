import path from "node:path";

import type { ZeruxConfig, ZeruxStructureConfig } from "../index.js";
import { findExistingFile, importModule } from "../utils/fs.js";
import type { ResolvedStructure, RuntimeMode } from "./types.js";

const DEFAULT_STRUCTURE: ZeruxStructureConfig = {
    app: "app",
    middleware: ["middleware"],
    controllers: ["controllers"],
    composables: ["composables"],
    plugins: ["plugins"],
    public: ["public"],
    env: []
};

const asArray = (value?: string | string[]) => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
};

const uniquePaths = (rootDir: string, values: string[]) =>
    [...new Set(values.map((value) => path.resolve(rootDir, value)))];

export const resolveDefaultEnvFiles = (rootDir: string, mode: RuntimeMode): string[] => {
    const environment = process.env.NODE_ENV || (mode === "start" ? "production" : "development");

    return uniquePaths(rootDir, [
        ".env",
        ".env.local",
        `.env.${environment}`,
        `.env.${environment}.local`
    ]);
};

export const loadConfig = async (rootDir: string, mode: RuntimeMode): Promise<ZeruxConfig> => {
    const configPath = findExistingFile(rootDir, [
        "zerux.config.ts",
        "zerux.config.js",
        "zerux.config.mjs",
        "zerux.config.cjs"
    ]);

    if (!configPath) {
        return {};
    }

    const loaded = await importModule(configPath, mode);
    return (loaded.default || loaded.zeruxConfig || loaded.zdevConfig || loaded) as ZeruxConfig;
};

export const resolveStructure = (
    rootDir: string,
    config: ZeruxConfig,
    serviceName = "zerux"
): ResolvedStructure => {
    const mode = config.type ?? "fix";
    const structure = {
        ...DEFAULT_STRUCTURE,
        ...(config.structure ?? {})
    };

    const environment = process.env.NODE_ENV || (mode === "function" ? "production" : "development");
    const explicitEnvFiles = asArray(structure.env);
    const envFiles = uniquePaths(rootDir, [
        ...resolveDefaultEnvFiles(rootDir, environment === "production" ? "start" : "dev"),
        ...explicitEnvFiles
    ]);

    return {
        mode,
        rootDir,
        serviceName,
        entryPointName: config.entryPoint ?? "index",
        appDir: structure.app ? path.resolve(rootDir, structure.app) : null,
        middlewareDirs: uniquePaths(rootDir, asArray(structure.middleware)),
        controllerDirs: uniquePaths(rootDir, asArray(structure.controllers)),
        composableDirs: uniquePaths(rootDir, asArray(structure.composables)),
        pluginDirs: uniquePaths(rootDir, asArray(structure.plugins)),
        publicDirs: uniquePaths(rootDir, asArray(structure.public)),
        envFiles,
        outputDir: path.resolve(rootDir, config.outDir ?? `.${serviceName}`),
        raw: structure
    };
};
