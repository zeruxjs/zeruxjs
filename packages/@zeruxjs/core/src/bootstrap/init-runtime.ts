import type { BootstrapContext } from "./bootstap.js";

export async function initRuntime(context: BootstrapContext) {
    const container = new Map<string, any>();

    context.runtime.container = container;

    container.set("config", context.config);
    container.set("env", context.env);
}