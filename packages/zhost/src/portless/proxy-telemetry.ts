import type { IncomingMessage, ServerResponse } from 'node:http';
export type StatusFamily = '1xx' | '2xx' | '3xx' | '4xx' | '5xx';
export interface RouteLoadStatus {
  /** Host-controlled route label, or outside for unmatched traffic. */
  hostname: string;
  /** Currently observed responses not yet finished or closed. */
  activeRequests: number;
  /** Number of retained completions within the report window, not lifetime deliveries. */
  completed: number;
  /** Retained completion counts grouped by HTTP status family. */
  statusFamilies: Record<StatusFamily, number>;
  /** Retained completion counts keyed by numeric HTTP status. */
  statusCodes: Record<string, number>;
  /** Arithmetic mean of retained completion durations; zero when no samples exist. */
  averageLatencyMs: number;
  /** Retained completion count divided by the requested window in seconds. */
  requestsPerSecond: number;
  /** Retained completion counts by HTTP version. */
  httpVersions: Record<string, number>;
  /** Most recent retained completion timestamp, or null without samples. */
  lastRequestAt: number | null;
}
export interface ProxyLoadStatus {
  /** Wall-clock report timestamp in milliseconds. */
  sampledAt: number;
  /** Currently observed responses not yet finished or closed. */
  activeRequests: number;
  /** Lifetime arrivals observed by this process-local instance. */
  totalRequests: number;
  /** Retained completion counts grouped by HTTP status family. */
  statusFamilies: Record<StatusFamily, number>;
  /** Aggregate report for unmatched traffic and capacity overflow. */
  outsideRoutes: RouteLoadStatus;
  /** Bounded route reports in stable bucket insertion order. */
  routes: RouteLoadStatus[];
}
interface Sample {
  /** Completion wall-clock timestamp in milliseconds. */
  at: number;
  /** Observed HTTP status, or 499 for an unfinished response close. */
  status: number;
  /** Bounded elapsed response duration in milliseconds. */
  duration: number;
  /** Request HTTP version label. */
  version: string;
}
/** Create fresh zeroed HTTP family counters for each report.
 * @returns {Record<StatusFamily, number>} Detached fixed-label counters.
 */
const families = (): Record<StatusFamily, number> => ({
  '1xx': 0,
  '2xx': 0,
  '3xx': 0,
  '4xx': 0,
  '5xx': 0,
});
interface Bucket {
  /** Responses currently associated with this bucket. */
  active: number;
  /** Bounded recent response-completion samples. */
  samples: Sample[];
  /** Lifetime arrivals for this bucket, separate from retained samples. */
  total: number;
}
/** Create one empty telemetry bucket without external resources.
 * @returns {Bucket} New mutable process-local accounting.
 */
const empty = (): Bucket => ({ active: 0, samples: [], total: 0 });
/** Low-cardinality metrics of incoming HTTP responses, including misses/errors at proxy boundary.
 * Holds at most 120 seconds / 2000 samples per hostname; tracks 128 hostnames. */
