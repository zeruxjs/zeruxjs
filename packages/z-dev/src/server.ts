import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";

import { buildContentSecurityPolicy } from "@zeruxjs/security";

import { createDocumentSecurity } from "./components/document.js";
import { readModuleAsset, resolveModuleApiRequest, resolveModuleSocketRequest } from "./module-loader.js";
import { readDevAsset, renderApplicationPage, renderHomePage, resolveCustomApiHandler, loadApplicationSections } from "./render.js";
import { appendSnapshotEvent, normalizeSnapshot } from "./state.js";
import { getRegistryApp, readRegistry, readSharedDevRouteName, registerSharedDevApp, unregisterSharedDevApp, isPortFree, findPort, writeRegistry } from "./registry.js";
import type { SharedDevEvent, SharedDevServerHandle, SharedDevRegistration } from "./types.js";

let sharedServerHandle: SharedDevServerHandle | null = null;
let sharedDevEventBroadcaster: ((appName: string, event: SharedDevEvent) => void) | null = null;

const sendJson = (res: ServerResponse, body: unknown, statusCode = 200) => {
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
};

const sendHtml = (
    res: ServerResponse,
    body: string,
    statusCode = 200,
    headers: Record<string, string> = {}
) => {
    res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8", ...headers });
    res.end(body);
};

const sendBuffer = (res: ServerResponse, body: Buffer, contentType: string, statusCode = 200) => {
    res.writeHead(statusCode, { "Content-Type": contentType });
    res.end(body);
};

const normalizeAncestorOrigin = (value?: string | null) => {
    if (!value) return null;
    try {
        const origin = new URL(value).origin;
        if (origin.startsWith("http://") || origin.startsWith("https://")) {
            return origin;
        }
    } catch {
        return null;
    }
    return null;
};

const isLocalHost = (host: string) => {
    const hostname = host.split(":")[0].toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".localhost")) return true;
    return false;
};

const matchWildcard = (pattern: string, host: string) => {
    const p = pattern.toLowerCase();
    const h = host.toLowerCase();
    if (p === h) return true;
    if (p.startsWith("*.")) {
        const domain = p.slice(2);
        return h === domain || h.endsWith(`.${domain}`);
    }
    return false;
};

const getFrameAncestors = (req?: IncomingMessage, registration?: SharedDevRegistration | null) => {
    const referer = req?.headers.referer || req?.headers.origin;

    if (!referer) {
        return ["'self'"];
    }

    const refererOrigin = normalizeAncestorOrigin(String(referer));
    if (!refererOrigin) {
        return ["'self'"];
    }

    try {
        const hostname = new URL(refererOrigin).hostname;

        // Check if referer is a local IP or localhost
        const isLocalIP =
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '[::1]' ||
            hostname === '::1' ||
            hostname.startsWith('192.168.') ||
            hostname.startsWith('10.') ||
            hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./); // 172.16.0.0 - 172.31.255.255

        // Check if referer is *.localhost
        const isLocalhost = hostname.endsWith('.localhost');

        // Check if referer matches allowedDomains
        const allowedDomains = registration?.allowedDomains
            ? (Array.isArray(registration.allowedDomains)
                ? registration.allowedDomains
                : [registration.allowedDomains])
            : [];

        const isAllowedDomain = allowedDomains.some(domain =>
            domain && (hostname === domain || hostname.endsWith(`.${domain}`))
        );

        const isAllowedDevDomain = registration?.allowedDevDomain
            ? (hostname === registration.allowedDevDomain ||
                hostname.endsWith(`.${registration.allowedDevDomain}`))
            : false;

        // Return referer + self if it matches any allowed pattern
        if (isLocalIP || isLocalhost || isAllowedDomain || isAllowedDevDomain) {
            return ["'self'", refererOrigin];
        }

    } catch (err) {
        // Invalid URL, fall through to default
    }

    // Otherwise, only self
    return ["'self'"];
};

const buildFrameAwarePolicy = (nonce: string, req?: IncomingMessage, registration?: SharedDevRegistration | null) => buildContentSecurityPolicy(nonce).replace(
    "frame-ancestors 'self'",
    `frame-ancestors ${getFrameAncestors(req, registration).join(" ")}`
);

const readRequestBody = async (req: IncomingMessage) =>
    new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });

const toJsonBody = (body: Buffer) => {
    try {
        return JSON.parse(body.toString("utf8") || "{}") as Record<string, unknown>;
    } catch {
        return {};
    }
};

const getAppFromPath = (pathname: string) => {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;

    const app = getRegistryApp(segments[0]);
    if (!app) return null;

    return {
        app,
        remainingPath: `/${segments.slice(1).join("/")}`.replace(/\/+$/, "") || "/"
    };
};

const broadcastEvent = (appName: string, event: SharedDevEvent) => {
    sharedDevEventBroadcaster?.(appName, {
        ...event,
        timestamp: event.timestamp ?? new Date().toISOString()
    });
};

