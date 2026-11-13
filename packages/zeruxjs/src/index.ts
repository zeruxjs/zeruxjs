export interface DatabaseConnection {
  /** Explicit named database connection identifier. */
  name: string;
  /** Stable connection lookup key owned by database configuration. */
  slug: string;
  /** Explicit database connector module selection. */
  connector?: string;
  /** Historical spelling retained in the public compatibility shape. */
  connecter?: string;
  /** Private connector-owned options; validate with the selected provider contract. */
  options?: Record<string, unknown>;
}

export interface DatabaseConfig {
  /** Database-owned pending/batch/deadline/metric policy, validated before startup. */
  execution?: import('@zeruxjs/db').DatabaseExecutionPolicy;
  /** Explicit default named database connection. */
  default?: string;
  /** Configured named database connections. */
  connections?: DatabaseConnection[];
  /** Historical connection-list field retained for compatibility. */
  connection?: DatabaseConnection[];
}

export interface ZeruxStructureConfig {
  /** Project-relative application source directory. */
  app?: string;
  /** Explicit project-relative middleware directories/files. */
  middleware?: string | string[];
  /** Explicit project-relative controller directories/files. */
  controllers?: string | string[];
  /** Explicit project-relative application helper directories/files. */
  composables?: string | string[];
  /** Explicit trusted server plugin directories/files; not request-selected imports. */
  plugins?: string | string[];
  /** Explicit public asset directories in precedence order; never put secrets here. */
  public?: string | string[];
  /** Explicit environment file paths; contents remain private host configuration. */
  env?: string | string[];
}

export interface ZeruxServerConfig {
  /** Configured server port; binding and conflicts belong to the hosting owner. */
  port?: number;
  /** Explicit development server port. */
  devPort?: number;
  /** Set false for direct loopback HTTP without managing the shared portless proxy. */
  portless?: boolean;
  /** Host-admission patterns; not user or tenant authorization. */
  allowedDomains?: string | string[];
  /** Explicit development host admitted by the existing host policy. */
  allowedDevDomain?: string;
  /** Up to 64 project-relative directories excluded from development source scans. */
  watchIgnoredPaths?: string[];
}

export interface ZeruxDevtoolsModuleConfig {
  /** Explicit trusted development module package name. */
  package: string;
  /** Explicitly opt in/out of this configured integration. */
  enabled?: boolean;
  /** Private connector-owned options; validate with the selected provider contract. */
  options?: Record<string, unknown>;
}

export interface ZeruxDevtoolsConfig {
  /** Explicit development module registrations; no arbitrary disk package discovery. */
  modules?: Array<string | ZeruxDevtoolsModuleConfig>;
}

export interface ZeruxWorkerConfig {
  /** Configured minimum native worker-thread pool size. */
  minThreads?: number;
  /** Configured maximum native worker-thread pool size. */
  maxThreads?: number;
}

export interface SecuritySaltsAndKeys {
  /** Private host nonce key material; never publish through client settings. */
  nonce?: string;
  /** Private host cookie key material. */
  cookie?: string;
  /** Private host session key material. */
  session?: string;
  /** Private host personal-token key material. */
  personalToken?: string;
  /** Private host password-related configuration; the owning auth provider defines semantics. */
  password?: string;
  /** Private host encryption key material. */
  encryption?: string;
  /** Private host peer-to-peer key material. */
  p2p?: string;
  [key: string]: string | undefined;
}

export interface SecurityConfig {
  /** Private host keyring settings; excluded from public projections. */
  keys?: SecuritySaltsAndKeys;
  /** Private host salt settings; excluded from public projections. */
  salts?: SecuritySaltsAndKeys;
  [key: string]: any;
}

export interface AuthConfig {
  [key: string]: any;
}

