import type { QueueSelection } from '@zeruxjs/queue/neutral';
import { prepareConfiguration } from './config-validation.js';
import {
  startCustomServices,
  type RuntimeServiceName,
} from './service-definitions.js';
import path from 'node:path';
import type { ZeruxConfig } from '../index.js';
import { initializeDatabaseRuntime } from './database.js';
import { initializeCacheRuntime } from './cache.js';
import { serviceRouteOverlaps } from './service-http.js';

export type ServiceName =
  | 'database'
  | 'cache'
  | 'files'
  | 'analytics'
  | 'email'
  | 'tags'
  | 'reports'
  | 'queue'
  | 'search';
export type ServiceStatus = {
  /** Stable configured registration/account/storage identity. */
  name: RuntimeServiceName;
  /** Fixed service lifecycle state without private failure causes. */
  state: 'ready' | 'disabled' | 'degraded' | 'closed';
};
/** Framework-neutral Fetch endpoints owned by a single runtime generation. */
export interface ServiceHttpRoute {
  /** Explicit absolute service route pattern; overlaps reject before registration. */
  pattern: string;
  /** Trusted owning-package Fetch handler; request authorization remains mandatory. */
  handler: (request: Request) => Promise<Response> | Response;
}
export interface ScopedServiceHttpRoute extends ServiceHttpRoute {
  /** Declared runtime owner of this route or configured service value. */
  service: RuntimeServiceName;
}

/** Own explicitly registered generation service releases and reverse-order rollback; route-only registrations do not invent resource cleanup.
 * @param {Record<string, unknown>} publicConfig - Already prepared public-only configuration projection.
 * @returns {object} Owned service scope; initialize/activate/close remain distinct phases.
 */
export function createServiceScope(publicConfig: Record<string, unknown> = {}) {
  /** Generation-local initialized manager values; never a process-global request registry. */
  const services = new Map<RuntimeServiceName, unknown>();
  /** Captured explicit service Fetch routes; registration does not authorize requests. */
  const httpRoutes: ScopedServiceHttpRoute[] = [];
  /** Owned registered service cleanup receipts in acquisition order. */
  const releases: Array<{
    /** Stable configured registration/account/storage identity. */
    name: RuntimeServiceName;
    /** Explicit asynchronous service release receipt. */
    release: () => Promise<void>;
  }> = [];
  let closed = false;
  let closing: Promise<void> | undefined;
  /** Explicit absent/disabled service identities. */
  const disabled = new Set<RuntimeServiceName>();
  /** Optional services whose startup or route registration failed. */
  const degraded = new Set<RuntimeServiceName>();
  /** Private startup causes retained only for trusted diagnostics. */
  const failures = new Map<RuntimeServiceName, unknown>();
  /** Compatibility publication callbacks deferred until candidate generation activation. */
  const activations: (() => void)[] = [];
  let activated = false;
  return {
    /** Read the already prepared public-only configuration projection.
     * @returns {Record<string, unknown>} Public projection; never the private host service callback/key map.
     */
    publicConfig() {
      return publicConfig;
    },
    /** Read a detached map of private startup causes for trusted host diagnostics only.
     * @returns {Map<RuntimeServiceName, unknown>} Private causes; never serialize into public manifests.
     */
    errors() {
      return new Map(failures);
    },
    /** Defer a compatibility publication callback until generation activation succeeds.
     * @param {() => void} callback - Trusted synchronous compatibility publication callback.
     * @returns {void} Activation registration completion; closed or already activated scopes reject.
     */
    onActivate(callback: () => void) {
      if (closed || activated) {
        throw new Error('Service scope activation closed');
      }
      activations.push(callback);
    },
    /** Publish prepared compatibility handles once without reacquiring services.
     * @returns {void} Activation callback completion; publication failures remain explicit.
     */
    activate() {
      if (closed) {
        throw new Error('Service scope closed');
      }
      if (activated) {
        return;
      }
      for (const callback of activations) {
        callback();
      }
      activated = true;
    },
    /** Read through the declared service/store scope without transferring cleanup or trusting a browser identity.
     * @param {RuntimeServiceName} name - Declared runtime service identity.
     * @returns {T | undefined} Scoped borrowed value or the owning store’s missing result.
     */
    get<T = unknown>(name: RuntimeServiceName): T | undefined {
      return services.get(name) as T | undefined;
    },
    /** Register one initialized value with its exact release owner, or mark a missing value disabled.
     * @param {RuntimeServiceName} name - Declared built-in/custom service identity.
     * @param {unknown} value - Prepared manager value; null/undefined means disabled.
     * @param {() => Promise<void> | void} release - Optional explicit cleanup; otherwise preserve compatible close/disconnect behavior.
     * @returns {void} Ownership registration completion; duplicate/closed identities reject.
     */
    add(
      name: RuntimeServiceName,
      value: unknown,
      release?: () => Promise<void> | void
    ) {
      if (closed || services.has(name) || disabled.has(name)) {
        throw new Error(`Duplicate or closed runtime service: ${name}`);
      }
      if (value === null || value === undefined) {
        disabled.add(name);
        return;
      }
      services.set(name, value);
      /** Explicit release callback or the compatible close/disconnect fallback for this registered value. */
      const cleanup =
        release ??
        /** Release a registered owned value through its compatible lifecycle method.
         * @returns {void | Promise<void>} Actual manager cleanup settlement, when asynchronous.
         */
        (() => {
          /** Borrowed initialized manager inspected for compatible cleanup methods. */
          const item = value as {
            /** Owning-service cleanup contract; borrowed resources follow their owner policy. */
            close?: () => Promise<void> | void;
            disconnect?: () => Promise<void> | void;
          };
          if (typeof item.close === 'function') {
            return item.close();
          }
          return item.disconnect?.();
        });
      releases.push({
        name,
        release: async () => {
          await cleanup();
        },
      });
    },
    /** Record optional startup degradation without inventing a ready service.
     * @param {RuntimeServiceName} name - Declared runtime service identity.
     * @param {unknown} error - Optional private cause for trusted diagnostics.
     * @returns {void} Fixed state/optional cause update.
     */
    markDegraded(name: RuntimeServiceName, error?: unknown) {
      degraded.add(name);
      if (error) {
        failures.set(name, error);
      }
    },
    /** Validate an entire explicit route batch for overlap before mutation; service handlers still own fresh request authorization.
     * @param {RuntimeServiceName} service - Declared owner used for private route orientation.
     * @param {readonly ServiceHttpRoute[]} routes - Explicit absolute non-root Fetch handlers.
     * @returns {void} Atomic local route registration completion, not a listener startup.
     */
    addHttpRoutes(
      service: RuntimeServiceName,
      routes: readonly ServiceHttpRoute[]
    ) {
      if (closed) {
        throw new Error(
          'Cannot register HTTP routes on a closed service scope'
        );
      }
      // Check the entire batch before mutating the live scope. Dynamic paths and
      // catch-alls can shadow routes even when their strings differ.
      /** Whole-batch existing/candidate route patterns checked before any live route mutation. */
      const accepted = httpRoutes.map((route) => route.pattern);
      for (const route of routes) {
        if (
          typeof route.pattern !== 'string' ||
          !/^\/(?:[A-Za-z0-9_.~:*-]+)(?:\/[A-Za-z0-9_.~:*-]+)*\/?$/.test(
            route.pattern
          ) ||
          route.pattern === '/' ||
          route.pattern.includes('..') ||
          route.pattern.includes('//') ||
          route.pattern.includes('?') ||
          route.pattern.includes('#') ||
          typeof route.handler !== 'function'
        ) {
          throw new TypeError('Invalid service HTTP route');
        }
        if (accepted.includes(route.pattern)) {
          throw new Error(`Duplicate service HTTP route: ${route.pattern}`);
        }
        if (
          accepted.some((existing) =>
            serviceRouteOverlaps(existing, route.pattern)
          )
        ) {
          throw new Error(`Conflicting service HTTP route: ${route.pattern}`);
        }
        accepted.push(route.pattern);
      }
      httpRoutes.push(...routes.map((route) => ({ ...route, service })));
    },
    /** Read a fresh route-list snapshot without transferring service or handler ownership.
     * @returns {readonly ScopedServiceHttpRoute[]} Explicit captured Fetch route descriptors.
     */
    httpRoutes(): readonly ScopedServiceHttpRoute[] {
      return [...httpRoutes];
    },
    /** Project fixed service names and lifecycle states without settings, credentials or cause payloads.
     * @returns {ServiceStatus[]} Generation-local readiness/degradation/disabled/closed state.
     */
    status(): ServiceStatus[] {
      return (
        [
          'database',
          'cache',
          'files',
          'analytics',
          'email',
          ...(services.has('tags') || degraded.has('tags') ? ['tags'] : []),
          ...(services.has('reports') || degraded.has('reports')
            ? ['reports']
            : []),
          ...(services.has('search') ? ['search'] : []),
          ...(services.has('queue') || degraded.has('queue') ? ['queue'] : []),
          ...new Set(
            [...services.keys(), ...disabled, ...degraded].filter((name) =>
              name.startsWith('custom:')
            )
          ),
        ] as RuntimeServiceName[]
      ).map((name) => {
        /** Fresh fixed-label state projection; private failure causes never enter it. */
        const status: ServiceStatus = { name, state: 'closed' };
        if (closed) {
          return status;
        }
        if (degraded.has(name)) {
          status.state = 'degraded';
        } else if (services.has(name)) {
          status.state = 'ready';
        } else {
          status.state = 'disabled';
        }
        return status;
      });
    },
    /** Release this owner’s resources under its declared lifecycle; borrowed dependencies remain with their host.
     * @returns {Promise<void>} Actual owned cleanup settlement when asynchronous.
     */
    async close() {
      if (closing) {
        return closing;
      }
      closed = true;
      closing = (async () => {
        /** Actual release failures collected while remaining reverse-order cleanup continues. */
        const errors: unknown[] = [];
        for (const { release } of [...releases].reverse()) {
          try {
            await release();
          } catch (error) {
            errors.push(error);
          }
        }
        services.clear();
        httpRoutes.length = 0;
        if (errors.length) {
          throw new AggregateError(
            errors,
            'Failed to close one or more Zerux services'
          );
        }
      })();
      return closing;
    },
  };
}
export type RuntimeServiceScope = ReturnType<typeof createServiceScope>;

