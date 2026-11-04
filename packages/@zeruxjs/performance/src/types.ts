export type VitalName = 'LCP'|'CLS'|'INP'|'FCP'|'TTFB';
export interface PerformanceMetric{name:VitalName|string;value:number;rating?:'good'|'needs-improvement'|'poor';timestamp:number;coverage?:'native-observation'|'web-vitals-5'|'server-request'|'custom';consent?:'granted'|'denied'|'unknown'|'not-applicable';statusClass?:'1xx'|'2xx'|'3xx'|'4xx'|'5xx';outcome?:'completed'|'disconnected'|'error'}
export interface CacheOptions{maxAge?:number;immutable?:boolean;private?:boolean;noStore?:boolean;mustRevalidate?:boolean;staleWhileRevalidate?:number;staleIfError?:number;sMaxAge?:number}
