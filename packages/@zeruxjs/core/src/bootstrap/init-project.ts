import fs from "node:fs";
import path from "node:path";
import type { BootstrapContext } from "./bootstap.js";

export async function initProject(context: BootstrapContext) {
    const zeruxDir = path.join(context.rootDir, ".zerux");

    if (!fs.existsSync(zeruxDir)) {
        fs.mkdirSync(zeruxDir);
    }

    context.runtime.zeruxDir = zeruxDir;
}