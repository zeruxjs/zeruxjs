export interface DatabaseConnection {
    name: string;
    slug: string;
    connecter: string;
    options?: Record<string, string | number | boolean>;
}

export interface ZeruxStructureConfig {
    app?: string;
    middleware?: string | string[];
    controllers?: string | string[];
    composables?: string | string[];
    plugins?: string | string[];
    public?: string | string[];
    env?: string | string[];
}

export interface ZeruxServerConfig {
    port?: number;
    devPort?: number;
}

export interface ZeruxConfig {
    type?: "fix" | "dynamic" | "function";
    entryPoint?: string;
    outDir?: string;
    structure?: ZeruxStructureConfig;
    server?: ZeruxServerConfig;
    database?: {
        default?: string;
        connections?: DatabaseConnection[];
    };
    [key: string]: any;
}

export type { ZeruxPluginApi, ZeruxRequestContext } from "./bootstrap/types.js";
export { HttpError } from "./exceptions/http_error.js";
export { exceptionHandler } from "./exceptions/exception_handler.js";
export { logger, Logger } from "./bootstrap/logger.js";