export interface FilesStartupConfig {
  /** Configured named store selected by the files owner. */
  defaultStorage?: string;
  /** Explicit named local/S3 providers; no automatic infrastructure setup. */
  stores: Array<{
    /** Stable configured registration/account/storage identity. */
    name: string;
    /** Explicit owning-package provider or event kind. */
    type: 'local' | 's3';
    /** Host-configured local storage root resolved inside the selected application policy. */
    root?: string;
    /** Private provider options; never a browser configuration projection. */
    options?: Record<string, unknown>;
    /** Explicit storage bucket allowlist enforced by files. */
    allowedBuckets?: string[];
    /** Explicit MIME/type policy enforced by files. */
    allowedTypes?: string[];
    /** Explicit write prohibition for the named storage. */
    readonly?: boolean;
    /** Owning-package byte budget; semantics remain provider-specific. */
    maxBytes?: number;
    /** Configured storage namespace; not an authorization substitute. */
    keyPrefix?: string;
  }>;
  /** Optional bounded files metadata cache policy. */
  cache?: {
    /** Owning-package cache entry ceiling. */
    maxEntries?: number; /** Owning-package byte budget; semantics remain provider-specific. */
    maxBytes?: number; /** Configured signed-link/cache lifetime in milliseconds. */
    ttlMs?: number;
  };
}
export interface EmailTrackingStartupConfig {
  /** Explicit opt-in/disable flag consumed before owning-package initialization. */
  enabled?: boolean;
  /** Explicit public link origin/base; never derived from untrusted request Host. */
  baseUrl: string;
  /** Legacy single-secret mode, or use keyRing to rotate signing keys. */
  secret?: string;
  /** Private current/previous signing credentials for explicit key rotation. */
  keyRing?: {
    /** Current private signing key record. */
    current: {
      /** Opaque configured key/event/message identity. */
      id: string; /** Private host signing material; never emitted in public configuration. */
      secret: string;
    };
    /** Explicit retained verification keys; rotation retention stays host-owned. */
    previous?: Array<{
      /** Opaque configured key/event/message identity. */
      id: string; /** Private host signing material; never emitted in public configuration. */
      secret: string;
    }>;
  };
  /** Optional compatibility switch for legacy readable HMAC links. */
  acceptLegacyHmac?: boolean;
  /** Configured endpoint mount path. */
  path?: string;
  /** Configured signed-link/cache lifetime in milliseconds. */
  ttlMs?: number;
  /** Explicit outbound link host policy. */
  allowedLinkHosts?: string[];
  /** Bounded optional tracking-storage wait policy. */
  telemetryTimeoutMs?: number;
  /** Bounded optional tracking-storage work. */
  maxPendingTelemetry?: number;
  /** Optional shared durable aggregation adapter. Independent of marketing consent. */
  activityStore?: {
    /** Persist one owning-service observation under the host’s durability, scope and deduplication contract.
     * @param {{ kind: 'sent' | 'open' | 'click' | 'download_click' | 'download'; id: string; account: string; campaign: string; at: number; linkId?: string; bytes?: number; }} event - Owning-service event metadata, bound and validated by that service/host.
     * @param {'sent' | 'open' | 'click' | 'download_click' | 'download'} event.kind - Fixed owning-package event classification.
     * @param {string} event.id - Opaque configured key/event/message identity.
     * @param {string} event.account - Explicit configured account namespace, never a browser role claim.
     * @param {string} event.campaign - Explicit campaign identity; request access is checked separately.
     * @param {number} event.at - Owning-package event time metadata.
     * @param {string} event.linkId - Opaque tracking link identity without recipient payload.
     * @param {number} event.bytes - Observed transfer byte count only.
     * @returns {Promise<void>} Owning-service contract result; no broader capability or durability is inferred.
     */
    record(event: {
      /** Fixed owning-package event classification. */
      kind: 'sent' | 'open' | 'click' | 'download_click' | 'download';
      /** Opaque configured key/event/message identity. */
      id: string;
      /** Explicit configured account namespace, never a browser role claim. */
      account: string;
      /** Explicit campaign identity; request access is checked separately. */
      campaign: string;
      /** Owning-package event time metadata. */
      at: number;
      /** Opaque tracking link identity without recipient payload. */
      linkId?: string;
      /** Observed transfer byte count only. */
      bytes?: number;
    }): Promise<void>;
    /** Read through the declared service/store scope without transferring cleanup or trusting a browser identity.
     * @param {string} id - Opaque scoped record/request identity.
     * @returns {Promise<unknown>} Scoped borrowed value or the owning store’s missing result.
     */
    get(id: string): Promise<unknown>;
  };
}
export interface EmailPreferencesStartupConfig {
  /** Explicit opt-in/disable flag consumed before owning-package initialization. */
  enabled?: boolean;
  /** Explicit public link origin/base; never derived from untrusted request Host. */
  baseUrl: string;
  /** Private host signing material; never emitted in public configuration. */
  secret: string;
  /** Configured endpoint mount path. */
  path?: string;
  /** Bounded preference link maximum age. */
  maxAgeMs?: number;
  /** Bounded preference write deadline. */
  postTimeoutMs?: number;
  /** Shared durable adapter supplied by the host; optional for development only. */
  store?: {
    /** Read through the declared service/store scope without transferring cleanup or trusting a browser identity.
     * @param {string} email - Private normalized preference lookup identity; never a public diagnostic label.
     * @returns {Promise<unknown>} Scoped borrowed value or the owning store’s missing result.
     */
    get(email: string): Promise<unknown>;
    /** Persist a host-authorized preference record independently of optional tracking collection.
     * @param {string} email - Private normalized preference lookup identity; never a public diagnostic label.
     * @param {unknown} record - Host-approved preference record.
     * @returns {Promise<void>} Owning-service contract result; no broader capability or durability is inferred.
     */
    set(email: string, record: unknown): Promise<void>;
  };
}
export interface AnalyticsCollectorStartupConfig {
  /** Explicit endpoint/provider namespace. */
  prefix?: string;
  /** Exact configured browser origin policy, independent of session authorization. */
  allowedOrigins?: string[];
  /** Private server collection credential, omitted from public manifests. */
  serverToken?: string;
  /** Bounded HTTP input bytes. */
  maxBodyBytes?: number;
  /** Bounded body reader deadline. */
  bodyTimeoutMs?: number;
  /** Bounded actual body-reader work. */
  maxConcurrentReads?: number;
  /** Configured event admission ceiling. */
  maxEventsPerMinute?: number;
  /** Bounded optional collection-storage wait. */
  storageTimeoutMs?: number;
  /** Bounded actual collection-storage work. */
  maxPendingEvents?: number;
}
/** Admin routes appear only with host-application session authentication. No bundled default passwords. */
export interface TagsStartupConfig {
  /** Explicit opt-in/disable flag consumed before owning-package initialization. */
  enabled?: boolean;
  /** Explicit endpoint/provider namespace. */
  prefix?: string;
  /** Server-configured analytics site binding, not a saved browser query override. */
  site?: string;
  /** Explicit public UI/API origin. */
  publicOrigin?: string;
  /** Exact configured browser origin policy, independent of session authorization. */
  allowedOrigins?: string[];
  /** Private server collection credential, omitted from public manifests. */
  serverToken?: string;
  /** Host-owned shared request-ID reservation contract; process fallback is explicitly limited. */
  requestIds?: {
    /** Atomically reserve the explicit day/request identity under the host shared-store contract.
     * @param {string} day - Explicit UTC request-ID reservation partition.
     * @param {string} id - Opaque scoped record/request identity.
     * @returns {Promise<boolean>} Explicit conflict/reservation result from the owning durable contract.
     */
    reserve(day: string, id: string): Promise<boolean>;
  };
  /** Explicit host persistence owner; durability is never inferred from an object alone. */
  store?: {
    /** Read the current host-owned versioned private document without executing its contents.
     * @returns {Promise<unknown>} Owning-service contract result; no broader capability or durability is inferred.
     */
    load(): Promise<unknown>;
    /** Compare-and-set one validated private document; stale expected versions must not silently overwrite current state.
     * @param {unknown} container - Validated inert versioned tag definition.
     * @param {number} expectedVersion - Expected current revision for optimistic conflict detection.
     * @returns {Promise<boolean>} Explicit conflict/reservation result from the owning durable contract.
     */
    save(container: unknown, expectedVersion: number): Promise<boolean>;
  };
  /** Explicit trusted validated container definition, not executable strings. */
  container?: unknown;
  /** Private destination credentials retained server-side. */
  credentials?: Record<
    string,
    {
      /** Private host signing material; never emitted in public configuration. */
      secret: string;
    }
  >;
  /** Explicit configured destination references and host policy. */
  destinations?: Record<
    string,
    {
      /** Explicit host-selected provider endpoint/public link URL. */
      url: string; /** Private configured destination request headers. */
      headers?: Record<string, string>;
    }
  >;
  /** Fresh host administrator session authorization callback. */
  authorizeAdmin?: (request: Request) => boolean | Promise<boolean>;
  /** Fresh host publication authorization callback. */
  authorizePublish?: (request: Request) => boolean | Promise<boolean>;
  /** Explicit consent-before-browser-dispatch policy. */
  requireBrowserConsent?: boolean;
  /** Configured origin/site binding, not a caller-selected tenant. */
  siteByOrigin?: Record<string, string>;
  /** Explicit documented known-bot filtering policy. */
  botPolicy?: 'allow' | 'drop-known';
  /** Private host diagnostic observer. */
  onWarning?: (message: string) => void;
  /** Explicit dashboard host binding, separate from authorization. */
  dashboardHost?: string;
  /** Explicit private development diagnostics opt-in. */
  debug?: boolean;
  /** Configured collection default; fresh consent checks remain owner-enforced. */
  defaultConsent?: 'granted' | 'denied';
  /** Private host debug observer; do not expose credentials or subject values. */
  onDebug?: (data: unknown) => void;
  /** Bounded HTTP input bytes. */
  maxBodyBytes?: number;
  /** Configured event admission ceiling. */
  maxEventsPerMinute?: number;
}
export interface ReportsStartupConfig {
  /** Explicit opt-in/disable flag consumed before owning-package initialization. */
  enabled?: boolean;
  /** Explicit endpoint/provider namespace. */
  prefix?: string;
  /** Fresh host operation/resource authorization callback. */
  authorize: (
    request: Request,
    action?: 'read' | 'edit' | 'export' | 'sensitive' | 'campaign',
    resourceId?: string
  ) => boolean | Promise<boolean>;
  /** Explicit dashboard host binding, separate from authorization. */
  dashboardHost?: string;
  /** Explicit host persistence owner; durability is never inferred from an object alone. */
  store?: {
    /** Read the current host-owned versioned private document without executing its contents.
     * @returns {Promise<any>} Owning-service contract result; no broader capability or durability is inferred.
     */
    load(): Promise<any>;
    /** Compare-and-set one validated private document; stale expected versions must not silently overwrite current state.
     * @param {any} document - Validated inert versioned report document.
     * @param {number} expectedVersion - Expected current revision for optimistic conflict detection.
     * @returns {Promise<boolean>} Explicit conflict/reservation result from the owning durable contract.
     */
    save(document: any, expectedVersion: number): Promise<boolean>;
  };
  /** Explicit authorized report source contract. */
  source?: {
    /** Read a bounded authorized analytics event query through the configured source owner.
     * @param {any} query - Bounded host-authorized source query; saved browser definitions cannot override tenant scope.
     * @returns {Promise<any[]>} Owning-service contract result; no broader capability or durability is inferred.
     */
    events(query: any): Promise<any[]>;
    /** Optional connector-owned aggregate execution, not arbitrary SQL from saved reports. */
    aggregate?: (query: any) => Promise<any>;
    /** Optional bounded numeric-sidecar aggregation. */
    aggregateNumeric?: (query: any) => Promise<any>;
    /** Owning-source numeric coverage/capability check. */
    supportsNumericField?: (field: string) => boolean;
  };
  /** Host request-to-site/store binding, never a saved report claim. */
  resolveScope?: (request: Request) =>
    | Promise<{
        /** Server-configured analytics site binding, not a saved browser query override. */
        site: string;
        /** Explicit host persistence owner; durability is never inferred from an object alone. */
        store: {
          /** Read the current host-owned versioned private document without executing its contents.
           * @returns {Promise<any>} Owning-service contract result; no broader capability or durability is inferred.
           */
          load(): Promise<any>;
          /** Compare-and-set one validated private document; stale expected versions must not silently overwrite current state.
           * @param {any} document - Validated inert versioned report document.
           * @param {number} expectedVersion - Expected current revision for optimistic conflict detection.
           * @returns {Promise<boolean>} Explicit conflict/reservation result from the owning durable contract.
           */
          save(document: any, expectedVersion: number): Promise<boolean>;
        };
        /** Explicit authorized report source contract. */
        source?: ReportsStartupConfig['source'];
      }>
    | {
        /** Server-configured analytics site binding, not a saved browser query override. */
        site: string;
        /** Explicit host persistence owner; durability is never inferred from an object alone. */
        store: {
          /** Read the current host-owned versioned private document without executing its contents.
           * @returns {Promise<any>} Owning-service contract result; no broader capability or durability is inferred.
           */
          load(): Promise<any>;
          /** Compare-and-set one validated private document; stale expected versions must not silently overwrite current state.
           * @param {any} document - Validated inert versioned report document.
           * @param {number} expectedVersion - Expected current revision for optimistic conflict detection.
           * @returns {Promise<boolean>} Explicit conflict/reservation result from the owning durable contract.
           */
          save(document: any, expectedVersion: number): Promise<boolean>;
        };
        /** Explicit authorized report source contract. */
        source?: ReportsStartupConfig['source'];
      };
  /** Explicit read-only campaign report callbacks. */
  campaigns?: {
    /** Host-authorized campaign report query callback. */
    report: (
      code: string,
      options: {
        /** Opaque owning-store continuation cursor. */
        cursor: string | null; /** Explicit bounded page size. */
        limit: number; /** Server-configured analytics site binding, not a saved browser query override. */
        site?: string;
      }
    ) => Promise<any>;
    /** Optional campaign measurement report, not a provider reputation claim. */
    performance?: (code: string, site?: string) => Promise<unknown>;
    /** Optional UTC-day campaign trend query callback. */
    dailyTrends?: (
      code: string,
      from: string,
      to: string,
      site?: string
    ) => Promise<unknown>;
    /** Optional bounded campaign activity query callback. */
    activity?: (
      code: string,
      from: string,
      to: string,
      site?: string
    ) => Promise<unknown>;
  };
  /** Maximum source rows retained by the report owner. */
  maxSourceRows?: number;
  /** Restrict every report query to one analytics site, independent of saved chart definitions. */
  site?: string;
}
/** Queue workers run only when explicitly configured. Redis config stays private. */
export type QueueStartupConfig =
  | LegacyQueueStartupConfig
  | {
      /** Explicit opt-in/disable flag consumed before owning-package initialization. */
      enabled?: boolean; /** Whether failure must abort startup; optional degradation remains explicit. */
      required?: boolean; /** Private explicit neutral backend selection/factory authority. */
      selection: QueueSelection;
    };
