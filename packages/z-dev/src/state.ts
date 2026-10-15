import fs from "node:fs";

import { CLIENT_EVENT_LIMIT, LOG_LINE_LIMIT } from "./constants.js";
import { readJsonFile, writeJsonFile } from "./fs.js";
import type { SharedDevRegistration, SharedDevSnapshot } from "./types.js";

export const readTailLines = (filePath: string | null, limit = LOG_LINE_LIMIT) => {
    if (!filePath || !fs.existsSync(filePath)) return [];

    // Keep memory bounded even when the application's log file is very large.
    const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    let content: string;
    try {
        const info = fs.fstatSync(fd);
        if (!info.isFile()) throw new Error('Unsafe devtools log file');
        const length = Math.min(info.size, 256 * 1024);
        const buffer = Buffer.alloc(length);
        const bytes = fs.readSync(fd, buffer, 0, length, info.size - length);
        content = buffer.subarray(0, bytes).toString('utf8');
        if (info.size > length) content = content.slice(content.indexOf('\n') + 1);
    } finally { fs.closeSync(fd); }
    return content
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-limit);
};

export const appendSnapshotEvent = (filePath: string | null, event: Record<string, unknown>) => {
    if (!filePath) return;

    const snapshot = readJsonFile<Record<string, unknown>>(filePath, {});
    const currentEvents = Array.isArray(snapshot.clientEvents) ? snapshot.clientEvents : [];
    snapshot.clientEvents = [...currentEvents, event].slice(-CLIENT_EVENT_LIMIT);
    snapshot.updatedAt = new Date().toISOString();
    writeJsonFile(filePath, snapshot);
};

export const normalizeSnapshot = (
    app: SharedDevRegistration,
    options?: { identifier?: string | null }
): SharedDevSnapshot => {
    const snapshot = app.dataFilePath
        ? readJsonFile<Record<string, unknown>>(app.dataFilePath, {})
        : {};
    const rawEvents = Array.isArray(snapshot.clientEvents)
        ? snapshot.clientEvents as Record<string, unknown>[]
        : [];
    const clientEvents = options?.identifier
        ? rawEvents.filter((event) => event.identifier === options.identifier)
        : rawEvents;

    return {
        routeName: app.routeName,
        appName: app.appName,
        rootDir: app.rootDir,
        appPort: app.appPort,
        manifestPath: app.runtimeManifestPath,
        logFilePath: app.logFilePath,
        startedAt: app.startedAt,
        updatedAt: String(snapshot.updatedAt ?? app.updatedAt),
        mode: String(snapshot.mode ?? "dev"),
        routes: Array.isArray(snapshot.routes)
            ? snapshot.routes as Array<{ path: string; methods: string[] }>
            : [],
        devtools: {
            modules: [...new Set([
                ...app.devtools.modules,
                ...(Array.isArray((snapshot as { devtools?: { modules?: unknown[] } }).devtools?.modules)
                    ? (snapshot as { devtools?: { modules?: Array<string | { package: string; enabled?: boolean; options?: Record<string, unknown> }> } }).devtools!.modules!.map(m => typeof m === "string" ? m : m.package)
                    : [])
            ])]
        },
        clientEvents,
        logs: readTailLines(app.logFilePath),
        reload: snapshot.reload && typeof snapshot.reload === 'object' && !Array.isArray(snapshot.reload)
            ? snapshot.reload as SharedDevSnapshot['reload']
            : undefined
    };
};
