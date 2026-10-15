import { createLiveRequestHandler } from "./live-handler.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import process from "node:process";
import { startWatcher } from "zwatch";
import { WebSocketServer, WebSocket } from "ws";
import {
    closeSharedDevServer,
    ensureSharedDevServer,
    getDevtoolsServerChannelHandler,
    publishSharedDevEvent,
    registerSharedDevApp,
    resolveSharedDevModuleSocketRequest,
    setSharedDevEventBroadcaster,
    unregisterSharedDevApp
} from "z-dev";

import { createInjectedAppHandler } from './injection.js';
import {
    portlessProxy,
    portlessAlias,
    portlessGet,
    portlessStop,
    portlessRestart
} from "../portless/portless.js";

/* ---------------- UTIL ---------------- */

let sharedDevWebSocketServer: WebSocketServer | null = null;
let sharedDevWebSocketHttpServer: http.Server | null = null;
let devPortLessAlias: { value: string | null | false } = { value: null };

const ensureSharedDevSockets = (server: http.Server) => {
    if (sharedDevWebSocketServer && sharedDevWebSocketHttpServer === server) {
        return sharedDevWebSocketServer;
    }

    if (sharedDevWebSocketServer) {
        sharedDevWebSocketServer.close();
    }

    sharedDevWebSocketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
    sharedDevWebSocketHttpServer = server;

    server.on("upgrade", (req, socket, head) => {
        let requestUrl: URL;
        try { requestUrl = new URL(req.url || '/', 'http://127.0.0.1'); }
        catch { socket.destroy(); return; }
        const wsMatch = requestUrl.pathname.match(/^\/__([a-z0-9_-]{1,64})\/ws$/i);
        if (!wsMatch) {
            socket.destroy();
            return;
        }

        sharedDevWebSocketServer!.handleUpgrade(req, socket, head, (ws) => {
            (ws as WebSocket & { appName?: string }).appName = requestUrl.searchParams.get("app") ?? undefined;
            (ws as WebSocket & { identifier?: string }).identifier = requestUrl.searchParams.get("identifier") ?? undefined;
            (ws as WebSocket & { clientType?: string }).clientType = requestUrl.searchParams.get("client") ?? undefined;
            (ws as WebSocket & { moduleId?: string }).moduleId = requestUrl.searchParams.get("moduleId") ?? undefined;
            sharedDevWebSocketServer!.emit("connection", ws, req);
        });
    });

    sharedDevWebSocketServer.on("connection", (ws) => {
        ws.on("message", async (raw) => {
            try {
                const message = JSON.parse(String(raw));
                if (message?.type !== "channel" || typeof message.channel !== "string") return;

                const appName = (ws as WebSocket & { appName?: string }).appName;
                const identifier = (ws as WebSocket & { identifier?: string }).identifier;
                const clientType = (ws as WebSocket & { clientType?: string }).clientType;
                const boundModuleId = (ws as WebSocket & { moduleId?: string }).moduleId;

                if (message.channelType === "server") {
                    if (!appName) return;

                    let data: unknown = null;
                    const targetModuleId = typeof message.moduleId === "string" ? message.moduleId : boundModuleId;
                    if (targetModuleId) {
                        data = await resolveSharedDevModuleSocketRequest({
                            appName,
                            moduleId: targetModuleId,
                            channel: message.channel,
                            payload: message.payload,
                            identifier,
                            clientType,
                            requesterModuleId: typeof message.requesterModuleId === "string"
                                ? message.requesterModuleId
                                : boundModuleId
                        });
                    } else {
                        const handler = getDevtoolsServerChannelHandler(message.channel);
                        if (!handler) return;
                        data = await handler(message.payload, {
                            app: appName,
                            identifier,
                            clientType
                        });
                    }

                    ws.send(JSON.stringify({
                        type: "server-channel",
                        channel: message.channel,
                        moduleId: targetModuleId,
                        identifier,
                        payload: data ?? null
                    }));
                    return;
                }

                if (message.channelType === "peer" && appName) {
                    for (const client of sharedDevWebSocketServer!.clients) {
                        if (client.readyState !== WebSocket.OPEN || client === ws) continue;
                        const targetApp = (client as WebSocket & { appName?: string }).appName;
                        const targetIdentifier = (client as WebSocket & { identifier?: string }).identifier;
                        const targetModuleId = (client as WebSocket & { moduleId?: string }).moduleId;
                        if (targetApp !== appName) continue;
                        if (identifier && targetIdentifier && identifier !== targetIdentifier) continue;
                        if (typeof message.targetModuleId === "string" && targetModuleId !== message.targetModuleId) continue;
                        if (typeof message.moduleId === "string" && targetModuleId && targetModuleId !== message.moduleId) continue;
                        client.send(JSON.stringify({
                            type: "peer-channel",
                            channel: message.channel,
                            moduleId: typeof message.moduleId === "string" ? message.moduleId : boundModuleId,
                            identifier,
                            payload: message.payload ?? null
                        }));
                    }
                }
            } catch {
                return;
            }
        });
    });

    server.on("close", () => {
        if (sharedDevWebSocketHttpServer === server) {
            sharedDevWebSocketServer?.close();
            sharedDevWebSocketServer = null;
            sharedDevWebSocketHttpServer = null;
            setSharedDevEventBroadcaster(null);
        }
    });

    setSharedDevEventBroadcaster((appName, event) => {
        if (!sharedDevWebSocketServer) return;

        for (const client of sharedDevWebSocketServer.clients) {
            if (client.readyState !== WebSocket.OPEN) continue;

            const targetApp = (client as WebSocket & { appName?: string }).appName;
            if (targetApp && targetApp !== appName) continue;

            const targetIdentifier = (client as WebSocket & { identifier?: string }).identifier;
            const eventIdentifier = typeof event.payload?.identifier === "string"
                ? event.payload.identifier
                : undefined;
            if (event.type === "client-event" && targetIdentifier && eventIdentifier && targetIdentifier !== eventIdentifier) {
                continue;
            }

            client.send(JSON.stringify(event));
        }
    });

    return sharedDevWebSocketServer;
};

