import type { IncomingMessage, ServerResponse } from "node:http";

import type { Logger } from "./logger.js";
import type { ZeruxConfig, ZeruxStructureConfig } from "../index.js";

export type RuntimeMode = "dev" | "start";

export type MiddlewareFunction = (
    context: ZeruxRequestContext,
    next: () => Promise<void>
) => Promise<unknown> | unknown;

export type RouteHandler = (
    context: ZeruxRequestContext
) => Promise<unknown> | unknown;

export type ZeruxWorkerCleanup = () => Promise<void> | void;

export interface ZeruxWorkerContext {
    runtime: ZeruxRuntime;
    mode: RuntimeMode;
    config: ZeruxConfig;
    structure: ResolvedStructure;
    logger: Logger;
    env: NodeJS.ProcessEnv;
    state: Map<string, unknown>;
}

export type ZeruxWorkerHandler = (
    context: ZeruxWorkerContext
) => Promise<ZeruxWorkerCleanup | void> | ZeruxWorkerCleanup | void;

export interface ZeruxWorker {
    name: string;
    start: ZeruxWorkerHandler;
    meta?: Record<string, unknown>;
}

export type ZeruxWorkerInput = ZeruxWorkerHandler | Partial<ZeruxWorker> & {
    handler?: ZeruxWorkerHandler;
};

export interface ZeruxThreadWorkerOptions {
    name?: string;
    script: string | URL;
    minThreads?: number;
    maxThreads?: number;
    workerData?: unknown;
    meta?: Record<string, unknown>;
}

export type ZeruxThreadWorkerInput = string | URL | ZeruxThreadWorkerOptions;

export interface ZeruxThreadWorkerTaskOptions {
    timeoutMs?: number;
}

export interface ZeruxThreadWorkerPool {
    readonly name: string;
    readonly size: number;
    readonly minThreads: number;
    readonly maxThreads: number;
    start(): void;
    run<TPayload = unknown, TResult = unknown>(
        payload: TPayload,
        options?: ZeruxThreadWorkerTaskOptions
    ): Promise<TResult>;
    stop(): Promise<void>;
}

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
    /** Original request stream; use route.meta.streamBody to prevent pre-buffering. */
    requestStream: IncomingMessage;
    /** Cache policy for the current response; defaults to private when explicitly called. */
    setCache(policy: import("../response.js").ResponseCachePolicy): void;
    /** Convenience factory for a bounded streaming response. */
    stream(source: import("../response.js").StreamResult['source'], options?: import("../response.js").ResponseStreamOptions): import("../response.js").StreamResult;
    multisiteRegister(url: string, folderName: string): void;
    logger: Logger;
    config: ZeruxConfig;
    runtime: ZeruxRuntime;
    state: Record<string, unknown>;
    env: NodeJS.ProcessEnv;
    services: {
        get(name: import("./services.js").ServiceName): unknown;
        controllers: Record<string, unknown>;
        composables: Record<string, unknown>;
    };
}

export interface ZeruxPluginApi {
    /** Get an initialized generation-scoped database/cache/files/analytics/email manager. */
    service<T = unknown>(name: import("./services.js").ServiceName): T | undefined;
    /** Template variables are isolated to this runtime generation. */
    variables(): import('../variables.js').VariableRegistry;
    /** Register MCP, JSON-RPC, Connect, tRPC and SSE handlers before server startup. */
    protocols(): import("../protocols.js").ZeruxProtocols;
    getLoadStatus(windowMs?: number): import("../metrics.js").ApplicationHttpStatus;
    addRoute(route: RegisteredRouteInput): void;
    removeRoute(pattern: string, method?: string): void;
    addMiddleware(name: string, middleware: MiddlewareFunction): void;
    removeMiddleware(name: string): void;
    addWorker(name: string, worker: ZeruxWorkerInput): void;
    removeWorker(name: string): void;
    getWorker(name: string): ZeruxWorker | undefined;
    getWorkers(): ZeruxWorker[];
    addThreadWorker(name: string, worker: ZeruxThreadWorkerInput): void;
    removeThreadWorker(name: string): void;
    getThreadWorker(name: string): ZeruxThreadWorkerPool | undefined;
    getThreadWorkers(): ZeruxThreadWorkerPool[];
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
    serviceName: string;
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
    workers: Map<string, ZeruxWorker>;
    workerState: Map<string, unknown>;
    threadWorkers: Map<string, ZeruxThreadWorkerPool>;
    routes: DiscoveredRoute[];
    publicFiles: Map<string, string>;
    readonly protocolGateway?: import("../protocols.js").ZeruxProtocolGateway;
    closeProtocols(): void;
    readonly serviceScope: import("./services.js").RuntimeServiceScope;
    readonly variables: import('../variables.js').VariableRegistry;
    closeServices(): Promise<void>;
    getLoadStatus(windowMs?: number): import("../metrics.js").ApplicationHttpStatus;
    entryModulePath: string | null;
    createHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
    asPluginApi(): ZeruxPluginApi;
    toManifest(): Record<string, unknown>;
}
