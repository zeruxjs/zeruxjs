import path from "node:path";

import { ensureDirectory } from "../utils/fs.js";
import { writeRuntimeJson } from "./persist.js";
import type { ZeruxRuntime } from "./types.js";

export const writeRuntimeManifest = (runtime: ZeruxRuntime) => {
    ensureDirectory(runtime.structure.outputDir);

    const manifestPath = path.join(runtime.structure.outputDir, "runtime.json");
    writeRuntimeJson(manifestPath, runtime.toManifest());

    return manifestPath;
};
