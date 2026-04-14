import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { exceptionHandler } from "../exceptions/exception_handler.js";
import { findScriptEntry, importModule, toPosixPath, walkDirectory } from "../utils/fs.js";
import type { ZeruxConfig } from "../index.js";
import { initializeDatabaseRuntime } from "./database.js";
import type {
    BootstrapResult,
    DiscoveredRoute,
    LoadedModule,
    MiddlewareFunction,
    RegisteredRouteInput,
    ResolvedStructure,
    RouteHandler,
    RuntimeMode,
    ZeruxPluginApi,
    ZeruxRequestContext,
    ZeruxRuntime
} from "./types.js";
import { logger } from "./logger.js";
import { isAllowedHost } from "../utils/host.js";

type HttpMethod = "ALL" | "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT";

const HTTP_METHODS: HttpMethod[] = [
    "ALL",
    "DELETE",
    "GET",
    "HEAD",
    "OPTIONS",
    "PATCH",
    "POST",
    "PUT"
];

const RESERVED_ROUTE_FILE_NAMES = new Set(["layout", "loading", "template", "error"]);

const MIME_TYPES: Record<string, string> = JSON.parse(
    fs.readFileSync(new URL("../../assets/json/mime.json", import.meta.url), "utf-8")
);

const looksLikeHtml = (value: string) => {
    const trimmed = value.trimStart().toLowerCase();
    return (
        trimmed.startsWith("<!doctype html") ||
        trimmed.startsWith("<html") ||
        trimmed.startsWith("<body") ||
        trimmed.startsWith("<main") ||
        trimmed.startsWith("<section") ||
        trimmed.startsWith("<div")
    );
};

const normalizeMethod = (value?: string) => (value ? value.toUpperCase() : "GET");

const asArray = <T>(value: T | T[] | undefined): T[] => {
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
};

const toKey = (rootDir: string, absolutePath: string) => {
    const relativePath = toPosixPath(path.relative(rootDir, absolutePath));
    return relativePath.replace(/\.[^.]+$/, "");
};

const extractModuleValue = <T>(loaded: any, fallbacks: string[]): T | null => {
    for (const fallback of fallbacks) {
        if (loaded[fallback] !== undefined) {
            return loaded[fallback] as T;
        }
    }

    return null;
};

const sanitizePathname = (pathname: string) => {
    if (!pathname || pathname === "/") return "/";
    const normalized = pathname.replace(/\/+/g, "/");
    return normalized.endsWith("/") && normalized !== "/" ? normalized.slice(0, -1) : normalized;
};

const getContentType = (filePath: string) => {
    const extParts = path.extname(filePath).toLowerCase();
    const lookupKey = extParts.startsWith(".") ? extParts.slice(1) : extParts;
    return MIME_TYPES[lookupKey] || "application/octet-stream";
};

const readRequestBody = async (req: IncomingMessage) =>
    new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];

        req.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });

const sendResponse = (res: ServerResponse, payload: unknown, statusCode = 200) => {
    if (res.writableEnded) return;

    if (payload === undefined) {
        res.statusCode = statusCode;
        res.end();
        return;
    }

    if (Buffer.isBuffer(payload)) {
        res.statusCode = statusCode;
        res.end(payload);
        return;
    }

    if (typeof payload === "string") {
        res.statusCode = statusCode;
        res.setHeader(
            "Content-Type",
            looksLikeHtml(payload) ? "text/html; charset=utf-8" : "text/plain; charset=utf-8"
        );
        res.end(payload);
        return;
    }

    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
};

