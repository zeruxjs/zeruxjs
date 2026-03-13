import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";

export type WatcherEvent = { file: string; type: string };
export type WatcherCallback = (event: WatcherEvent, type: string) => void;

const watchers = new Map<string, Set<WatcherCallback>>();
const masterClients = new Map<string, Set<net.Socket>>();
const isTakingOver = new Set<string>();

function getSocketPath(rootDir: string) {
    const hash = crypto.createHash("md5").update(rootDir).digest("hex");
    if (process.platform === "win32") {
        return `\\\\.\\pipe\\zeruxjs-watcher-${hash}`;
    }
    return path.join("/tmp", `zeruxjs-watcher-${hash}.sock`);
}

export function startWatcher(rootDir: string, onChange?: WatcherCallback) {
    if (!onChange) return;

    if (watchers.has(rootDir)) {
        watchers.get(rootDir)!.add(onChange);
        return;
    }

    const callbacks = new Set<WatcherCallback>();
    callbacks.add(onChange);
    watchers.set(rootDir, callbacks);

    const socketPath = getSocketPath(rootDir);

    const client = net.createConnection(socketPath);

    client.on("connect", () => {
        console.log(`[Watcher] Connected to existing watcher daemon for: ${rootDir}`);
        
        let buffer = "";
        client.on("data", (data) => {
            buffer += data.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const event = JSON.parse(line);
                    for (const cb of watchers.get(rootDir) || []) {
                        cb(event, event.type);
                    }
                } catch (e) {}
            }
        });

        // If daemon dies, we should take over
        client.on("close", () => {
            console.log(`[Watcher] Daemon connection closed for: ${rootDir}. Taking over supervision.`);
            startMasterDaemon(rootDir, socketPath);
        });
    });

    client.on("error", (err: any) => {
        if (err.code === "ENOENT" || err.code === "ECONNREFUSED") {
            startMasterDaemon(rootDir, socketPath);
        }
    });

    return () => {
        callbacks.delete(onChange);
        if (callbacks.size === 0) {
            watchers.delete(rootDir);
            client.destroy();
        }
    };
}

function startMasterDaemon(rootDir: string, socketPath: string) {
    if (isTakingOver.has(rootDir)) return;
    isTakingOver.add(rootDir);

    if (process.platform !== "win32") {
        if (fs.existsSync(socketPath)) {
            try { fs.unlinkSync(socketPath); } catch (e) {}
        }
    }

    const clients = new Set<net.Socket>();
    masterClients.set(rootDir, clients);

    const server = net.createServer((socket) => {
        clients.add(socket);
        socket.on("close", () => clients.delete(socket));
        socket.on("error", () => clients.delete(socket));
    });

    server.listen(socketPath, () => {
        console.log(`[Watcher] Started master watcher daemon for: ${rootDir}`);
        isTakingOver.delete(rootDir);
        
        const watchDir = path.resolve(rootDir);
        const fileHashes = new Map();
        const debounceTimers = new Map();

        const watcher = fs.watch(watchDir, { recursive: true }, (event: string, file: string | null) => {
            if (!file) return;

            const filePath = path.join(watchDir, file);

            const timer = debounceTimers.get(filePath);
            if (timer) clearTimeout(timer);

            debounceTimers.set(filePath, setTimeout(() => {
                debounceTimers.delete(filePath);

                let stat;
                try {
                    stat = fs.statSync(filePath);
                } catch (err: any) {
                    if (err.code === "ENOENT") {
                        fileHashes.delete(filePath);
                        broadcast({ file, type: "delete" });
                    }
                    return;
                }

                if (stat.isDirectory()) return;

                let content;
                try {
                    content = fs.readFileSync(filePath);
                } catch {
                    return;
                }

                const currentHash = crypto.createHash("md5").update(content).digest("hex");
                const prevHash = fileHashes.get(filePath);

                let type = "update";

                if (!prevHash) {
                    type = event === "rename" ? "new" : "update";
                } else if (prevHash === currentHash) {
                    type = "resave";
                }

                if (type !== "resave") {
                    fileHashes.set(filePath, currentHash);
                }

                broadcast({ file, type });

            }, 50));
        });

        const cleanup = () => {
            try {
                watcher.close();
                server.close();
                if (process.platform !== "win32" && fs.existsSync(socketPath)) {
                    fs.unlinkSync(socketPath);
                }
            } catch (e) {}
        };

        process.on("exit", cleanup);
        process.on("SIGINT", () => { cleanup(); process.exit(); });
        process.on("SIGTERM", () => { cleanup(); process.exit(); });
    });

    server.on("error", (err: any) => {
        isTakingOver.delete(rootDir);
        if (err.code === "EADDRINUSE") {
             setTimeout(() => {
                 const client = net.createConnection(socketPath);
                 client.on("connect", () => { 
                     // connected fallback
                 });
                 client.on("error", () => { 
                     // retry mechanism failed
                 });
                 client.on("close", () => {
                     startMasterDaemon(rootDir, socketPath);
                 });
             }, 100);
        }
    });

    function broadcast(eventData: WatcherEvent) {
        console.log(`[Watcher] File changed: ${eventData.file} (${eventData.type})`);
        
        // local listeners
        for (const cb of watchers.get(rootDir) || []) {
            cb(eventData, eventData.type);
        }
        
        // ipc listeners
        const msg = JSON.stringify(eventData) + "\n";
        for (const client of clients) {
            client.write(msg);
        }
    }
}
