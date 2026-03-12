import fs from "node:fs";
import path from "node:path";
import type { BootstrapContext } from "./bootstap.js";

export async function loadConfig(context: BootstrapContext) {
    const configDir = path.join(context.rootDir, "config");

    if (!fs.existsSync(configDir)) return;

    const files = fs.readdirSync(configDir);

    const config: Record<string, any> = {};

    for (const file of files) {
        if (!file.endsWith(".js")) continue;

        const name = file.replace(".js", "");

        const module = await import(path.join(configDir, file));

        config[name] = module.default || module;
    }

    context.config = config;
}