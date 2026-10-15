import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { exceptionHandler } from "../exceptions/exception_handler.js";
import { findScriptEntry, importModule, toPosixPath, walkDirectory } from "../utils/fs.js";
import type { ZeruxConfig } from "../index.js";
import { isRedirectResponse } from "../navigation.js";
import { getResolvedTheme, getThemeConfig, getThemeMode } from "../theme.js";
import { initializeRuntimeServices, type RuntimeServiceScope } from "./services.js";
import { registerServiceHttpRoutes, serviceRouteOverlaps } from "./service-http.js";
import { redactManifestConfig } from "./manifest-config.js";
import { createZeruxProtocols, type ZeruxProtocols } from "../protocols.js";
import { ApplicationHttpMetrics } from "../metrics.js";
import { createVariableRegistry } from "../variables.js";
import type { ServiceInitializers } from "./services.js";
import { applyCachePolicy, isCached, isStream, conditionalEtag, sendStream, stream } from "../response.js";
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
import { isAllowedHost, isLocalHost } from "../utils/host.js";
import { normalizeThreadWorker, normalizeWorker, ThreadWorkerPool } from "./worker.js";

type HttpMethod = "ALL" | "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT";

interface MultisiteRegistration {
    url: string;
    folderName: string;
    host: string;
    pathname: string;
    pathSize: number;
    order: number;
}

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

const normalizeHost = (host: string) => host.split(":")[0].toLowerCase();

const getMultisiteHostPriority = (host: string) => {
    if (host === "*") return 0;
    if (host.startsWith("*.")) return 1;
    return 2;
};

const countPathSegments = (pathname: string) => sanitizePathname(pathname).split("/").filter(Boolean).length;

const normalizeMultisiteFolder = (folderName: string) => {
    const normalized = folderName.trim().replace(/^\/+|\/+$/g, "");

    if (!normalized || normalized.includes("/") || normalized === "." || normalized === "..") {
        throw new Error(`Invalid multisite folder name "${folderName}". Use a single root app folder segment.`);
    }

    if (!/^[a-zA-Z0-9._~\{\}\[\]\-]+$/.test(normalized)) {
        throw new Error(`Invalid multisite folder name "${folderName}". Use URL-safe characters only.`);
    }

    return normalized;
};

const parseMultisiteUrl = (value: string) => {
    const input = value.trim();
    if (!input) {
        throw new Error("multisiteRegister requires a non-empty url.");
    }

    const url = new URL(input.includes("://") ? input : `http://${input}`);

    return {
        host: normalizeHost(url.host),
        pathname: sanitizePathname(url.pathname)
    };
};

const createMultisiteRegistration = (
    url: string,
    folderName: string,
    order: number
): MultisiteRegistration => {
    const parsed = parseMultisiteUrl(url);

    return {
        url,
        folderName: normalizeMultisiteFolder(folderName),
        host: parsed.host,
        pathname: parsed.pathname,
        pathSize: countPathSegments(parsed.pathname),
        order
    };
};

const matchesMultisitePath = (registeredPath: string, pathname: string) => {
    if (registeredPath === "/") return true;
    return pathname === registeredPath || pathname.startsWith(`${registeredPath}/`);
};

const matchesMultisiteHost = (registeredHost: string, host: string) => {
    if (registeredHost === "*") return true;

    if (registeredHost.startsWith("*.")) {
        const suffix = registeredHost.slice(1);
        return host.endsWith(suffix) && host.length > suffix.length;
    }

    return registeredHost === host;
};

const applyMultisitePath = (
    host: string,
    pathname: string,
    registrations: MultisiteRegistration[]
) => {
    const normalizedHost = normalizeHost(host);
    const normalizedPathname = sanitizePathname(pathname);
    const match = [...registrations]
        .sort((left, right) =>
            right.pathSize - left.pathSize ||
            right.pathname.length - left.pathname.length ||
            getMultisiteHostPriority(right.host) - getMultisiteHostPriority(left.host) ||
            left.order - right.order
        )
        .find((registration) =>
            matchesMultisiteHost(registration.host, normalizedHost) &&
            matchesMultisitePath(registration.pathname, normalizedPathname)
        );

    if (!match) {
        return null;
    }

    const suffix = match.pathname === "/"
        ? normalizedPathname
        : normalizedPathname.slice(match.pathname.length);

    return {
        registration: match,
        pathname: sanitizePathname(`/${match.folderName}${suffix === "/" ? "" : suffix}`)
    };
};

