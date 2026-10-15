import fs from "node:fs";
import net from "node:net";

import { DEFAULT_SHARED_PORT, SHARED_DEV_FILE } from "./constants.js";
import { readJsonFile, writeJsonFile } from "./fs.js";
import type {
    SharedDevRegistration,
    SharedDevRegistrationOptions,
    SharedDevRegistry,
    SharedDevStartResult
} from "./types.js";

const sanitizeAppName = (value: string) =>
    value
        .trim()
        .replace(/^@/, "")
        .replace(/[\\/]+/g, "_")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "app";

const isPidAlive = (pid?: number) => {
    if (!pid) return false;

    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

export const isPortFree = (port: number) =>
    new Promise<boolean>((resolve) => {
        const server = net.createServer();
        server.once("error", () => resolve(false));
        server.once("listening", () => server.close(() => resolve(true)));
        server.listen(port, "127.0.0.1");
    });

export const findPort = async (start: number) => {
    let port = start;
    while (!(await isPortFree(port))) {
        port += 1;
    }
    return port;
};

export const readRegistry = (): SharedDevRegistry => {
    const registry = readJsonFile<SharedDevRegistry>(SHARED_DEV_FILE, { apps: [] });
    return {
        port: registry.port,
        serverPid: registry.serverPid,
        updatedAt: registry.updatedAt,
        apps: Array.isArray(registry.apps) ? registry.apps : []
    };
};

export const writeRegistry = (registry: SharedDevRegistry) => {
    registry.updatedAt = new Date().toISOString();
    writeJsonFile(SHARED_DEV_FILE, registry);
};

const resolveRouteName = (appName: string, apps: SharedDevRegistration[], rootDir: string, serviceName: string) => {
    const sanitized = sanitizeAppName(appName);
    const taken = new Set(
        apps
            .filter((app) => app.rootDir !== rootDir)
            .map((app) => app.routeName)
    );

    let candidate = sanitized;
    let index = 1;
    while (taken.has(candidate) || candidate === `__${serviceName}`) {
        candidate = `${sanitized}_${index++}`;
    }

    return candidate;
};

export const getRegistryApp = (routeName: string) => {
    const registry = readRegistry();
    return registry.apps.find((app) => app.routeName === routeName) ?? null;
};

export const getRegistryAppByRoot = (rootDir: string) => {
    const registry = readRegistry();
    return registry.apps.find((app) => app.rootDir === rootDir) ?? null;
};

export const registerSharedDevApp = async (
    options: SharedDevRegistrationOptions
): Promise<SharedDevStartResult> => {
    const registry = readRegistry();
    const now = new Date().toISOString();
    const basePort = options.preferredPort ?? registry.port ?? DEFAULT_SHARED_PORT;
    const port = registry.port ?? await findPort(basePort);

    const filteredApps = registry.apps.filter((app) => app.rootDir !== options.rootDir);
    const serviceName = options.serviceName || "zdev";
    const routeName = resolveRouteName(options.appName, filteredApps, options.rootDir, serviceName);
    const nextApp: SharedDevRegistration = {
        appName: options.appName,
        routeName,
        serviceName,
        appPort: options.appPort,
        rootDir: options.rootDir,
        dataFilePath: options.dataFilePath ?? null,
        logFilePath: options.logFilePath ?? null,
        runtimeManifestPath: options.runtimeManifestPath ?? null,
        allowedDomains: options.allowedDomains ?? [],
        allowedDevDomain: options.allowedDevDomain ?? null,
        devtools: options.devtools ?? { modules: [] },
        startedAt: now,
        updatedAt: now
    };

    registry.port = port;
    registry.apps = [...filteredApps, nextApp].sort((left, right) => left.routeName.localeCompare(right.routeName));
    writeRegistry(registry);

    return {
        port,
        routeName,
        allowedDevDomain: nextApp.allowedDevDomain,
        urls: {
            devtools: `http://127.0.0.1:${port}/${routeName}`,
            websocket: `ws://127.0.0.1:${port}/__${serviceName}/ws?app=${encodeURIComponent(routeName)}`
        }
    };
};

export const unregisterSharedDevApp = (rootDir: string) => {
    if (!fs.existsSync(SHARED_DEV_FILE)) return false;

    const registry = readRegistry();
    const nextApps = registry.apps.filter((app) => app.rootDir !== rootDir);

    if (nextApps.length === 0) {
        try {
            fs.unlinkSync(SHARED_DEV_FILE);
        } catch {
            return false;
        }
        return true;
    }

    writeRegistry({
        ...registry,
        apps: nextApps,
        serverPid: isPidAlive(registry.serverPid) ? registry.serverPid : undefined
    });
    return false;
};

export const readSharedDevRouteName = (rootDir: string) => getRegistryAppByRoot(rootDir)?.routeName ?? null;
