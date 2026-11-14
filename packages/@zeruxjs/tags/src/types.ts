import type { AnalyticsManager } from '@zeruxjs/analytics';
import type { RequestIdStore } from '@zeruxjs/analytics';
export type Scalar = string | number | boolean | null;
export type Values = Record<string, Scalar>;
export interface TagEvent {
  /** Bounded authored public label or event identifier according to this enclosing schema; never executable code. */
  name: string;
  /** Bounded scalar event properties; private values require explicit host consent/policy. */
  properties: Values;
  /** Optional host-bound site; public collection must verify origin/site mapping independently. */
  site?: string;
  /** Optional bounded route path; runtime removes query and fragment before dispatch. */
  pathname?: string;
  /** Optional explicitly consented opaque identity; no fingerprint is generated. */
  sessionId?: string;
  /** Opaque reserved request correlation ID; server scopes may intentionally reuse one across related events. */
  requestId: string;
  /** Server-assigned UTC reservation day in YYYY-MM-DD form. */
  requestUtcDay: string;
  /** Explicit web/server origin class; browsers cannot claim server authorization. */
  source: 'web' | 'server';
  /** Optional bounded scalar data-layer snapshot, not arbitrary nested expressions. */
  data?: Values;
}
export interface Condition {
  /** Registered variable ID or bounded scalar event/data field name. */
  field: string;
  /** Allowlisted scalar comparison; no regex, SQL or JavaScript expression is evaluated. */
  operator: 'eq' | 'neq' | 'contains' | 'exists' | 'gte' | 'lte';
  /** Optional bounded scalar operand or constant; interpretation belongs to the enclosing schema. */
  value?: Scalar;
}
export interface Trigger {
  /** Validated explicit identifier within the enclosing definition or release namespace. */
  id: string;
  /** Bounded authored public label or event identifier according to this enclosing schema; never executable code. */
  name: string;
  /** Declared supported kind; unknown kinds reject before runtime dispatch. */
  type: 'event' | 'all' | 'pageview' | 'click' | 'form' | 'history' | 'group';
  /** Optional explicit V1 schema marker; omission means V1, unsupported versions reject. */
  schemaVersion?: 1;
  /** Group-only bounded Boolean references; unknown/cyclic/deep graphs reject. */
  composition?: {
    /** Explicit all/any/not Boolean composition; not requires exactly one input. */
    mode: 'all' | 'any' | 'not';
    /** Declared trigger references validated against the same container. */
    triggerIds: string[];
  };
  /** Optional exact event identifier for event triggers; debug events are correlation labels. */
  event?: string;
  /** At most twenty scalar conditions evaluated without arbitrary expressions. */
  conditions?: Condition[];
  /** False disables this definition; omission retains enabled behavior. */
  enabled?: boolean;
}
export interface Variable {
  /** Validated explicit identifier within the enclosing definition or release namespace. */
  id: string;
  /** Bounded authored public label or event identifier according to this enclosing schema; never executable code. */
  name: string;
  /** Declared supported kind; unknown kinds reject before runtime dispatch. */
  type: 'constant' | 'event' | 'dataLayer' | 'context';
  /** Optional explicit V1 schema marker; omission means V1, unsupported versions reject. */
  schemaVersion?: 1;
  /** Optional bounded declared event/data/context field name, not a dynamic expression. */
  key?: string;
  /** Optional bounded scalar operand or constant; interpretation belongs to the enclosing schema. */
  value?: Scalar;
}
export interface TagDefinition {
  /** Validated explicit identifier within the enclosing definition or release namespace. */
  id: string;
  /** Bounded authored public label or event identifier according to this enclosing schema; never executable code. */
  name: string;
  /** Declared supported kind; unknown kinds reject before runtime dispatch. */
  type: 'analytics' | 'ga4' | 'webhook' | 'provider';
  /** Explicit registered trusted provider ID; no package or URL is loaded from it. */
  providerRef?: string;
  /** Required registered provider schema version for provider tags. */
  providerVersion?: number;
  /** Declared bounded public scalar provider settings; credentials never belong here. */
  publicConfig?: Values;
  /** Declared trigger references validated against the same container. */
  triggerIds: string[];
  /** False disables this definition; omission retains enabled behavior. */
  enabled?: boolean;
  /** Optional explicit destination event name override. */
  eventName?: string;
  /** Validated GA4 G- measurement identifier; secret stays in server configuration. */
  measurementId?: string;
  /** Server credential reference only; never the credential value. */
  credentialRef?: string;
  /** Configured HTTPS destination reference, never an arbitrary user endpoint. */
  destinationRef?: string;
  /** Optional registered variable supplying an explicit GA4 client identifier. */
  clientIdVariable?: string;
  /** Bounded scalar parameters with exact registered {{variableId}} bindings only. */
  parameters?: Record<string, Scalar | string>;
}
/** A historical release is immutable; revisions (container.version) advance on every edit. */
export interface TagRelease {
  /** Validated explicit identifier within the enclosing definition or release namespace. */
  id: number;
  /** UTC ISO operation timestamp retained as release metadata. */
  at: string;
  /** Declared initial/publish/rollback release action. */
  action: 'initial' | 'publish' | 'rollback';
  /** Definition snapshot or initial runtime definition; server governance ownership remains separate. */
  container: TagContainer;
}
export interface TagGovernance {
  /** Current monotonic live release ID, distinct from draft document revision. */
  release: number;
  /** Current live immutable-by-convention public definition snapshot. */
  published: TagContainer;
  /** At most twelve retained immutable release snapshots, additionally bounded by document bytes. */
  history: TagRelease[];
}
export interface TagContainer {
  /** Validated explicit identifier within the enclosing definition or release namespace. */
  id: string;
  /** Positive monotonically increasing optimistic document revision. */
  version: number;
  /** Bounded authored public label or event identifier according to this enclosing schema; never executable code. */
  name: string;
  /** At most two hundred declared trigger definitions; bounded groups remain Boolean conditions, not permissions. */
  triggers: Trigger[];
  /** At most two hundred declared destinations/provider references, never arbitrary script tags. */
  tags: TagDefinition[];
  /** At most two hundred declared scalar source bindings; source text is never evaluated. */
  variables: Variable[];
  /** Server-owned live/history envelope; editor input cannot silently overwrite it. */
  governance?: TagGovernance;
}
export interface TagContainerStore {
  /** Read a complete independent versioned container document. Runtime callers validate persisted schema before using it.
   * @returns {Promise<TagContainer>} Loaded document; dependency failures reject rather than fabricating a successful publication.
   */
  load(): Promise<TagContainer>;
  /** Atomically replace one complete document only when the stored revision matches. Host adapters own persistence/linearizability; memory is process-local.
   * @param {TagContainer} container - Validated next document including server-owned governance.
   * @param {number} expectedVersion - Required current optimistic revision.
   * @returns {Promise<boolean>} True only for a successful CAS; false for conflict, dependency failures reject.
   */
  save(container: TagContainer, expectedVersion: number): Promise<boolean>;
}
export interface TagRuntimeOptions {
  /** Borrowed analytics manager; no connection or remote credential ownership transfers. */
  analytics: AnalyticsManager;
  /** A shared atomic store is REQUIRED for cross-instance request-ID uniqueness. */
  requestIds: RequestIdStore;
  /** Optional borrowed whole-document CAS store; omitted store is volatile process-local development state. */
  store?: TagContainerStore;
  /** Definition snapshot or initial runtime definition; server governance ownership remains separate. */
  container?: TagContainer;
  /** Telemetry route mount, default /_tags; administration can mount independently. */
  prefix?: string;
  /** Optional explicit admin API/UI/CORS/CSRF/audit policy; host mounts returned routes. */
  administration?: import('./admin-policy.js').TagAdminMount;
  /** Absolute public origin for a separate tagging subdomain; browser sends here. */
  publicOrigin?: string;
  /** Optional host-bound site; public collection must verify origin/site mapping independently. */
  site?: string;
  /** Explicit collector origin allowlist, separate from administration origins. */
  allowedOrigins?: string[];
  /** Private host server-collection bearer secret, never browser bootstrap configuration. */
  serverToken?: string;
  /** Secrets resolved server-side; never included in an exposed container. */
  credentials?: Record<
    string,
    {
      /** Private server credential value resolved only inside destination dispatch. */
      secret: string;
    }
  >;
  /** Host-owned reference-to-HTTPS-address mapping; untrusted definitions carry references only. */
  destinations?: Record<
    string,
    {
      /** Explicit host-approved destination URL; deployment DNS/IP egress policy remains required. */
      url: string; /** Private configured destination headers; never exported to browser definitions. */
      headers?: Record<string, string>;
    }
  >;
  /** Borrowed server transport; wrapper close does not own global connection pools. */
  fetch?: typeof fetch;
  /** No admin routes are created unless an application authorizer is supplied. */
  authorizeAdmin?: (request: Request) => boolean | Promise<boolean>;
  /** An independent permission check; without this callback no one may publish or roll back. */
  authorizePublish?: (request: Request) => boolean | Promise<boolean>;
  /** Browser event consent is a client assertion; still enforce consent at collection ingress. */
  requireBrowserConsent?: boolean;
  /** Bind approved origins to fixed site identities; never trust browser-supplied site names. */
  siteByOrigin?: Record<string, string>;
  /** Optional known-bot filtering policy, not an authentication or consent proof. */
  botPolicy?: 'allow' | 'drop-known';
  /** Optional exact admin request host restriction, independent of user authorization. */
  dashboardHost?: string;
  /** Explicitly enables bounded debug metadata callbacks; never exposes destination credentials. */
  debug?: boolean;
  /** Initial telemetry setting, independent of email consent. */
  defaultConsent?: 'granted' | 'denied';
  /** Optional isolated diagnostic callback; host owns label/identity handling and storage policy. */
  onDebug?: (data: {
    /** Opaque reserved request correlation ID; server scopes may intentionally reuse one across related events. */
    requestId: string;
    /** Optional exact event identifier for event triggers; debug events are correlation labels. */
    event: string;
    /** Matched definition IDs only, not source expressions or user traits. */
    matchedTriggers: string[];
    /** Destination tag IDs whose dispatch settled successfully; not provider-side processing proof. */
    firedTags: string[];
    /** Failed tag IDs or fixed runtime outcome categories, without private transport causes. */
    failures: string[];
  }) => void;
  /** Fail-soft sink, store and ID warnings. Never receives credentials, URLs or event payloads. */
  onWarning?: (message: string) => void;
  /** App-owned trusted code registry; borrowed unless ownProviders is true. */
  providers?: import('./providers.js').TagProviderRegistry;
  /** True transfers registry disposal to this manager after drain; default borrowed. */
  ownProviders?: boolean;
  /** Actual pending dispatch ceiling, default eight, allowed one through sixty-four. */
  maxConcurrentDispatches?: number;
  /** Caller observation deadline, default 2000 ms, maximum 30000; native work can settle later. */
  dispatchTimeoutMs?: number;
  /** Host-owned fresh consent decision, checked before each destination. */
  allowDispatch?: (event: Readonly<TagEvent>) => boolean | Promise<boolean>;
  /** Collector/event byte budget, default 16 KiB, runtime range 256 through 262144. */
  maxBodyBytes?: number;
  /** Collector admission policy; not a distributed delivery guarantee. */
  maxEventsPerMinute?: number;
}
