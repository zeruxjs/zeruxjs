/** Shape-compatible with @zeruxjs/db without coupling browser entry points to Node database drivers. */
export type EventValue = string | number | boolean | null;
export type EventProperties = Record<string, EventValue>;
export interface AnalyticsEventInput {
  name: string;
  properties?: EventProperties;
  source?: 'web' | 'server' | 'email' | 'system';
  site?: string;
  pathname?: string;
  /** An application-assigned opaque session identifier, never a raw email address. */
  sessionId?: string;
  /** Consent for web identifiers. Denied events are never persisted. */
  consent?: 'granted'|'denied'|'unknown';
  /** Pseudonymous, application-generated visitor token (never email/IP). Only stored with explicit consent. */
  visitorId?: string;
  occurredAt?: number;
  /** 16-character request correlation ID, assigned once per ingress request. */
  requestId?: string;
  /** UTC calendar day of request ID reservation. */
  requestUtcDay?: string;
  /** Optional tag-manager data layer variables; not stored as raw event properties. */
  data?: EventProperties;
}
export interface AnalyticsRow {
  id: string;
  event_name: string;
  source: string;
  site: string;
  pathname: string;
  session_id: string;
  occurred_at: number;
  properties_json: string;
}
export interface DatabaseResultLike {ok: boolean; rows?: unknown[]; affectedCount?:number;rowCount?:number; error?: {message?:string;code?:string}}
export interface AnalyticsConnection {
  insert(operation:{table:string;values:Record<string,string|number>|Array<Record<string,string|number>>}):DatabaseResultLike|Promise<DatabaseResultLike>;
  select(operation:{table:string;columns?:Array<string|{expr:{kind:'column';name:string}|{kind:'function';name:'COUNT'|'SUM'|'AVG'|'MIN'|'MAX';args:Array<{kind:'column';name:string}>};as?:string}>;groupBy?:string[];where?:{field:string;operator:'eq'|'gte'|'lte'|'gt'|'lt';value:string|number}|{and:Array<{field:string;operator:'eq'|'gte'|'lte'|'gt'|'lt';value:string|number}>};orderBy?:Array<{by:string;direction:'desc'|'asc'}>;limit?:number}):DatabaseResultLike|Promise<DatabaseResultLike>;
  createTable(operation:{table:string;ifNotExists:true;columns:Array<{name:string;type:'varchar'|'text'|'bigint'|'float';length?:number;primary?:boolean;notNull?:boolean}>}):DatabaseResultLike|Promise<DatabaseResultLike>;
  delete?(operation:{table:string;where:{field:string;operator:'eq'|'lt';value:string|number}|{and:Array<{field:string;operator:'eq'|'lt';value:string|number}>}}):DatabaseResultLike|Promise<DatabaseResultLike>;
  createIndex?(operation:{table:string;name:string;columns:string[];unique?:boolean;ifNotExists?:boolean}):DatabaseResultLike|Promise<DatabaseResultLike>;
  update?(operation:{table:string;values:Record<string,string|number>;where:{and:Array<{field:string;operator:'eq';value:string|number}>}}):DatabaseResultLike|Promise<DatabaseResultLike>;
}
export interface DatabaseManagerLike {connectionSlugs:readonly string[];getConnectionFacade(name:string):AnalyticsConnection}
export interface AnalyticsConfig {
  /** Named @zeruxjs/db connection; omitted/missing connections warn and skip telemetry. */
  analytics?:string;
  database?:DatabaseManagerLike;
  /** No data is collected when disabled. */
  enabled?:boolean;
  /** One warning per issue; warning handler exceptions are ignored. */
  onWarning?:(message:string)=>void;
  table?:string;
  /** Set false to manage analytics indexes with external migrations. Default true. */
  indexes?:boolean;
  /** Opt-in indexed numeric event properties (max 8). Existing events need an explicit backfill. */
  numericFields?:string[];
  /** Trust an externally migrated UNIQUE(event_id, property_name) index when indexes:false. */
  numericUniqueIndexManagedExternally?:boolean;
  /** Require explicit granted consent before saving *web* events. Default is optional; denied is always dropped. */
  webConsent?:'optional'|'required';
  /** Optional allowlist of event names and scalar properties. Unknown names/keys reject if configured. */
  eventSchemas?:Record<string,{properties:Record<string,'string'|'number'|'boolean'|'null'>;allowAdditionalProperties?:boolean}>;
  /** Explicit authorized administrator approval, required for destructive retention. */
  approveRetention?:(scope:{site:string;before:number})=>boolean|Promise<boolean>;
  /** Optional data minimization hook invoked before insertion. */
  filter?:(input:Readonly<AnalyticsEventInput>)=>AnalyticsEventInput|null|Promise<AnalyticsEventInput|null>;
}
export interface AnalyticsSummaryQuery {name?:string;source?:string;site?:string;since?:number;until?:number;limit?:number}
export interface AnalyticsAggregateQuery extends AnalyticsSummaryQuery {groupBy:'event'|'source'|'site'|'pathname'|'day'}
export interface AnalyticsAggregateResult {groups:Array<{category:string;value:number}>;total:number;truncated:boolean;mode:'database';groupBy:AnalyticsAggregateQuery['groupBy']}

/** Values cover successfully materialized numeric facts, not necessarily all historical events. */
export interface AnalyticsNumericAggregateQuery extends AnalyticsAggregateQuery {
  metric:'sum'|'average'|'min'|'max';
  valueField:string;
}
export interface AnalyticsNumericAggregateResult {
  groups:Array<{category:string;value:number}>;
  total:number;
  matchedFacts:number;
  truncated:boolean;
  mode:'materialized';
  coverage:'indexed-only';
  groupBy:AnalyticsAggregateQuery['groupBy'];
  metric:AnalyticsNumericAggregateQuery['metric'];
  valueField:string;
}
