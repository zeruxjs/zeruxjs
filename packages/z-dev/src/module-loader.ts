import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import {
    ensurePathInsideRoot,
    sanitizeIdentifier,
    sanitizeRelativeAssetPath
} from "@zeruxjs/security";

import {
    getRegisteredDevtoolsModules,
    type DevtoolsApiModuleHandlers,
    type DevtoolsModuleConfig,
    type DevtoolsModuleDefinition,
    type DevtoolsSectionDefinition,
    type DevtoolsSocketModuleHandlers
} from "./module-registry.js";
import type { SharedDevRegistration, SharedDevSnapshot } from "./types.js";

interface LoadedDevtoolsModule {
    definition: DevtoolsModuleDefinition;
    apiHandlers: DevtoolsApiModuleHandlers;
    socketHandlers: DevtoolsSocketModuleHandlers;
    stylePath?: string;
    scriptPath?: string;
    shareWith: string[];
}

const importModule = async <T = any>(filePath: string): Promise<T> => {
    const target = `${pathToFileURL(filePath).href}?v=${fs.statSync(filePath).mtimeMs}`;
    return import(target) as Promise<T>;
};

const toModuleConfig = (value: any): DevtoolsModuleConfig | null => {
    const config = value?.default ?? value?.config ?? value;
    if (!config || typeof config.entry !== "string") {
        return null;
    }
    return config as DevtoolsModuleConfig;
};

const toModuleDefinition = (
    value: any,
    fallback: {
        id: string;
        title: string;
        description?: string;
        packageName: string;
        packageRoot: string;
        dependencies: string[];
        routeName: string;
    }
): DevtoolsModuleDefinition => {
    const definition = value?.default ?? value?.module ?? value ?? {};
    const sections = Array.isArray(definition.sections)
        ? definition.sections.filter((section: unknown): section is DevtoolsSectionDefinition =>
            Boolean(section && typeof section === "object" && typeof (section as DevtoolsSectionDefinition).id === "string" && typeof (section as DevtoolsSectionDefinition).title === "string" && typeof (section as DevtoolsSectionDefinition).render === "function"))
        : [];

    return {
        id: sanitizeIdentifier(definition.id ?? fallback.id, fallback.id),
        title: String(definition.title ?? fallback.title),
        version: typeof definition.version === "string" ? definition.version : undefined,
        description: typeof definition.description === "string" ? definition.description : fallback.description,
        badge: typeof definition.badge === "string" ? definition.badge : "module",
        packageName: fallback.packageName,
        packageRoot: fallback.packageRoot,
        dependencies: Array.isArray(definition.dependencies)
            ? definition.dependencies.filter((item: unknown): item is string => typeof item === "string")
            : fallback.dependencies,
        sections: sections.map((section: DevtoolsSectionDefinition) => ({
            ...section,
            moduleId: sanitizeIdentifier(definition.id ?? fallback.id, fallback.id)
        })),
        meta: typeof definition.meta === "object" && definition.meta ? definition.meta : {}
    };
};

const toHandlers = <T extends Record<string, unknown>>(value: any): T => {
    const handlers = value?.default ?? value?.handlers ?? value;
    return (handlers && typeof handlers === "object" ? handlers : {}) as T;
};

const resolveModulePackageRoot = (appRoot: string, packageName: string) => {
    const require = createRequire(path.join(appRoot, "package.json"));
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    return path.dirname(packageJsonPath);
};

const resolveModuleFile = (packageRoot: string, relativePath?: string | null) => {
    const safePath = sanitizeRelativeAssetPath(relativePath);
    if (!safePath) return null;

    const absolutePath = path.join(packageRoot, safePath);
    if (!ensurePathInsideRoot(packageRoot, absolutePath) || !fs.existsSync(absolutePath)) {
        return null;
    }

    return absolutePath;
};

const loadConfiguredModule = async (
    app: SharedDevRegistration,
    snapshot: SharedDevSnapshot,
    reference: string | { package: string; enabled?: boolean; options?: Record<string, unknown> }
): Promise<LoadedDevtoolsModule | null> => {
    const packageName = typeof reference === "string" ? reference : reference.package;
    if (!packageName || (typeof reference === "object" && reference.enabled === false)) {
        return null;
    }

    try {
        const packageRoot = resolveModulePackageRoot(app.rootDir, packageName);
        const configPath = path.join(packageRoot, "zerux.module.config.js");
        if (!fs.existsSync(configPath)) {
            return null;
        }

        const config = toModuleConfig(await importModule(configPath));
        if (!config) {
            return null;
        }

        const moduleId = sanitizeIdentifier(config.id ?? packageName.split("/").pop() ?? packageName, "module");
        const title = String(config.title ?? moduleId);
        const entryPath = resolveModuleFile(packageRoot, config.entry);
        if (!entryPath) {
            return null;
        }

        const entryModule = await importModule(entryPath);
        const definition = toModuleDefinition(entryModule, {
            id: moduleId,
            title,
            description: config.description,
            packageName,
            packageRoot,
            dependencies: Array.isArray(config.dependencies)
                ? config.dependencies.filter((item): item is string => typeof item === "string")
                : [],
            routeName: app.routeName
        });

        definition.sections = (definition.sections ?? []).map((section) => ({
            ...section,
            moduleId
        }));

        const stylePath = resolveModuleFile(packageRoot, config.assets?.style);
        const scriptPath = resolveModuleFile(packageRoot, config.assets?.script);
        const versionSuffix = typeof config.version === "string" ? `?v=${encodeURIComponent(config.version)}` : "";
        definition.assets = {
            styleUrl: stylePath ? `/${app.routeName}/__zerux/modules/${moduleId}/style.css${versionSuffix}` : undefined,
            scriptUrl: scriptPath ? `/${app.routeName}/__zerux/modules/${moduleId}/client.js${versionSuffix}` : undefined
        };
        definition.meta = {
            ...definition.meta,
            packageName,
            options: typeof reference === "object" ? (reference.options ?? {}) : {}
        };

        const apiPath = resolveModuleFile(packageRoot, config.server?.api);
        const websocketPath = resolveModuleFile(packageRoot, config.server?.websocket);

        return {
            definition,
            apiHandlers: apiPath ? toHandlers<DevtoolsApiModuleHandlers>(await importModule(apiPath)) : {},
            socketHandlers: websocketPath ? toHandlers<DevtoolsSocketModuleHandlers>(await importModule(websocketPath)) : {},
            stylePath: stylePath ?? undefined,
            scriptPath: scriptPath ?? undefined,
            shareWith: Array.isArray(config.server?.shareWith)
                ? config.server!.shareWith.filter((item): item is string => typeof item === "string").map((item) => sanitizeIdentifier(item, item))
                : []
        };
    } catch {
        return null;
    }
};

