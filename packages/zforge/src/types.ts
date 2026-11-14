import type http from 'node:http';

/** Host-owned inputs for explicit legacy development registration. */
export interface SharedDevRegistrationOptions {
  /** Host-provided display name of the registered development application. */
  appName: string;
  /** Application listener port; registering it does not start that application. */
  appPort: number;
  /** Host-owned application root used to resolve explicit module and state paths. */
  rootDir: string;
  /** Initial preferred shared development port when no registry port exists. */
  preferredPort?: number;
  /** Host-owned private runtime snapshot path; null/absence means no snapshot file. */
  dataFilePath?: string;
  /** Host-owned private log path read only through the bounded tail helper. */
  logFilePath?: string;
  /** Host-provided runtime manifest reference retained for development inspection. */
  runtimeManifestPath?: string;
  /** Legacy explicit host-routing patterns; these do not authenticate callers. */
  allowedDomains?: string | string[];
  /** Optional development hostname used by legacy routing/client URLs. */
  allowedDevDomain?: string;
  /** Trusted namespace used for this application development endpoint paths. */
  serviceName?: string;
  /** Explicit development module/framing configuration; hosts retain access-control responsibility. */
  devtools?: {
    /** Exact trusted development embedding origins; not host-routing patterns. */
    frameAncestors?: string[];
    /** Explicit configured package references or trusted module definitions; no arbitrary disk discovery is implied. */
    modules: Array<
      | string
      | {
          /** Explicit module package reference selected by the host. */
          package: string;
          /** Whether the configured module reference participates in loading. */
          enabled?: boolean;
          /** Private trusted module options; hosts must decide what may enter development output. */
          options?: Record<string, unknown>;
        }
    >;
  };
}

/** Private persisted application registration used by the shared development server. */
export interface SharedDevRegistration {
  /** Host-provided display name of the registered development application. */
  appName: string;
  /** Normalized registry namespace identifying the development application. */
  routeName: string;
  /** Application listener port; registering it does not start that application. */
  appPort: number;
  /** Host-owned application root used to resolve explicit module and state paths. */
  rootDir: string;
  /** Host-owned private runtime snapshot path; null/absence means no snapshot file. */
  dataFilePath: string | null;
  /** Host-owned private log path read only through the bounded tail helper. */
  logFilePath: string | null;
  /** Host-provided runtime manifest reference retained for development inspection. */
  runtimeManifestPath: string | null;
  /** Legacy explicit host-routing patterns; these do not authenticate callers. */
  allowedDomains: string | string[];
  /** Optional development hostname used by legacy routing/client URLs. */
  allowedDevDomain: string | null;
  /** Trusted namespace used for this application development endpoint paths. */
  serviceName: string;
  /** Explicit development module/framing configuration; hosts retain access-control responsibility. */
  devtools: {
    frameAncestors?: string[];
    /** Explicit configured package references or trusted module definitions; no arbitrary disk discovery is implied. */
    modules: Array<
      | string
      | {
          /** Explicit module package reference selected by the host. */
          package: string;
          /** Whether the configured module reference participates in loading. */
          enabled?: boolean;
          /** Private trusted module options; hosts must decide what may enter development output. */
          options?: Record<string, unknown>;
        }
    >;
  };
  /** ISO timestamp recorded when this application registration was created. */
  startedAt: string;
  /** ISO timestamp associated with the latest registry or snapshot update. */
  updatedAt: string;
}

/** Legacy private process-shared registry; it is not a request or tenant store. */
export interface SharedDevRegistry {
  /** Selected shared development listener port. */
  port?: number;
  /** Recorded process identifier used only as a legacy server liveness hint. */
  serverPid?: number;
  /** ISO timestamp associated with the latest registry or snapshot update. */
  updatedAt?: string;
  /** Registered application records stored in the private shared registry. */
  apps: SharedDevRegistration[];
}

/** Development address receipt; application/server startup ownership remains explicit. */
export interface SharedDevStartResult {
  /** Selected shared development listener port. */
  port: number;
  /** Normalized registry namespace identifying the development application. */
  routeName: string;
  /** Optional development hostname used by legacy routing/client URLs. */
  allowedDevDomain: string | null;
  /** Development URLs returned for the selected app and shared server port. */
  urls: {
    /** Development dashboard URL for the registered application. */
    devtools: string;
    /** Explicit shared WebSocket URL for this application namespace. */
    websocket: string;
  };
}

/** Host-approved event envelope for the shared development broadcaster. */
export interface SharedDevEvent {
  /** Registered application namespace associated with this development event. */
  app: string;
  /** Development event discriminator interpreted by the receiving owner. */
  type: string;
  /** Trusted namespace used for this application development endpoint paths. */
  serviceName?: string;
  /** Host-approved event data; callers must redact secrets before publication. */
  payload?: Record<string, unknown>;
  /** Optional event time; publishers fill the current time when absent. */
  timestamp?: string;
}

/** Process-shared native listener handle returned by the legacy server owner. */
export interface SharedDevServerHandle {
  /** Selected shared development listener port. */
  port: number;
  /** Shared native HTTP server handle; its lifetime belongs to the shared server owner. */
  server: http.Server;
}

/** Normalized private development view of one registered application. */
export interface SharedDevSnapshot {
  /** Normalized registry namespace identifying the development application. */
  routeName: string;
  /** Host-provided display name of the registered development application. */
  appName: string;
  /** Host-owned application root used to resolve explicit module and state paths. */
  rootDir: string;
  /** Application listener port; registering it does not start that application. */
  appPort: number;
  /** Optional private runtime manifest reference shown only within controlled development views. */
  manifestPath: string | null;
  /** Host-owned private log path read only through the bounded tail helper. */
  logFilePath: string | null;
  /** ISO timestamp recorded when this application registration was created. */
  startedAt: string;
  /** ISO timestamp associated with the latest registry or snapshot update. */
  updatedAt: string;
  /** Application runtime mode projected from the host snapshot. */
  mode: string;
  /** Public route summary recorded by the application runtime. */
  routes: Array<{
    /** Route pathname shown in the development route summary. */
    path: string;
    /** Declared HTTP methods for the summarized route. */
    methods: string[];
  }>;
  /** Explicit development module/framing configuration; hosts retain access-control responsibility. */
  devtools: {
    /** Explicit configured package references or trusted module definitions; no arbitrary disk discovery is implied. */
    modules: Array<
      | string
      | {
          /** Explicit module package reference selected by the host. */
          package: string;
          /** Whether the configured module reference participates in loading. */
          enabled?: boolean;
          /** Private trusted module options; hosts must decide what may enter development output. */
          options?: Record<string, unknown>;
        }
    >;
  };
  /** Bounded recorded client events, optionally filtered by an opaque pairing identifier. */
  clientEvents: Record<string, unknown>[];
  /** Bounded trailing nonempty log lines; not a full log export. */
  logs: string[];
  /** Optional generation reload status supplied by the application runtime. */
  reload?: {
    /** Current runtime generation sequence. */
    generation: number;
    /** Recorded reload attempts for this application. */
    attempts: number;
    /** Recorded reload failures for this application. */
    failures: number;
    /** Whether the host snapshot reports a candidate rebuild in progress. */
    rebuilding: boolean;
    /** Whether the host snapshot reports its runtime owner closed. */
    closed: boolean;
    /** Optional host-redacted last reload failure description. */
    lastError: string | null;
  };
}
