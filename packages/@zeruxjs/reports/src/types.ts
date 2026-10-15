import type {AnalyticsManager,AnalyticsRow,AnalyticsSummaryQuery,AnalyticsAggregateQuery,AnalyticsAggregateResult,AnalyticsNumericAggregateQuery,AnalyticsNumericAggregateResult} from '@zeruxjs/analytics';
export type ChartKind='bar'|'horizontal-bar'|'line'|'area'|'pie'|'doughnut'|'scatter'|'stacked-bar'|'table'|'kpi';
export type Metric='count'|'sum'|'average'|'min'|'max'|'distinct';
export interface ChartDefinition {id:string;title:string;type:ChartKind;groupBy:'event'|'day'|'source'|'site'|'pathname'|`property:${string}`;metric:Metric;valueField?:string;eventName?:string;source?:string;site?:string;since?:number;until?:number;limit?:number}
export interface ReportPage {id:string;name:string;charts:ChartDefinition[]}
export interface ReportDefinition {id:string;name:string;description?:string;pages:ReportPage[]}
export interface ReportsDocument {version:number;reports:ReportDefinition[]}
export interface ReportsStore {load():Promise<ReportsDocument>;save(document:ReportsDocument,expectedVersion:number):Promise<boolean>}
/** Custom aggregate adapters remove the built-in 500-row query limit. */
export interface AnalyticsReportSource {events(query:AnalyticsSummaryQuery):Promise<AnalyticsRow[]>;aggregate?(query:AnalyticsAggregateQuery):Promise<AnalyticsAggregateResult>;aggregateNumeric?(query:AnalyticsNumericAggregateQuery):Promise<AnalyticsNumericAggregateResult>;supportsNumericField?(field:string):boolean}
export type ReportAction='read'|'edit'|'export'|'sensitive'|'campaign';
/** A trusted application callback supplies both tenant storage and a fixed analytics site.
 * Never derive this from query parameters, Host or unverified cookies. */
export interface ReportTenantScope {site:string;store:ReportsStore;source?:AnalyticsReportSource}
export interface MarketingReportPage {campaignCode:string;status:string;scanned:number;
  states:Record<string,number>;nextCursor:string|null;done:boolean;scope:'complete'|'page';disclaimer:string}
/** The marketing service must authorize campaign access independently of Reports.
 * Supplying campaign callbacks does not grant access to another tenant's campaigns. */
export interface CampaignReportsSource {
  report(code:string,options:{cursor:string|null;limit:number;site?:string}):Promise<MarketingReportPage>;
  performance?(code:string,site?:string):Promise<unknown>;
  dailyTrends?(code:string,from:string,to:string,site?:string):Promise<unknown>;
  activity?(code:string,from:string,to:string,site?:string):Promise<unknown>;
}
export interface ReportsOptions {
  analytics:AnalyticsManager;store?:ReportsStore;source?:AnalyticsReportSource;prefix?:string;
  /** Distinct read, edit, export and campaign authorization; legacy single-argument callbacks remain valid. */
  authorize:(request:Request,action?:ReportAction,resourceId?:string)=>boolean|Promise<boolean>;
  dashboardHost?:string;maxSourceRows?:number;
  /** Static site is appropriate only for dedicated single-tenant instances. */
  site?:string;
  /** Dynamic tenant mode REQUIRES tenant-specific persisted stores; authorization precedes resolution. */
  resolveScope?:(request:Request)=>Promise<ReportTenantScope>|ReportTenantScope;
  /** Opt-in marketing reporting; all callbacks must enforce their own campaign tenant boundary. */
  campaigns?:CampaignReportsSource;
}
export interface ChartData {id:string;title:string;type:ChartKind;labels:string[];values:number[];total:number;sampledRows:number;truncated:boolean;/** Native DB counts are exact; limited source rows are explicitly sampled. */queryMode?:'database'|'sampled'|'materialized';/** Materialized numeric totals cover only successfully indexed numeric facts. */ numericCoverage?:'indexed-only';matchedFacts?:number;/** Scope and interpretation, not an assertion of exactness. */coverage?:string}