const handleHttpRequest = async (req: IncomingMessage, res: ServerResponse) => {
    const host = req.headers.host || "";
    if (isLocalHost(host)) {
        // Localhost/127.0.0.1 is always allowed for devtools server
    } else {
        // For Shared Dev Server, we need to check if the app being requested allows this host
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const resolved = getAppFromPath(url.pathname);
        if (resolved) {
            const { app } = resolved;
            let allowed = false;

            if (app.allowedDevDomain && matchWildcard(app.allowedDevDomain, host.split(":")[0])) {
                allowed = true;
            } else {
                const domains = Array.isArray(app.allowedDomains) ? app.allowedDomains : [app.allowedDomains];
                for (const pattern of domains) {
                    if (pattern && matchWildcard(pattern, host.split(":")[0])) {
                        allowed = true;
                        break;
                    }
                }
            }

            if (!allowed) {
                console.error(`[Dev] Blocked unallowed host access to devtools: ${host} (App: ${app.appName})`);
                sendJson(res, { error: "Unallowed Host", message: `Host ${host} is not allowed to access devtools for ${app.appName}.` }, 403);
                return;
            }
        }
    }

    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;
    
    if (pathname === "/favicon.ico" || pathname === "/__zerux/assets/favicon.ico") {
        const asset = readDevAsset("favicon.ico");
        if (asset) {
            sendBuffer(res, asset, "image/x-icon");
            return;
        }
    }

    if (pathname === "/favicon.png" || pathname === "/__zerux/assets/favicon.png") {
        const asset = readDevAsset("favicon.png");
        if (asset) {
            sendBuffer(res, asset, "image/png");
            return;
        }
    }

    if (pathname === "/__zerux/assets/style.css") {
        const asset = readDevAsset("style.css");
        if (!asset) {
            sendJson(res, { message: "Asset not found" }, 404);
            return;
        }
        sendBuffer(res, asset, "text/css; charset=utf-8");
        return;
    }

    if (pathname === "/__zerux/assets/app.js") {
        const asset = readDevAsset("app.js");
        if (!asset) {
            sendJson(res, { message: "Asset not found" }, 404);
            return;
        }
        sendBuffer(res, asset, "text/javascript; charset=utf-8");
        return;
    }

    if (pathname === "/") {
        if (!isLocalHost(host)) {
            // Root dashboard only accessible if at least one app allows this host
            const apps = readRegistry().apps;
            let hostAllowed = false;
            for (const app of apps) {
                const domains = Array.isArray(app.allowedDomains) ? app.allowedDomains : [app.allowedDomains];
                if ((app.allowedDevDomain && matchWildcard(app.allowedDevDomain, host.split(":")[0])) ||
                    domains.some(d => d && matchWildcard(d, host.split(":")[0]))) {
                    hostAllowed = true;
                    break;
                }
            }
            if (!hostAllowed) {
                console.error(`[Dev] Blocked unallowed host access to root dashboard: ${host}`);
                sendJson(res, { error: "Unallowed Host", message: `Host ${host} is not allowed to access the devtools dashboard.` }, 403);
                return;
            }
        }
        const security = createDocumentSecurity();
        const page = await renderHomePage(readRegistry().apps);
        sendHtml(res, page(security.nonce), 200, {
            "Content-Security-Policy": buildFrameAwarePolicy(security.nonce, req, null)
        });
        return;
    }

    if (pathname === "/__zerux/events" && req.method === "POST") {
        const body = toJsonBody(await readRequestBody(req));
        if (typeof body.app !== "string" || typeof body.type !== "string") {
            sendJson(res, { message: "Missing app name" }, 400);
            return;
        }

        broadcastEvent(body.app, body as unknown as SharedDevEvent);
        sendJson(res, { ok: true });
        return;
    }

    const resolved = getAppFromPath(pathname);
    if (!resolved) {
        sendJson(res, { message: "Application not found" }, 404);
        return;
    }

    const { app, remainingPath } = resolved;
    const identifier = url.searchParams.get("identifier");
    const snapshot = normalizeSnapshot(app, { identifier });

    if (remainingPath === "/__zerux/state" && req.method === "GET") {
        sendJson(res, snapshot);
        return;
    }

    if (remainingPath === "/__zerux/api/bootstrap" && req.method === "GET") {
        sendJson(res, {
            snapshot: {
                updatedAt: snapshot.updatedAt,
                routes: snapshot.routes,
                clientEvents: snapshot.clientEvents,
                logs: snapshot.logs
            },
            identifier
        });
        return;
    }

    const moduleAssetMatch = remainingPath.match(/^\/__zerux\/modules\/([^/]+)\/(style\.css|client\.js)$/);
    if (moduleAssetMatch && req.method === "GET") {
        const [, moduleId, assetName] = moduleAssetMatch;
        const asset = await readModuleAsset(
            app,
            snapshot,
            moduleId,
            assetName === "style.css" ? "style" : "script"
        );
        if (!asset) {
            sendJson(res, { message: "Module asset not found" }, 404);
            return;
        }

        sendBuffer(
            res,
            asset,
            assetName === "style.css" ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8"
        );
        return;
    }

    const moduleApiMatch = remainingPath.match(/^\/__zerux\/modules\/([^/]+)\/api\/([^/]+)$/);
    if (moduleApiMatch) {
        const [, moduleId, handlerName] = moduleApiMatch;
        const requestBody = req.method === "GET" || req.method === "HEAD"
            ? {}
            : toJsonBody(await readRequestBody(req));
        const requesterModuleId = url.searchParams.get("requester");
        const result = await resolveModuleApiRequest({
            app,
            snapshot,
            moduleId,
            handlerName,
            request: req,
            body: requestBody,
            identifier,
            requesterModuleId
        });

        if (result === null) {
            sendJson(res, { message: "Module API handler not found" }, 404);
            return;
        }

        sendJson(res, result);
        return;
    }

    if (remainingPath.startsWith("/__zerux/api/")) {
        const apiName = remainingPath.slice("/__zerux/api/".length);
        const handler = resolveCustomApiHandler(apiName);
        if (!handler) {
            sendJson(res, { message: "API handler not found" }, 404);
            return;
        }
        sendJson(res, await handler({ req, app, snapshot, identifier }));
        return;
    }

    if (remainingPath === "/__zerux/client-event" && req.method === "POST") {
        const payload = toJsonBody(await readRequestBody(req));
        appendSnapshotEvent(app.dataFilePath, payload);
        broadcastEvent(app.routeName, {
            app: app.routeName,
            type: "client-event",
            payload
        });
        sendJson(res, { ok: true });
        return;
    }

    const isAsset = remainingPath.startsWith("/__zerux/");
    if (!isAsset && req.method === "GET") {
        const security = createDocumentSecurity();
        const sectionId = remainingPath.replace(/^\//, "") || null;
        const page = await renderApplicationPage(app, snapshot, identifier, sectionId);
        sendHtml(res, page(security.nonce), 200, {
            "Content-Security-Policy": buildFrameAwarePolicy(security.nonce, req, app)
        });
        return;
    }

    sendJson(res, { message: "Route not found" }, 404);
};

export const ensureSharedDevServer = async (preferredPort?: number) => {
    if (sharedServerHandle) {
        return sharedServerHandle;
    }

    const registry = readRegistry();
    const port = registry.port ?? await findPort(preferredPort ?? 9000);
    const portFree = await isPortFree(port);
    const liveOwner = registry.serverPid ? (() => {
        try {
            process.kill(registry.serverPid, 0);
            return true;
        } catch {
            return false;
        }
    })() : false;

    if (!portFree && liveOwner && registry.serverPid !== process.pid) {
        return null;
    }

    const server = http.createServer((req, res) => {
        void handleHttpRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve());
    });

    writeRegistry({
        ...registry,
        port,
        serverPid: process.pid
    });

    sharedServerHandle = { port, server };
    server.on("close", () => {
        const currentRegistry = readRegistry();
        if (currentRegistry.serverPid === process.pid) {
            writeRegistry({
                ...currentRegistry,
                serverPid: undefined
            });
        }
        sharedServerHandle = null;
    });

    return sharedServerHandle;
};

