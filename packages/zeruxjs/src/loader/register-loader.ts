import { register } from "node:module";
import { setLoaderService } from "./registry.js";

export interface LoaderOptions {
    /** Explicit local source root for CLI development/build; absent in production. */
    sourceRoot?: string;
}
export const registerLoader = (serviceName = "zerux", options: LoaderOptions = {}) => {
    setLoaderService(serviceName);

    // IMPORTANT: resolve relative to THIS FILE, not cwd
    const loaderUrl = new URL("./loader.js", import.meta.url);
    try {
        register(loaderUrl.href, { data: { serviceName, sourceRoot: options.sourceRoot } });
    } catch (err) {
        console.error("[zerux loader] Failed to register loader:", err);
    }
}