const isRootDynamicRoute = (route: DiscoveredRoute) => {
    const [firstSegment] = route.pattern.split("/").filter(Boolean);
    return Boolean(firstSegment?.startsWith(":"));
};

const getContentType = (filePath: string) => {
    const extParts = path.extname(filePath).toLowerCase();
    const lookupKey = extParts.startsWith(".") ? extParts.slice(1) : extParts;
    return MIME_TYPES[lookupKey] || "application/octet-stream";
};

const MAX_REQUEST_BODY_BYTES = 1024 * 1024; // Default limit: 1 MiB.
const readRequestBody = async (req: IncomingMessage): Promise<Buffer> =>
    new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let settled = false;
        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            reject(error);
        };
        const declaredLength = Number(req.headers["content-length"]);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
            fail(Object.assign(new Error("Request body exceeds 1 MiB"), { statusCode: 413 }));
            req.resume();
            return;
        }
        req.on("data", (chunk: Buffer | string) => {
            if (settled) return;
            const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += data.length;
            if (size > MAX_REQUEST_BODY_BYTES) {
                fail(Object.assign(new Error("Request body exceeds 1 MiB"), { statusCode: 413 }));
                req.pause();
                return;
            }
            chunks.push(data);
        });
        req.on("end", () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks, size)); } });
        req.on("error", fail);
        req.on("aborted", () => fail(new Error("Request aborted")));
    });

