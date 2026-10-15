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
export interface ReportsOptions {analytics:AnalyticsManager;store?:ReportsStore;source?:AnalyticsReportSource;prefix?:string;authorize:(request:Request)=>boolean|Promise<boolean>;dashboardHost?:string;maxSourceRows?:number;/** Optional enforced site isolation, not overridable by chart authors. */site?:string}
export interface ChartData {id:string;title:string;type:ChartKind;labels:string[];values:number[];total:number;sampledRows:number;truncated:boolean;/** Native DB counts are exact; limited source rows are explicitly sampled. */queryMode?:'database'|'sampled'|'materialized';/** Materialized numeric totals cover only successfully indexed numeric facts. */ numericCoverage?:'indexed-only';matchedFacts?:number}