const isPortFree = (port: number) =>
    new Promise<boolean>((resolve) => {
        const s = net.createServer();
        s.once("error", () => resolve(false));
        s.once("listening", () => s.close(() => resolve(true)));
        s.listen(port);
    });

const findPort = async (start: number) => {
    let p = start;
    while (p <= 65535 && !(await isPortFree(p))) p++;
    if (p > 65535) throw new Error('No free application port');
    return p;
};

const readJSON = (file: string) => {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return [];
    }
};

const writeJSON = (file: string, data: any) => {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

const normalizeWebSocketPath = (value: unknown) => {
    const pathValue = typeof value === "string" && value.trim() ? value.trim() : "/ws";
    return pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
};

const isWebSocketPath = (pathname: string, configuredPath: string) =>
    pathname === configuredPath || pathname.endsWith(configuredPath);

/* ---------------- SERVER.JSON ---------------- */

const getServiceFile = (service: string) => {
    const dir = path.join(process.cwd(), `.${service}`);
    const file = path.join(dir, "server.json");

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    return file;
};

const initServiceFile = (file: string) => {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    writeJSON(file, []);
};

const addSerDetails = (file: string, type: string, urls: string[]) => {
    const data = readJSON(file) || [];
    const existing = data.find((x: any) => x.type === type);

    if (existing) existing.urls = urls;
    else data.push({ type, urls });

    writeJSON(file, data);
};

const removeSerDetails = (file: string, type: string) => {
    let data = readJSON(file) || [];
    data = data.filter((x: any) => x.type !== type);
    writeJSON(file, data);
};

/* ---------------- MAIN ---------------- */

export const startServer = async (details: any) => {
    if (!details?.app?.func) {
        throw new Error("App func required");
    }

    const service = details.service || "zdev";
    if (typeof service !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(service)) {
        throw new TypeError('Invalid service name');
    }
    const root = process.cwd();

    const serviceFile = getServiceFile(service);
    initServiceFile(serviceFile);

    /* ---------------- PROXY ---------------- */

    console.log("- Starting portless proxy");
    if (!(await portlessProxy(undefined, { https: true }))) {
        throw new Error('Failed to start the portless proxy');
    }
    console.log("- Portless proxy ready");

    /* ---------------- APP ---------------- */

    const appName = details.app.name || "app";

    const appPort = details.app.port
        ? await isPortFree(details.app.port)
            ? details.app.port
            : (() => { throw new Error("Port busy"); })()
        : await findPort(3000);

    let devInfo: Awaited<ReturnType<typeof registerSharedDevApp>> | null = null;
    let devAlias = false;

    if (details.dev) {
        devInfo = await registerSharedDevApp({
            appName,
            appPort,
            rootDir: root,
            preferredPort: details.dev.port,
            dataFilePath: details.dev.dataFilePath,
            logFilePath: details.dev.logFilePath,
            runtimeManifestPath: details.dev.runtimeManifestPath,
            allowedDomains: details.config?.server?.allowedDomains ?? details.config?.allowedDomains,
            allowedDevDomain: details.config?.server?.allowedDevDomain ?? details.config?.allowedDevDomain,
            serviceName: service,
            devtools: details.config?.devtools
        });
        const sharedDevHandle = await ensureSharedDevServer(devInfo.port);
        if (sharedDevHandle) {
            ensureSharedDevSockets(sharedDevHandle.server);
        }

        devAlias = await portlessAlias(service, devInfo.port);

        const devAliasBase = devAlias ? await portlessGet(service) : false;
        const devUrls = [
            devInfo.urls.devtools,
            devInfo.urls.websocket,
            ...(devAliasBase
                ? [
                    `${devAliasBase}/${devInfo.routeName}`,
                    `${String(devAliasBase).replace(/^http/, "ws")}/__${service}/ws?app=${encodeURIComponent(devInfo.routeName)}`,
                ]
                : [])
        ];

        addSerDetails(serviceFile, "dev", devUrls);
        devPortLessAlias.value = devUrls.find(url => new URL(url).hostname.endsWith(".localhost") && new URL(url).protocol === "https:") ?? null;;
    }

    let appRequestHandler = details.app.func;
    if (devInfo) {
        appRequestHandler = createInjectedAppHandler(details.app.func, {
            serviceName: service,
            routeName: devInfo.routeName,
            devServerUrl: devInfo.urls.devtools,
            allowedDevDomain: devInfo.allowedDevDomain,
            devPortLessAlias: devPortLessAlias
        });
    }

    let appWebSocketServer: WebSocketServer | null = null;
    if (details.config?.websocket?.enabled === true) {
        const maxPayload = Number(details.config?.websocket?.maxPayload);
        appWebSocketServer = new WebSocketServer({
            noServer: true,
            maxPayload: Number.isSafeInteger(maxPayload) && maxPayload >= 1 && maxPayload <= 16 * 1024 * 1024
                ? maxPayload : 1024 * 1024
        });
        appWebSocketServer.on("connection", (ws) => {
            (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
            ws.on("pong", () => {
                (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
            });
            ws.on("message", (raw) => {
                if (appWebSocketServer) {
                    for (const client of appWebSocketServer.clients) {
                        if (client.readyState === WebSocket.OPEN && client !== ws) {
                            client.send(raw);
                        }
                    }
                }
            });
        });

        const heartbeat = setInterval(() => {
            if (!appWebSocketServer) return;
            for (const client of appWebSocketServer.clients) {
                const socket = client as WebSocket & { isAlive?: boolean };
                if (socket.isAlive === false) {
                    socket.terminate();
                    continue;
                }
                socket.isAlive = false;
                socket.ping();
            }
        }, 30_000);
        heartbeat.unref?.();
        appWebSocketServer.on("close", () => clearInterval(heartbeat));
    }

    const bindWebSocketUpgrade = (server: http.Server) => {
        if (appWebSocketServer) {
            const websocketPath = normalizeWebSocketPath(details.config?.websocket?.path);
            server.on("upgrade", (req, socket, head) => {
                let requestUrl: URL;
                try { requestUrl = new URL(req.url || '/', 'http://127.0.0.1'); }
                catch { socket.destroy(); return; }
                if (isWebSocketPath(requestUrl.pathname, websocketPath)) {
                    appWebSocketServer!.handleUpgrade(req, socket, head, (ws) => {
                        appWebSocketServer!.emit("connection", ws, req);
                    });
                } else {
                    socket.destroy();
                }
            });
        }
    };

    const liveHandler = createLiveRequestHandler(appRequestHandler);
    let appServer = http.createServer(liveHandler.handle);
    bindWebSocketUpgrade(appServer);

    await new Promise<void>((resolve, reject) => {
        appServer.once('error', reject);
        appServer.listen(appPort, '127.0.0.1', () => { appServer.off('error', reject); resolve(); });
    });

    const appAlias = await portlessAlias(appName, appPort);

    const appAliasUrl = await portlessGet(appName);

    const appUrls = [
        `http://127.0.0.1:${appPort}`,
        ...(appAliasUrl ? [appAliasUrl] : [])
    ];

    addSerDetails(serviceFile, "app", appUrls);

    /* ---------------- LOG ---------------- */

    console.log("Application Started");

    console.log(
        `- App server started at ${appUrls.join(", ")}`
    );

    if (devInfo) {
        const devUrls = readJSON(serviceFile)
            .find((x: any) => x.type === "dev")?.urls;

        console.log(
            `- Dev server is running at ${devUrls.join(", ")}`
        );
    }

    /* ---------------- WATCH ---------------- */

    let stopWatcher: (() => void) | undefined;
    let rebuild = Promise.resolve();
    let stopping = false;
    if (details.dev) {
        const trigger = details.dev.watchTriggerFunc || (() => true);

        stopWatcher = startWatcher(root, (event: any) => {
            if (stopping || !trigger(event)) return;
            rebuild = rebuild.then(async () => {
                if (stopping) return;

            console.log(
                `[Watcher] File changed: ${event.file} (${event.type})`
            );

            // Prepare the new application before switching traffic. If rebuilding
            // fails, preserve the previous request handler and listening socket.
            // Existing in-flight requests keep their original handler reference.
            await details.dev.watchFunc(event.file);
            const sharedDevHandle = await ensureSharedDevServer(devInfo?.port);
            if (sharedDevHandle) ensureSharedDevSockets(sharedDevHandle.server);

            const nextHandler = devInfo
                ? createInjectedAppHandler(details.app.func, {
                    serviceName: service,
                    routeName: devInfo.routeName,
                    devServerUrl: devInfo.urls.devtools,
                    devPortLessAlias: devPortLessAlias
                })
                : details.app.func;
            liveHandler.swap(nextHandler);

            console.log(
                `App handler updated without port rebinding at ${appUrls.join(", ")}`
            );

            if (devInfo) {
                await publishSharedDevEvent(devInfo.port, {
                    app: devInfo.routeName,
                    type: "hot-update",
                    serviceName: service,
                    payload: {
                        file: event.file ?? null,
                        appUrls,
                        strategy: typeof event.file === "string" && /\.(css|less|sass|scss|styl|pcss)$/i.test(event.file)
                            ? "style"
                            : "document",
                        updatedAt: new Date().toISOString()
                    }
                });
            }
            }).catch(error => console.error('[Watcher] Reload failed:', error));
        }, { onError: (error: Error) => console.error('[Watcher] Failed:', error) });
    }

    /* ---------------- CLEANUP ---------------- */

    let cleanedUp = false;
    const cleanupState = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        stopping = true;
        stopWatcher?.();
        try { removeSerDetails(serviceFile, 'app'); removeSerDetails(serviceFile, 'dev'); }
        catch (error) { console.error('Cannot clean up service metadata:', error); }
        if (devInfo) {
            const last = unregisterSharedDevApp(root);
            if (last) void closeSharedDevServer().catch(error => console.error('Cannot close devtools:', error));
            // The proxy can serve unrelated apps; never stop it unconditionally.
        }
    };
    const shutdown = async () => {
        cleanupState();
        if (appWebSocketServer) {
            for (const client of appWebSocketServer.clients) client.terminate();
            appWebSocketServer.close();
        }
        // An existing keep-alive request must not block termination forever.
        const current = appServer;
        if (current.listening) {
            await new Promise<void>(resolve => {
                let finished = false;
                const done = () => { if (!finished) { finished = true; clearTimeout(timer); resolve(); } };
                current.close(done);
                current.closeIdleConnections?.();
                const timer = setTimeout(() => { current.closeAllConnections?.(); done(); }, 5000);
                timer.unref?.();
            });
        }
        process.exitCode = 0;
    };
    process.once('SIGINT', () => { void shutdown().catch(error => { console.error(error); process.exitCode = 1; }); });
    process.once('SIGTERM', () => { void shutdown().catch(error => { console.error(error); process.exitCode = 1; }); });
    process.once('exit', cleanupState);
};
