import { loadEnv } from "./load-env.js";
import { loadConfig } from "./load-config.js";
import { initRuntime } from "./init-runtime.js";
import { initProject } from "./init-project.js";

export interface BootstrapContext {
    rootDir: string;
    mode: string;
    env: Record<string, string>;
    config: Record<string, any>;
    runtime: Record<string, any>;
}

export async function bootstrap({ rootDir, mode }: { rootDir: string; mode: string }): Promise<BootstrapContext> {
    const context: BootstrapContext = {
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