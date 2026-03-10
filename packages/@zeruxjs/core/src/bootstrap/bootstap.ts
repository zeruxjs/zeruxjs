import { loadEnv } from "./load-env.js";
import { loadConfig } from "./load-config.js";
import { initRuntime } from "./init-runtime.js";
import { initProject } from "./init-project.js";

export async function bootstrap({ rootDir, mode }: { rootDir: string; mode: string }) {
    const context = {
        rootDir,
        mode,
        env: {},
        config: {},
        runtime: {}
    };

    await initProject(context);
    await loadEnv(context);
    await loadConfig(context);
    await initRuntime(context);

    return context;
}