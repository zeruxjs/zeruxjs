import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Logger } from './logger.js';
import type { ZeruxConfig, ZeruxStructureConfig } from '../index.js';

export type RuntimeMode = 'dev' | 'start';

export type MiddlewareFunction = (
  context: ZeruxRequestContext,
  next: () => Promise<void>
) => Promise<unknown> | unknown;

export type RouteHandler = (
  context: ZeruxRequestContext
) => Promise<unknown> | unknown;

export type ZeruxWorkerCleanup = () => Promise<void> | void;

export interface ZeruxWorkerContext {
  /** Borrowed generation runtime owning registrations and service cleanup. */
  runtime: ZeruxRuntime;
  /** Explicit development or production-start mode. */
  mode: RuntimeMode;
  /** Private host configuration; use public projections before serialization. */
  config: ZeruxConfig;
  /** Resolved project paths and registration layout. */
  structure: ResolvedStructure;
  /** Borrowed runtime logger; do not close it from an individual handler. */
  logger: Logger;
  /** Private host environment; never a client configuration object. */
  env: NodeJS.ProcessEnv;
  /** Owner-local mutable state; its scope is defined by the enclosing worker/request contract. */
  state: Map<string, unknown>;
}

export type ZeruxWorkerHandler = (
  context: ZeruxWorkerContext
) => Promise<ZeruxWorkerCleanup | void> | ZeruxWorkerCleanup | void;

export interface ZeruxWorker {
  /** Stable host-authored registration name. */
  name: string;
  /** Trusted application worker startup callback returning its cleanup when needed. */
  start: ZeruxWorkerHandler;
  /** Trusted registration metadata; not an authorization decision. */
  meta?: Record<string, unknown>;
}

export type ZeruxWorkerInput =
  | ZeruxWorkerHandler
  | (Partial<ZeruxWorker> & {
      /** Trusted application callback, never executable browser input. */
      handler?: ZeruxWorkerHandler;
    });

export interface ZeruxThreadWorkerOptions {
  /** Stable host-authored registration name. */
  name?: string;
  /** Explicit host-selected worker script path or file URL. */
  script: string | URL;
  /** Configured minimum native thread count. */
  minThreads?: number;
  /** Configured maximum native thread count; not a queued-task capacity guarantee. */
  maxThreads?: number;
  /** Host-authored initialization payload passed through native structured cloning. */
  workerData?: unknown;
  /** Trusted registration metadata; not an authorization decision. */
  meta?: Record<string, unknown>;
}

export type ZeruxThreadWorkerInput = string | URL | ZeruxThreadWorkerOptions;

export interface ZeruxThreadWorkerTaskOptions {
  /** Caller wait deadline; timeout does not force-cancel arbitrary handler JavaScript. */
  timeoutMs?: number;
}

export interface ZeruxThreadWorkerPool {
  /** Stable host-authored registration name. */
  readonly name: string;
  /** Current native thread count reported by the pool. */
  readonly size: number;
  /** Configured minimum native thread count. */
  readonly minThreads: number;
  /** Configured maximum native thread count; not a queued-task capacity guarantee. */
  readonly maxThreads: number;
  /** Start this explicitly configured pool; runtime activation owns when workers are launched.
   * @returns {void} Startup scheduling completion, not a worker readiness receipt.
   */
  start(): void;
  /** Submit one payload to the configured worker pool; handler code and cooperative behavior remain host-owned.
   * @param {TPayload} payload - Structured-clone-compatible task input.
   * @param {ZeruxThreadWorkerTaskOptions} options - Optional caller task deadline.
   * @returns {Promise<TResult>} Worker result or task failure; timeout is not proof the handler stopped.
   */
  run<TPayload = unknown, TResult = unknown>(
    payload: TPayload,
    options?: ZeruxThreadWorkerTaskOptions
  ): Promise<TResult>;
  /** Stop the owned worker pool and settle native worker termination.
   * @returns {Promise<void>} Pool shutdown completion.
   */
  stop(): Promise<void>;
}

export interface LoadedModule<T = unknown> {
  /** Stable discovery registry key. */
  key: string;
  /** Private absolute source path. */
  absolutePath: string;
  /** Project-relative source path used for discovery diagnostics. */
  relativePath: string;
  /** Loaded trusted module exports. */
  exports: T;
}