export interface LegacyQueueStartupConfig {
  /** Explicit opt-in/disable flag consumed before owning-package initialization. */
  enabled?: boolean;
  /** Whether failure must abort startup; optional degradation remains explicit. */
  required?: boolean;
  /** Private legacy BullMQ connection policy; not browser configuration. */
  redis: {
    /** Explicit host-selected provider endpoint/public link URL. */
    url?: string;
    /** Explicit configured service endpoint host. */
    host?: string;
    /** Explicit configured service endpoint port. */
    port?: number;
    /** Private provider identity; omitted from public settings. */
    username?: string;
    /** Private provider credential; omitted from public settings. */
    password?: string;
    /** Explicit Redis logical database selection. */
    db?: number;
    /** Host-owned verified transport security settings. */
    tls?: Record<string, unknown>;
    /** Explicit native Cluster seed configuration. */
    cluster?: {
      /** Explicit configured seed endpoints. */
      nodes: Array<{
        /** Explicit configured service endpoint host. */
        host: string; /** Explicit configured service endpoint port. */
        port: number;
      }>;
    };
    /** Configured storage namespace; not an authorization substitute. */
    keyPrefix?: never;
  };
  /** Explicit endpoint/provider namespace. */
  prefix?: string;
  /** Explicit queue names/default job policy. */
  queues: Array<
    | string
    | {
        /** Stable configured registration/account/storage identity. */
        name: string; /** Owning-backend enqueue defaults; unsupported capabilities must reject. */
        defaultJobOptions?: Record<string, unknown>;
      }
  >;
  /** Explicit trusted queue processors; disabled unless configured. */
  workers?: Record<
    string,
    {
      /** Trusted registered worker callback, never a model/request-supplied command. */
      processor: (job: unknown) => Promise<unknown> | unknown;
      /** Configured actual worker concurrency. */
      concurrency?: number;
      /** Explicit backend worker activation policy. */
      autorun?: boolean;
      /** Owning-backend lease duration. */
      lockDuration?: number;
      /** Explicit backend-supported admission policy. */
      limiter?: {
        /** Configured backend policy maximum. */
        max: number; /** Configured backend time interval. */
        duration: number;
      };
    }
  >;
  /** Bounded backend readiness wait. */
  readyTimeoutMs?: number;
  /** Bounded cooperative worker drain policy. */
  shutdownGraceMs?: number;
  /** Private worker cause observer; no payload forwarding. */
  onWorkerError?: (queue: string, error: unknown) => void;
  /** Optional Redis-stream job lifecycle events; payloads are never forwarded to callbacks. */
  events?: {
    /** Explicit opt-in/disable flag consumed before owning-package initialization. */
    enabled: true;
    /** Fixed lifecycle metadata callback without job payloads. */
    onEvent?: (event: {
      queue: string;
      /** Explicit owning-package provider or event kind. */
      type: string;
      /** Opaque job reference, not private body content. */
      jobId?: string;
      /** Owning-package event time metadata. */
      at: string;
    }) => void;
    /** Private owning-package cause observer. */
    onError?: (queue: string, error: unknown) => void;
  };
  /** Host-validated operations authorization. Queue management is never exposed as public routes. */
  dashboard?: {
    /** Fresh host operation/resource authorization callback. */
    authorize: (request: Request) => unknown | Promise<unknown>;
    /** Fresh host write-origin/session CSRF verification callback. */
    verifyCsrf: (
      request: Request,
      principal: unknown
    ) => boolean | Promise<boolean>;
    /** Host-issued session-bound CSRF token callback. */
    csrfToken: (
      request: Request,
      principal: unknown
    ) => string | Promise<string>;
    /** Explicit endpoint/provider namespace. */
    prefix?: string;
    /** Explicit public UI/API origin. */
    publicOrigin?: string;
  };
  /** Explicit server-only privileged queue operations policy. */
  administration?: {
    /** Fresh host operation/resource authorization callback. */
    authorize: (
      action:
        | 'inspect'
        | 'retry'
        | 'pause-queue'
        | 'resume-queue'
        | 'pause-worker'
        | 'resume-worker'
        | 'schedule-inspect'
        | 'schedule-create'
        | 'schedule-remove',
      queue: string,
      context: unknown
    ) => boolean | Promise<boolean>;
    /** Host-owned metadata-only privileged operation audit sink. */
    onAudit?: (entry: {
      /** Explicit owning-service operation name, not an authorization grant. */
      action: string;
      queue: string;
      /** Opaque job reference, not private body content. */
      jobId?: string;
      /** Observed authorized operation outcome. */
      success: boolean;
      /** Owning-package event time metadata. */
      at: string;
    }) => void | Promise<void>;
    /** Bounded management query page size. */
    maxPageSize?: number;
  };
}
export interface EndpointProvider {
  /** Project explicit owning-service Fetch routes; the host still enforces request/session/origin policy.
   * @returns {ServiceHttpRoute[]} Owning-service contract result; no broader capability or durability is inferred.
   */
  routes(): ServiceHttpRoute[];
  /** Release this owner’s resources under its declared lifecycle; borrowed dependencies remain with their host.
   * @returns {void | Promise<void>} Actual owned cleanup settlement when asynchronous.
   */
  close?(): void | Promise<void>;
}
export interface EmailStartupConfig {
  /** Private explicit sending/receiving account configuration. */
  accounts?: Array<Record<string, unknown>>;
  /** Optional receive-only or combined SMTP/IMAP/POP3 runtime. Inbound credentials are server-only. */
  receive?: {
    /** Explicit opt-in/disable flag consumed before owning-package initialization. */
    enabled?: boolean;
    /** Required only for the built-in persistent inbox. */
    database?: string;
    /** Explicit host table mapping; no migrations occur unless opted in. */
    table?: string;
    /** Existing application-owned inbox table mapping. No schema changes unless createTable=true. */
    mapping?: {
      /** Explicit host table mapping; no migrations occur unless opted in. */
      table: string;
      /** Explicit schema creation opt-in; no hidden migration is inferred. */
      createTable?: boolean;
      /** Host-authored existing inbox column mapping. */
      columns?: {
        /** Opaque configured key/event/message identity. */
        id?: string;
        /** Explicit configured account namespace, never a browser role claim. */
        account?: string;
        /** Private message payload column; never a public label. */
        payload?: string;
        /** Private inbox subject column mapping. */
        subject?: string;
        /** Explicit configured mailbox scope. */
        mailbox?: string;
        /** Stored inbound message time field. */
        receivedAt?: string;
        /** Private sender column or bounded report-window start. */
        from?: string;
      };
    };
    /** json returns parsed messages without creating inbox tables. */
    mode?: 'json' | 'persist';
    /** Host-provided storage mapping can replace the built-in ZeruxJS table. */
    store?: {
      /** Host-owned authorized lookup callback. */
      get: (id: string) => Promise<unknown>;
      /** Host-owned create/write callback with its own conflict semantics. */
      put: (message: unknown) => Promise<boolean>;
      /** Host-owned bounded account-scoped page callback. */
      page: (
        account: string,
        cursor: string | null,
        limit: number
      ) => Promise<unknown>;
      /** Explicit optional authorized erasure callback. */
      erase?: (id: string, account: string) => Promise<boolean>;
    };
    /** Optional server-only inbox UI API. Never enabled without a host authorization callback. */
    api?: {
      /** Fresh host operation/resource authorization callback. */
      authorize: (access: {
        /** Explicit authorized inbox action. */
        operation:
          | 'list'
          | 'read'
          | 'search'
          | 'poll'
          | 'markSeen'
          | 'markUnread'
          | 'flag'
          | 'unflag'
          | 'folders'
          | 'erase';
        /** Explicit configured account namespace, never a browser role claim. */
        account: string;
        /** Opaque account-bound message identifier. */
        messageId?: string;
      }) => boolean | Promise<boolean>;
      /** Host retention/permission policy rechecked before deleting a message. */
      canErase?: (message: unknown) => boolean | Promise<boolean>;
    };
    /** Trusted host inbound callback, never executable MIME content. */
    onMessage?: (message: unknown) => Promise<void> | void;
    /** Host-provided scanners; failures stop the poll instead of claiming a clean scan. */
    inspectRaw?: (context: {
      /** Explicit configured account namespace, never a browser role claim. */
      account: string;
      /** Private raw MIME bytes passed only to the trusted scanner. */
      raw: Buffer;
    }) => Promise<'clean' | 'spam' | 'phishing' | 'malware' | 'review'>;
    /** Explicit trusted attachment inspection callback. */
    inspectAttachment?: (context: {
      /** Explicit configured account namespace, never a browser role claim. */
      account: string;
      /** Opaque account-bound message identifier. */
      messageId: string;
      /** Untrusted attachment display name requiring owner validation. */
      filename: string;
      /** Private attachment bytes, never executable source by default. */
      content: Buffer;
    }) => Promise<'clean' | 'suspicious' | 'blocked'>;
    /** Explicit trusted storage hook with host authorization. */
    saveAttachment?: (context: {
      /** Explicit configured account namespace, never a browser role claim. */
      account: string;
      /** Opaque account-bound message identifier. */
      messageId: string;
      /** Parsed untrusted attachment metadata. */
      attachment: unknown;
      /** Private attachment bytes, never executable source by default. */
      content: Buffer;
    }) => Promise<string>;
    /** Explicit metadata/base64 inline content policy. */
    attachmentContent?: 'metadata' | 'base64';
    /** Hard configured inline attachment ceiling. */
    maxInlineAttachmentBytes?: number;
    /** Private explicit sending/receiving account configuration. */
    accounts?: Array<Record<string, unknown>>;
    /** If omitted, each sending account's `receive` config is used. */
  };
  /** Explicit named sending account fallback. */
  defaultAccount?: string;
  /** Owning-email recipient ceiling. */
  maxRecipients?: number;
  /** Fresh host suppression contract checked independently of optional analytics. */
  marketingSuppression?: {
    /** Host-owned fresh recipient suppression lookup. */
    isSuppressed: (address: string) => Promise<boolean>;
  };
  /** Opt-in, durable, per-SMTP-account sender reputation. Connector name is resolved server-side. */
  reputation?: {
    /** Explicit opt-in/disable flag consumed before owning-package initialization. */
    enabled?: boolean;
    /** Explicit named configured database connection. */
    database: string;
    /** Explicit host table mapping; no migrations occur unless opted in. */
    table?: string;
    /** Private owning-package policy values. */
    policy?: {
      /** Bounded rolling measurement window. */
      windowMs?: number;
      /** Minimum denominator coverage before local reputation heuristics apply. */
      minimumAccepted?: number;
      /** Explicit local heuristic warning threshold. */
      warnBouncePercent?: number;
      /** Explicit local heuristic pause threshold. */
      pauseBouncePercent?: number;
      /** Explicit local complaint warning threshold. */
      warnComplaintPercent?: number;
      /** Explicit local complaint pause threshold. */
      pauseComplaintPercent?: number;
      /** Explicit local soft-bounce warning threshold. */
      warnSoftBouncePercent?: number;
      /** Explicit local soft-bounce pause threshold. */
      pauseSoftBouncePercent?: number;
      /** Explicit host policy for applying reputation checks to transactional messages. */
      protectTransactional?: boolean;
      /** Bounded durable ledger scan ceiling. */
      scanLimit?: number;
    };
  };
  /** Optional independently enabled tracking policy; not marketing consent. */
  tracking?: EmailTrackingStartupConfig;
  /** Explicit unsubscribe/preference policy; opted-in routes must mount successfully. */
  preferences?: EmailPreferencesStartupConfig;
  /** Optional trusted campaign admin UI, not enabled by default. */
  /** Optional signed provider bounce/complaint intake; never mounted without signature verifier. */
  marketingFeedback?: {
    /** Explicit opt-in/disable flag consumed before owning-package initialization. */
    enabled?: boolean;
    /** Host-owned durable suppression mutation contract. */
    suppression: {
      /** Trusted durable feedback/suppression persistence callback. */
      recordFeedback: (event: any) => Promise<unknown>;
    };
    /** Trusted provider-event-to-account binding callback. */
    feedbackAccount?: (event: any) => string;
    /** Optional provider-verified delivery/deferred/bounce/complaint event ledger. */
    providerOutcomes?: {
      /** Host-owned durable event observation callback. */
      record: (event: {
        /** Stable provider event identity used for deduplication. */
        eventId: string;
        /** Fixed configured provider identity, not an arbitrary URL. */
        provider: string;
        /** Authorized campaign namespace. */
        campaignId: string;
        /** Opaque account-bound message identifier. */
        messageId: string;
        /** Fixed owning-package event classification. */
        kind:
          | 'delivered'
          | 'deferred'
          | 'hard-bounce'
          | 'soft-bounce'
          | 'complaint';
        /** Trusted provider event occurrence time. */
        occurredAt: number;
      }) => Promise<boolean>;
    };
    /** Must resolve attribution and stable event time from trusted provider metadata. */
    feedbackDelivery?: (event: any) => {
      /** Fixed configured provider identity, not an arbitrary URL. */
      provider: string;
      /** Authorized campaign namespace. */
      campaignId: string;
      /** Opaque account-bound message identifier. */
      messageId: string;
      /** Trusted provider event occurrence time. */
      occurredAt: number;
    };
    /** Explicit bounded provider signature/freshness verification; never enabled implicitly. */
    verifySignature: (
      body: Uint8Array,
      headers: Headers
    ) => boolean | Promise<boolean>;
    /** Owning-host provider payload parser after signature policy. */
    parse: (body: Uint8Array, headers: Headers) => unknown | Promise<unknown>;
    /** Configured endpoint mount path. */
    path?: string;
    /** Bounded HTTP input bytes. */
    maxBodyBytes?: number;
    timeoutMs?: number;
  };
  /** Optional protected UI for one-template function-first marketing campaigns. */
  marketingCampaignDashboard?: {
    /** Declared runtime owner of this route or configured service value. */
    service: unknown;
    /** Fresh host operation/resource authorization callback. */
    authorize: (request: Request) => unknown | Promise<unknown>;
    /** Fresh resource-scoped campaign permission callback. */
    authorizeCampaign: (
      principal: unknown,
      code: string,
      action: string
    ) => boolean | Promise<boolean>;
    /** Fresh host permission to create campaigns. */
    authorizeCreate: (principal: unknown) => boolean | Promise<boolean>;
    /** Fresh host permission to list authorized campaigns. */
    authorizeList?: (principal: unknown) => boolean | Promise<boolean>;
    /** Fresh host write-origin/session CSRF verification callback. */
    verifyCsrf: (
      request: Request,
      principal: unknown
    ) => boolean | Promise<boolean>;
    /** Host-issued session-bound CSRF token callback. */
    csrfToken: (
      request: Request,
      principal: unknown
    ) => string | Promise<string>;
    /** Explicit endpoint/provider namespace. */
    prefix?: string;
    /** Explicit public UI/API origin. */
    publicOrigin?: string;
  };
  /** Explicit host-provided planner UI integration. */
  campaignDashboard?: {
    /** Host-provided CampaignPlanner; strongly typed by @zeruxjs/email itself. */
    planner: unknown;
    /** Fresh host operation/resource authorization callback. */
    authorize: (request: Request) => unknown | Promise<unknown>;
    /** Fresh host write-origin/session CSRF verification callback. */
    verifyCsrf: (
      request: Request,
      principal: unknown
    ) => boolean | Promise<boolean>;
    /** Host-issued session-bound CSRF token callback. */
    csrfToken: (
      request: Request,
      principal: unknown
    ) => string | Promise<string>;
    /** Fresh resource-scoped campaign permission callback. */
    authorizeCampaign: (
      principal: unknown,
      id: string,
      action: string
    ) => boolean | Promise<boolean>;
    /** Optional PII-free, bounded delivery report callback; scope enforced by authorizeCampaign. */
    deliveryReport?: (campaignId: string) => Promise<unknown>;
    /** Optional authorized campaign performance measurement callback. */
    performanceReport?: (campaignId: string) => Promise<unknown>;
    /** Opt-in native UTC-day report, guarded by per-campaign dashboard authorization. */
    trendsReport?: (
      campaignId: string,
      from: string,
      to: string
    ) => Promise<unknown>;
    /** Explicit endpoint/provider namespace. */
    prefix?: string;
    /** Explicit public UI/API origin. */
    publicOrigin?: string;
  };
}
export interface AnalyticsStartupConfig {
  /** Explicit named analytics database connection. */
  analytics?: string;
  /** Explicit opt-in/disable flag consumed before owning-package initialization. */
  enabled?: boolean;
  /** Explicit host table mapping; no migrations occur unless opted in. */
  table?: string;
  /** Explicit analytics index/migration policy owned by analytics. */
  indexes?: boolean;
  /** Explicit bounded numeric sidecar schema fields. */
  numericFields?: string[];
  /** Host declaration of externally managed numeric-sidecar uniqueness. */
  numericUniqueIndexManagedExternally?: boolean;
  /** Whether failure must abort startup; optional degradation remains explicit. */
  required?: false;
  /** Optional independently mounted collection HTTP policy. */
  collector?: AnalyticsCollectorStartupConfig;
}

