import { loadEnv } from "./load-env";
import { loadConfig } from "./load-config";
import { initRuntime } from "./init-runtime";
import { initProject } from "./init-project";

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