export interface ZeruxConfig {
  /** Borrowed explicit host lifecycle bus reused across generations and disposed by the host. */
  lifecycleHooks?: import('@zeruxjs/hooks').ServerLifecycleHooks;
  /** Private explicit tracing/error observers; no exporter starts merely on root import. */
  observability?: import('./observability.js').ObservabilityOptions;
  /** Explicit trusted service declarations; never public manifest data. */
  serviceDefinitions?: readonly import('./bootstrap/service-definitions.js').ServiceDefinition[];
  /** Namespaced custom-service settings/private options, validated against explicit definitions. */
  services?: Record<
    string,
    import('./bootstrap/service-definitions.js').CustomServiceConfig
  >;
  /** Intentional bounded JSON browser projection; the host must not hide secrets under innocent names. */
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
  /** Explicit application gateway policy; protocol declarations do not grant authorization. */
  protocols?: import('./protocols.js').ZeruxProtocolOptions;
  /** Existing application structure mode; not a renderer/runtime capability declaration. */
  type?: 'fix' | 'dynamic' | 'function';
  /** Trusted application entry basename/path consumed by the framework loader. */
  entryPoint?: string;
  /** Contained project build output directory; staging/path guards remain authoritative. */
  outDir?: string;
  /** Enable request-local host/path registrations without trusting browser tenant claims. */
  multisite?: boolean;
  /** Explicit project source-directory mapping. */
  structure?: ZeruxStructureConfig;
  /** Hosting and development source-watch policy. */
  server?: ZeruxServerConfig;
  /** Explicit development module configuration. */
  devtools?: ZeruxDevtoolsConfig;
  /** Native worker-thread pool defaults. */
  worker?: ZeruxWorkerConfig;
  /** Host-admission patterns; not user or tenant authorization. */
  allowedDomains?: string | string[];
  /** Explicit development host admitted by the existing host policy. */
  allowedDevDomain?: string;
  /** Explicit trusted database-manager integration selected by the host. */
  connectorManager?: string;
  /** Private database runtime settings, initialized within the generation. */
  db?: DatabaseConfig;
  /** Compatibility database configuration field. */
  database?: DatabaseConfig;
  /** Optional host-owned WebSocket policy. */
  websocket?: {
    /** Explicitly opt in/out of this configured integration. */
    enabled?: boolean;
    /** Explicit WebSocket path when this integration is enabled. */
    path?: string;
    /** Configured message byte ceiling passed to the owning transport. */
    maxPayload?: number;
  };
  /** Generation-owned scoped cache policy/provider settings. */
  cache?: {
    /** Cache-owned capability/resource/ownership policy checked before startup. */
    policy?: import('@zeruxjs/cache').CachePolicy;
    /** Explicit database connector module selection. */
    connector?: string;
    /** Private connector-owned options; validate with the selected provider contract. */
    options?: Record<string, unknown>;
    /** Application cache namespace prefix. */
    prefix?: string;
    /** Default cache TTL expressed in seconds. */
    defaultTtlSeconds?: number;
    /** Configured cache startup deadline in milliseconds. */
    startupTimeoutMs?: number;
    /** Whether failure must reject startup rather than degrade this integration. */
    required?: boolean;
  };
  /** Private host security integration settings; not a substitute for authorization. */
  security?: SecurityConfig;
  /** Private application-owned auth integration settings. */
  auth?: AuthConfig;
  /** Application theme presentation policy; it does not authorize access. */
  theme?: import('./theme.js').ThemeConfig;
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
  ZeruxThreadWorkerTaskOptions,
} from './bootstrap/types.js';
export {
  defineThreadWorker,
  defineWorker,
  registerThreadWorker,
  registerWorker,
  runWorkers,
  ThreadWorkerPool,
} from './bootstrap/worker.js';
export { HttpError } from './exceptions/http_error.js';
export { exceptionHandler } from './exceptions/exception_handler.js';
export { logger, Logger } from './bootstrap/logger.js';
export { redirect, isRedirectResponse, RedirectType } from './navigation.js';
export type { RedirectResponse } from './navigation.js';

export { createZeruxProtocols } from './protocols.js';
export type { ZeruxProtocols, ZeruxProtocolOptions } from './protocols.js';
export {
  cacheControl,
  applyCachePolicy,
  cached,
  stream,
  sendStream,
} from './response.js';
export type {
  ResponseCachePolicy,
  ResponseStreamOptions,
  StreamResult,
  CachedResult,
} from './response.js';

export { ApplicationHttpMetrics } from './metrics.js';
export type { ApplicationHttpStatus, HttpStatusFamily } from './metrics.js';

export {
  createFetchRoute,
  registerFetchRoutes,
  sendFetchResponse,
} from './fetch-route.js';
export type {
  FetchRouteHandler,
  FetchRouteRegistration,
} from './fetch-route.js';

export {
  createServiceScope,
  initializeRuntimeServices,
} from './bootstrap/services.js';
export type {
  RuntimeServiceScope,
  ServiceName,
  ServiceStatus,
  SearchStartupConfig,
} from './bootstrap/services.js';

export {
  buildProjectSources,
  resolveProductionStructure,
  ModuleBoundaryError,
} from './commands/project-builder.js';
export type {
  ProjectBuildOptions,
  ProductionBuildManifest,
} from './commands/project-builder.js';

export { redactManifestConfig } from './bootstrap/manifest-config.js';

export { createRequestLifecycle } from './bootstrap/request-lifecycle.js';

/** Application-scoped variable rendering with bounded literal placeholders and no expression execution. */
export {
  createVariableRegistry,
  variables,
  registerVariable,
  renderVariables,
} from './variables.js';
export type {
  VariableContext,
  VariableResolver,
  VariableEscape,
  VariableRenderOptions,
  VariableRegistry,
} from './variables.js';

export { defineService } from './bootstrap/service-definitions.js';
export type {
  ServiceDefinition,
  ServiceConfigSchema,
  ServiceStartContext,
  ServiceInstance,
  CustomServiceConfig,
  RuntimeServiceName,
} from './bootstrap/service-definitions.js';
export {
  resolveApplicationConfig,
  prepareConfiguration,
  assertConfigReloadable,
  ConfigurationError,
  RestartRequiredError,
} from './bootstrap/config-validation.js';
export type { ConfigLayers } from './bootstrap/config-validation.js';

export { createApplicationLifecycle } from './bootstrap/application-lifecycle.js';
export { loadConfig } from './bootstrap/config.js';

export {
  createRequestObserver,
  getRequestCorrelation,
  parseTraceParent,
  createHealthHandler,
} from './observability.js';
export type {
  ObservabilityOptions,
  TracingAdapter,
  RequestCorrelation,
  RequestSpan,
  HealthSnapshot,
} from './observability.js';
export {
  ApplicationError,
  APPLICATION_ERROR_CODES,
  normalizeApiError,
} from './exceptions/api-error.js';
export type { ErrorEnvelope } from './exceptions/api-error.js';

export * from './modules.js';
export * from './service-endpoints.js';
export * from './renderers.js';
