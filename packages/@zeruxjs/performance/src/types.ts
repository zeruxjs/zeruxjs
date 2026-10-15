export type VitalName = 'LCP'|'CLS'|'INP'|'FCP'|'TTFB';
export interface PerformanceMetric{name:VitalName|string;value:number;rating?:'good'|'needs-improvement'|'poor';timestamp:number}
export interface CacheOptions{maxAge?:number;immutable?:boolean;private?:boolean;noStore?:boolean;mustRevalidate?:boolean;staleWhileRevalidate?:number;staleIfError?:number;sMaxAge?:number}
