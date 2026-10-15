import { fileURLToPath, pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";

import { registerLoader } from "../loader/register-loader.js";

interface ThreadBootstrapData {
    script: string;
    mode: "dev" | "start";
    rootDir: string;
    serviceName: string;
    workerData?: unknown;
}

type ThreadHandler = (payload: unknown, context: {
    mode: "dev" | "start";
    rootDir: string;
    workerData?: unknown;
    env: NodeJS.ProcessEnv;
}) => Promise<unknown> | unknown;

const data = workerData as ThreadBootstrapData;

registerLoader(data.serviceName);

const toModuleUrl = (script: string) => {
    const moduleUrl = script.startsWith("file://")
        ? new URL(script)
        : pathToFileURL(script);

    if (data.mode === "dev") {
        moduleUrl.searchParams.set("t", `${Date.now()}`);
    }

    return moduleUrl.href;
};

const loadHandler = async (): Promise<ThreadHandler> => {
    const module = await import(toModuleUrl(data.script));
    const handler = module.default ?? module.handler ?? module.process ?? module.run;

    if (typeof handler !== "function") {
        throw new TypeError(`Thread worker "${fileURLToPath(toModuleUrl(data.script))}" must export default, handler, process, or run function.`);
    }

    return handler as ThreadHandler;
};

const handler = await loadHandler();

parentPort?.on("message", async (message: { id: number; payload: unknown }) => {
    try {
        const result = await handler(message.payload, {
            mode: data.mode,
            rootDir: data.rootDir,
            workerData: data.workerData,
            env: process.env
        });

        parentPort?.postMessage({
            id: message.id,
            result
        });
    } catch (error) {
        parentPort?.postMessage({
            id: message.id,
            error: error instanceof Error ? error.message : String(error)
        });
    }
});
