import type { IncomingMessage, ServerResponse } from "node:http";

import type { Logger } from "./logger.js";
import type { ZeruxConfig, ZeruxStructureConfig } from "../index.js";

export type RuntimeMode = "dev" | "start";

export type MiddlewareFunction = (
    context: ZeruxRequestContext,
    next: () => Promise<void>
) => Promise<void> | void;

export type RouteHandler = (
    context: ZeruxRequestContext
) => Promise<unknown> | unknown;

export interface LoadedModule<T = unknown> {
    key: string;
    absolutePath: string;
    relativePath: string;
    exports: T;
}

export interface DiscoveredRoute {
    id: string;
    absolutePath: string;
    relativePath: string;
    pattern: string;
    methods: Partial<Record<string, RouteHandler>>;
    middleware: string[];
    meta?: Record<string, unknown>;
}

export interface ZeruxRequestContext {
    req: IncomingMessage;
    res: ServerResponse;
    method: string;
    url: URL;
    pathname: string;
    params: Record<string, string>;
    query: URLSearchParams;
    body?: unknown;
    logger: Logger;
    config: ZeruxConfig;
    runtime: ZeruxRuntime;
    state: Record<string, unknown>;
    env: NodeJS.ProcessEnv;
    services: {
        controllers: Record<string, unknown>;
        composables: Record<string, unknown>;
    };
}

export interface ZeruxPluginApi {
    addRoute(route: RegisteredRouteInput): void;
    removeRoute(pattern: string, method?: string): void;
    addMiddleware(name: string, middleware: MiddlewareFunction): void;
    removeMiddleware(name: string): void;
    setComposable(name: string, value: unknown): void;
    setController(name: string, value: unknown): void;
    getConfig(): ZeruxConfig;
    getStructure(): ResolvedStructure;
}

export interface RegisteredRouteInput {
    pattern: string;
    method?: string;
    handler: RouteHandler;
    middleware?: string[];
    meta?: Record<string, unknown>;
    source?: string;
}

export interface ResolvedStructure {
    mode: "fix" | "dynamic" | "function";
    rootDir: string;
    entryPointName: string;
    appDir: string | null;
    middlewareDirs: string[];
    controllerDirs: string[];
    composableDirs: string[];
    pluginDirs: string[];
    envFiles: string[];
    publicDirs: string[];
    outputDir: string;
    raw: ZeruxStructureConfig;
}

export interface BootstrapResult {
    config: ZeruxConfig;
    structure: ResolvedStructure;
    runtime: ZeruxRuntime;
    manifestPath: string;
}

export interface ZeruxRuntime {
    rootDir: string;
    mode: RuntimeMode;
    config: ZeruxConfig;
    structure: ResolvedStructure;
    logger: Logger;
    middleware: Map<string, MiddlewareFunction>;
    controllers: Map<string, unknown>;
    composables: Map<string, unknown>;
    routes: DiscoveredRoute[];
    publicFiles: Map<string, string>;
    entryModulePath: string | null;
    createHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
    asPluginApi(): ZeruxPluginApi;
    toManifest(): Record<string, unknown>;
}