export const loadAppDevtoolsModules = async (app: SharedDevRegistration, snapshot: SharedDevSnapshot) => {
    const configured = await Promise.all(
        snapshot.devtools.modules.map((reference) => loadConfiguredModule(app, snapshot, reference))
    );

    const loaded = [
        ...getRegisteredDevtoolsModules().map((definition) => ({
            definition,
            apiHandlers: {},
            socketHandlers: {},
            shareWith: []
        })),
        ...configured.filter((module): module is LoadedDevtoolsModule => Boolean(module))
    ];

    const unique = new Map<string, LoadedDevtoolsModule>();
    for (const module of loaded) {
        unique.set(module.definition.id, module);
    }

    return [...unique.values()].sort((left, right) =>
        left.definition.title.localeCompare(right.definition.title)
    );
};

export const loadApplicationSections = async (
    app: SharedDevRegistration,
    snapshot: SharedDevSnapshot,
    baseSections: DevtoolsSectionDefinition[],
    identifier?: string | null
) => {
    const loadedModules = await loadAppDevtoolsModules(app, snapshot);
    const modules = loadedModules.map((entry) => entry.definition);
    const moduleSections = loadedModules.flatMap((entry) => entry.definition.sections ?? []);
    const sections = [...baseSections, ...moduleSections].sort(
        (left, right) => (left.order ?? 1000) - (right.order ?? 1000) || left.title.localeCompare(right.title)
    );

    return {
        modules,
        sections: await Promise.all(sections.map(async (section) => ({
            ...section,
            content: await section.render({
                app,
                snapshot,
                identifier,
                modules,
                module: section.moduleId ? modules.find((module) => module.id === section.moduleId) : undefined
            })
        })))
    };
};

const canAccessModule = (fromModuleId: string | undefined, target: LoadedDevtoolsModule) =>
    !fromModuleId ||
    fromModuleId === target.definition.id ||
    target.definition.dependencies?.includes(fromModuleId) ||
    target.shareWith.includes(fromModuleId);

export const resolveModuleApiRequest = async (options: {
    app: SharedDevRegistration;
    snapshot: SharedDevSnapshot;
    moduleId: string;
    handlerName: string;
    request: IncomingMessage;
    body: unknown;
    identifier?: string | null;
    requesterModuleId?: string | null;
}) => {
    const loadedModules = await loadAppDevtoolsModules(options.app, options.snapshot);
    const target = loadedModules.find((module) => module.definition.id === options.moduleId);
    if (!target || !canAccessModule(options.requesterModuleId ?? undefined, target)) {
        return null;
    }

    const handler = target.apiHandlers[options.handlerName];
    if (!handler) {
        return null;
    }

    return handler({
        app: options.app,
        snapshot: options.snapshot,
        identifier: options.identifier,
        request: options.request,
        body: options.body,
        module: target.definition
    });
};

export const resolveModuleSocketRequest = async (options: {
    app: SharedDevRegistration;
    snapshot: SharedDevSnapshot;
    moduleId: string;
    channel: string;
    payload?: Record<string, unknown>;
    identifier?: string | null;
    clientType?: string;
    requesterModuleId?: string | null;
}) => {
    const loadedModules = await loadAppDevtoolsModules(options.app, options.snapshot);
    const target = loadedModules.find((module) => module.definition.id === options.moduleId);
    if (!target || !canAccessModule(options.requesterModuleId ?? undefined, target)) {
        return null;
    }

    const handler = target.socketHandlers[options.channel];
    if (!handler) {
        return null;
    }

    return handler({
        app: options.app,
        snapshot: options.snapshot,
        identifier: options.identifier,
        clientType: options.clientType,
        payload: options.payload,
        module: target.definition
    });
};

export const readModuleAsset = async (
    app: SharedDevRegistration,
    snapshot: SharedDevSnapshot,
    moduleId: string,
    asset: "style" | "script"
) => {
    const loadedModules = await loadAppDevtoolsModules(app, snapshot);
    const target = loadedModules.find((module) => module.definition.id === moduleId);
    const targetPath = asset === "style" ? target?.stylePath : target?.scriptPath;

    if (!targetPath || !fs.existsSync(targetPath)) {
        return null;
    }

    return fs.readFileSync(targetPath);
};
