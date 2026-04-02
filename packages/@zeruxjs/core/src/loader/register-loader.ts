import { register } from "node:module";


export const registerLoader = () => {
    // IMPORTANT: resolve relative to THIS FILE, not cwd
    const loaderUrl = new URL("./loader.js", import.meta.url);
    try {
        register(loaderUrl.href);
    } catch (err) {
        console.error("[zerux loader] Failed to register loader:", err);
    }
}