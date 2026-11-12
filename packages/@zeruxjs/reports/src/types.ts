import type {
  AnalyticsManager,
  AnalyticsRow,
  AnalyticsSummaryQuery,
  AnalyticsAggregateQuery,
  AnalyticsAggregateResult,
  AnalyticsNumericAggregateQuery,
  AnalyticsNumericAggregateResult,
} from '@zeruxjs/analytics';
export type ChartKind =
  | 'bar'
  | 'horizontal-bar'
  | 'line'
  | 'area'
  | 'pie'
  | 'doughnut'
  | 'scatter'
  | 'stacked-bar'
  | 'table'
  | 'kpi';
export type Metric = 'count' | 'sum' | 'average' | 'min' | 'max' | 'distinct';
export interface ChartDefinition {
  /** Validated inert report/page/chart identifier; not permission to read a source. */
  id: string;
  /** Authored bounded inert chart label; UI renders text rather than executing markup. */
  title: string;
  /** Finite supported chart presentation kind; never executable rendering code. */
  type: ChartKind;
  /** Allowlisted built-in dimension or validated property reference; not SQL/JavaScript. */
  groupBy:
    | 'event'
    | 'day'
    | 'source'
    | 'site'
    | 'pathname'
    | `property:${string}`;
  /** Explicit supported count/numeric/distinct operation; coverage depends on the selected source path. */
  metric: Metric;
  /** Optional validated property key for numeric/distinct metrics; indexing is separately configured. */
  valueField?: string;
  /** Optional bounded event-name filter. */
  eventName?: string;
  /** Explicit borrowed analytics source or event-origin filter; no automatic provider discovery. */
  source?: string;
  /** Host-selected fixed site for dedicated instances, or a validated definition filter overridden by trusted scope. */
  site?: string;
  /** Optional inclusive epoch-millisecond query bound; saved values are not recomputed on every render. */
  since?: number;
  /** Optional final epoch-millisecond query bound; runtime date overrides are separately bounded. */
  until?: number;
  /** Optional finite group/source row limit, at most500; returned display groups may be further bounded. */
  limit?: number;
}
export interface ReportPage {
  /** Validated inert report/page/chart identifier; not permission to read a source. */
  id: string;
  /** Bounded inert authored label, not executable HTML. */
  name: string;
  /** Finite validated chart definitions owned by this page. */
  charts: ChartDefinition[];
  /** Optional independently versioned presentation layout; absent resolves to legacy defaults. */
  layout?: import('./layout.js').ReportLayoutV1;
}
export interface ReportDefinition {
  /** Validated inert report/page/chart identifier; not permission to read a source. */
  id: string;
  /** Bounded inert authored label, not executable HTML. */
  name: string;
  /** Optional bounded inert report notes; never source expressions or credentials. */
  description?: string;
  /** Finite validated page definitions with unique IDs. */
  pages: ReportPage[];
}
export interface ReportsDocument {
  /** Positive optimistic document storage revision, separate from layout/transfer versions. */
  version: number;
  /** Bounded validated report definitions; no result bodies or executable callbacks. */
  reports: ReportDefinition[];
}
export interface ReportsStore {
  /** Read the current private tenant document; the host owns storage isolation, lifecycle and failure semantics.
   * @returns {Promise<ReportsDocument>} Explicit source/storage result or dependency failure; permissions and resource ownership remain host-owned.
   */
  load(): Promise<ReportsDocument>;
  /** Conditionally save one next revision. Return false for a stale conflict, never silently overwrite; local memory revisioning does not supply distributed locks.
   * @param {ReportsDocument} document - Validated next document with expectedVersion+1; no imported revision bypass.
   * @param {number} expectedVersion - Required optimistic current storage revision; a stale save returns false.
   * @returns {Promise<boolean>} Explicit source/storage result or dependency failure; permissions and resource ownership remain host-owned.
   */
  save(document: ReportsDocument, expectedVersion: number): Promise<boolean>;
}
/** Custom aggregate adapters remove the built-in 500-row query limit. */
export interface AnalyticsReportSource {
  /** Borrow a bounded analytics event page. Raw rows may contain private properties and must not be forwarded as aggregate output.
   * @param {AnalyticsSummaryQuery} query - Explicit bounded analytics query; host-scoped site must override definition input.
   * @returns {Promise<AnalyticsRow[]>} Explicit source/storage result or dependency failure; permissions and resource ownership remain host-owned.
   */
  events(query: AnalyticsSummaryQuery): Promise<AnalyticsRow[]>;
  /** Optionally execute connector-native persisted event counts; unknown coverage must not become a fictional exact total.
   * @param {AnalyticsAggregateQuery} query - Explicit bounded analytics query; host-scoped site must override definition input.
   * @returns {Promise<AnalyticsAggregateResult>} Explicit source/storage result or dependency failure; permissions and resource ownership remain host-owned.
   */
  aggregate?(query: AnalyticsAggregateQuery): Promise<AnalyticsAggregateResult>;
  /** Optionally query indexed numeric facts with explicit coverage; historical/failed sidecars may be absent.
   * @param {AnalyticsNumericAggregateQuery} query - Explicit bounded analytics query; host-scoped site must override definition input.
   * @returns {Promise<AnalyticsNumericAggregateResult>} Explicit source/storage result or dependency failure; permissions and resource ownership remain host-owned.
   */
  aggregateNumeric?(
    query: AnalyticsNumericAggregateQuery
  ): Promise<AnalyticsNumericAggregateResult>;
  /** Report whether this explicit field supports the native numeric path; false preserves bounded sampling.
   * @param {string} field - Explicit configured numeric field; absence means sampling rather than invented materialization.
   * @returns {boolean} Explicit source/storage result or dependency failure; permissions and resource ownership remain host-owned.
   */
  supportsNumericField?(field: string): boolean;
}
export type ReportAction =
  | 'read'
  | 'edit'
  | 'export'
  | 'sensitive'
  | 'campaign';
