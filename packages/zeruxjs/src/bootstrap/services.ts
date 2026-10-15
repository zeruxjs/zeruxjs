import path from 'node:path';
import type { ZeruxConfig } from '../index.js';
import { initializeDatabaseRuntime } from './database.js';
import { initializeCacheRuntime } from './cache.js';
import { serviceRouteOverlaps } from './service-http.js';

export type ServiceName = 'database' | 'cache' | 'files' | 'analytics' | 'email' | 'tags' | 'reports' | 'queue';
export type ServiceStatus = { name: ServiceName; state: 'ready' | 'disabled' | 'degraded' | 'closed' };
/** Framework-neutral Fetch endpoints owned by a single runtime generation. */
export interface ServiceHttpRoute {
  pattern: string;
  handler: (request: Request) => Promise<Response> | Response;
}
export interface ScopedServiceHttpRoute extends ServiceHttpRoute { service: 'analytics' | 'email' | 'tags' | 'reports' | 'queue' }


/** Own every generation's resources. Failed preparations close in reverse initialization order. */
export function createServiceScope() {
  const services = new Map<ServiceName, unknown>();
  const httpRoutes: ScopedServiceHttpRoute[] = [];
  const releases: Array<{ name: ServiceName; release: () => Promise<void> }> = [];
  let closed = false;
  let closing: Promise<void> | undefined;
  const disabled = new Set<ServiceName>();
  const degraded = new Set<ServiceName>();
  return {
    get<T = unknown>(name: ServiceName): T | undefined { return services.get(name) as T | undefined; },
    add(name: ServiceName, value: unknown, release?: () => Promise<void> | void) {
      if (closed || services.has(name)) throw new Error(`Duplicate or closed runtime service: ${name}`);
      if (value == null) { disabled.add(name); return; }
      services.set(name, value);
      const cleanup = release ?? (() => {
        const item = value as { close?: () => Promise<void> | void; disconnect?: () => Promise<void> | void };
        if (typeof item.close === 'function') return item.close();
        return item.disconnect?.();
      });
      releases.push({ name, release: async () => { await cleanup(); } });
    },
    markDegraded(name: ServiceName) { degraded.add(name); },
    /** Register only distinct, absolute service paths; never override application routes. */
    addHttpRoutes(service: 'analytics' | 'email' | 'tags' | 'reports' | 'queue', routes: readonly ServiceHttpRoute[]) {
      if (closed) throw new Error('Cannot register HTTP routes on a closed service scope');
      // Check the entire batch before mutating the live scope. Dynamic paths and
      // catch-alls can shadow routes even when their strings differ.
      const accepted = httpRoutes.map(route => route.pattern);
      for (const route of routes) {
        if (typeof route.pattern !== 'string' || !/^\/(?:[A-Za-z0-9_.~:*-]+)(?:\/[A-Za-z0-9_.~:*-]+)*\/?$/.test(route.pattern) ||
            route.pattern === '/' || route.pattern.includes('..') || route.pattern.includes('//') ||
            route.pattern.includes('?') || route.pattern.includes('#') || typeof route.handler !== 'function') {
          throw new TypeError('Invalid service HTTP route');
        }
        if (accepted.includes(route.pattern)) throw new Error(`Duplicate service HTTP route: ${route.pattern}`);
        if (accepted.some(existing => serviceRouteOverlaps(existing, route.pattern))) {
          throw new Error(`Conflicting service HTTP route: ${route.pattern}`);
        }
        accepted.push(route.pattern);
      }
      httpRoutes.push(...routes.map(route => ({ ...route, service })));
    },
    httpRoutes(): readonly ScopedServiceHttpRoute[] { return [...httpRoutes]; },
    status(): ServiceStatus[] {
      return (['database', 'cache', 'files', 'analytics', 'email', ...(services.has('tags') || degraded.has('tags') ? ['tags'] : []), ...(services.has('reports') || degraded.has('reports') ? ['reports'] : []), ...(services.has('queue') || degraded.has('queue') ? ['queue'] : [])] as ServiceName[]).map(name => ({
        name, state: closed ? 'closed' : degraded.has(name) ? 'degraded' : services.has(name) ? 'ready' : 'disabled'
      }));
    },
    async close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => {
        const errors: unknown[] = [];
        for (const { release } of [...releases].reverse()) {
          try { await release(); } catch (error) { errors.push(error); }
        }
        services.clear();
        httpRoutes.length = 0;
        if (errors.length) throw new AggregateError(errors, 'Failed to close one or more Zerux services');
      })();
      return closing;
    }
  };
}
export type RuntimeServiceScope = ReturnType<typeof createServiceScope>;