const routePathFromFile = (appDir: string, filePath: string) => {
    const relativePath = toPosixPath(path.relative(appDir, filePath));
    const parsed = path.parse(relativePath);
    const parts = parsed.dir ? parsed.dir.split("/") : [];

    if (!RESERVED_ROUTE_FILE_NAMES.has(parsed.name)) {
        parts.push(parsed.name);
    }

    const segments = parts
        .filter(Boolean)
        .map((segment) => {
            if (segment === "index" || segment === "page" || segment === "route") return null;
            if (segment.startsWith("[...") && segment.endsWith("]")) {
                return `:${segment.slice(4, -1)}*`;
            }
            if (segment.startsWith("[") && segment.endsWith("]")) {
                return `:${segment.slice(1, -1)}`;
            }
            return segment;
        })
        .filter((segment): segment is string => Boolean(segment));

    return segments.length ? `/${segments.join("/")}` : "/";
};

const compileRoutePattern = (pattern: string) => {
    const sanitized = sanitizePathname(pattern);
    if (sanitized === "/") {
        return {
            regex: /^\/$/,
            keys: [] as string[]
        };
    }

    const keys: string[] = [];
    const source = sanitized
        .split("/")
        .filter(Boolean)
        .map((segment) => {
            if (segment.startsWith(":") && segment.endsWith("*")) {
                const key = segment.slice(1, -1);
                keys.push(key);
                return `(?<${key}>.+)`;
            }

            if (segment.startsWith(":")) {
                const key = segment.slice(1);
                keys.push(key);
                return `(?<${key}>[^/]+)`;
            }

            return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("/");

    return {
        regex: new RegExp(`^/${source}$`),
        keys
    };
};

const serveStaticFile = (res: ServerResponse, filePath: string) => {
    const content = fs.readFileSync(filePath);
    res.statusCode = 200;
    res.setHeader("Content-Type", getContentType(filePath));
    res.setHeader("Content-Length", content.length);
    res.end(content);
};

const loadModulesFromDirectories = async <T = any>(
    rootDir: string,
    directories: string[],
    mode: RuntimeMode
): Promise<LoadedModule<T>[]> => {
    const loadedModules: LoadedModule<T>[] = [];

    for (const directoryPath of directories) {
        for (const filePath of walkDirectory(directoryPath)) {
            const exports = (await importModule(filePath, mode)) as T;
            loadedModules.push({
                key: toKey(rootDir, filePath),
                absolutePath: filePath,
                relativePath: toPosixPath(path.relative(rootDir, filePath)),
                exports
            });
        }
    }

    return loadedModules;
};

const collectPublicFiles = (rootDir: string, publicDirs: string[]) => {
    const publicFiles = new Map<string, string>();

    for (const publicDir of publicDirs) {
        if (!fs.existsSync(publicDir) || !fs.statSync(publicDir).isDirectory()) continue;

        const stack = [publicDir];
        while (stack.length) {
            const currentDir = stack.pop()!;
            for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
                const absolutePath = path.join(currentDir, entry.name);
                if (entry.isDirectory()) {
                    stack.push(absolutePath);
                    continue;
                }

                const relativePath = toPosixPath(path.relative(publicDir, absolutePath));
                publicFiles.set(`/${relativePath}`, absolutePath);
            }
        }
    }

    return publicFiles;
};

const resolveHandlerReference = (
    reference: unknown,
    controllers: Map<string, unknown>
): RouteHandler | null => {
    if (typeof reference === "function") {
        return reference as RouteHandler;
    }

    if (typeof reference !== "string") return null;

    const [controllerKey, actionName] = reference.split("#");
    const controller = controllers.get(controllerKey);
    if (!controller) return null;

    if (!actionName && typeof controller === "function") {
        return controller as RouteHandler;
    }

    if (controller && typeof controller === "object" && actionName) {
        const action = (controller as Record<string, unknown>)[actionName];
        if (typeof action === "function") {
            return action as RouteHandler;
        }
    }

    return null;
};

const discoverRoutes = async (
    rootDir: string,
    appDir: string | null,
    mode: RuntimeMode,
    middleware: Map<string, MiddlewareFunction>,
    controllers: Map<string, unknown>
): Promise<DiscoveredRoute[]> => {
    if (!appDir || !fs.existsSync(appDir) || !fs.statSync(appDir).isDirectory()) {
        return [];
    }

    const routes: DiscoveredRoute[] = [];

    for (const filePath of walkDirectory(appDir)) {
        const relativePath = path.relative(appDir, filePath);
        if (relativePath.startsWith("middleware") || relativePath.startsWith("controllers") || relativePath.startsWith("composables")) {
            continue;
        }

        const loaded = await importModule(filePath, mode);
        const declaredPattern =
            typeof loaded.routePath === "string" ? loaded.routePath :
                typeof loaded.path === "string" ? loaded.path :
                    routePathFromFile(appDir, filePath);

        const methods: Partial<Record<string, RouteHandler>> = {};
        for (const method of HTTP_METHODS) {
            const handler = loaded[method];
            if (typeof handler === "function") {
                methods[method] = handler as RouteHandler;
            }
        }

        const directHandler = extractModuleValue<RouteHandler | string>(loaded, [
            "default",
            "handler",
            "route"
        ]);

        if (Object.keys(methods).length === 0 && directHandler !== null) {
            const resolved = resolveHandlerReference(directHandler, controllers);
            if (resolved) {
                methods.ALL = resolved;
            }
        }

        if (Object.keys(methods).length === 0 && typeof loaded.controller === "string") {
            const resolved = resolveHandlerReference(loaded.controller, controllers);
            if (resolved) {
                const method = normalizeMethod(loaded.method);
                methods[method] = resolved;
            }
        }

        const routeMiddleware = asArray<string>(loaded.middleware).filter((name) => middleware.has(name));
        if (Object.keys(methods).length === 0) continue;

        routes.push({
            id: toKey(rootDir, filePath),
            absolutePath: filePath,
            relativePath: toPosixPath(path.relative(rootDir, filePath)),
            pattern: sanitizePathname(declaredPattern),
            methods,
            middleware: routeMiddleware,
            meta: typeof loaded.meta === "object" ? loaded.meta : undefined
        });
    }

    return routes.sort((left, right) => left.pattern.localeCompare(right.pattern));
};

const matchRoute = (routes: DiscoveredRoute[], pathname: string, method: string) => {
    const normalizedPathname = sanitizePathname(pathname);

    for (const route of routes) {
        const compiled = compileRoutePattern(route.pattern);
        const match = compiled.regex.exec(normalizedPathname);
        if (!match) continue;

        const handler = route.methods[method] || route.methods.ALL;
        if (!handler) {
            return {
                route,
                params: match.groups ?? {},
                handler: null
            };
        }

        return {
            route,
            params: match.groups ?? {},
            handler
        };
    }

    return null;
};

const createRuntime = async (
    rootDir: string,
    mode: RuntimeMode,
    config: ZeruxConfig,
    structure: ResolvedStructure
): Promise<ZeruxRuntime> => {
    const middleware = new Map<string, MiddlewareFunction>();
    const controllers = new Map<string, unknown>();
    const composables = new Map<string, unknown>();
    const routes: DiscoveredRoute[] = [];
    const publicFiles = collectPublicFiles(rootDir, structure.publicDirs);

    const middlewareModules = await loadModulesFromDirectories(rootDir, structure.middlewareDirs, mode);
    for (const module of middlewareModules) {
        const fn = extractModuleValue<MiddlewareFunction>(module.exports, [
            "default",
            "middleware",
            "handle"
        ]);

        if (typeof fn === "function") {
            middleware.set(module.key, fn);
            const shortKey = path.basename(module.key);
            middleware.set(shortKey, fn);
        }
    }

    const controllerModules = await loadModulesFromDirectories(rootDir, structure.controllerDirs, mode);
    for (const module of controllerModules) {
        const exported = module.exports.default ?? module.exports;
        controllers.set(module.key, exported);
        controllers.set(path.basename(module.key), exported);
    }

    const composableModules = await loadModulesFromDirectories(rootDir, structure.composableDirs, mode);
    for (const module of composableModules) {
        const exported = module.exports.default ?? module.exports;
        composables.set(module.key, exported);
        composables.set(path.basename(module.key), exported);
    }

    let runtime!: ZeruxRuntime;

    const pluginApi: ZeruxPluginApi = {
        addRoute(route) {
            const normalizedMethod = normalizeMethod(route.method);
            const existing = routes.find((item) => item.pattern === sanitizePathname(route.pattern));
            const handler = route.handler;

            if (existing) {
                existing.methods[normalizedMethod] = handler;
                existing.middleware = [...new Set([...existing.middleware, ...asArray(route.middleware)])];
                existing.meta = { ...(existing.meta ?? {}), ...(route.meta ?? {}) };
                return;
            }

            routes.push({
                id: route.source ?? `inline:${route.pattern}:${normalizedMethod}`,
                absolutePath: route.source ?? route.pattern,
                relativePath: route.source ?? route.pattern,
                pattern: sanitizePathname(route.pattern),
                methods: { [normalizedMethod]: handler },
                middleware: asArray(route.middleware),
                meta: route.meta
            });
        },
        removeRoute(pattern, method) {
            const normalizedPattern = sanitizePathname(pattern);
            const index = routes.findIndex((route) => route.pattern === normalizedPattern);
            if (index === -1) return;

            if (!method) {
                routes.splice(index, 1);
                return;
            }

            delete routes[index].methods[normalizeMethod(method)];
            if (Object.keys(routes[index].methods).length === 0) {
                routes.splice(index, 1);
            }
        },
        addMiddleware(name, value) {
            middleware.set(name, value);
        },
        removeMiddleware(name) {
            middleware.delete(name);
        },
        setComposable(name, value) {
            composables.set(name, value);
        },
        setController(name, value) {
            controllers.set(name, value);
        },
        getConfig() {
            return config;
        },
        getStructure() {
            return structure;
        }
    };

    for (const pluginDir of structure.pluginDirs) {
        if (!fs.existsSync(pluginDir)) continue;

        const stat = fs.statSync(pluginDir);
        const pluginFiles = stat.isDirectory()
            ? [
                ...walkDirectory(pluginDir),
                ...fs.readdirSync(pluginDir)
                    .map((name) => path.join(pluginDir, name))
                    .filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory())
                    .map((directory) => findScriptEntry(directory))
                    .filter((candidate): candidate is string => Boolean(candidate))
            ]
            : [pluginDir];

        for (const pluginFile of [...new Set(pluginFiles)]) {
            const pluginModule = await importModule(pluginFile, mode);
            const registerPlugin = extractModuleValue<
                ((api: ZeruxPluginApi) => Promise<void> | void)
            >(pluginModule, ["default", "register", "plugin"]);

            if (typeof registerPlugin === "function") {
                await registerPlugin(pluginApi);
            }
        }
    }

    const discoveredRoutes = await discoverRoutes(rootDir, structure.appDir, mode, middleware, controllers);
    routes.push(...discoveredRoutes);

    const entryModulePath = findScriptEntry(rootDir, structure.entryPointName);
    if (entryModulePath) {
        const entryModule = await importModule(entryModulePath, mode);
        const registerEntry = extractModuleValue<
            ((api: ZeruxPluginApi) => Promise<void> | void)
        >(entryModule, ["default", "register", "setup", "boot"]);

        if (typeof registerEntry === "function") {
            await registerEntry(pluginApi);
        }
    }

    runtime = {
        rootDir,
        mode,
        config,
        structure,
        logger,
        middleware,
        controllers,
        composables,
        routes,
        publicFiles,
        entryModulePath,
        createHandler() {
            return async (req: IncomingMessage, res: ServerResponse) => {
                const host = req.headers.host || "";
                const allowedDomains = config.server?.allowedDomains ?? config.allowedDomains ?? [];
                const allowedDevDomain = config.server?.allowedDevDomain ?? config.allowedDevDomain;

                if (!isAllowedHost(host, allowedDomains, allowedDevDomain)) {
                    const message = `Access from unallowed host "${host}" is restricted. Please add it to "allowedDomains" in your zerux.config.ts if this is intended.`;
                    if (mode === "dev") {
                        logger.error(message);
                        sendResponse(res, { error: "Unallowed Host", message }, 400);
                        return;
                    } else {
                        logger.error(`Access from unallowed host "${host}" ignored.`);
                        res.destroy();
                        return;
                    }
                }

                try {
                    const url = new URL(req.url || "/", "http://127.0.0.1");
                    const pathname = sanitizePathname(url.pathname);
                    const staticFile = publicFiles.get(pathname);

                    if (staticFile) {
                        serveStaticFile(res, staticFile);
                        return;
                    }

                    const method = normalizeMethod(req.method);
                    const match = matchRoute(routes, pathname, method);

                    if (!match) {
                        sendResponse(res, {
                            message: `Route not found for ${method} ${pathname}`
                        }, 404);
                        return;
                    }

                    if (!match.handler) {
                        sendResponse(res, {
                            message: `Method ${method} not allowed on ${match.route.pattern}`
                        }, 405);
                        return;
                    }

                    const contentType = req.headers["content-type"] || "";
                    let body: unknown = undefined;
                    if (req.method && !["GET", "HEAD"].includes(req.method.toUpperCase())) {
                        const rawBody = await readRequestBody(req);
                        if (rawBody.length > 0) {
                            body = contentType.includes("application/json")
                                ? JSON.parse(rawBody.toString("utf-8"))
                                : rawBody.toString("utf-8");
                        }
                    }

                    const context: ZeruxRequestContext = {
                        req,
                        res,
                        method,
                        url,
                        pathname,
                        params: match.params,
                        query: url.searchParams,
                        body,
                        logger,
                        config,
                        runtime,
                        state: {},
                        env: process.env,
                        services: {
                            controllers: Object.fromEntries(controllers.entries()),
                            composables: Object.fromEntries(composables.entries())
                        }
                    };

                    const middlewareStack = match.route.middleware
                        .map((name) => middleware.get(name))
                        .filter((fn): fn is MiddlewareFunction => Boolean(fn));

                    let index = -1;
                    const dispatch = async (cursor: number): Promise<void> => {
                        if (cursor <= index) {
                            throw new Error("next() called multiple times");
                        }

                        index = cursor;
                        const current = middlewareStack[cursor];
                        if (current) {
                            await current(context, () => dispatch(cursor + 1));
                            return;
                        }

                        const result = await match.handler!(context);
                        if (!res.writableEnded) {
                            sendResponse(res, result);
                        }
                    };

                    await dispatch(0);
                } catch (error) {
                    const normalized = exceptionHandler(error);
                    if (!res.writableEnded) {
                        sendResponse(res, normalized.body, normalized.status);
                    }
                }
            };
        },
        asPluginApi() {
            return pluginApi;
        },
        toManifest() {
            return {
                generatedAt: new Date().toISOString(),
                mode,
                rootDir,
                entryModulePath,
                config,
                structure: {
                    ...structure,
                    rootDir: undefined,
                    raw: structure.raw
                },
                middleware: [...middleware.keys()].sort(),
                controllers: [...controllers.keys()].sort(),
                composables: [...composables.keys()].sort(),
                routes: routes.map((route) => ({
                    id: route.id,
                    path: route.pattern,
                    file: route.relativePath,
                    methods: Object.keys(route.methods).sort(),
                    middleware: route.middleware
                })),
                publicFiles: [...publicFiles.keys()].sort()
            };
        }
    };

    return runtime;
};

export const bootstrapApplication = async (
    rootDir: string,
    mode: RuntimeMode,
    config: ZeruxConfig,
    structure: ResolvedStructure
): Promise<BootstrapResult> => {
    await initializeDatabaseRuntime(config);
    const runtime = await createRuntime(rootDir, mode, config, structure);

    return {
        config,
        structure,
        runtime,
        manifestPath: ""
    };
};