/** A trusted application callback supplies both tenant storage and a fixed analytics site.
 * Never derive this from query parameters, Host or unverified cookies. */
export interface ReportTenantScope {
  /** Host-selected fixed site for dedicated instances, or a validated definition filter overridden by trusted scope. */
  site: string;
  /** Explicit borrowed tenant-specific CAS document store; a shared cross-tenant store is not isolated merely by site filtering. */
  store: ReportsStore;
  /** Explicit borrowed analytics source or event-origin filter; no automatic provider discovery. */
  source?: AnalyticsReportSource;
}
export interface MarketingReportPage {
  /** Opaque campaign reference; the underlying service must authorize it independently. */
  campaignCode: string;
  /** Provider-owned campaign status text, never proof of delivery. */
  status: string;
  /** Actual recipient records included in this page/scope. */
  scanned: number;
  /** Finite recipient-state totals checked against scanned rows. */
  states: Record<string, number>;
  /** Opaque bounded continuation, null when no further page is indicated. */
  nextCursor: string | null;
  /** Whether this campaign scan page reached its end. */
  done: boolean;
  /** Complete scan versus one recipient page; never treat partial data as campaign-wide. */
  scope: 'complete' | 'page';
  /** Required coverage explanation; SMTP acceptance is not confirmed mailbox delivery. */
  disclaimer: string;
}
/** The marketing service must authorize campaign access independently of Reports.
 * Supplying campaign callbacks does not grant access to another tenant's campaigns. */