export interface FilesStartupConfig {
  defaultStorage?: string;
  stores: Array<{ name: string; type: 'local' | 's3'; root?: string; options?: Record<string, unknown>;
    allowedBuckets?: string[]; allowedTypes?: string[]; readonly?: boolean; maxBytes?: number; keyPrefix?: string }>;
  cache?: { maxEntries?: number; maxBytes?: number; ttlMs?: number };
}
export interface EmailTrackingStartupConfig {
  enabled?: boolean;
  baseUrl: string;
  /** Legacy single-secret mode, or use keyRing to rotate signing keys. */
  secret?: string;
  keyRing?: {
    current: { id: string; secret: string };
    previous?: Array<{ id: string; secret: string }>;
  };
  /** Optional compatibility switch for pre-Section 44 readable HMAC links. */
  acceptLegacyHmac?: boolean;
  path?: string;
  ttlMs?: number;
  allowedLinkHosts?: string[];
  telemetryTimeoutMs?: number;
  maxPendingTelemetry?: number;
  /** Optional shared durable aggregation adapter. Independent of marketing consent. */
  activityStore?: { record(event: {kind:'sent'|'open'|'click'|'download_click'|'download';id:string;account:string;campaign:string;at:number;linkId?:string;bytes?:number}): Promise<void>; get(id: string): Promise<unknown> };
}
export interface EmailPreferencesStartupConfig {
  enabled?: boolean;
  baseUrl: string;
  secret: string;
  path?: string;
  maxAgeMs?: number;
  postTimeoutMs?: number;
  /** Shared durable adapter supplied by the host; optional for development only. */
  store?: {get(email: string): Promise<unknown>; set(email: string, record: unknown): Promise<void>};
}
export interface AnalyticsCollectorStartupConfig {
  prefix?: string;
  allowedOrigins?: string[];
  serverToken?: string;
  maxBodyBytes?: number;
  bodyTimeoutMs?: number;
  maxConcurrentReads?: number;
  maxEventsPerMinute?: number;
  storageTimeoutMs?: number;
  maxPendingEvents?: number;
}
/** Admin routes appear only with host-application session authentication. No bundled default passwords. */
export interface TagsStartupConfig {
  enabled?:boolean;
  prefix?:string;
  site?:string;
  publicOrigin?:string;
  allowedOrigins?:string[];
  serverToken?:string;
  requestIds?:{reserve(day:string,id:string):Promise<boolean>};
  store?:{load():Promise<unknown>;save(container:unknown,expectedVersion:number):Promise<boolean>};
  container?:unknown;
  credentials?:Record<string,{secret:string}>;
  destinations?:Record<string,{url:string;headers?:Record<string,string>}>;
  authorizeAdmin?:(request:Request)=>boolean|Promise<boolean>;
  authorizePublish?:(request:Request)=>boolean|Promise<boolean>;
  requireBrowserConsent?:boolean;
  siteByOrigin?:Record<string,string>;
  botPolicy?:'allow'|'drop-known';
  onWarning?:(message:string)=>void;
  dashboardHost?:string;
  debug?:boolean;
  defaultConsent?:'granted'|'denied';
  onDebug?:(data:unknown)=>void;
  maxBodyBytes?:number;
  maxEventsPerMinute?:number;
}
export interface ReportsStartupConfig {
  enabled?:boolean;
  prefix?:string;
  authorize:(request:Request,action?:'read'|'edit'|'export'|'sensitive'|'campaign',resourceId?:string)=>boolean|Promise<boolean>;
  dashboardHost?:string;
  store?:{load():Promise<any>;save(document:any,expectedVersion:number):Promise<boolean>};
  source?:{events(query:any):Promise<any[]>;aggregate?:(query:any)=>Promise<any>;aggregateNumeric?:(query:any)=>Promise<any>;supportsNumericField?:(field:string)=>boolean};
  resolveScope?:(request:Request)=>Promise<{site:string;store:{load():Promise<any>;save(document:any,expectedVersion:number):Promise<boolean>};source?:ReportsStartupConfig['source']}>|{site:string;store:{load():Promise<any>;save(document:any,expectedVersion:number):Promise<boolean>};source?:ReportsStartupConfig['source']};
  campaigns?:{report:(code:string,options:{cursor:string|null;limit:number;site?:string})=>Promise<any>;performance?:(code:string,site?:string)=>Promise<unknown>;dailyTrends?:(code:string,from:string,to:string,site?:string)=>Promise<unknown>;activity?:(code:string,from:string,to:string,site?:string)=>Promise<unknown>};
  maxSourceRows?:number;
  /** Restrict every report query to one analytics site, independent of saved chart definitions. */
  site?:string;
}
/** Queue workers run only when explicitly configured. Redis config stays private. */
export interface QueueStartupConfig {
  enabled?:boolean;
  required?:boolean;
  redis: {url?:string;host?:string;port?:number;username?:string;password?:string;db?:number;tls?:Record<string,unknown>;cluster?:{nodes:Array<{host:string;port:number}>};keyPrefix?:never};
  prefix?:string;
  queues: Array<string | {name:string;defaultJobOptions?:Record<string,unknown>}>;
  workers?:Record<string,{processor:(job:unknown)=>Promise<unknown>|unknown;concurrency?:number;autorun?:boolean;lockDuration?:number;limiter?:{max:number;duration:number}}>;
  readyTimeoutMs?:number;
  shutdownGraceMs?:number;
  onWorkerError?:(queue:string,error:unknown)=>void;
  /** Optional Redis-stream job lifecycle events; payloads are never forwarded to callbacks. */
  events?:{enabled:true;onEvent?:(event:{queue:string;type:string;jobId?:string;at:string})=>void;onError?:(queue:string,error:unknown)=>void};
  /** Host-validated operations authorization. Queue management is never exposed as public routes. */
  dashboard?:{
    authorize:(request:Request)=>unknown|Promise<unknown>;
    verifyCsrf:(request:Request,principal:unknown)=>boolean|Promise<boolean>;
    csrfToken:(request:Request,principal:unknown)=>string|Promise<string>;
    prefix?:string;
    publicOrigin?:string;
  };
  administration?:{
    authorize:(action:'inspect'|'retry'|'pause-queue'|'resume-queue'|'pause-worker'|'resume-worker'|'schedule-inspect'|'schedule-create'|'schedule-remove',queue:string,context:unknown)=>boolean|Promise<boolean>;
    onAudit?:(entry:{action:string;queue:string;jobId?:string;success:boolean;at:string})=>void|Promise<void>;
    maxPageSize?:number;
  };
}
export interface EndpointProvider { routes(): ServiceHttpRoute[] }
export interface EmailStartupConfig {
  accounts?: Array<Record<string, unknown>>;
  /** Optional receive-only or combined SMTP/IMAP/POP3 runtime. Inbound credentials are server-only. */
  receive?: {
    enabled?:boolean;
    /** Required only for the built-in persistent inbox. */
    database?:string;
    table?:string;
    /** Existing application-owned inbox table mapping. No schema changes unless createTable=true. */
    mapping?:{table:string;createTable?:boolean;columns?:{id?:string;account?:string;payload?:string;subject?:string;mailbox?:string;receivedAt?:string;from?:string}};
    /** json returns parsed messages without creating inbox tables. */
    mode?:'json'|'persist';
    /** Host-provided storage mapping can replace the built-in ZeruxJS table. */
    store?:{get:(id:string)=>Promise<unknown>;put:(message:unknown)=>Promise<boolean>;page:(account:string,cursor:string|null,limit:number)=>Promise<unknown>;erase?:(id:string,account:string)=>Promise<boolean>};
    /** Optional server-only inbox UI API. Never enabled without a host authorization callback. */
    api?:{
      authorize:(access:{operation:'list'|'read'|'search'|'poll'|'markSeen'|'markUnread'|'flag'|'unflag'|'folders'|'erase';account:string;messageId?:string})=>boolean|Promise<boolean>;
      canErase?:(message:unknown)=>boolean|Promise<boolean>;
    };
    onMessage?:(message:unknown)=>Promise<void>|void;
    /** Host-provided scanners; failures stop the poll instead of claiming a clean scan. */
    inspectRaw?:(context:{account:string;raw:Buffer})=>Promise<'clean'|'spam'|'phishing'|'malware'|'review'>;
    inspectAttachment?:(context:{account:string;messageId:string;filename:string;content:Buffer})=>Promise<'clean'|'suspicious'|'blocked'>;
    saveAttachment?:(context:{account:string;messageId:string;attachment:unknown;content:Buffer})=>Promise<string>;
    attachmentContent?:'metadata'|'base64';
    maxInlineAttachmentBytes?:number;
    accounts?:Array<Record<string,unknown>>;
    /** If omitted, each sending account's `receive` config is used. */
  };
  defaultAccount?: string;
  maxRecipients?: number;
  marketingSuppression?:{isSuppressed:(address:string)=>Promise<boolean>};
  /** Opt-in, durable, per-SMTP-account sender reputation. Connector name is resolved server-side. */
  reputation?:{enabled?:boolean;database:string;table?:string;policy?:{
    windowMs?:number;minimumAccepted?:number;warnBouncePercent?:number;pauseBouncePercent?:number;
    warnComplaintPercent?:number;pauseComplaintPercent?:number;warnSoftBouncePercent?:number;pauseSoftBouncePercent?:number;
    protectTransactional?:boolean;scanLimit?:number
  }};
  tracking?: EmailTrackingStartupConfig;
  preferences?: EmailPreferencesStartupConfig;
  /** Optional trusted campaign admin UI, not enabled by default. */
  /** Optional signed provider bounce/complaint intake; never mounted without signature verifier. */
  marketingFeedback?: {
    enabled?:boolean;
    suppression:{recordFeedback:(event:any)=>Promise<unknown>};
    feedbackAccount?:(event:any)=>string;
    /** Optional provider-verified delivery/deferred/bounce/complaint event ledger. */
    providerOutcomes?:{record:(event:{eventId:string;provider:string;campaignId:string;messageId:string;kind:'delivered'|'deferred'|'hard-bounce'|'soft-bounce'|'complaint';occurredAt:number})=>Promise<boolean>};
    /** Must resolve attribution and stable event time from trusted provider metadata. */
    feedbackDelivery?:(event:any)=>{provider:string;campaignId:string;messageId:string;occurredAt:number};
    verifySignature:(body:Uint8Array,headers:Headers)=>boolean|Promise<boolean>;
    parse:(body:Uint8Array,headers:Headers)=>unknown|Promise<unknown>;
    path?:string;maxBodyBytes?:number;timeoutMs?:number;
  };
  /** Optional protected UI for one-template function-first marketing campaigns. */
  marketingCampaignDashboard?: {
    service:unknown;
    authorize:(request:Request)=>unknown|Promise<unknown>;
    authorizeCampaign:(principal:unknown,code:string,action:string)=>boolean|Promise<boolean>;
    authorizeCreate:(principal:unknown)=>boolean|Promise<boolean>;
    authorizeList?:(principal:unknown)=>boolean|Promise<boolean>;
    verifyCsrf:(request:Request,principal:unknown)=>boolean|Promise<boolean>;
    csrfToken:(request:Request,principal:unknown)=>string|Promise<string>;
    prefix?:string;publicOrigin?:string;
  };
  campaignDashboard?: {
    /** Host-provided CampaignPlanner; strongly typed by @zeruxjs/email itself. */
    planner:unknown;
    authorize:(request:Request)=>unknown|Promise<unknown>;
    verifyCsrf:(request:Request,principal:unknown)=>boolean|Promise<boolean>;
    csrfToken:(request:Request,principal:unknown)=>string|Promise<string>;
    authorizeCampaign:(principal:unknown,id:string,action:string)=>boolean|Promise<boolean>;
    /** Optional PII-free, bounded delivery report callback; scope enforced by authorizeCampaign. */
    deliveryReport?:(campaignId:string)=>Promise<unknown>;
    performanceReport?:(campaignId:string)=>Promise<unknown>;
    /** Opt-in native UTC-day report, guarded by per-campaign dashboard authorization. */
    trendsReport?:(campaignId:string,from:string,to:string)=>Promise<unknown>;
    prefix?:string;publicOrigin?:string;
  };
}
export interface AnalyticsStartupConfig { analytics?: string; enabled?: boolean; table?: string; indexes?:boolean; numericFields?:string[]; numericUniqueIndexManagedExternally?:boolean; required?: false; collector?: AnalyticsCollectorStartupConfig; }

