import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import os from "node:os";
import process from "node:process";
import { WebSocketServer } from "ws";
import { startWatcher } from "@zeruxjs/watcher";

import {
    portlessProxy,
    portlessAlias,
    portlessStop
} from "./portless.js";

/* ---------------- PATHS ---------------- */

const SHARED_DEV_FILE = path.join(os.tmpdir(), "zerux-dev.json");

/* ---------------- UTIL ---------------- */

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

/* ---------------- SHARED DEV ---------------- */

const ensureSharedDev = async (appName: string, port?: number) => {
    let data = readJSON(SHARED_DEV_FILE);

    if (!data.port) {
        const p = port ? await findPort(port) : await findPort(9000);
        data = { port: p, services: [] };
    }

    const names = data.services.map((s: any) => s.name);

    let final = appName;
    let i = 1;

    while (names.includes(final) || final === "zdev") {
        final = `${appName}-${i++}`;
    }

    data.services.push({ name: final });

    writeJSON(SHARED_DEV_FILE, data);

    return {
        port: data.port,
        name: final,
        isFirst: data.services.length === 1
    };
};

const removeSharedDev = (name: string) => {
    const data = readJSON(SHARED_DEV_FILE);

    data.services = data.services.filter((s: any) => s.name !== name);

    if (data.services.length === 0) {
        fs.unlinkSync(SHARED_DEV_FILE);
        return true;
    }

    writeJSON(SHARED_DEV_FILE, data);
    return false;
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

    await portlessProxy(1355, { https: true });

    /* ---------------- APP ---------------- */

    const appName = details.app.name || "app";

    const appPort = details.app.port
        ? await isPortFree(details.app.port)
            ? details.app.port
            : (() => { throw new Error("Port busy"); })()
        : await findPort(3000);

    let appServer = http.createServer(details.app.func);

    await new Promise<void>((r) => appServer.listen(appPort, r));

    const appAlias = await portlessAlias(appName, appPort);

    const appUrls = [
        `http://127.0.0.1:${appPort}`,
        ...(appAlias ? [`https://${appName}.localhost`] : [])
    ];

    addSerDetails(serviceFile, "app", appUrls);

    /* ---------------- DEV ---------------- */

    let devInfo: any = null;
    let devAlias = false;

    if (details.dev) {
        devInfo = await ensureSharedDev(appName, details.dev.port);

        if (devInfo.isFirst) {
            const server = details.dev.func ? http.createServer(details.dev.func) : http.createServer();
            new WebSocketServer({ server });

            await new Promise<void>((r) =>
                server.listen(devInfo.port, r)
            );
        }

        devAlias = await portlessAlias("zdev", devInfo.port);

        const devUrls = [
            `http://127.0.0.1:${devInfo.port}/${devInfo.name}`,
            `ws://127.0.0.1:${devInfo.port}/${devInfo.name}`,
            ...(devAlias
                ? [
                    `https://zdev.localhost/${devInfo.name}`,
                    `wss://zdev.localhost/${devInfo.name}`
                ]
                : [])
        ];

        addSerDetails(serviceFile, "dev", devUrls);
    }

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

            if (!(await isPortFree(appPort))) {
                throw new Error("Port locked");
            }

            appServer = http.createServer(details.app.func);

            await new Promise<void>((r) =>
                appServer.listen(appPort, r)
            );

            console.log(
                `App server restarted at ${appUrls.join(", ")}`
            );
        });
    }

    /* ---------------- CLEANUP ---------------- */

    const cleanup = () => {
        removeSerDetails(serviceFile, "app");
        removeSerDetails(serviceFile, "dev");

        if (devInfo) {
            const last = removeSharedDev(devInfo.name);
            if (last) portlessStop();
        }
    };

    process.on("SIGINT", () => {
        cleanup();
        process.exit(0);
    });

    process.on("exit", cleanup);
};