export interface DiscoveredRoute {
  /** Stable discovered route identifier. */
  id: string;
  /** Private absolute source path. */
  absolutePath: string;
  /** Project-relative source path used for discovery diagnostics. */
  relativePath: string;
  /** Authored route pattern interpreted by the framework matcher. */
  pattern: string;
  /** Registered method-specific trusted route handlers. */
  methods: Partial<Record<string, RouteHandler>>;
  /** Ordered middleware names, or the runtime’s named callback map. */
  middleware: string[];
  /** Trusted registration metadata; not an authorization decision. */
  meta?: Record<string, unknown>;
}

export interface ZeruxRequestContext {
  /** Render through an explicit generation registration and request-owned cleanup scope.
   * @param {import('../renderers.js').RendererRegistration<V>} renderer - Registration issued by this generation renderer registry.
   * @param {NoInfer<V>} view - Validated renderer-specific view input.
   * @param {import('../renderers.js').RendererFeature} feature - Requested supported rendering mode.
   * @returns {Promise<import('../renderers.js').RendererResult>} Prepared render result; native response sending retains stream ownership.
   */
  render<V>(
    renderer: import('../renderers.js').RendererRegistration<V>,
    view: NoInfer<V>,
    feature?: import('../renderers.js').RendererFeature
  ): Promise<import('../renderers.js').RendererResult>;
  /** Borrowed request lifecycle context disposed at native response termination. */
  readonly requestLifecycle?: import('@zeruxjs/hooks').RequestHookContext;
  /** Borrowed native request stream. */
  req: IncomingMessage;
  /** Borrowed native response; commitment ends mutable header/status policy. */
  res: ServerResponse;
  /** Normalized request method or explicit registered HTTP method. */
  method: string;
  /** Parsed request URL; origin trust remains a host policy. */
  url: URL;
  /** Normalized matching path, distinct from query parameters. */
  pathname: string;
  /** Matched route parameter strings; handlers still validate domain input. */
  params: Record<string, string>;
  /** Parsed request query; values remain untrusted. */
  query: URLSearchParams;
  /** Parsed request body when buffering is enabled; validate before use. */
  body?: unknown;
  /** Original request stream; use route.meta.streamBody to prevent pre-buffering. */
  requestStream: IncomingMessage;
  /** Select an explicit HTTP response policy before response commitment.
   * @param {import('../response.js').ResponseCachePolicy} policy - Host-selected response cache policy, default private.
   * @returns {void} Request-local policy update.
   */
  setCache(policy: import('../response.js').ResponseCachePolicy): void;
  /** Wrap an explicitly transferred stream producer with response limits.
   * @param {import('../response.js').StreamResult['source']} source - Producer relinquished to the response sender.
   * @param {import('../response.js').ResponseStreamOptions} options - Optional status, headers and byte ceiling.
   * @returns {import('../response.js').StreamResult} Marked stream result requiring sender-owned cleanup.
   */
  stream(
    source: import('../response.js').StreamResult['source'],
    options?: import('../response.js').ResponseStreamOptions
  ): import('../response.js').StreamResult;
  /** Register an explicit host site-folder mapping through the runtime compatibility helper.
   * @param {string} url - Trusted host site URL.
   * @param {string} folderName - Trusted project folder name.
   * @returns {void} Mapping registration completion; host authorization remains external.
   */
  multisiteRegister(url: string, folderName: string): void;
  /** Borrowed runtime logger; do not close it from an individual handler. */
  logger: Logger;
  /** Private host configuration; use public projections before serialization. */
  config: ZeruxConfig;
  /** Borrowed generation runtime owning registrations and service cleanup. */
  runtime: ZeruxRuntime;
  /** Owner-local mutable state; its scope is defined by the enclosing worker/request contract. */
  state: Record<string, unknown>;
  /** Private host environment; never a client configuration object. */
  env: NodeJS.ProcessEnv;
  /** Borrowed generation service/controller/composable lookup projection. */
  services: {
    /** Read an initialized service by its declared runtime name.
     * @param {import('./service-definitions.js').RuntimeServiceName} name - Declared service key.
     * @returns {unknown} Borrowed service value; ownership remains with the generation scope.
     */
    get(name: import('./service-definitions.js').RuntimeServiceName): unknown;
    /** Registered trusted controllers; not serialized handler code. */
    controllers: Record<string, unknown>;
    /** Registered trusted composable values. */
    composables: Record<string, unknown>;
  };
}

