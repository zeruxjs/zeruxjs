import fs from "node:fs";
import path from "node:path";
import type { BootstrapContext } from "./bootstap.js";

export async function loadEnv(context: BootstrapContext) {
    const envPath = path.join(context.rootDir, ".env");

    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, "utf8").split("\n");

    for (const line of lines) {
        const [key, value] = line.split("=");

        if (key && value) {
            process.env[key.trim()] = value.trim();
        }
    }

    context.env = process.env as Record<string, string>;
}