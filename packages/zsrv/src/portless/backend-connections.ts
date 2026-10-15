import type { FleetLoadMetrics } from './fleet-autoscaler.js';
/** In-flight upstream accounting independent of the mutable route table.
 * A route handover must not erase connections accepted by a previous backend. */
export class BackendConnections {
  private readonly counts = new Map<string, number>();
  private observedRequests = 0;
  private readonly completions = new Map<string, { at: number; durationMs: number; failed: boolean }[]>();
  private readonly requestBuckets = new Map<string, Map<number, number>>();
  private readonly watchers = new Map<string, Set<() => void>>();

  private key(hostname: string, port: number): string { return `${hostname}\0${port}`; }

  active(hostname: string, port: number): number {
    return this.counts.get(this.key(hostname, port)) ?? 0;
  }

  /** Call once when routing a request or accepted WebSocket, release on close. */
  track(hostname: string, port: number): () => void {
    const key = this.key(hostname, port);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    const now = Math.floor(Date.now() / 1000);
    const buckets = this.requestBuckets.get(key) ?? new Map<number, number>();
    buckets.set(now, (buckets.get(now) ?? 0) + 1);
    for (const bucket of buckets.keys()) if (bucket < now - 60) buckets.delete(bucket);
    this.requestBuckets.set(key, buckets);
    // Clean up idle/retired backends without a permanent polling timer.
    if (++this.observedRequests % 256 === 0) {
      for (const [other, history] of this.requestBuckets) {
        for (const second of history.keys()) if (second < now - 60) history.delete(second);
        if (!history.size && !this.counts.has(other)) this.requestBuckets.delete(other);
      }
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = (this.counts.get(key) ?? 1) - 1;
      if (next > 0) this.counts.set(key, next);
      else {
        this.counts.delete(key);
        for (const notify of this.watchers.get(key) ?? []) notify();
      }
    };
  }

  /** Called once after an HTTP response finishes or aborts; WebSockets are excluded.
   * Samples are capped per backend and automatically expire from the recent window. */
  recordHttp(hostname: string, port: number, durationMs: number, statusCode: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 86_400_000 ||
      !Number.isSafeInteger(statusCode) || statusCode < 100 || statusCode > 599) {
      throw new RangeError('Invalid HTTP response telemetry');
    }
    const key = this.key(hostname, port);
    const now = Date.now();
    const items = (this.completions.get(key) ?? []).filter(item => item.at >= now - 60_000);
    items.push({ at: now, durationMs, failed: statusCode >= 500 });
    if (items.length > 512) items.splice(0, items.length - 512);
    this.completions.set(key, items);
    if (this.completions.size > 1024) this.completions.delete(this.completions.keys().next().value!);
  }

  /** Bounded per-second arrival counters, including completed HTTP requests. */
  metrics(hostname: string, ports: readonly number[], windowMs = 30000): FleetLoadMetrics {
    if (!Number.isSafeInteger(windowMs) || windowMs < 1000 || windowMs > 60000 ||
        !Array.isArray(ports) || ports.length < 1 || ports.length > 17 ||
        ports.some(port => !Number.isSafeInteger(port) || port < 1 || port > 65535)) {
      throw new RangeError('Invalid backend metrics request');
    }
    const now = Date.now();
    let requests = 0;
    let activeConnections = 0;
    let completedRequests = 0, serverErrors = 0;
    const latencies: number[] = [];
    const startSecond = Math.ceil((now - windowMs) / 1000);
    const cutoff = Math.floor(now / 1000) - 60;
    for (const port of new Set(ports)) {
      const key = this.key(hostname, port);
      activeConnections += this.counts.get(key) ?? 0;
      const recent = this.completions.get(key);
      if (recent) {
        const valid = recent.filter(item => item.at >= now - windowMs);
        completedRequests += valid.length;
        for (const item of valid) {
          if (item.failed) serverErrors++;
          latencies.push(item.durationMs);
        }
        if (!valid.length && !this.counts.has(key)) this.completions.delete(key);
      }
      const buckets = this.requestBuckets.get(key);
      if (!buckets) continue;
      for (const [second, count] of buckets) {
        if (second < cutoff) buckets.delete(second);
        else if (second >= startSecond) requests += count;
      }
      if (!buckets.size && !this.counts.has(key)) this.requestBuckets.delete(key);
    }
    latencies.sort((a,b) => a-b);
    return { hostname, requests, requestsPerSecond: requests / (windowMs / 1000),
      activeConnections, windowMs, sampledAt: now,
      completedRequests, serverErrors, errorRate: completedRequests ? serverErrors / completedRequests : null,
      p95LatencyMs: latencies.length ? latencies[Math.ceil(latencies.length * 0.95) - 1] : null };
  }

  /** True if all sessions finished; false on deadline. Existing WebSockets count. */
  waitForIdle(hostname: string, port: number, timeoutMs = 10_000): Promise<boolean> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 300_000) {
      throw new RangeError('Backend drain timeout must be 0–300000ms');
    }
    if (!this.active(hostname, port)) return Promise.resolve(true);
    if (timeoutMs === 0) return Promise.resolve(false);
    const key = this.key(hostname, port);
    return new Promise(resolve => {
      const callbacks = this.watchers.get(key) ?? new Set<() => void>();
      this.watchers.set(key, callbacks);
      let done = false;
      const finish = (idle: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        callbacks.delete(notify);
        if (!callbacks.size) this.watchers.delete(key);
        resolve(idle);
      };
      const notify = () => { if (!this.active(hostname, port)) finish(true); };
      callbacks.add(notify);
      const timer = setTimeout(() => finish(false), timeoutMs);
      notify();
    });
  }
}