export class ProxyTelemetry {
  /** Bounded per-route operational samples, owned only by this proxy instance. */
  private readonly buckets = new Map<string, Bucket>();
  /** Fixed overflow/unmatched label; never a request path or user identity. */
  private readonly outsideKey = '__outside_routes__';
  /** Lifetime accepted response count for this process-local instance. */
  private total = 0;
  /** Accepted responses awaiting their first terminal event. */
  private active = 0;
  /** Initialize process-local response accounting without timers, sockets or global listeners.
   */
  constructor() {
    this.buckets.set(this.outsideKey, empty());
  }
  /** Count one accepted HTTP response and finalize once on finish or close; retain route identity from acceptance time.
   * @param {IncomingMessage} req - Borrowed incoming request; only its HTTP version is retained.
   * @param {ServerResponse} res - Borrowed response owning terminal event delivery.
   * @param {() => string | undefined} resolveHostname - Borrowed synchronous route lookup; undefined belongs to the outside-routes bucket.
   * @returns {void} Registers terminal response observers; no request URL, body, headers or personal identity is stored.
   */
  observe(
    req: IncomingMessage,
    res: ServerResponse,
    resolveHostname: () => string | undefined
  ): void {
    /** Monotonic response-acceptance timestamp used only for elapsed latency. */
    const begin = performance.now();
    let finished = false;
    /** Route identity captured once so route changes cannot relabel an accepted response. */
    const keyAtStart = resolveHostname();
    this.total++;
    this.active++;
    /** Bucket charged for this response throughout its lifetime. */
    const initial = this.bucket(keyAtStart);
    initial.active++;
    initial.total++;
    /** Record only the first finish or close observation.
     * @returns {void} Prevents duplicate completion and active-count decrements.
     */
    const finalize = () => {
      if (finished) {
        return;
      }
      finished = true;
      this.active = Math.max(0, this.active - 1);
      initial.active = Math.max(0, initial.active - 1);
      /** Observed completion status, or 499 when the response closes unfinished. */
      const status = res.writableFinished ? res.statusCode : 499;
      initial.samples.push({
        at: Date.now(),
        status,
        duration: Math.min(performance.now() - begin, 86_400_000),
        version: req.httpVersion || '1.1',
      });
      this.prune(initial);
    };
    res.once('finish', finalize);
    res.once('close', finalize);
  }
  /** Resolve a bounded hostname bucket, evicting an inactive route or using the outside bucket at capacity.
   * @param {string} hostname - Optional host-controlled route hostname, never a raw request path.
   * @returns {Bucket} Mutable accounting owned by this telemetry instance.
   */
  private bucket(hostname?: string): Bucket {
    /** Host-controlled route label, with unmatched traffic assigned to a fixed outside label. */
    const key = hostname || this.outsideKey;
    let existing = this.buckets.get(key);
    if (!existing) {
      if (this.buckets.size >= 129) {
        for (const [name, current] of this.buckets) {
          if (name !== this.outsideKey && current.active === 0) {
            this.buckets.delete(name);
            break;
          }
        }
        if (this.buckets.size >= 129) {
          return this.buckets.get(this.outsideKey)!;
        }
      }
      existing = empty();
      this.buckets.set(key, existing);
    }
    return existing;
  }
  /** Keep only recent observations within the fixed sample count and 120-second retention window.
   * @param {Bucket} bucket - Owned bucket whose sample array is replaced.
   * @returns {void} Preserves active and lifetime arrival counters.
   */
  private prune(bucket: Bucket): void {
    /** Oldest wall-clock completion retained regardless of the requested report window. */
    const since = Date.now() - 120_000;
    bucket.samples = bucket.samples
      .filter((item) => item.at >= since)
      .slice(-2000);
  }
  /** Build a detached sampled report without exposing mutable bucket arrays.
   * @param {string} name - Display hostname chosen by the host.
   * @param {Bucket} bucket - Owned accounting bucket.
   * @param {number} windowMs - Host-selected report window in milliseconds.
   * @param {number} now - Wall-clock timestamp used for this report.
   * @returns {RouteLoadStatus} Recent completion rates and arithmetic latency mean; no-sample mean/rate are zero.
   */
  private describe(
    name: string,
    bucket: Bucket,
    windowMs: number,
    now: number
  ): RouteLoadStatus {
    this.prune(bucket);
    /** Retained completion samples admitted into this report window. */
    const data = bucket.samples.filter((sample) => sample.at >= now - windowMs);
    /** Fresh fixed HTTP status-family counters. */
    const statusFamilies = families();
    /** Prototype-free per-status counts for this detached report. */
    const statusCodes: Record<string, number> = Object.create(null);
    /** Prototype-free per-version counts for this detached report. */
    const httpVersions: Record<string, number> = Object.create(null);
    let totalMs = 0;
    for (const item of data) {
      /** HTTP family derived from an observed integer status. */
      const family = `${Math.floor(item.status / 100)}xx` as StatusFamily;
      if (family in statusFamilies) {
        statusFamilies[family]++;
      }
      statusCodes[String(item.status)] =
        (statusCodes[String(item.status)] ?? 0) + 1;
      httpVersions[item.version] = (httpVersions[item.version] ?? 0) + 1;
      totalMs += item.duration;
    }
    return {
      hostname: name,
      activeRequests: bucket.active,
      completed: data.length,
      statusFamilies,
      statusCodes,
      averageLatencyMs: data.length ? totalMs / data.length : 0,
      requestsPerSecond: data.length / (windowMs / 1000),
      httpVersions,
      lastRequestAt: bucket.samples.length
        ? bucket.samples[bucket.samples.length - 1]!.at
        : null,
    };
  }
  /** Validate a 1–120 second window and report all bounded route buckets using one wall-clock timestamp.
   * @param {number} windowMs - Report window in milliseconds, defaulting to 30000.
   * @returns {ProxyLoadStatus} Detached process-local operational metrics, not durable analytics.
   */
  snapshot(windowMs = 30_000): ProxyLoadStatus {
    if (
      !Number.isSafeInteger(windowMs) ||
      windowMs < 1000 ||
      windowMs > 120000
    ) {
      throw new RangeError('Telemetry window must be 1–120 seconds');
    }
    /** Shared wall-clock timestamp for all route reports in this snapshot. */
    const now = Date.now();
    return {
      sampledAt: now,
      activeRequests: this.active,
      totalRequests: this.total,
      statusFamilies: [...this.buckets.entries()].reduce(
        (acc, [name, bucket]) => {
          /** Detached route family counters folded into the process-wide report. */
          const part = this.describe(
            name,
            bucket,
            windowMs,
            now
          ).statusFamilies;
          for (const key of Object.keys(part) as StatusFamily[]) {
            acc[key] += part[key];
          }
          return acc;
        },
        families()
      ),
      outsideRoutes: this.describe(
        'outside',
        this.buckets.get(this.outsideKey)!,
        windowMs,
        now
      ),
      routes: [...this.buckets.entries()]
        .filter(([name]) => name !== this.outsideKey)
        .map(([name, bucket]) => this.describe(name, bucket, windowMs, now)),
    };
  }
  /** Read one host-selected route report; unknown routes produce an empty sampled report.
   * @param {string} hostname - Host-controlled route hostname whose report the caller is authorized to inspect.
   * @param {number} windowMs - Host-selected milliseconds, defaulting to 30000; unlike snapshot this legacy method does not validate the window.
   * @returns {RouteLoadStatus} Detached sampled report; this accessor does not perform authorization.
   */
  application(hostname: string, windowMs = 30_000): RouteLoadStatus {
    /** Existing per-route accounting, if the host label has been observed. */
    const bucket = this.buckets.get(hostname);
    return this.describe(hostname, bucket ?? empty(), windowMs, Date.now());
  }
}