export interface ServiceInitializers {
  database(config: ZeruxConfig): Promise<unknown>;
  cache(config: ZeruxConfig): Promise<unknown>;
  files(config: FilesStartupConfig, rootDir: string): Promise<unknown>;
  analytics(config: AnalyticsStartupConfig, database: unknown): Promise<unknown>;
  email(config: EmailStartupConfig, files: unknown, analytics: unknown, tracking?: unknown, preferences?: unknown, reputation?:unknown, database?:unknown): Promise<unknown>;
  emailPreferences(config: EmailPreferencesStartupConfig): Promise<EndpointProvider>;
  analyticsCollector(config: AnalyticsCollectorStartupConfig, analytics: unknown): Promise<EndpointProvider>;
  emailTracking(config: EmailTrackingStartupConfig, analytics: unknown): Promise<EndpointProvider>;
  tags(config: TagsStartupConfig, analytics: unknown): Promise<EndpointProvider>;
  reports(config: ReportsStartupConfig, analytics: unknown): Promise<EndpointProvider>;
  queue(config: QueueStartupConfig): Promise<unknown>;
}

const defaults: ServiceInitializers = {
  database: initializeDatabaseRuntime,
  cache: initializeCacheRuntime,
  async files(config, rootDir) {
    const moduleId = '@zeruxjs/files';
    const { createFileManager, createLocalStorage, createS3Storage } = await import(moduleId) as {
      createFileManager: (config: unknown) => unknown;
      createLocalStorage: (config: unknown) => unknown;
      createS3Storage: (config: unknown) => unknown;
    };
    return createFileManager({
      defaultStorage: config.defaultStorage, cache: config.cache,
      stores: config.stores.map(store => ({
        name: store.name, allowedBuckets: store.allowedBuckets, allowedTypes: store.allowedTypes,
        readonly: store.readonly, maxBytes: store.maxBytes, keyPrefix: store.keyPrefix,
        driver: store.type === 'local'
          ? createLocalStorage({ ...store.options, root: path.resolve(rootDir, store.root ?? '.zerux/files') })
          : store.type === 's3' ? createS3Storage(store.options ?? {}) : (() => { throw new Error('Unknown storage driver'); })()
      }))
    });
  },
  async analytics(config, database) {
    const moduleId = '@zeruxjs/analytics';
    const { createAnalytics } = await import(moduleId) as { createAnalytics: (config: unknown) => {
      initialize(): Promise<boolean>;
      status(): unknown;
      track(event: unknown): Promise<unknown>;
    } };
    const { collector: _collector, ...settings } = config;
    const instance = createAnalytics({ ...settings, database });
    await instance.initialize(); // A disconnected DB never interrupts application startup.
    return instance;
  },
  async analyticsCollector(config, analytics) {
    const moduleId = '@zeruxjs/analytics';
    const { createAnalyticsCollector } = await import(moduleId) as {
      createAnalyticsCollector: (options: unknown) => EndpointProvider;
    };
    return createAnalyticsCollector({ ...config, analytics });
  },
  async tags(config, analytics) {
    const moduleId='@zeruxjs/tags';
    const {createTagManager,emptyTagContainer}=await import(moduleId) as {createTagManager:(config:unknown)=>EndpointProvider;emptyTagContainer:()=>unknown};
    const active=analytics as {createRequestIdStore?:()=>unknown;createDocumentStore?:(table:string,id:string,initial:unknown)=>unknown};
    const store=config.store??active?.createDocumentStore?.('analytics_tag_containers','default',config.container??emptyTagContainer());
    if(!store)console.warn('[zerux tags] Using volatile configuration; supply a shared persistent store');
    let requestIds=config.requestIds??active?.createRequestIdStore?.();
    if(!requestIds){
      // Explicit warning: memory mode is not a cross-instance reservation system.
      console.warn('[zerux tags] No shared ID store; single-process development reservation only');
      const analyticsId='@zeruxjs/analytics';
      const {createMemoryRequestIdStore}=await import(analyticsId) as {createMemoryRequestIdStore:()=>unknown};
      requestIds=createMemoryRequestIdStore();
    }
    return createTagManager({...config,analytics,requestIds,...(store?{store}:{})});
  },
  async reports(config,analytics) {
    const moduleId='@zeruxjs/reports';
    const {createReports}=await import(moduleId) as {createReports:(config:unknown)=>EndpointProvider};
    const active=analytics as {createDocumentStore?:(table:string,id:string,initial:unknown)=>unknown};
    const store=config.store??active?.createDocumentStore?.('analytics_report_documents','default',{version:1,reports:[]});
    if(!store)console.warn('[zerux reports] Using volatile reports; supply a shared persistent store');
    return createReports({...config,analytics,...(store?{store}:{})});
  },
  async queue(config) {
    const moduleId='@zeruxjs/queue';
    const {createQueueService}=await import(moduleId) as {createQueueService:(config:unknown)=>Promise<unknown>};
    return createQueueService(config);
  },
  async emailTracking(config, analytics) {
    const moduleId = '@zeruxjs/analytics';
    const { createEmailTrackingService } = await import(moduleId) as {
      createEmailTrackingService: (options: unknown) => EndpointProvider;
    };
    // Signed links must continue redirecting/serving pixels during DB outages.
    const telemetry = analytics ?? { track: async () => undefined };
    return createEmailTrackingService({ ...config, analytics: telemetry });
  },
  async emailPreferences(config) {
    const moduleId = '@zeruxjs/email';
    const {createEmailPreferenceService} = await import(moduleId) as {createEmailPreferenceService: (options: unknown) => EndpointProvider};
    const {enabled: _enabled, ...settings} = config;
    return createEmailPreferenceService(settings);
  },
  async email(config, files, _analytics, tracking, preferences, reputation, database) {
    const moduleId = '@zeruxjs/email';
    const { createEmailManager, createEmailReceiver, createDatabaseInboxStore, createMappedDatabaseInboxStore, createInboxApi } = await import(moduleId) as {
      createEmailManager:(config:unknown)=>any;
      createEmailReceiver:(config:unknown)=>any;
      createDatabaseInboxStore:(db:unknown,table?:string)=>unknown;
      createMappedDatabaseInboxStore:(db:unknown,config:unknown)=>unknown;
      createInboxApi:(config:unknown)=>unknown;
    };
    const { tracking: _trackingConfig, preferences: _preferencesConfig, campaignDashboard: _campaignDashboard, marketingCampaignDashboard: _marketingCampaignDashboard, marketingFeedback: _marketingFeedback, reputation: _reputationConfig, receive: receiveConfig, ...settings } = config;
    const incomingFromAccounts=(settings.accounts??[]).filter(a=>a.receive&&typeof a.receive==='object').map(a=>({name:a.name,...(a.receive as Record<string,unknown>)}));
    const sendingAccounts=(settings.accounts??[]).filter(a=>a.smtp||a.transport);
    const manager=sendingAccounts.length?createEmailManager({...settings,accounts:sendingAccounts,files,tracking,preferences,reputation}):null;
    if(receiveConfig?.enabled!==false && (receiveConfig?.accounts?.length||incomingFromAccounts.length)){
      let store=receiveConfig?.store;
      const receiveMode=receiveConfig?.mode??'persist';
      if(receiveMode!=='json'&&receiveMode!=='persist')throw new Error('Invalid email receive mode');
      if(receiveMode==='persist'&&!store){
        if(!receiveConfig?.database||typeof receiveConfig.database!=='string')throw new Error('Persistent email receive requires a named database connector or host inbox store');
        const runtimeDatabase=database as {getConnectionFacade?:(name:string)=>unknown}|undefined;
        const connector=runtimeDatabase?.getConnectionFacade?.(receiveConfig.database);
        if(!connector)throw new Error('Email receive requires an available named database connector');
        store=(receiveConfig?.mapping
          ? createMappedDatabaseInboxStore(connector,receiveConfig.mapping)
          : createDatabaseInboxStore(connector,receiveConfig?.table)) as typeof store;
      }
      const inbound=createEmailReceiver({accounts:receiveConfig?.accounts?.length?receiveConfig.accounts:incomingFromAccounts,
        mode:receiveMode,store,onMessage:receiveConfig?.onMessage,
        inspectRaw:receiveConfig?.inspectRaw,inspectAttachment:receiveConfig?.inspectAttachment,saveAttachment:receiveConfig?.saveAttachment,
        attachmentContent:receiveConfig?.attachmentContent,maxInlineAttachmentBytes:receiveConfig?.maxInlineAttachmentBytes});
      const inbox=store&&receiveConfig?.api ? createInboxApi({store,receiver:inbound,...receiveConfig.api}) : undefined;
      if(receiveConfig?.api&&!store)throw new Error('The inbox UI API requires a persistent or host-defined inbox store');
      if(!manager)return {receive:inbound,...(inbox?{inbox}:{}),async close(){await inbound.close();}};
      return {...manager,receive:inbound,...(inbox?{inbox}:{}),async close(){await inbound.close();await manager.close();}};
    }
    if(!manager)throw new Error('Email requires an SMTP sending account or a configured receive account');
    return manager;
  }
};