/** Private executable registration produced by @zeruxjs/search/adapters. */
export interface SearchStartupConfig {
  /** Explicit opt-in/disable flag consumed before owning-package initialization. */
  enabled?: boolean;
  /** Private executable search registration; no endpoint probing/package discovery. */
  registration: {
    /** Fixed owning-package event classification. */
    readonly kind: 'zerux-search-v1';
    /** Validate the explicitly registered search configuration without starting its resources.
     * @returns {void} Owning-service contract result; no broader capability or durability is inferred.
     */
    validate(): void;
    /** Start the explicitly registered search owner; return its actual cleanup handle.
     * @returns {Promise<{ close(): Promise<void> | void }>} Owning-service contract result; no broader capability or durability is inferred.
     */
    start(): Promise<{
      /** Release this owner’s resources under its declared lifecycle; borrowed dependencies remain with their host.
       * @returns {Promise<void> | void} Actual owned cleanup settlement when asynchronous.
       */
      close(): Promise<void> | void;
    }>;
  };
}
export interface ServiceInitializers {
  /** Prepare database-owned connectors and defer compatibility publication until activation when requested.
   * @param {ZeruxConfig} config - Private validated owning-service startup settings.
   * @param {{ onActivate: (callback: () => void) => void }} activation - Optional generation compatibility-publication registrar.
   * @param {(callback: () => void) => void} activation.onActivate - Register compatibility publication after successful generation preparation.
   * @returns {Promise<unknown>} Owning-service contract result; no broader capability or durability is inferred.
   */
  database(
    config: ZeruxConfig,
    activation?: { onActivate: (callback: () => void) => void }
  ): Promise<unknown>;
  /** Prepare a cache-owned manager with explicit startup policy and staged compatibility publication.
   * @param {ZeruxConfig} config - Private validated owning-service startup settings.
   * @param {{ onActivate: (callback: () => void) => void }} activation - Optional generation compatibility-publication registrar.
   * @param {(callback: () => void) => void} activation.onActivate - Register compatibility publication after successful generation preparation.
   * @returns {Promise<unknown>} Owning-service contract result; no broader capability or durability is inferred.
   */
  cache(
    config: ZeruxConfig,
    activation?: { onActivate: (callback: () => void) => void }
  ): Promise<unknown>;
  /** Prepare explicitly configured named files-owned providers; no storage engine is discovered automatically.
   * @param {FilesStartupConfig} config - Private validated owning-service startup settings.
   * @param {string} rootDir - Trusted application project root for configured local paths.
   * @returns {Promise<unknown>} Owning-service contract result; no broader capability or durability is inferred.
   */
  files(config: FilesStartupConfig, rootDir: string): Promise<unknown>;
  /** Prepare optional analytics-owned event storage against the explicitly supplied database owner.
   * @param {AnalyticsStartupConfig} config - Private validated owning-service startup settings.
   * @param {unknown} database - Borrowed initialized database manager.
   * @returns {Promise<unknown>} Owning-service contract result; no broader capability or durability is inferred.
   */
  analytics(
    config: AnalyticsStartupConfig,
    database: unknown
  ): Promise<unknown>;
  /** Prepare explicitly configured sending/receiving owners while keeping inbox, consent, tracking and persistence responsibilities distinct.
   * @param {EmailStartupConfig} config - Private validated owning-service startup settings.
   * @param {unknown} files - Borrowed initialized files manager.
   * @param {unknown} analytics - Borrowed optional initialized analytics manager.
   * @param {unknown} tracking - Prepared optional signed-link endpoint owner.
   * @param {unknown} preferences - Prepared required-when-enabled preference/suppression owner.
   * @param {unknown} reputation - Prepared optional durable reputation ledger service.
   * @param {unknown} database - Borrowed initialized database manager.
   * @returns {Promise<unknown>} Owning-service contract result; no broader capability or durability is inferred.
   */
  email(
    config: EmailStartupConfig,
    files: unknown,
    analytics: unknown,
    tracking?: unknown,
    preferences?: unknown,
    reputation?: unknown,
    database?: unknown
  ): Promise<unknown>;
  /** Prepare opted-in email-owned preference/suppression endpoints; invalid setup must fail closed.
   * @param {EmailPreferencesStartupConfig} config - Private validated owning-service startup settings.
   * @returns {Promise<EndpointProvider>} Owning-service contract result; no broader capability or durability is inferred.
   */
  emailPreferences(
    config: EmailPreferencesStartupConfig
  ): Promise<EndpointProvider>;
  /** Prepare the analytics-owned bounded HTTP collector for an available explicit analytics manager.
   * @param {AnalyticsCollectorStartupConfig} config - Private validated owning-service startup settings.
   * @param {unknown} analytics - Borrowed optional initialized analytics manager.
   * @returns {Promise<EndpointProvider>} Owning-service contract result; no broader capability or durability is inferred.
   */
  analyticsCollector(
    config: AnalyticsCollectorStartupConfig,
    analytics: unknown
  ): Promise<EndpointProvider>;
  /** Prepare signed tracking endpoints independently of optional telemetry availability; this does not grant marketing consent.
   * @param {EmailTrackingStartupConfig} config - Private validated owning-service startup settings.
   * @param {unknown} analytics - Borrowed optional initialized analytics manager.
   * @returns {Promise<EndpointProvider>} Owning-service contract result; no broader capability or durability is inferred.
   */
  emailTracking(
    config: EmailTrackingStartupConfig,
    analytics: unknown
  ): Promise<EndpointProvider>;
  /** Prepare the tags-owned container and explicit host consent/destination/store policy.
   * @param {TagsStartupConfig} config - Private validated owning-service startup settings.
   * @param {unknown} analytics - Borrowed optional initialized analytics manager.
   * @returns {Promise<EndpointProvider>} Owning-service contract result; no broader capability or durability is inferred.
   */
  tags(
    config: TagsStartupConfig,
    analytics: unknown
  ): Promise<EndpointProvider>;
  /** Prepare reports-owned authorized definitions/source/store endpoints against the supplied analytics manager.
   * @param {ReportsStartupConfig} config - Private validated owning-service startup settings.
   * @param {unknown} analytics - Borrowed optional initialized analytics manager.
   * @returns {Promise<EndpointProvider>} Owning-service contract result; no broader capability or durability is inferred.
   */
  reports(
    config: ReportsStartupConfig,
    analytics: unknown
  ): Promise<EndpointProvider>;
  /** Prepare the explicitly selected neutral backend or compatible legacy queue owner; no optional backend scanning occurs.
   * @param {QueueStartupConfig} config - Private validated owning-service startup settings.
   * @returns {Promise<unknown>} Owning-service contract result; no broader capability or durability is inferred.
   */
  queue(config: QueueStartupConfig): Promise<unknown>;
  /** Start only the explicit validated private search registration, retaining its owning cleanup contract.
   * @param {SearchStartupConfig} config - Private validated owning-service startup settings.
   * @returns {Promise<{ close(): Promise<void> | void }>} Owning-service contract result; no broader capability or durability is inferred.
   */
  search(config: SearchStartupConfig): Promise<{
    /** Release this owner’s resources under its declared lifecycle; borrowed dependencies remain with their host.
     * @returns {Promise<void> | void} Actual owned cleanup settlement when asynchronous.
     */
    close(): Promise<void> | void;
  }>;
}

