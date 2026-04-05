import fs from "node:fs";
import path from "node:path";

import { ensureDirectory } from "../utils/fs.js";
import type { ZeruxRuntime } from "./types.js";

export const writeRuntimeManifest = (runtime: ZeruxRuntime) => {
    ensureDirectory(runtime.structure.outputDir);

    const manifestPath = path.join(runtime.structure.outputDir, "runtime.json");
    fs.writeFileSync(manifestPath, JSON.stringify(runtime.toManifest(), null, 2), "utf-8");

    return manifestPath;
};