export interface ZeruxPluginApi {
  /** Read the borrowed host lifecycle bus, when explicitly configured.
   * @returns {import('@zeruxjs/hooks/lifecycle').ServerLifecycleHooks | undefined} Borrowed bus; plugins must release their own registrations.
   */
  lifecycleHooks?():
    | import('@zeruxjs/hooks/lifecycle').ServerLifecycleHooks
    | undefined;
  /** Project only opted-in public GET routes into a bounded client manifest.
   * @param {import('../navigation-manifest.js').PublicRouteManifestOptions} options - Explicit origin, route and output policy.
   * @returns {import('../navigation-manifest.js').PublicRouteManifest} Public route descriptors excluding handlers and private source metadata.
   */
  navigationManifest(
    options: import('../navigation-manifest.js').PublicRouteManifestOptions
  ): import('../navigation-manifest.js').PublicRouteManifest;
  /** Read the generation-owned renderer registration authority.
   * @returns {import('../renderers.js').RendererRegistry} Borrowed registry; generation cleanup owns its lifetime.
   */
  renderers(): import('../renderers.js').RendererRegistry;
  /** Attach cleanup to this generation, including failed preparation.
   * @param {() => void | Promise<void>} cleanup - Trusted disposer returning actual asynchronous settlement when needed.
   * @returns {void} Cleanup registration completion.
   */
  onDispose(cleanup: () => void | Promise<void>): void;
  /** Check exact registered route and method presence without authorizing access.
   * @param {string} pattern - Registered route pattern.
   * @param {string} method - Explicit HTTP method.
   * @returns {boolean} Whether the route/method pair is already present.
   */
  hasRoute(pattern: string, method: string): boolean;
  /** Read an initialized generation service without transferring ownership.
   * @param {import('./service-definitions.js').RuntimeServiceName} name - Declared runtime service key.
   * @returns {T | undefined} Borrowed typed value, absent when not initialized.
   */
  service<T = unknown>(
    name: import('./service-definitions.js').RuntimeServiceName
  ): T | undefined;
  /** Read this generation’s template variable registry.
   * @returns {import('../variables.js').VariableRegistry} Generation-isolated variable registry.
   */
  variables(): import('../variables.js').VariableRegistry;
  /** Read the explicit protocol registration owner before server startup.
   * @returns {import('../protocols.js').ZeruxProtocols} Borrowed protocol owner; supported transports remain capability-specific.
   */
  protocols(): import('../protocols.js').ZeruxProtocols;
  /** Read bounded process-local HTTP completion measurements.
   * @param {number} windowMs - Optional supported rolling window in milliseconds.
   * @returns {import('../metrics.js').ApplicationHttpStatus} Retained sample measurements, not a durable complete traffic history.
   */
  getLoadStatus(
    windowMs?: number
  ): import('../metrics.js').ApplicationHttpStatus;
  /** Register trusted handler code with explicit path, method and metadata.
   * @param {RegisteredRouteInput} route - Authored route descriptor; browser claims never supply handler code.
   * @returns {void} Registration completion.
   */
  addRoute(route: RegisteredRouteInput): void;
  /** Remove a registered route, optionally limited to one method.
   * @param {string} pattern - Exact registered pattern.
   * @param {string} method - Optional method to remove.
   * @returns {void} Registration removal completion.
   */
  removeRoute(pattern: string, method?: string): void;
  /** Register explicit application middleware under a stable name.
   * @param {string} name - Authored middleware name.
   * @param {MiddlewareFunction} middleware - Trusted request middleware callback.
   * @returns {void} Registration completion.
   */
  addMiddleware(name: string, middleware: MiddlewareFunction): void;
  /** Remove a named middleware registration.
   * @param {string} name - Exact authored name.
   * @returns {void} Registration removal completion.
   */
  removeMiddleware(name: string): void;
  /** Register an application worker for runtime-owned startup and cleanup.
   * @param {string} name - Stable worker name.
   * @param {ZeruxWorkerInput} worker - Trusted worker callback or descriptor.
   * @returns {void} Registration completion; worker execution follows lifecycle activation.
   */
  addWorker(name: string, worker: ZeruxWorkerInput): void;
  /** Remove a named application worker registration.
   * @param {string} name - Exact registered worker name.
   * @returns {void} Registration removal completion.
   */
  removeWorker(name: string): void;
  /** Read a named registered application worker.
   * @param {string} name - Exact worker name.
   * @returns {ZeruxWorker | undefined} Borrowed descriptor, if present.
   */
  getWorker(name: string): ZeruxWorker | undefined;
  /** Read registered application worker descriptors.
   * @returns {ZeruxWorker[]} Current descriptors; runtime remains their lifecycle owner.
   */
  getWorkers(): ZeruxWorker[];
  /** Register an explicit trusted worker script and pool settings.
   * @param {string} name - Stable pool name.
   * @param {ZeruxThreadWorkerInput} worker - Host-authored script or pool descriptor.
   * @returns {void} Pool registration completion.
   */
  addThreadWorker(name: string, worker: ZeruxThreadWorkerInput): void;
  /** Remove a named thread-worker registration.
   * @param {string} name - Exact pool name.
   * @returns {void} Registration removal completion.
   */
  removeThreadWorker(name: string): void;
  /** Read a named thread pool without transferring shutdown ownership.
   * @param {string} name - Exact registered pool name.
   * @returns {ZeruxThreadWorkerPool | undefined} Borrowed pool, if registered.
   */
  getThreadWorker(name: string): ZeruxThreadWorkerPool | undefined;
  /** Read registered thread-worker pools.
   * @returns {ZeruxThreadWorkerPool[]} Borrowed pools; generation shutdown remains authoritative.
   */
  getThreadWorkers(): ZeruxThreadWorkerPool[];
  /** Register an application-owned composable value under an explicit name.
   * @param {string} name - Authored registry key.
   * @param {unknown} value - Trusted application value.
   * @returns {void} Registry update completion.
   */
  setComposable(name: string, value: unknown): void;
  /** Register an application-owned controller value under an explicit name.
   * @param {string} name - Authored registry key.
   * @param {unknown} value - Trusted application value.
   * @returns {void} Registry update completion.
   */
  setController(name: string, value: unknown): void;
  /** Read private runtime configuration for trusted server plugins only.
   * @returns {ZeruxConfig} Borrowed host configuration; not a public response projection.
   */
  getConfig(): ZeruxConfig;
  /** Read the generation’s resolved local project structure.
   * @returns {ResolvedStructure} Borrowed private filesystem/configuration descriptor.
   */
  getStructure(): ResolvedStructure;
}

