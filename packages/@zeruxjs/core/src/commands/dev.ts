import { startAppServer } from "../server/app-server.js";
import { startDevServer } from "../server/dev-server.js";
import { startWatcher } from "../compiler/watcher.js";

export async function startDev() {
    const rootDir = process.cwd();

    try {
        const ts = await import("@zeruxjs/typescript");
        ts.registerTypescript();
    } catch {
        // typescript support not installed
    }

    let appServer = await startAppServer(rootDir);

    const devServer = await startDevServer(rootDir);

    startWatcher(rootDir, async (event: { type: string; file: string }) => {
        const shouldRestartApp = await devServer.build(event);

        if (shouldRestartApp) {
            console.log("Restarting app server...");
            appServer.close(); // Gracefully stops accepting new connections

            // Re-instantiate the server. By passing `null`, it will automatically 
            // hunt for the next open port (like 3001, 3002) if the old port isn't fully released yet.
            appServer = await startAppServer(rootDir, null);

            devServer.broadcast({ message: "change" });
        }
    });

    console.log("Zerux dev mode started");
}