/** Start configured application services. Credentials never enter the public runtime config. */
export async function initializeRuntimeServices(config: ZeruxConfig, rootDir: string, providers: Partial<ServiceInitializers> = {}): Promise<RuntimeServiceScope> {
  const scope = createServiceScope();
  const start = { ...defaults, ...providers };
  const files = config.files as FilesStartupConfig | undefined;
  const email = config.email as EmailStartupConfig | undefined;
  const analytics = config.analytics as AnalyticsStartupConfig | undefined;
  const tags = config.tags as TagsStartupConfig | undefined;
  const reports = config.reports as ReportsStartupConfig | undefined;
  const queue = config.queue as QueueStartupConfig | undefined;
  // All service config, session authorizers and destination credentials stay out of public build manifests.
  delete config.files; delete config.email; delete config.analytics; delete config.tags; delete config.reports; delete config.queue;
  try {
    scope.add('database', await start.database(config));
    scope.add('cache', await start.cache(config));
    if (files) scope.add('files', await start.files(files, rootDir));
    if (queue?.enabled === true) {
      try {
        const queueService=await start.queue(queue) as {routes?:()=>ServiceHttpRoute[]};
        try {
          if(queueService.routes)scope.addHttpRoutes('queue',queueService.routes());
          scope.add('queue',queueService);
        } catch (error) {
          try {await (queueService as {close?:()=>Promise<void>}).close?.();}catch{/* Preserve registration failure */}
          throw error;
        }
      }
      catch(error){
        if(queue.required === true) throw error;
        scope.markDegraded('queue');
        try{console.warn('[zerux queue] Service unavailable:',error instanceof Error?error.message:String(error));}catch{}
      }
    }
    if (analytics?.enabled !== false && analytics) {
      try { scope.add('analytics', await start.analytics(analytics, scope.get('database'))); }
      catch (error) {
        scope.markDegraded('analytics');
        // No telemetry failure must prevent application startup or delivery.
        try { console.warn('[zerux analytics] Telemetry unavailable:', error instanceof Error ? error.message : String(error)); } catch { /* best effort */ }
      }
    }
    if (analytics?.enabled !== false && analytics?.collector && scope.get('analytics')) {
      try {
        const collector = await start.analyticsCollector(analytics.collector, scope.get('analytics'));
        scope.addHttpRoutes('analytics', collector.routes());
      } catch (error) {
        scope.markDegraded('analytics');
        try { console.warn('[zerux analytics] Collector unavailable:', error instanceof Error ? error.message : String(error)); } catch { /* fail soft */ }
      }
    }
    if (tags?.enabled === true) {
      try {
        if (!scope.get('analytics')) throw new Error('Tags requires the analytics service');
        const tagService=await start.tags(tags,scope.get('analytics'));
        scope.addHttpRoutes('tags',tagService.routes());
        scope.add('tags',tagService);
      } catch(error){scope.markDegraded('tags');
        try{console.warn('[zerux tags] Service unavailable:',error instanceof Error?error.message:String(error));}catch{}
      }
    }
    if (reports?.enabled === true) {
      try {
        if (!scope.get('analytics')) throw new Error('Reports requires the analytics service');
        const reportService=await start.reports(reports,scope.get('analytics'));
        scope.addHttpRoutes('reports',reportService.routes());
        scope.add('reports',reportService);
      } catch(error){scope.markDegraded('reports');
        try{console.warn('[zerux reports] Service unavailable:',error instanceof Error?error.message:String(error));}catch{}
      }
    }
    let tracking: EndpointProvider | undefined;
    if (email?.tracking?.enabled === true) {
      try {
        tracking = await start.emailTracking(email.tracking, scope.get('analytics'));
      } catch (error) {
        scope.markDegraded('email');
        try { console.warn('[zerux email] Optional tracking unavailable:', error instanceof Error ? error.message : String(error)); } catch { /* fail soft */ }
      }
    }
    if (tracking) {
      try { scope.addHttpRoutes('email', tracking.routes()); }
      catch (error) {
        // Never instrument outgoing mail with links to routes we failed to mount.
        tracking = undefined;
        scope.markDegraded('email');
        try { console.warn('[zerux email] Tracking routes unavailable:', error instanceof Error ? error.message : String(error)); } catch { /* fail soft */ }
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
    if(email?.reputation?.enabled===true){
      const manager=scope.get('database') as {getConnectionFacade?:(slug:string)=>unknown}|undefined;
      if(!manager?.getConnectionFacade)throw new Error('Email reputation requires a configured database connector');
      const connection=manager.getConnectionFacade(email.reputation.database);
      const moduleId='@zeruxjs/email';
      const {createEmailReputationService,createDatabaseReputationLedger}=await import(moduleId) as {
        createEmailReputationService:(input:unknown)=>unknown;
        createDatabaseReputationLedger:(db:unknown,table?:string)=>unknown;
      };
      reputation=createEmailReputationService({ledger:createDatabaseReputationLedger(connection,email.reputation.table),policy:email.reputation.policy});
    }
    if (email?.marketingFeedback?.enabled===true) {
      const moduleId='@zeruxjs/email';
      const {createMarketingFeedbackEndpoint}=await import(moduleId) as {createMarketingFeedbackEndpoint:(config:unknown)=>EndpointProvider};
      scope.addHttpRoutes('email',createMarketingFeedbackEndpoint({...email.marketingFeedback,...(reputation?{reputation}:{})}).routes());
    }
    if (email?.campaignDashboard) {
      const moduleId='@zeruxjs/email';
      const {createCampaignDashboard}=await import(moduleId) as {createCampaignDashboard:(config:unknown)=>EndpointProvider};
      const dashboard=createCampaignDashboard(email.campaignDashboard);
      scope.addHttpRoutes('email',dashboard.routes());
    }
    if (email?.marketingCampaignDashboard) {
      const moduleId='@zeruxjs/email';
      const {createMarketingCampaignDashboard}=await import(moduleId) as {createMarketingCampaignDashboard:(config:unknown)=>EndpointProvider};
      scope.addHttpRoutes('email',createMarketingCampaignDashboard(email.marketingCampaignDashboard).routes());
    }
    if (email) scope.add('email', await start.email(email, scope.get('files'), scope.get('analytics'), tracking, preferences,reputation,scope.get('database')));
    return scope;
  } catch (error) {
    try { await scope.close(); } catch { /* Preserve initialization failure. */ }
    throw error;
  }
}