/** Explicit built-in initializer table; optional service modules load only when selected. */
const defaults: ServiceInitializers = {
  /** Start only the explicit validated private search registration, retaining its owning cleanup contract.
   * @param {SearchStartupConfig} config - Private validated owning-service startup settings.
   * @returns {Promise<{ close(): Promise<void> | void }>} Owning-service contract result; no broader capability or durability is inferred.
   */
  async search(config) {
    return config.registration.start();
  },
  database: initializeDatabaseRuntime,
  cache: initializeCacheRuntime,
  /** Prepare explicitly configured named files-owned providers; no storage engine is discovered automatically.
   * @param {FilesStartupConfig} config - Private validated owning-service startup settings.
   * @param {string} rootDir - Trusted application project root for configured local paths.
   * @returns {Promise<unknown>} Owning-service contract result; no broader capability or durability is inferred.
   */
  async files(config, rootDir) {
    /** Fixed owning service package name; no package scanning or arbitrary user module discovery. */
    const moduleId = '@zeruxjs/files';
    /** Explicit files-owned factories loaded only for configured storage. */
    const { createFileManager, createLocalStorage, createS3Storage } =
      (await import(moduleId)) as {
        createFileManager: (config: unknown) => unknown;
        createLocalStorage: (config: unknown) => unknown;
        createS3Storage: (config: unknown) => unknown;
      };
    return createFileManager({
      defaultStorage: config.defaultStorage,
      cache: config.cache,
      stores: config.stores.map((store) => ({
        name: store.name,
        allowedBuckets: store.allowedBuckets,
        allowedTypes: store.allowedTypes,
        readonly: store.readonly,
        maxBytes: store.maxBytes,
        keyPrefix: store.keyPrefix,
        driver: (() => {
          if (store.type === 'local') {
            return createLocalStorage({
              ...store.options,
              root: path.resolve(rootDir, store.root ?? '.zerux/files'),
            });
          }
          if (store.type === 's3') {
            return createS3Storage(store.options ?? {});
          }
          throw new Error('Unknown storage driver');
        })(),
      })),
    });
  },
  /** Prepare optional analytics-owned event storage against the explicitly supplied database owner.
   * @param {AnalyticsStartupConfig} config - Private validated owning-service startup settings.
   * @param {unknown} database - Borrowed initialized database manager.
   * @returns {Promise<unknown>} Owning-service contract result; no broader capability or durability is inferred.
   */
  async analytics(config, database) {
    /** Fixed owning service package name; no package scanning or arbitrary user module discovery. */
    const moduleId = '@zeruxjs/analytics';
    /** Explicit analytics-owned factory; framework does not recreate event storage. */
    const { createAnalytics } = (await import(moduleId)) as {
      createAnalytics: (config: unknown) => {
        /** Attempt owning-package analytics storage initialization under its best-effort contract.
         * @returns {Promise<boolean>} Owning-service contract result; no broader capability or durability is inferred.
         */
        initialize(): Promise<boolean>;
        /** Project fixed service names and lifecycle states without settings, credentials or cause payloads.
         * @returns {ServiceStatus[]} Generation-local readiness/degradation/disabled/closed state.
         */
        status(): unknown;
        /** Submit an explicit bounded event through the owning analytics policy; no durability or consent bypass is inferred.
         * @param {unknown} event - Owning-service event metadata, bound and validated by that service/host.
         * @returns {Promise<unknown>} Owning-service contract result; no broader capability or durability is inferred.
         */
        track(event: unknown): Promise<unknown>;
      };
    };
    /** Separate collector HTTP settings from the analytics manager’s private configuration. */
    const { collector: _collector, ...settings } = config;
    /** Owning-package service instance prepared by its public initializer. */
    const instance = createAnalytics({ ...settings, database });
    await instance.initialize(); // A disconnected DB never interrupts application startup.
    return instance;
  },
  /** Prepare the analytics-owned bounded HTTP collector for an available explicit analytics manager.
   * @param {AnalyticsCollectorStartupConfig} config - Private validated owning-service startup settings.
   * @param {unknown} analytics - Borrowed optional initialized analytics manager.
   * @returns {Promise<EndpointProvider>} Owning-service contract result; no broader capability or durability is inferred.
   */
  async analyticsCollector(config, analytics) {
    /** Fixed owning service package name; no package scanning or arbitrary user module discovery. */
    const moduleId = '@zeruxjs/analytics';
    /** Explicit analytics-owned Fetch collector factory. */
    const { createAnalyticsCollector } = (await import(moduleId)) as {
      createAnalyticsCollector: (options: unknown) => EndpointProvider;
    };
    return createAnalyticsCollector({ ...config, analytics });
  },
  /** Prepare the tags-owned container and explicit host consent/destination/store policy.
   * @param {TagsStartupConfig} config - Private validated owning-service startup settings.
   * @param {unknown} analytics - Borrowed optional initialized analytics manager.
   * @returns {Promise<EndpointProvider>} Owning-service contract result; no broader capability or durability is inferred.
   */
  async tags(config, analytics) {
    /** Fixed owning service package name; no package scanning or arbitrary user module discovery. */
    const moduleId = '@zeruxjs/tags';
    /** Explicit tags-owned manager/default definition helpers, not executable draft content. */
    const { createTagManager, emptyTagContainer } = (await import(
      moduleId
    )) as {
      createTagManager: (config: unknown) => EndpointProvider;
      emptyTagContainer: () => unknown;
    };
    /** Borrowed initialized analytics manager providing optional durable document/request-ID contracts. */
    const active = analytics as {
      createRequestIdStore?: () => unknown;
      createDocumentStore?: (
        table: string,
        id: string,
        initial: unknown
      ) => unknown;
    };
    /** Host-provided store or owning-package document store; absent persistence is warned explicitly. */
    const store =
      config.store ??
      active?.createDocumentStore?.(
        'analytics_tag_containers',
        'default',
        config.container ?? emptyTagContainer()
      );
    if (!store) {
      console.warn(
        '[zerux tags] Using volatile configuration; supply a shared persistent store'
      );
    }
    let requestIds = config.requestIds ?? active?.createRequestIdStore?.();
    if (!requestIds) {
      // Explicit warning: memory mode is not a cross-instance reservation system.
      console.warn(
        '[zerux tags] No shared ID store; single-process development reservation only'
      );
      /** Fixed analytics module used only for the documented single-process ID-store fallback. */
      const analyticsId = '@zeruxjs/analytics';
      /** Explicit process-local compatibility store; not a shared durable reservation system. */
      const { createMemoryRequestIdStore } = (await import(analyticsId)) as {
        createMemoryRequestIdStore: () => unknown;
      };
      requestIds = createMemoryRequestIdStore();
    }
    return createTagManager({
      ...config,
      analytics,
      requestIds,
      ...(store ? { store } : {}),
    });
  },
  /** Prepare reports-owned authorized definitions/source/store endpoints against the supplied analytics manager.
   * @param {ReportsStartupConfig} config - Private validated owning-service startup settings.
   * @param {unknown} analytics - Borrowed optional initialized analytics manager.
   * @returns {Promise<EndpointProvider>} Owning-service contract result; no broader capability or durability is inferred.
   */
  async reports(config, analytics) {
    /** Fixed owning service package name; no package scanning or arbitrary user module discovery. */
    const moduleId = '@zeruxjs/reports';
    /** Explicit reports-owned manager factory. */
    const { createReports } = (await import(moduleId)) as {
      createReports: (config: unknown) => EndpointProvider;
    };
    /** Borrowed initialized analytics manager providing optional durable document/request-ID contracts. */
    const active = analytics as {
      createDocumentStore?: (
        table: string,
        id: string,
        initial: unknown
      ) => unknown;
    };
    /** Host-provided store or owning-package document store; absent persistence is warned explicitly. */
    const store =
      config.store ??
      active?.createDocumentStore?.('analytics_report_documents', 'default', {
        version: 1,
        reports: [],
      });
    if (!store) {
      console.warn(
        '[zerux reports] Using volatile reports; supply a shared persistent store'
      );
    }
    return createReports({ ...config, analytics, ...(store ? { store } : {}) });
  },
  /** Prepare the explicitly selected neutral backend or compatible legacy queue owner; no optional backend scanning occurs.
   * @param {QueueStartupConfig} config - Private validated owning-service startup settings.
   * @returns {Promise<unknown>} Owning-service contract result; no broader capability or durability is inferred.
   */
  async queue(config) {
    if ('selection' in config) {
      /** Explicit neutral queue selection factory; unsupported capabilities remain backend-owned. */
      const { createQueueBackend } = await import('@zeruxjs/queue/neutral');
      return createQueueBackend(config.selection);
    }
    /** Fixed owning service package name; no package scanning or arbitrary user module discovery. */
    const moduleId = '@zeruxjs/queue';
    /** Legacy BullMQ-compatible queue factory retained for existing callers. */
    const { createQueueService } = (await import(moduleId)) as {
      createQueueService: (config: unknown) => Promise<unknown>;
    };
    return createQueueService(config);
  },
  /** Prepare signed tracking endpoints independently of optional telemetry availability; this does not grant marketing consent.
   * @param {EmailTrackingStartupConfig} config - Private validated owning-service startup settings.
   * @param {unknown} analytics - Borrowed optional initialized analytics manager.
   * @returns {Promise<EndpointProvider>} Owning-service contract result; no broader capability or durability is inferred.
   */
  async emailTracking(config, analytics) {
    /** Fixed owning service package name; no package scanning or arbitrary user module discovery. */
    const moduleId = '@zeruxjs/analytics';
    /** Analytics-owned signed-link tracking endpoint factory; mail consent remains separate. */
    const { createEmailTrackingService } = (await import(moduleId)) as {
      createEmailTrackingService: (options: unknown) => EndpointProvider;
    };
    // Signed links must continue redirecting/serving pixels during DB outages.
    /** Borrowed analytics or inert optional-collection fallback; signed-link serving remains available during telemetry absence. */
    const telemetry = analytics ?? { track: async () => undefined };
    return createEmailTrackingService({ ...config, analytics: telemetry });
  },
  /** Prepare opted-in email-owned preference/suppression endpoints; invalid setup must fail closed.
   * @param {EmailPreferencesStartupConfig} config - Private validated owning-service startup settings.
   * @returns {Promise<EndpointProvider>} Owning-service contract result; no broader capability or durability is inferred.
   */
  async emailPreferences(config) {
    /** Fixed owning service package name; no package scanning or arbitrary user module discovery. */
    const moduleId = '@zeruxjs/email';
    /** Email-owned preference/suppression endpoint factory; opted-in consent endpoints fail closed on startup errors. */
    const { createEmailPreferenceService } = (await import(moduleId)) as {
      createEmailPreferenceService: (options: unknown) => EndpointProvider;
    };
    /** Strip the framework activation flag before passing private preference settings to its owner. */
    const { enabled: _enabled, ...settings } = config;
    return createEmailPreferenceService(settings);
  },
  /** Prepare explicitly configured sending/receiving owners while keeping inbox, consent, tracking and persistence responsibilities distinct.
   * @param {EmailStartupConfig} config - Private validated owning-service startup settings.
   * @param {unknown} files - Borrowed initialized files manager.
   * @param {unknown} _analytics - Borrowed optional analytics handle, intentionally unused by this sending initializer.
   * @param {unknown} tracking - Prepared optional signed-link endpoint owner.
   * @param {unknown} preferences - Prepared required-when-enabled preference/suppression owner.
   * @param {unknown} reputation - Prepared optional durable reputation ledger service.
   * @param {unknown} database - Borrowed initialized database manager.
   * @returns {Promise<unknown>} Owning-service contract result; no broader capability or durability is inferred.
   */
  async email(
    config,
    files,
    _analytics,
    tracking,
    preferences,
    reputation,
    database
  ) {
    /** Fixed owning service package name; no package scanning or arbitrary user module discovery. */
    const moduleId = '@zeruxjs/email';
    /** Explicit email-owned sending, receiving and authorized inbox/storage factories. */
    const {
      createEmailManager,
      createEmailReceiver,
      createDatabaseInboxStore,
      createMappedDatabaseInboxStore,
      createInboxApi,
    } = (await import(moduleId)) as {
      createEmailManager: (config: unknown) => any;
      createEmailReceiver: (config: unknown) => any;
      createDatabaseInboxStore: (db: unknown, table?: string) => unknown;
      createMappedDatabaseInboxStore: (db: unknown, config: unknown) => unknown;
      createInboxApi: (config: unknown) => unknown;
    };
    /** Separate framework endpoint/receiving configuration before preparing the sending manager. */
    const {
      tracking: _trackingConfig,
      preferences: _preferencesConfig,
      campaignDashboard: _campaignDashboard,
      marketingCampaignDashboard: _marketingCampaignDashboard,
      marketingFeedback: _marketingFeedback,
      reputation: _reputationConfig,
      receive: receiveConfig,
      ...settings
    } = config;
    /** Explicit receive configurations captured from host-authored account descriptors. */
    const incomingFromAccounts = (settings.accounts ?? [])
      .filter((a) => a.receive && typeof a.receive === 'object')
      .map((a) => ({
        name: a.name,
        ...(a.receive as Record<string, unknown>),
      }));
    /** Only accounts with an explicit SMTP/transport descriptor passed to sending initialization. */
    const sendingAccounts = (settings.accounts ?? []).filter(
      (a) => a.smtp || a.transport
    );
    /** Prepared email or database manager; acquisition remains generation-scoped. */
    const manager = sendingAccounts.length
      ? createEmailManager({
          ...settings,
          accounts: sendingAccounts,
          files,
          tracking,
          preferences,
          reputation,
        })
      : null;
    if (
      receiveConfig?.enabled !== false &&
      (receiveConfig?.accounts?.length || incomingFromAccounts.length)
    ) {
      let store = receiveConfig?.store;
      /** Explicit json/persist receive policy, validated before selecting an inbox store. */
      const receiveMode = receiveConfig?.mode ?? 'persist';
      if (receiveMode !== 'json' && receiveMode !== 'persist') {
        throw new Error('Invalid email receive mode');
      }
      if (receiveMode === 'persist' && !store) {
        if (
          !receiveConfig?.database ||
          typeof receiveConfig.database !== 'string'
        ) {
          throw new Error(
            'Persistent email receive requires a named database connector or host inbox store'
          );
        }
        /** Borrowed initialized database manager for an explicit named inbox connector. */
        const runtimeDatabase = database as
          | { getConnectionFacade?: (name: string) => unknown }
          | undefined;
        /** Explicit available named database facade; missing selection rejects persistence startup. */
        const connector = runtimeDatabase?.getConnectionFacade?.(
          receiveConfig.database
        );
        if (!connector) {
          throw new Error(
            'Email receive requires an available named database connector'
          );
        }
        store = (
          receiveConfig?.mapping
            ? createMappedDatabaseInboxStore(connector, receiveConfig.mapping)
            : createDatabaseInboxStore(connector, receiveConfig?.table)
        ) as typeof store;
      }
      /** Owned email receiver closed before its dependent sending manager. */
      const inbound = createEmailReceiver({
        accounts: receiveConfig?.accounts?.length
          ? receiveConfig.accounts
          : incomingFromAccounts,
        mode: receiveMode,
        store,
        onMessage: receiveConfig?.onMessage,
        inspectRaw: receiveConfig?.inspectRaw,
        inspectAttachment: receiveConfig?.inspectAttachment,
        saveAttachment: receiveConfig?.saveAttachment,
        attachmentContent: receiveConfig?.attachmentContent,
        maxInlineAttachmentBytes: receiveConfig?.maxInlineAttachmentBytes,
      });
      /** Optional authorized inbox API; requires persistent or host-defined storage. */
      const inbox =
        store && receiveConfig?.api
          ? createInboxApi({ store, receiver: inbound, ...receiveConfig.api })
          : undefined;
      if (receiveConfig?.api && !store) {
        throw new Error(
          'The inbox UI API requires a persistent or host-defined inbox store'
        );
      }
      if (!manager) {
        return {
          receive: inbound,
          ...(inbox ? { inbox } : {}),
          /** Release this owner’s resources under its declared lifecycle; borrowed dependencies remain with their host.
           * @returns {Promise<void>} Actual owned cleanup settlement when asynchronous.
           */
          async close() {
            await inbound.close();
          },
        };
      }
      return {
        ...manager,
        receive: inbound,
        ...(inbox ? { inbox } : {}),
        /** Release this owner’s resources under its declared lifecycle; borrowed dependencies remain with their host.
         * @returns {Promise<void>} Actual owned cleanup settlement when asynchronous.
         */
        async close() {
          await inbound.close();
          await manager.close();
        },
      };
    }
    if (!manager) {
      throw new Error(
        'Email requires an SMTP sending account or a configured receive account'
      );
    }
    return manager;
  },
};