export interface RegisteredRouteInput {
  /** Authored route pattern interpreted by the framework matcher. */
  pattern: string;
  /** Normalized request method or explicit registered HTTP method. */
  method?: string;
  /** Trusted application callback, never executable browser input. */
  handler: RouteHandler;
  /** Ordered middleware names, or the runtime’s named callback map. */
  middleware?: string[];
  /** Trusted registration metadata; not an authorization decision. */
  meta?: Record<string, unknown>;
  /** Private route source label used for diagnostics. */
  source?: string;
}

export interface ResolvedStructure {
  /** Explicit development or production-start mode. */
  mode: 'fix' | 'dynamic' | 'function';
  /** Trusted local project root. */
  rootDir: string;
  /** Host-selected runtime compatibility namespace. */
  serviceName: string;
  /** Configured application entry module name. */
  entryPointName: string;
  /** Resolved application directory, or null when absent. */
  appDir: string | null;
  /** Explicit middleware discovery directories. */
  middlewareDirs: string[];
  /** Explicit controller discovery directories. */
  controllerDirs: string[];
  /** Explicit composable discovery directories. */
  composableDirs: string[];
  /** Explicit trusted plugin discovery directories. */
  pluginDirs: string[];
  /** Host-selected private environment files. */
  envFiles: string[];
  /** Explicit public-file source directories. */
  publicDirs: string[];
  /** Configured build output directory. */
  outputDir: string;
  /** Original private structure settings retained for trusted runtime use. */
  raw: ZeruxStructureConfig;
}

