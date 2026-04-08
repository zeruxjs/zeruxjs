import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import process from "node:process";
import { startWatcher } from "@zeruxjs/watcher";
import { WebSocketServer, WebSocket } from "ws";
import {
    closeSharedDevServer,
    ensureSharedDevServer,
    getDevtoolsServerChannelHandler,
    injectDevClient,
    isPrimaryHtmlRequest,
    publishSharedDevEvent,
    registerSharedDevApp,
    resolveSharedDevModuleSocketRequest,
    setSharedDevEventBroadcaster,
    unregisterSharedDevApp
} from "@zeruxjs/dev";

import {
    portlessProxy,
    portlessAlias,
    portlessGet,
    portlessStop
} from "./portless/portless.js";

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

    sharedDevWebSocketServer = new WebSocketServer({ noServer: true });
    sharedDevWebSocketHttpServer = server;

    server.on("upgrade", (req, socket, head) => {
        const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
        if (requestUrl.pathname !== "/__zerux/ws") {
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

const createInjectedAppHandler = (
    handler: (req: any, res: any) => Promise<void>,
    options: { routeName: string; devServerUrl: string; allowedDevDomain?: string | null; devPortLessAlias: { value: string | null | false } }
) => {
    return async (req: any, res: any) => {
        if (!isPrimaryHtmlRequest(req)) {
            await handler(req, res);
            return;
        }

        const chunks: Buffer[] = [];
        let intercepted = false;
        let statusCode = 200;
        const headers = new Map<string, string | number | readonly string[]>();

        const originalWriteHead = res.writeHead.bind(res);
        const originalWrite = res.write.bind(res);
        const originalEnd = res.end.bind(res);
        const originalSetHeader = res.setHeader.bind(res);

        res.setHeader = ((name: string, value: string | number | readonly string[]) => {
            headers.set(name.toLowerCase(), value);
            return originalSetHeader(name, value);
        }) as typeof res.setHeader;

        res.writeHead = ((code: number, ...args: any[]) => {
            statusCode = code;
            const [reasonOrHeaders, maybeHeaders] = args;
            const headHeaders = (typeof reasonOrHeaders === "string" ? maybeHeaders : reasonOrHeaders) ?? {};
            for (const [key, value] of Object.entries(headHeaders)) {
                headers.set(key.toLowerCase(), value as string | number | readonly string[]);
            }
            return res;
        }) as typeof res.writeHead;

        res.write = ((chunk: any, encoding?: any, callback?: any) => {
            intercepted = true;
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
            if (typeof callback === "function") callback();
            return true;
        }) as typeof res.write;

        res.end = ((chunk?: any, encoding?: any, callback?: any) => {
            if (chunk !== undefined && chunk !== null) {
                intercepted = true;
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
            }

            const contentType = String(headers.get("content-type") || "");
            if (!intercepted || !contentType.includes("text/html")) {
                res.setHeader = originalSetHeader;
                res.writeHead = originalWriteHead;
                res.write = originalWrite;
                res.end = originalEnd;

                res.statusCode = statusCode;
                if (intercepted) {
                    return originalEnd(Buffer.concat(chunks), callback);
                }
                return originalEnd(chunk, encoding, callback);
            }

            const html = Buffer.concat(chunks).toString("utf8");
            const transformed = injectDevClient(html, {
                routeName: options.routeName,
                devServerUrl: options.devServerUrl,
                allowedDevDomain: options.allowedDevDomain,
                devPortLessAlias: options.devPortLessAlias
            });

            res.setHeader = originalSetHeader;
            res.writeHead = originalWriteHead;
            res.write = originalWrite;
            res.end = originalEnd;

            for (const [key, value] of headers.entries()) {
                if (key === "content-length") continue;
                originalSetHeader(key, value as any);
            }

            originalSetHeader("content-length", Buffer.byteLength(transformed, "utf8"));
            res.statusCode = statusCode;
            return originalEnd(transformed, "utf8", callback);
        }) as typeof res.end;

        await handler(req, res);
    };
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
    while (!(await isPortFree(p))) p++;
    return p;
};

const readJSON = (file: string) => {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return {};
    }
};

const writeJSON = (file: string, data: any) => {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

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

    const service = details.service || "zerux";
    const root = process.cwd();

    const serviceFile = getServiceFile(service);
    initServiceFile(serviceFile);

    /* ---------------- PROXY ---------------- */

    await portlessProxy(undefined, { https: true });

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
            allowedDevDomain: details.config?.server?.allowedDevDomain ?? details.config?.allowedDevDomain
        });
        const sharedDevHandle = await ensureSharedDevServer(devInfo.port);
        if (sharedDevHandle) {
            ensureSharedDevSockets(sharedDevHandle.server);
        }

        devAlias = await portlessAlias("zdev", devInfo.port);

        const devAliasBase = devAlias ? await portlessGet("zdev") : false;
        const devUrls = [
            devInfo.urls.devtools,
            devInfo.urls.websocket,
            ...(devAliasBase
                ? [
                    `${devAliasBase}/${devInfo.routeName}`,
                    `${String(devAliasBase).replace(/^http/, "ws")}/__zerux/ws?app=${encodeURIComponent(devInfo.routeName)}`,
                ]
                : [])
        ];

        addSerDetails(serviceFile, "dev", devUrls);
        devPortLessAlias.value = devUrls.find(url => new URL(url).hostname.endsWith(".localhost") && new URL(url).protocol === "https:") ?? null;;
    }

    let appRequestHandler = details.app.func;
    if (devInfo) {
        appRequestHandler = createInjectedAppHandler(details.app.func, {
            routeName: devInfo.routeName,
            devServerUrl: devInfo.urls.devtools,
            allowedDevDomain: devInfo.allowedDevDomain,
            devPortLessAlias: devPortLessAlias
        });
    }

    let appServer = http.createServer(appRequestHandler);

    await new Promise<void>((r) => appServer.listen(appPort, r));

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

    if (details.dev) {
        const trigger =
            details.dev.watchTriggerFunc || (() => true);

        startWatcher(root, async (event: any) => {
            if (!trigger(event)) return;

            await new Promise<void>((r) =>
                appServer.close(() => r())
            );

            await details.dev.watchFunc(event.file);
            const sharedDevHandle = await ensureSharedDevServer(devInfo?.port);
            if (sharedDevHandle) {
                ensureSharedDevSockets(sharedDevHandle.server);
            }

            if (!(await isPortFree(appPort))) {
                throw new Error("Port locked");
            }

            appRequestHandler = devInfo
                ? createInjectedAppHandler(details.app.func, {
                    routeName: devInfo.routeName,
                    devServerUrl: devInfo.urls.devtools,
                    devPortLessAlias: devPortLessAlias
                })
                : details.app.func;

            appServer = http.createServer(appRequestHandler);

            await new Promise<void>((r) =>
                appServer.listen(appPort, r)
            );

            console.log(
                `App server restarted at ${appUrls.join(", ")}`
            );

            if (devInfo) {
                await publishSharedDevEvent(devInfo.port, {
                    app: devInfo.routeName,
                    type: "reload",
                    payload: {
                        file: event.file ?? null,
                        appUrls
                    }
                });
            }
        });
    }

    /* ---------------- CLEANUP ---------------- */

    let cleanedUp = false;

    const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;

        removeSerDetails(serviceFile, "app");
        removeSerDetails(serviceFile, "dev");

        if (devInfo) {
            const last = unregisterSharedDevApp(root);
            if (last) {
                void closeSharedDevServer();
                portlessStop();
            }
        }
    };

    process.on("SIGINT", () => {
        cleanup();
        process.exit(0);
    });

    process.on("exit", cleanup);
};