export interface CampaignReportsSource {
  /** Read one independently authorized campaign recipient-state page with explicit continuation; SMTP acceptance is not inbox delivery.
   * @param {string} code - Opaque campaign reference; the campaign provider independently authorizes tenant access.
   * @param {object} options - Bounded campaign page settings with a host-selected site.
   * @param {string|null} options.cursor - Opaque exclusive continuation.
   * @param {number} options.limit - Explicit bounded recipient page size.
   * @param {string} [options.site] - Trusted authenticated site filter.
   * @returns {Promise<MarketingReportPage>} Explicit source/storage result or dependency failure; permissions and resource ownership remain host-owned.
   */
  report(
    code: string,
    options: {
      cursor: string | null;
      /** Optional finite group/source row limit, at most500; returned display groups may be further bounded. */
      limit: number;
      /** Host-selected fixed site for dedicated instances, or a validated definition filter overridden by trusted scope. */
      site?: string;
    }
  ): Promise<MarketingReportPage>;
  /** Optionally read campaign-native current states and provider-reported event aggregates; host validates permissions independently.
   * @param {string} code - Opaque campaign reference; the campaign provider independently authorizes tenant access.
   * @param {string} site - Optional trusted fixed tenant site; never take it directly from browser query text.
   * @returns {Promise<unknown>} Explicit source/storage result or dependency failure; permissions and resource ownership remain host-owned.
   */
  performance?(code: string, site?: string): Promise<unknown>;
  /** Optionally read bounded UTC last-state-update/provider-event trends, not immutable transition history.
   * @param {string} code - Opaque campaign reference; the campaign provider independently authorizes tenant access.
   * @param {string} from - Inclusive bounded UTC calendar start day.
   * @param {string} to - Inclusive bounded UTC calendar end day.
   * @param {string} site - Optional trusted fixed tenant site; never take it directly from browser query text.
   * @returns {Promise<unknown>} Explicit source/storage result or dependency failure; permissions and resource ownership remain host-owned.
   */
  dailyTrends?(
    code: string,
    from: string,
    to: string,
    site?: string
  ): Promise<unknown>;
  /** Optionally read consent-aware observed tracking totals; never infer unique people or confirmed views.
   * @param {string} code - Opaque campaign reference; the campaign provider independently authorizes tenant access.
   * @param {string} from - Inclusive bounded UTC calendar start day.
   * @param {string} to - Inclusive bounded UTC calendar end day.
   * @param {string} site - Optional trusted fixed tenant site; never take it directly from browser query text.
   * @returns {Promise<unknown>} Explicit source/storage result or dependency failure; permissions and resource ownership remain host-owned.
   */
  activity?(
    code: string,
    from: string,
    to: string,
    site?: string
  ): Promise<unknown>;
}
export interface ReportsOptions {
  /** Borrowed internal analytics source; host config owns connection/lifecycle and consent. */
  analytics: AnalyticsManager;
  /** Explicit borrowed tenant-specific CAS document store; a shared cross-tenant store is not isolated merely by site filtering. */
  store?: ReportsStore;
  /** Explicit borrowed analytics source or event-origin filter; no automatic provider discovery. */
  source?: AnalyticsReportSource;
  /** Validated explicit mount prefix, default /_reports; not an authorization boundary. */
  prefix?: string;
  /** Distinct read, edit, export and campaign authorization; legacy single-argument callbacks remain valid. */
  authorize: (
    request: Request,
    action?: ReportAction,
    resourceId?: string
  ) => boolean | Promise<boolean>;
  /** Optional exact configured host restriction, additional to session/action authorization. */
  dashboardHost?: string;
  /** Default500, validated1–500 sampled rows; native aggregate paths have distinct coverage. */
  maxSourceRows?: number;
  /** Static site is appropriate only for dedicated single-tenant instances. */
  site?: string;
  /** Dynamic tenant mode REQUIRES tenant-specific persisted stores; authorization precedes resolution. */
  resolveScope?: (
    request: Request
  ) => Promise<ReportTenantScope> | ReportTenantScope;
  /** Opt-in marketing reporting; all callbacks must enforce their own campaign tenant boundary. */
  campaigns?: CampaignReportsSource;
  /** Trusted host rendering code, separate from saved definitions; authorization still runs first. */
  renderDashboard?: (context: {
    /** Validated explicit mount prefix, default /_reports; not an authorization boundary. */
    prefix: string;
  }) => string;
}
export interface ChartData {
  /** Validated inert report/page/chart identifier; not permission to read a source. */
  id: string;
  /** Authored bounded inert chart label; UI renders text rather than executing markup. */
  title: string;
  /** Finite supported chart presentation kind; never executable rendering code. */
  type: ChartKind;
  /** Finite returned display groups; missing backend groups are not inferred. */
  labels: string[];
  /** Finite values aligned to labels; interpretation depends on metric and coverage. */
  values: number[];
  /** Source metric total, not necessarily a sum of visible groups (for example an overall average). */
  total: number;
  /** Rows included in a bounded sample, or explicit source provenance; not a universal population size. */
  sampledRows: number;
  /** Whether groups/source rows are limited; false alone does not prove historical/index coverage. */
  truncated: boolean;
  /** Native DB counts are exact; limited source rows are explicitly sampled. */ queryMode?:
    | 'database'
    | 'sampled'
    | 'materialized';
  /** Materialized numeric totals cover only successfully indexed numeric facts. */ numericCoverage?: 'indexed-only';
  /** Persisted indexed numeric fact count, separate from complete historical events. */
  matchedFacts?: number;
  /** Scope and interpretation, not an assertion of exactness. */ coverage?: string;
}