export interface BootstrapResult {
  /** Private host configuration; use public projections before serialization. */
  config: ZeruxConfig;
  /** Resolved project paths and registration layout. */
  structure: ResolvedStructure;
  /** Borrowed generation runtime owning registrations and service cleanup. */
  runtime: ZeruxRuntime;
  /** Private runtime manifest destination. */
  manifestPath: string;
}

export interface ZeruxRuntime {
  /** Trusted local project root. */
  rootDir: string;
  /** Explicit development or production-start mode. */
  mode: RuntimeMode;
  /** Private host configuration; use public projections before serialization. */
  config: ZeruxConfig;
  /** Resolved project paths and registration layout. */
  structure: ResolvedStructure;
  /** Borrowed runtime logger; do not close it from an individual handler. */
  logger: Logger;
  /** Ordered middleware names, or the runtime’s named callback map. */
  middleware: Map<string, MiddlewareFunction>;
  /** Registered trusted controllers; not serialized handler code. */
  controllers: Map<string, unknown>;
  /** Registered trusted composable values. */
  composables: Map<string, unknown>;
  /** Registered application worker descriptors. */
  workers: Map<string, ZeruxWorker>;
  /** Worker lifecycle state retained by this runtime. */
  workerState: Map<string, unknown>;
  /** Registered native thread pools owned by runtime lifecycle. */
  threadWorkers: Map<string, ZeruxThreadWorkerPool>;
  /** Discovered registered routes with private handler references. */
  routes: DiscoveredRoute[];
  /** Public URL-to-local-file lookup, populated by explicit discovery. */
  publicFiles: Map<string, string>;
  /** Optional generation protocol gateway with its own transport lifecycle. */
  readonly protocolGateway?: import('../protocols.js').ZeruxProtocolGateway;
  /** Request closure of this runtime’s registered protocol gateway.
   * @returns {void} Close request completion; transport drain follows its owning gateway contract.
   */
  closeProtocols(): void;
  /** Generation-owned initialized service and cleanup scope. */
  readonly serviceScope: import('./services.js').RuntimeServiceScope;
  /** Generation-isolated template variable registry. */
  readonly variables: import('../variables.js').VariableRegistry;
  /** Close generation-owned services using their dependency-aware scope.
   * @returns {Promise<void>} Owned service shutdown settlement.
   */
  closeServices(): Promise<void>;
  /** Publish prepared compatibility service handles after generation preparation succeeds.
   * @returns {void} Activation callback completion.
   */
  activateServices(): void;
  /** Read the runtime’s bounded private operational health snapshot.
   * @returns {import('../observability.js').HealthSnapshot} Operational state without inventing external-provider health checks.
   */
  getHealthStatus(): import('../observability.js').HealthSnapshot;
  /** Read bounded redacted request-observer counters.
   * @returns {object} Observer status; request bodies and private labels are not included.
   */
  getTelemetryStatus(): ReturnType<
    typeof import('../observability.js').createRequestObserver
  >['status'] extends () => infer T
    ? T
    : never;
  /** Read bounded process-local HTTP completion measurements.
   * @param {number} windowMs - Optional supported rolling window in milliseconds.
   * @returns {import('../metrics.js').ApplicationHttpStatus} Retained sample measurements, not a durable complete traffic history.
   */
  getLoadStatus(
    windowMs?: number
  ): import('../metrics.js').ApplicationHttpStatus;
  /** Resolved private application entry path, or null when absent. */
  entryModulePath: string | null;
  /** Create a native request handler bound to this runtime generation.
   * @returns {Function} Asynchronous native request/response handler.
   */
  createHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  /** Project trusted registration and lookup APIs for this runtime generation.
   * @returns {ZeruxPluginApi} Generation-bound plugin authority, not a browser API.
   */
  asPluginApi(): ZeruxPluginApi;
  /** Project serializable runtime orientation using the runtime’s redaction boundary.
   * @returns {Record<string, unknown>} Manifest record; executable registrations remain runtime-owned.
   */
  toManifest(): Record<string, unknown>;
}
