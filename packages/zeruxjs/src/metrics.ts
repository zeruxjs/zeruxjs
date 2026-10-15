/** Bounded per-application request telemetry; no URL or sensitive header retention. */
import type { IncomingMessage, ServerResponse } from 'node:http';
export type HttpStatusFamily = '1xx' | '2xx' | '3xx' | '4xx' | '5xx';
export interface ApplicationHttpStatus {
  sampledAt: number;
  active: number;
  total: number;
  completed: number;
  requestsPerSecond: number;
  averageLatencyMs: number;
  statusFamilies: Record<HttpStatusFamily, number>;
  statusCodes: Record<string, number>;
  httpVersions: Record<string, number>;
}
interface Sample { time: number; status: number; elapsed: number; version: string; }
const families = (): Record<HttpStatusFamily, number> => ({ '1xx': 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 });
export class ApplicationHttpMetrics {
  private samples: Sample[] = [];
  private active = 0;
  private total = 0;
  track(req: IncomingMessage, res: ServerResponse): void {
    this.active++; this.total++;
    const started = performance.now();
    let counted = false;
    const finish = () => {
      if (counted) return;
      counted = true; this.active = Math.max(0, this.active - 1);
      this.samples.push({ time: Date.now(), status: res.writableFinished ? res.statusCode : 499,
        elapsed: Math.min(86_400_000, performance.now() - started), version: req.httpVersion || '1.1' });
      this.prune();
    };
    res.once('finish', finish); res.once('close', finish);
  }
  private prune(now = Date.now()) {
    const cutoff = now - 120_000;
    this.samples = this.samples.filter(sample => sample.time >= cutoff).slice(-2000);
  }
  snapshot(windowMs = 30_000): ApplicationHttpStatus {
    if (!Number.isSafeInteger(windowMs) || windowMs < 1000 || windowMs > 120000) throw new RangeError('Monitoring window must be 1-120 seconds');
    const now = Date.now(); this.prune(now);
    const samples = this.samples.filter(s => s.time >= now - windowMs);
    const statusFamilies = families();
    const statusCodes: Record<string, number> = Object.create(null);
    const httpVersions: Record<string, number> = Object.create(null);
    for (const item of samples) {
      const family = `${Math.floor(item.status / 100)}xx` as HttpStatusFamily;
      if (family in statusFamilies) statusFamilies[family]++;
      statusCodes[item.status] = (statusCodes[item.status] ?? 0) + 1;
      httpVersions[item.version] = (httpVersions[item.version] ?? 0) + 1;
    }
    return { sampledAt: now, active: this.active, total: this.total, completed: samples.length,
      requestsPerSecond: samples.length / (windowMs / 1000),
      averageLatencyMs: samples.length ? samples.reduce((sum, s) => sum + s.elapsed, 0) / samples.length : 0,
      statusFamilies, statusCodes, httpVersions };
  }
}
