export interface DatabaseConnection {
    name: string;
    slug: string;
    connector?: string;
    connecter?: string;
    options?: Record<string, unknown>;
}

export interface DatabaseConfig {
    execution?: import('@zeruxjs/db').DatabaseExecutionPolicy;
    default?: string;
    connections?: DatabaseConnection[];
    connection?: DatabaseConnection[];
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
    allowedDomains?: string | string[];
    allowedDevDomain?: string;
    /** Up to 64 project-relative directories excluded from development source scans. */
    watchIgnoredPaths?: string[];
}

export interface ZeruxDevtoolsModuleConfig {
    package: string;
    enabled?: boolean;
    options?: Record<string, unknown>;
}

export interface ZeruxDevtoolsConfig {
    modules?: Array<string | ZeruxDevtoolsModuleConfig>;
}

export interface ZeruxWorkerConfig {
    minThreads?: number;
    maxThreads?: number;
}

export interface SecuritySaltsAndKeys {
    nonce?: string;
    cookie?: string;
    session?: string;
    personalToken?: string;
    password?: string;
    encryption?: string;
    p2p?: string;
    [key: string]: string | undefined;
}

export interface SecurityConfig {
    keys?: SecuritySaltsAndKeys;
    salts?: SecuritySaltsAndKeys;
    [key: string]: any;
}

export interface AuthConfig {
    [key: string]: any;
}

export interface ZeruxConfig {
    lifecycleHooks?: import('@zeruxjs/hooks').ServerLifecycleHooks;
    observability?: import('./observability.js').ObservabilityOptions;
    /** Explicit trusted service declarations; never public manifest data. */
    serviceDefinitions?: readonly import('./bootstrap/service-definitions.js').ServiceDefinition[];
    services?: Record<string, import('./bootstrap/service-definitions.js').CustomServiceConfig>;
    publicSettings?: Record<string, unknown>;
    /** Named storage connections; initialized before email service. */
    files?: import('./bootstrap/services.js').FilesStartupConfig;
    /** Named SMTP providers. Never serialized into runtime manifests. */
    email?: import('./bootstrap/services.js').EmailStartupConfig;
    /** Best-effort telemetry backed by a named database connector. */
    analytics?: import('./bootstrap/services.js').AnalyticsStartupConfig;
    /** GA4-style event tags and browser ttag script, managed as a private service. */
    tags?: import('./bootstrap/services.js').TagsStartupConfig;
    /** Authenticated internal analytics report studio. */
    reports?: import('./bootstrap/services.js').ReportsStartupConfig;
    /** Legacy BullMQ or explicit backend selection. Credentials remain server-side. */
    queue?: import('./bootstrap/services.js').QueueStartupConfig;
    /** Explicit private search registration; no endpoint is mounted automatically. */
    search?: import('./bootstrap/services.js').SearchStartupConfig;
    protocols?: import("./protocols.js").ZeruxProtocolOptions;
    type?: "fix" | "dynamic" | "function";
    entryPoint?: string;
    outDir?: string;
    multisite?: boolean;
    structure?: ZeruxStructureConfig;
    server?: ZeruxServerConfig;
    devtools?: ZeruxDevtoolsConfig;
    worker?: ZeruxWorkerConfig;
    allowedDomains?: string | string[];
    allowedDevDomain?: string;
    connectorManager?: string;
    db?: DatabaseConfig;
    database?: DatabaseConfig;
    websocket?: {
        enabled?: boolean;
        path?: string;
        maxPayload?: number;
    };
    cache?: {
        policy?: import("@zeruxjs/cache").CachePolicy;
        connector?: string;
        options?: Record<string, unknown>;
        prefix?: string;
        defaultTtlSeconds?: number;
        startupTimeoutMs?: number;
        required?: boolean;
    };
    security?: SecurityConfig;
    auth?: AuthConfig;
    theme?: import("./theme.js").ThemeConfig;
    [key: string]: any;
}

export type {
    ZeruxPluginApi,
    ZeruxRequestContext,
    ZeruxWorker,
    ZeruxWorkerCleanup,
    ZeruxWorkerContext,
    ZeruxWorkerHandler,
    ZeruxWorkerInput,
    ZeruxThreadWorkerInput,
    ZeruxThreadWorkerOptions,
    ZeruxThreadWorkerPool,
    ZeruxThreadWorkerTaskOptions
} from "./bootstrap/types.js";
export {
    defineThreadWorker,
    defineWorker,
    registerThreadWorker,
    registerWorker,
    runWorkers,
    ThreadWorkerPool
} from "./bootstrap/worker.js";
export { HttpError } from "./exceptions/http_error.js";
export { exceptionHandler } from "./exceptions/exception_handler.js";
export { logger, Logger } from "./bootstrap/logger.js";
export { redirect, isRedirectResponse, RedirectType } from "./navigation.js";
export type { RedirectResponse } from "./navigation.js";

export { createZeruxProtocols } from "./protocols.js";
export type { ZeruxProtocols, ZeruxProtocolOptions } from "./protocols.js";
export { cacheControl, applyCachePolicy, cached, stream, sendStream } from "./response.js";
export type { ResponseCachePolicy, ResponseStreamOptions, StreamResult, CachedResult } from "./response.js";

export { ApplicationHttpMetrics } from "./metrics.js";
export type { ApplicationHttpStatus, HttpStatusFamily } from "./metrics.js";

export { createFetchRoute, registerFetchRoutes, sendFetchResponse } from "./fetch-route.js";
export type { FetchRouteHandler, FetchRouteRegistration } from "./fetch-route.js";

export { createServiceScope, initializeRuntimeServices } from "./bootstrap/services.js";
export type { RuntimeServiceScope, ServiceName, ServiceStatus, SearchStartupConfig } from "./bootstrap/services.js";

export { buildProjectSources, resolveProductionStructure, ModuleBoundaryError } from "./commands/project-builder.js";
export type { ProjectBuildOptions, ProductionBuildManifest } from "./commands/project-builder.js";

export { redactManifestConfig } from "./bootstrap/manifest-config.js";

export { createRequestLifecycle } from "./bootstrap/request-lifecycle.js";

/** Section 60: framework-wide, safe, application-configurable {{variable}} rendering. */
export {createVariableRegistry,variables,registerVariable,renderVariables} from './variables.js';
export type {VariableContext,VariableResolver,VariableEscape,VariableRenderOptions,VariableRegistry} from './variables.js';

export { defineService } from './bootstrap/service-definitions.js';
export type { ServiceDefinition, ServiceConfigSchema, ServiceStartContext, ServiceInstance, CustomServiceConfig, RuntimeServiceName } from './bootstrap/service-definitions.js';
export { resolveApplicationConfig, prepareConfiguration, assertConfigReloadable, ConfigurationError, RestartRequiredError } from './bootstrap/config-validation.js';
export type { ConfigLayers } from './bootstrap/config-validation.js';

export { createApplicationLifecycle } from './bootstrap/application-lifecycle.js';
export { loadConfig } from './bootstrap/config.js';

export { createRequestObserver, getRequestCorrelation, parseTraceParent, createHealthHandler } from './observability.js';
export type { ObservabilityOptions, TracingAdapter, RequestCorrelation, RequestSpan, HealthSnapshot } from './observability.js';
export { ApplicationError, APPLICATION_ERROR_CODES, normalizeApiError } from './exceptions/api-error.js';
export type { ErrorEnvelope } from './exceptions/api-error.js';

export * from './modules.js';
export * from './service-endpoints.js';
export * from './renderers.js';