export const closeSharedDevServer = async () => {
    if (!sharedServerHandle) return;

    const current = sharedServerHandle;
    sharedServerHandle = null;
    await new Promise<void>((resolve) => current.server.close(() => resolve()));
};

export const publishSharedDevEvent = async (port: number, event: SharedDevEvent) => {
    const payload = JSON.stringify({
        ...event,
        timestamp: event.timestamp ?? new Date().toISOString()
    });

    await new Promise<void>((resolve) => {
        const request = http.request(
            {
                hostname: "127.0.0.1",
                port,
                path: "/__zerux/events",
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(payload, "utf8")
                }
            },
            (response) => {
                response.resume();
                response.on("end", () => resolve());
            }
        );

        request.on("error", () => resolve());
        request.write(payload);
        request.end();
    });
};

export const setSharedDevEventBroadcaster = (
    broadcaster: ((appName: string, event: SharedDevEvent) => void) | null
) => {
    sharedDevEventBroadcaster = broadcaster;
};

export const resolveSharedDevModuleSocketRequest = async (options: {
    appName: string;
    moduleId: string;
    channel: string;
    payload?: Record<string, unknown>;
    identifier?: string | null;
    clientType?: string;
    requesterModuleId?: string | null;
}) => {
    const app = getRegistryApp(options.appName);
    if (!app) {
        return null;
    }

    const snapshot = normalizeSnapshot(app, { identifier: options.identifier });
    return resolveModuleSocketRequest({
        app,
        snapshot,
        moduleId: options.moduleId,
        channel: options.channel,
        payload: options.payload,
        identifier: options.identifier,
        clientType: options.clientType,
        requesterModuleId: options.requesterModuleId
    });
};

export {
    getRegistryApp,
    readSharedDevRouteName,
    registerSharedDevApp,
    unregisterSharedDevApp
};
