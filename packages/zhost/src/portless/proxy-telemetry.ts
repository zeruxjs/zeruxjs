import type { IncomingMessage, ServerResponse } from 'node:http';
export type StatusFamily = '1xx' | '2xx' | '3xx' | '4xx' | '5xx';
export interface RouteLoadStatus { hostname: string; activeRequests: number; completed: number; statusFamilies: Record<StatusFamily, number>; statusCodes: Record<string, number>; averageLatencyMs: number; requestsPerSecond: number; httpVersions: Record<string, number>; lastRequestAt: number | null; }
export interface ProxyLoadStatus { sampledAt: number; activeRequests: number; totalRequests: number; statusFamilies: Record<StatusFamily, number>; outsideRoutes: RouteLoadStatus; routes: RouteLoadStatus[]; }
interface Sample { at: number; status: number; duration: number; version: string }
const families = (): Record<StatusFamily, number> => ({ '1xx': 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 });
interface Bucket { active: number; samples: Sample[]; total: number }
const empty = (): Bucket => ({ active: 0, samples: [], total: 0 });
/** Low-cardinality metrics of incoming HTTP responses, including misses/errors at proxy boundary.
 * Holds at most 120 seconds / 2000 samples per hostname; tracks 128 hostnames. */
export class ProxyTelemetry {
  private readonly buckets = new Map<string, Bucket>();
  private readonly outsideKey = '__outside_routes__';
  private total = 0;
  private active = 0;
  constructor() { this.buckets.set(this.outsideKey, empty()); }
  observe(req: IncomingMessage, res: ServerResponse, resolveHostname: () => string | undefined): void {
    const begin = performance.now(); let finished = false;
    const keyAtStart = resolveHostname();
    this.total++; this.active++;
    const initial = this.bucket(keyAtStart);
    initial.active++; initial.total++;
    const finalize = () => {
      if (finished) return;
      finished = true;
      this.active = Math.max(0, this.active - 1);
      initial.active = Math.max(0, initial.active - 1);
      const status = res.writableFinished ? res.statusCode : 499;
      initial.samples.push({ at: Date.now(), status, duration: Math.min(performance.now() - begin, 86_400_000), version: req.httpVersion || '1.1' });
      this.prune(initial);
    };
    res.once('finish', finalize); res.once('close', finalize);
  }
  private bucket(hostname?: string): Bucket {
    const key = hostname || this.outsideKey;
    let existing = this.buckets.get(key);
    if (!existing) {
      if (this.buckets.size >= 129) {
        for (const [name, current] of this.buckets) if (name !== this.outsideKey && current.active === 0) { this.buckets.delete(name); break; }
        if (this.buckets.size >= 129) return this.buckets.get(this.outsideKey)!;
      }
      existing = empty(); this.buckets.set(key, existing);
    }
    return existing;
  }
  private prune(bucket: Bucket): void {
    const since = Date.now() - 120_000;
    bucket.samples = bucket.samples.filter(item => item.at >= since).slice(-2000);
  }
  private describe(name: string, bucket: Bucket, windowMs: number, now: number): RouteLoadStatus {
    this.prune(bucket);
    const data = bucket.samples.filter(sample => sample.at >= now - windowMs);
    const statusFamilies = families(); const statusCodes: Record<string, number> = Object.create(null);
    const httpVersions: Record<string, number> = Object.create(null);
    let totalMs = 0;
    for (const item of data) {
      const family = `${Math.floor(item.status / 100)}xx` as StatusFamily;
      if (family in statusFamilies) statusFamilies[family]++;
      statusCodes[String(item.status)] = (statusCodes[String(item.status)] ?? 0) + 1;
      httpVersions[item.version] = (httpVersions[item.version] ?? 0) + 1;
      totalMs += item.duration;
    }
    return { hostname: name, activeRequests: bucket.active, completed: data.length, statusFamilies, statusCodes,
      averageLatencyMs: data.length ? totalMs / data.length : 0, requestsPerSecond: data.length / (windowMs / 1000),
      httpVersions, lastRequestAt: bucket.samples.length ? bucket.samples[bucket.samples.length - 1].at : null };
  }
  snapshot(windowMs = 30_000): ProxyLoadStatus {
    if (!Number.isSafeInteger(windowMs) || windowMs < 1000 || windowMs > 120000) throw new RangeError('Telemetry window must be 1–120 seconds');
    const now = Date.now();
    return { sampledAt: now, activeRequests: this.active, totalRequests: this.total,
      statusFamilies: [...this.buckets.entries()].reduce((acc, [name, bucket]) => {
        const part = this.describe(name, bucket, windowMs, now).statusFamilies;
        for (const key of Object.keys(part) as StatusFamily[]) acc[key] += part[key];
        return acc;
      }, families()),
      outsideRoutes: this.describe('outside', this.buckets.get(this.outsideKey)!, windowMs, now),
      routes: [...this.buckets.entries()].filter(([name]) => name !== this.outsideKey).map(([name, bucket]) => this.describe(name, bucket, windowMs, now)) };
  }
  /** Explicit route-aware status API for application dashboards. */
  application(hostname: string, windowMs = 30_000): RouteLoadStatus {
    const bucket = this.buckets.get(hostname);
    return this.describe(hostname, bucket ?? empty(), windowMs, Date.now());
  }
}