const presetHtmlTheme = (html: string, mode: string, resolvedColorScheme: "light" | "dark"): string => {
    const htmlMatch = html.match(/<html\b([^>]*)>/i);
    if (!htmlMatch) return html;

    let attrs = htmlMatch[1];
    const themeClasses = mode === "system" ? ["system", resolvedColorScheme] : [mode];

    const classMatch = attrs.match(/class=(['"])(.*?)\1/i);
    if (classMatch) {
        const quote = classMatch[1];
        const existingClasses = classMatch[2].split(/\s+/).filter((item) =>
            item && item !== "light" && item !== "dark" && item !== "system"
        );
        const newClassAttr = `class=${quote}${[...existingClasses, ...themeClasses].join(" ")}${quote}`;
        attrs = attrs.replace(/class=(['"])(.*?)\1/i, newClassAttr);
    } else {
        attrs += ` class="${themeClasses.join(" ")}"`;
    }

    const styleMatch = attrs.match(/style=(['"])(.*?)\1/i);
    if (styleMatch) {
        const quote = styleMatch[1];
        const existingStyle = styleMatch[2]
            .replace(/color-scheme\s*:\s*[^;]+;?/gi, "")
            .trim()
            .replace(/;?$/, ";")
            .replace(/^;$/, "");
        const style = `${existingStyle ? `${existingStyle} ` : ""}color-scheme: ${resolvedColorScheme};`;
        const newStyleAttr = `style=${quote}${style}${quote}`;
        attrs = attrs.replace(/style=(['"])(.*?)\1/i, newStyleAttr);
    } else {
        attrs += ` style="color-scheme: ${resolvedColorScheme};"`;
    }

    return html.replace(/<html\b[^>]*>/i, `<html ${attrs.trim()}>`);
};

const processThemeHtml = (html: string, context: ZeruxRequestContext): string => {
    const themeConfig = getThemeConfig(context.config);
    const mode = getThemeMode(context);
    const colorScheme = getResolvedTheme(mode, context);
    let updatedHtml = presetHtmlTheme(html, mode, colorScheme);
    const scriptContent = `(function(){var name=${JSON.stringify(themeConfig.cookieName)},def=${JSON.stringify(themeConfig.default)},theme=def,cookies=document.cookie.split(";");for(var i=0;i<cookies.length;i++){var c=cookies[i].trim();if(c.indexOf(name+"=")===0){theme=decodeURIComponent(c.substring(name.length+1));break}}if(theme!=="light"&&theme!=="dark"&&theme!=="system")theme=def;var doc=document.documentElement;function apply(){var resolved=theme==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":theme==="dark"?"dark":"light";doc.classList.remove("light","dark","system");doc.classList.add(theme);if(theme==="system")doc.classList.add(resolved);doc.style.colorScheme=resolved}apply();if(window.matchMedia){var media=window.matchMedia("(prefers-color-scheme: dark)");var listener=function(){if(theme==="system")apply()};if(media.addEventListener)media.addEventListener("change",listener);else if(media.addListener)media.addListener(listener)}})();`;
    const scriptAttrs = [
        themeConfig.scriptType === "module" ? `type="module"` : "nomodule",
        themeConfig.scriptLoadType
    ];
    const scriptTag = `<script ${scriptAttrs.join(" ")}>${scriptContent}</script>`;

    if (themeConfig.scriptPosition === "head") {
        updatedHtml = updatedHtml.replace(/(<head\b[^>]*>)/i, `$1${scriptTag}`);
    } else if (themeConfig.scriptPosition === "body-top") {
        updatedHtml = updatedHtml.replace(/(<body\b[^>]*>)/i, `$1${scriptTag}`);
    } else {
        updatedHtml = updatedHtml.replace(/(<\/body>)/i, `${scriptTag}$1`);
    }

    return updatedHtml;
};

const setThemePreferenceHeaders = (res: ServerResponse, config: ZeruxConfig) => {
    const themeConfig = getThemeConfig(config);
    if (themeConfig.disablePrefrenceHeader || res.headersSent) return;

    const preferenceHeader = "Sec-CH-Prefers-Color-Scheme";
    const currentVary = res.getHeader("Vary");
    const varyValues = new Set(
        (Array.isArray(currentVary) ? currentVary.join(",") : String(currentVary ?? ""))
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
    );

    varyValues.add(preferenceHeader);
    res.setHeader("Accept-CH", preferenceHeader);
    res.setHeader("Critical-CH", preferenceHeader);
    res.setHeader("Vary", [...varyValues].join(", "));
    res.setHeader("Permissions-Policy", "ch-prefers-color-scheme=*");
};

const sendResponse = (res: ServerResponse, payload: unknown, statusCode = 200, context?: ZeruxRequestContext) => {
    if (res.writableEnded) return;

    if (isCached(payload)) {
        applyCachePolicy(res, payload.policy);
        if (payload.policy.etag && context) {
            const data = payload.value;
            if (!isStream(data) && !isRedirectResponse(data) && data !== undefined) {
                const bytes = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
                if (conditionalEtag(context.req, res, bytes)) return;
            }
        }
        payload = payload.value;
    }
    if (isStream(payload)) { sendStream(res, payload, context?.req); return; }
    if (isRedirectResponse(payload)) {
        res.setHeader("Location", payload.location);
        res.writeHead(payload.statusCode);
        res.end();
        return;
    }

    if (payload === undefined) {
        res.statusCode = statusCode;
        res.end();
        return;
    }

    if (Buffer.isBuffer(payload)) {
        res.statusCode = statusCode;
        if (context?.req.method === 'HEAD') { res.setHeader('Content-Length', payload.byteLength); res.end(); }
        else res.end(payload);
        return;
    }

    if (typeof payload === "string") {
        let finalPayload = payload;
        if (context && looksLikeHtml(payload)) {
            try {
                finalPayload = processThemeHtml(payload, context);
            } catch (err) {
                // fallback to original payload on error
            }
        }
        res.statusCode = statusCode;
        res.setHeader(
            "Content-Type",
            looksLikeHtml(finalPayload) ? "text/html; charset=utf-8" : "text/plain; charset=utf-8"
        );
        if (context?.req.method === 'HEAD') { res.setHeader('Content-Length', Buffer.byteLength(finalPayload)); res.end(); }
        else res.end(finalPayload);
        return;
    }

    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const serialized = JSON.stringify(payload);
    if (context?.req.method === 'HEAD') { res.setHeader('Content-Length', Buffer.byteLength(serialized)); res.end(); }
    else res.end(serialized);
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

            if (segment.startsWith("{") && segment.endsWith("}")) {
                const folder = segment.slice(1, -1);
                const literal = segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const publicSegment = folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                return `(?:${literal}|${publicSegment})`;
            }

            return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("/");

    return {
        regex: new RegExp(`^/${source}$`),
        keys
    };
};

const getRoutePriority = (route: DiscoveredRoute) => {
    const segments = route.pattern.split("/").filter(Boolean);
    const staticSegments = segments.filter((segment) => !segment.startsWith(":")).length;
    const wildcardSegments = segments.filter((segment) => segment.startsWith(":") && segment.endsWith("*")).length;

    return {
        segmentCount: segments.length,
        staticSegments,
        wildcardSegments
    };
};

const sortRoutes = (routes: DiscoveredRoute[]) =>
    routes.sort((left, right) => {
        const leftPriority = getRoutePriority(left);
        const rightPriority = getRoutePriority(right);

        return (
            rightPriority.segmentCount - leftPriority.segmentCount ||
            rightPriority.staticSegments - leftPriority.staticSegments ||
            leftPriority.wildcardSegments - rightPriority.wildcardSegments ||
            left.pattern.localeCompare(right.pattern)
        );
    });

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

        const routeMiddleware = asArray<string>(loaded.middleware);
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

    return sortRoutes(routes);
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
    structure: ResolvedStructure,
    serviceScope: RuntimeServiceScope
): Promise<ZeruxRuntime> => {
    const middleware = new Map<string, MiddlewareFunction>();
    const globalMiddleware: string[] = [];
    const controllers = new Map<string, unknown>();
    const composables = new Map<string, unknown>();
    const workers = new Map<string, ReturnType<typeof normalizeWorker>>();
    const workerState = new Map<string, unknown>();
    const threadWorkers = new Map<string, ThreadWorkerPool>();
    const routes: DiscoveredRoute[] = [];
    const publicFiles = collectPublicFiles(rootDir, structure.publicDirs);
    const multisiteEnabled = config.multisite === true;
    const httpMetrics = new ApplicationHttpMetrics();
    // Each generation owns its registered template values; the global singleton
    // is only a backwards-compatible convenience, never an app boundary.
    const variableRegistry = createVariableRegistry();
    let routesSealed = false;
    let appProtocols: ZeruxProtocols | undefined;
    const protocols = () => {
        if (config.protocols?.enabled === false) throw new Error('Application protocols are disabled');
        return appProtocols ??= createZeruxProtocols(config.protocols);
    };

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
            globalMiddleware.push(shortKey);
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
        protocols,
        service: (name) => serviceScope.get(name),
        variables: () => variableRegistry,
        getLoadStatus: (windowMs) => httpMetrics.snapshot(windowMs),
        addRoute(route) {
            if (!route || typeof route.pattern !== 'string' || !route.pattern.startsWith('/') ||
                typeof route.handler !== 'function') throw new TypeError('Invalid application route');
            const normalizedMethod = normalizeMethod(route.method);
            if (!HTTP_METHODS.includes(normalizedMethod as HttpMethod)) throw new TypeError('Unsupported HTTP method');
            if (routesSealed && serviceScope.httpRoutes().some(item => serviceRouteOverlaps(item.pattern, sanitizePathname(route.pattern)))) {
                throw new Error(`Reserved service endpoint cannot be replaced: ${route.pattern}`);
            }
            const existing = routes.find((item) => item.pattern === sanitizePathname(route.pattern));
            const handler = route.handler;

            if (existing) {
                if (existing.id.startsWith('service:') && route.source !== existing.id) {
                    throw new Error(`Cannot replace reserved service route: ${route.pattern}`);
                }
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
            if (routesSealed && serviceScope.httpRoutes().some(item => serviceRouteOverlaps(item.pattern, normalizedPattern))) {
                throw new Error(`Cannot remove reserved service route: ${pattern}`);
            }
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
        addWorker(name, worker) {
            workers.set(name, normalizeWorker(name, worker));
        },
        removeWorker(name) {
            workers.delete(name);
        },
        getWorker(name) {
            return workers.get(name);
        },
        getWorkers() {
            return [...workers.values()];
        },
        addThreadWorker(name, worker) {
            const normalizedWorker = normalizeThreadWorker(name, worker);
            threadWorkers.set(name, new ThreadWorkerPool({
                rootDir,
                mode,
                config,
                logger,
                serviceName: structure.serviceName,
                worker: normalizedWorker
            }));
        },
        removeThreadWorker(name) {
            threadWorkers.delete(name);
        },
        getThreadWorker(name) {
            return threadWorkers.get(name);
        },
        getThreadWorkers() {
            return [...threadWorkers.values()];
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

    // Reserved Fetch endpoints belong to this generation, with collision protection.
    registerServiceHttpRoutes(pluginApi, serviceScope, [...routes.map(route => route.pattern), ...publicFiles.keys()]);
    routesSealed = true;

    runtime = {
        rootDir,
        mode,
        config,
        structure,
        logger,
        middleware,
        controllers,
        composables,
        workers,
        workerState,
        threadWorkers,
        routes,
        publicFiles,
        entryModulePath,
        get protocolGateway() { return appProtocols?.gateway; },
        closeProtocols() { appProtocols?.close(); },
        serviceScope,
        variables: variableRegistry,
        closeServices() { variableRegistry.clear(); return serviceScope.close(); },
        getLoadStatus(windowMs) { return httpMetrics.snapshot(windowMs); },
        createHandler() {
            return async (req: IncomingMessage, res: ServerResponse) => {
                httpMetrics.track(req, res);
                const host = req.headers.host || "";
                const allowedDomains = config.server?.allowedDomains ?? config.allowedDomains ?? [];
                const allowedDevDomain = config.server?.allowedDevDomain ?? config.allowedDevDomain;
                setThemePreferenceHeaders(res, config);

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

                let context: ZeruxRequestContext | undefined;
                try {
                    const url = new URL(req.url || "/", "http://127.0.0.1");
                    const pathname = sanitizePathname(url.pathname);
                    if (appProtocols && await appProtocols.gateway.handle(req, res)) return;
                    const staticFile = publicFiles.get(pathname);

                    if (staticFile) {
                        serveStaticFile(res, staticFile);
                        return;
                    }

                    const method = normalizeMethod(req.method);
                    const contentType = req.headers["content-type"] || "";
                    let body: unknown = undefined;
                    const earlyRoute = matchRoute(sortRoutes(routes), pathname, method);
                    const internalServiceRequest = earlyRoute?.route.id.startsWith('service:') === true;
                    const streamBody = earlyRoute?.route.meta?.streamBody === true && (!multisiteEnabled || internalServiceRequest);
                    if (req.method && !["GET", "HEAD"].includes(req.method.toUpperCase()) && !streamBody) {
                        const rawBody = await readRequestBody(req);
                        if (rawBody.length > 0) {
                            body = contentType.includes("application/json")
                                ? JSON.parse(rawBody.toString("utf-8"))
                                : rawBody.toString("utf-8");
                        }
                    }

                    const multisiteRegistrations: MultisiteRegistration[] = [];
                    let multisiteRegistrationMissed = false;
                    const applyRegisteredMultisite = () => {
                        if (!multisiteEnabled || internalServiceRequest || multisiteRegistrations.length === 0) return;

                        const result = applyMultisitePath(host, pathname, multisiteRegistrations);
                        multisiteRegistrationMissed = !result;
                        if (!result || !context || result.pathname === context.pathname) return;

                        context.state.multisite = {
                            enabled: true,
                            originalPathname: pathname,
                            pathname: result.pathname,
                            url: result.registration.url,
                            folderName: result.registration.folderName
                        };
                        context.pathname = result.pathname;
                        context.url.pathname = result.pathname;
                    };

                    context = {
                        req,
                        res,
                        method,
                        url,
                        pathname,
                        params: {},
                        query: url.searchParams,
                        body: streamBody ? req : body,
                        requestStream: req,
                        setCache(policy) { applyCachePolicy(res, policy); },
                        stream,
                        multisiteRegister(registerUrl: string, folderName: string) {
                            if (!multisiteEnabled) return;
                            multisiteRegistrations.push(createMultisiteRegistration(
                                registerUrl,
                                folderName,
                                multisiteRegistrations.length
                            ));
                        },
                        logger,
                        config,
                        runtime,
                        state: {},
                        env: process.env,
                        services: {
                            get: name => serviceScope.get(name),
                            controllers: Object.fromEntries(controllers.entries()),
                            composables: Object.fromEntries(composables.entries())
                        }
                    };

                    const globalMiddlewareStack = [...new Set(globalMiddleware)]
                        .map((name) => middleware.get(name))
                        .filter((fn): fn is MiddlewareFunction => Boolean(fn));

                    let globalIndex = -1;
                    let passedGlobalMiddleware = false;
                    const dispatchGlobal = async (cursor: number): Promise<void> => {
                        applyRegisteredMultisite();

                        if (cursor <= globalIndex) {
                            throw new Error("next() called multiple times");
                        }

                        globalIndex = cursor;
                        const current = globalMiddlewareStack[cursor];
                        if (current) {
                            const result = await current(context!, () => dispatchGlobal(cursor + 1));
                            if (!res.writableEnded && result !== undefined) {
                                sendResponse(res, result, 200, context);
                            }
                            return;
                        }
                        passedGlobalMiddleware = true;
                    };

                    await dispatchGlobal(0);
                    if (!passedGlobalMiddleware) {
                        if (!res.headersSent && !res.writableEnded) sendResponse(res, {error: 'Forbidden'}, 403, context);
                        return;
                    }
                    applyRegisteredMultisite();

                    if (res.writableEnded) return;

                    const match = matchRoute(sortRoutes(routes), context.pathname, method);

                    if (!match) {
                        sendResponse(res, {
                            message: `Route not found for ${method} ${context.pathname}`
                        }, 404, context);
                        return;
                    }

                    if (multisiteRegistrationMissed && isRootDynamicRoute(match.route)) {
                        sendResponse(res, {
                            message: `Route not found for ${method} ${pathname}`
                        }, 404, context);
                        return;
                    }

                    if (!match.handler) {
                        sendResponse(res, {
                            message: `Method ${method} not allowed on ${match.route.pattern}`
                        }, 405, context);
                        return;
                    }

                    context.params = match.params;

                    const missingMiddleware = match.route.middleware.filter(name => !globalMiddleware.includes(name) && !middleware.has(name));
                    if (missingMiddleware.length) {
                        logger.error('Route references unregistered middleware', {path: match.route.pattern});
                        sendResponse(res, {error: 'Route middleware unavailable'}, 500, context);
                        return;
                    }
                    const routeMiddlewareStack = [...new Set(match.route.middleware)]
                        .filter((name) => !globalMiddleware.includes(name))
                        .map((name) => middleware.get(name))
                        .filter((fn): fn is MiddlewareFunction => Boolean(fn));

                    let routeIndex = -1;
                    const dispatchRoute = async (cursor: number): Promise<void> => {
                        if (cursor <= routeIndex) {
                            throw new Error("next() called multiple times");
                        }

                        routeIndex = cursor;
                        const current = routeMiddlewareStack[cursor];
                        if (current) {
                            const result = await current(context!, () => dispatchRoute(cursor + 1));
                            if (!res.writableEnded && result !== undefined) {
                                sendResponse(res, result, 200, context);
                            }
                            return;
                        }

                        const result = await match.handler!(context!);
                        if (!res.writableEnded) {
                            sendResponse(res, result, 200, context);
                        }
                    };

                    await dispatchRoute(0);
                } catch (error) {
                    const normalized = (error && typeof error === "object" && "statusCode" in error && error.statusCode === 413)
                        ? { status: 413, body: { error: "Payload Too Large" } }
                        : exceptionHandler(error);
                    if (!res.writableEnded) {
                        sendResponse(res, normalized.body, normalized.status, context);
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
                config: redactManifestConfig(config),
                services: serviceScope.status(),
                structure: {
                    ...structure,
                    rootDir: undefined,
                    raw: structure.raw
                },
                middleware: [...middleware.keys()].sort(),
                globalMiddleware,
                controllers: [...controllers.keys()].sort(),
                composables: [...composables.keys()].sort(),
                workers: [...workers.values()].map((worker) => ({
                    name: worker.name,
                    meta: worker.meta
                })),
                threadWorkers: [...threadWorkers.values()].map((worker) => ({
                    name: worker.name,
                    size: worker.size,
                    minThreads: worker.minThreads,
                    maxThreads: worker.maxThreads
                })),
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
    structure: ResolvedStructure,
    providers: Partial<ServiceInitializers> = {}
): Promise<BootstrapResult> => {
    // Never publish raw service configuration on globalThis: it may contain
    // DB passwords, SMTP tokens, signing keys or provider secrets.
    const serviceScope = await initializeRuntimeServices(config, rootDir, providers);
    let runtime: ZeruxRuntime;
    try {
        runtime = await createRuntime(rootDir, mode, config, structure, serviceScope);
    } catch (error) {
        await serviceScope.close().catch(() => {});
        throw error;
    }

    return {
        config,
        structure,
        runtime,
        manifestPath: ""
    };
};
