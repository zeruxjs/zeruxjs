export type VitalName = 'LCP' | 'CLS' | 'INP' | 'FCP' | 'TTFB';
export interface PerformanceMetric {
  /** Bounded metric name or fixed native timing field; never a private URL or identity. */
  name: VitalName | string;
  /** Finite nonnegative observation; milliseconds for timing and score for CLS. */
  value: number;
  /** Optional fixed threshold rating, not a statistical significance claim. */
  rating?: 'good' | 'needs-improvement' | 'poor';
  /** Observation epoch milliseconds; not a generated user/session identifier. */
  timestamp: number;
  /** Explicit measurement provenance; unknown APIs must not become zero samples. */
  coverage?:
    | 'native-observation'
    | 'web-vitals-5'
    | 'server-request'
    | 'custom';
  /** Explicit data classification/provenance; not proof of host authorization. */
  consent?: 'granted' | 'denied' | 'unknown' | 'not-applicable';
  /** Optional bounded server status family without request identifiers. */
  statusClass?: '1xx' | '2xx' | '3xx' | '4xx' | '5xx';
  /** Optional fixed terminal server outcome. */
  outcome?: 'completed' | 'disconnected' | 'error';
}
export interface CacheOptions {
  /** Freshness seconds, default zero; finite nonnegative values are floored. */
  maxAge?: number;
  /** Explicit immutable representation directive; host owns versioning truth. */
  immutable?: boolean;
  /** Choose private rather than the legacy public default. */
  private?: boolean;
  /** Suppress all other directives and return no-store. */
  noStore?: boolean;
  /** Explicit stale revalidation requirement. */
  mustRevalidate?: boolean;
  /** Optional nonnegative stale-while-revalidate seconds. */
  staleWhileRevalidate?: number;
  /** Optional nonnegative stale-if-error seconds. */
  staleIfError?: number;
  /** Optional shared-cache freshness seconds; not safe for personalized data automatically. */
  sMaxAge?: number;
}