/** Validate configuration before acquiring explicit services; remove private settings from runtime config and roll back owned acquisitions on failure.
 * @param {ZeruxConfig} config - Mutable runtime settings whose private service fields are consumed.
 * @param {string} rootDir - Trusted application project root.
 * @param {Partial<ServiceInitializers>} providers - Explicit host initializer overrides for injection/qualification.
 * @param {object} options - Optional delayed compatibility activation policy.
 * @param {boolean} options.deferActivation - Delay compatibility publication until the candidate generation activates.
 * @returns {Promise<RuntimeServiceScope>} Prepared owned service scope; optional service failures retain honest degradation.
 */
export async function initializeRuntimeServices(
  config: ZeruxConfig,
  rootDir: string,
  providers: Partial<ServiceInitializers> = {},
  options: { deferActivation?: boolean } = {}
): Promise<RuntimeServiceScope> {
  /** Validated private/public configuration and explicit custom service plan before resource acquisition. */
  const prepared = await prepareConfiguration(config);
  /** Private generation settings consumed only by trusted initializer callbacks. */
  const privateConfig = prepared.config;
  /** Owned generation service scope retaining acquired manager cleanup. */
  const scope = createServiceScope(prepared.publicConfig);
  /** Explicit built-in plus host-injected initializer table; no automatic package probing. */
  const start = { ...defaults, ...providers };
  /** Private configured named storage policy. */
  const files = privateConfig.files as FilesStartupConfig | undefined;
  /** Private configured sending/receiving/consent endpoint policy. */
  const email = privateConfig.email as EmailStartupConfig | undefined;
  /** Private optional analytics manager/collector settings. */
  const analytics = privateConfig.analytics as
    | AnalyticsStartupConfig
    | undefined;
  /** Private optional tag-container policy and authorization callbacks. */
  const tags = privateConfig.tags as TagsStartupConfig | undefined;
  /** Private optional report source/storage/authorization policy. */
  const reports = privateConfig.reports as ReportsStartupConfig | undefined;
  /** Private explicit neutral or legacy queue selection. */
  const queue = privateConfig.queue as QueueStartupConfig | undefined;
  /** Private explicit registered search adapter selection. */
  const search = privateConfig.search as SearchStartupConfig | undefined;
  // All service config, session authorizers and destination credentials stay out of public build manifests.
  delete config.db;
  delete config.database;
  delete config.connectorManager;
  delete config.cache;
  delete config.services;
  delete config.serviceDefinitions;
  delete config.files;
  delete config.email;
  delete config.analytics;
  delete config.tags;
  delete config.reports;
  delete config.queue;
  delete config.search;
  try {
    scope.add(
      'database',
      await start.database(privateConfig, { onActivate: scope.onActivate })
    );
    scope.add(
      'cache',
      await start.cache(privateConfig, { onActivate: scope.onActivate })
    );
    if (files) {
      scope.add('files', await start.files(files, rootDir));
    }
    if (search?.enabled === true) {
      scope.add('search', await start.search(search));
    }
    if (queue?.enabled === true) {
      try {
        /** Actual selected queue backend; route registration failure closes it before optional degradation. */
        const queueService = (await start.queue(queue)) as {
          routes?: () => ServiceHttpRoute[];
        };
        try {
          if (queueService.routes) {
            scope.addHttpRoutes('queue', queueService.routes());
          }
          scope.add('queue', queueService);
        } catch (error) {
          try {
            await (
              queueService as {
                /** Owning-service cleanup contract; borrowed resources follow their owner policy. */
                close?: () => Promise<void>;
              }
            ).close?.();
          } catch {
            /* Preserve registration failure */
          }
          throw error;
        }
      } catch (error) {
        if (queue.required === true) {
          throw error;
        }
        scope.markDegraded('queue', error);
        try {
          console.warn('[zerux queue] Service unavailable');
        } catch {
          /* This optional failure is intentionally ignored. */
        }
      }
    }
    if (analytics?.enabled !== false && analytics) {
      try {
        scope.add(
          'analytics',
          await start.analytics(analytics, scope.get('database'))
        );
      } catch (error) {
        scope.markDegraded('analytics');
        // No telemetry failure must prevent application startup or delivery.
        try {
          console.warn(
            '[zerux analytics] Telemetry unavailable:',
            error instanceof Error ? error.message : String(error)
          );
        } catch {
          /* best effort */
        }
      }
    }
    if (
      analytics?.enabled !== false &&
      analytics?.collector &&
      scope.get('analytics')
    ) {
      try {
        /** Analytics-owned collector endpoints prepared only when its manager is available. */
        const collector = await start.analyticsCollector(
          analytics.collector,
          scope.get('analytics')
        );
        scope.addHttpRoutes('analytics', collector.routes());
      } catch (error) {
        scope.markDegraded('analytics');
        try {
          console.warn(
            '[zerux analytics] Collector unavailable:',
            error instanceof Error ? error.message : String(error)
          );
        } catch {
          /* fail soft */
        }
      }
    }
    if (tags?.enabled === true) {
      try {
        if (!scope.get('analytics')) {
          throw new Error('Tags requires the analytics service');
        }
        /** Prepared tags owner; route collision triggers immediate local cleanup. */
        const tagService = await start.tags(tags, scope.get('analytics'));
        try {
          scope.addHttpRoutes('tags', tagService.routes());
        } catch (error) {
          await tagService.close?.();
          throw error;
        }
        scope.add('tags', tagService);
      } catch (error) {
        scope.markDegraded('tags');
        try {
          console.warn(
            '[zerux tags] Service unavailable:',
            error instanceof Error ? error.message : String(error)
          );
        } catch {
          /* This optional failure is intentionally ignored. */
        }
      }
    }
    if (reports?.enabled === true) {
      try {
        if (!scope.get('analytics')) {
          throw new Error('Reports requires the analytics service');
        }
        /** Prepared reports owner; route collision triggers immediate local cleanup. */
        const reportService = await start.reports(
          reports,
          scope.get('analytics')
        );
        try {
          scope.addHttpRoutes('reports', reportService.routes());
        } catch (error) {
          await reportService.close?.();
          throw error;
        }
        scope.add('reports', reportService);
      } catch (error) {
        scope.markDegraded('reports');
        try {
          console.warn(
            '[zerux reports] Service unavailable:',
            error instanceof Error ? error.message : String(error)
          );
        } catch {
          /* This optional failure is intentionally ignored. */
        }
      }
    }
    let tracking: EndpointProvider | undefined;
    if (email?.tracking?.enabled === true) {
      try {
        tracking = await start.emailTracking(
          email.tracking,
          scope.get('analytics')
        );
      } catch (error) {
        scope.markDegraded('email');
        try {
          console.warn(
            '[zerux email] Optional tracking unavailable:',
            error instanceof Error ? error.message : String(error)
          );
        } catch {
          /* fail soft */
        }
      }
    }
    if (tracking) {
      try {
        scope.addHttpRoutes('email', tracking.routes());
      } catch (error) {
        // Never instrument outgoing mail with links to routes we failed to mount.
        tracking = undefined;
        scope.markDegraded('email');
        try {
          console.warn(
            '[zerux email] Tracking routes unavailable:',
            error instanceof Error ? error.message : String(error)
          );
        } catch {
          /* fail soft */
        }
      }
    }
    let preferences: EndpointProvider | undefined;
    if (email?.preferences?.enabled === true) {
      // Consent endpoints are mandatory when opted in. Fail startup on invalid config
      // or route conflicts rather than sending mail with unusable unsubscribe links.
      preferences = await start.emailPreferences(email.preferences);
      scope.addHttpRoutes('email', preferences.routes());
    }
    let reputation: unknown;
    if (email?.reputation?.enabled === true) {
      /** Prepared email or database manager; acquisition remains generation-scoped. */
      const manager = scope.get('database') as
        | { getConnectionFacade?: (slug: string) => unknown }
        | undefined;
      if (!manager?.getConnectionFacade) {
        throw new Error(
          'Email reputation requires a configured database connector'
        );
      }
      /** Explicit named reputation database facade, never a browser-selected connector. */
      const connection = manager.getConnectionFacade(email.reputation.database);
      /** Fixed owning service package name; no package scanning or arbitrary user module discovery. */
      const moduleId = '@zeruxjs/email';
      /** Email-owned sender reputation and durable ledger factories selected explicitly. */
      const { createEmailReputationService, createDatabaseReputationLedger } =
        (await import(moduleId)) as {
          createEmailReputationService: (input: unknown) => unknown;
          createDatabaseReputationLedger: (
            db: unknown,
            table?: string
          ) => unknown;
        };
      reputation = createEmailReputationService({
        ledger: createDatabaseReputationLedger(
          connection,
          email.reputation.table
        ),
        policy: email.reputation.policy,
      });
    }
    if (email?.marketingFeedback?.enabled === true) {
      /** Fixed owning service package name; no package scanning or arbitrary user module discovery. */
      const moduleId = '@zeruxjs/email';
      /** Email-owned authenticated provider feedback endpoint factory. */
      const { createMarketingFeedbackEndpoint } = (await import(moduleId)) as {
        createMarketingFeedbackEndpoint: (config: unknown) => EndpointProvider;
      };
      scope.addHttpRoutes(
        'email',
        createMarketingFeedbackEndpoint({
          ...email.marketingFeedback,
          ...(reputation ? { reputation } : {}),
        }).routes()
      );
    }
    if (email?.campaignDashboard) {
      /** Fixed owning service package name; no package scanning or arbitrary user module discovery. */
      const moduleId = '@zeruxjs/email';
      /** Email-owned host-authorized campaign dashboard endpoint factory. */
      const { createCampaignDashboard } = (await import(moduleId)) as {
        createCampaignDashboard: (config: unknown) => EndpointProvider;
      };
      /** Prepared explicitly authorized campaign dashboard endpoints. */
      const dashboard = createCampaignDashboard(email.campaignDashboard);
      scope.addHttpRoutes('email', dashboard.routes());
    }
    if (email?.marketingCampaignDashboard) {
      /** Fixed owning service package name; no package scanning or arbitrary user module discovery. */
      const moduleId = '@zeruxjs/email';
      /** Email-owned function-first marketing dashboard endpoints selected explicitly. */
      const { createMarketingCampaignDashboard } = (await import(moduleId)) as {
        createMarketingCampaignDashboard: (config: unknown) => EndpointProvider;
      };
      scope.addHttpRoutes(
        'email',
        createMarketingCampaignDashboard(
          email.marketingCampaignDashboard
        ).routes()
      );
    }
    if (email) {
      scope.add(
        'email',
        await start.email(
          email,
          scope.get('files'),
          scope.get('analytics'),
          tracking,
          preferences,
          reputation,
          scope.get('database')
        )
      );
    }
    await startCustomServices(scope, prepared.services, rootDir);
    if (!options.deferActivation) {
      scope.activate();
    }
    return scope;
  } catch (error) {
    try {
      await scope.close();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'Service startup and rollback failed'
      );
    }
    throw error;
  }
}
