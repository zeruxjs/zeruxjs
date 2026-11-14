import type { FleetLoadMetrics } from './fleet-autoscaler.js';
/** In-flight upstream accounting independent of the mutable route table.
 * A route handover must not erase connections accepted by a previous backend. */
export class BackendConnections {
  /** Active accepted sessions by endpoint, removed only by their release callbacks. */
  private readonly counts = new Map<string, number>();
  /** Arrival counter used to amortize retired-backend pruning without a polling timer. */
  private observedRequests = 0;
  /** Bounded recent HTTP completion samples; excludes WebSocket lifetimes. */
  private readonly completions = new Map<
    string,
    { at: number; durationMs: number; failed: boolean }[]
  >();
  /** Per-endpoint per-second arrivals, lazily pruned to the recent window. */
  private readonly requestBuckets = new Map<string, Map<number, number>>();
  /** Pending drain observers, removed on idle or deadline settlement. */
  private readonly watchers = new Map<string, Set<() => void>>();

  /** Form an unambiguous internal endpoint key without consulting mutable route membership.
   * @param {string} hostname - Host-controlled route hostname recorded when the session was accepted.
   * @param {number} port - Selected loopback backend port, retained even after route handover.
   * @returns {string} Hostname and port separated by a NUL delimiter.
   */
  private key(hostname: string, port: number): string {
    return `${hostname}\0${port}`;
  }

  /** Read the number of sessions still owned by this endpoint, including WebSockets.
   * @param {string} hostname - Host-controlled route hostname recorded when the session was accepted.
   * @param {number} port - Selected loopback backend port, retained even after route handover.
   * @returns {number} Current active count, or zero for an unknown endpoint.
   */
  active(hostname: string, port: number): number {
    return this.counts.get(this.key(hostname, port)) ?? 0;
  }

  /** Acquire one active-session count and record its arrival; the caller must release when the actual session ends.
   * @param {string} hostname - Host-controlled route hostname recorded when the session was accepted.
   * @param {number} port - Selected loopback backend port, retained even after route handover.
   * @returns {() => void} Idempotent release callback; route replacement does not release it automatically.
   */
  track(hostname: string, port: number): () => void {
    /** Stable accepted-endpoint identity, independent of later route mutations. */
    const key = this.key(hostname, port);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    /** Wall-clock observation for bounded arrival or completion accounting. */
    const now = Math.floor(Date.now() / 1000);
    /** Per-second arrival counters for this endpoint; old buckets are pruned. */
    const buckets = this.requestBuckets.get(key) ?? new Map<number, number>();
    buckets.set(now, (buckets.get(now) ?? 0) + 1);
    for (const bucket of buckets.keys()) {
      if (bucket < now - 60) {
        buckets.delete(bucket);
      }
    }
    this.requestBuckets.set(key, buckets);
    // Clean up idle/retired backends without a permanent polling timer.
    if (++this.observedRequests % 256 === 0) {
      for (const [other, history] of this.requestBuckets) {
        for (const second of history.keys()) {
          if (second < now - 60) {
            history.delete(second);
          }
        }
        if (!history.size && !this.counts.has(other)) {
          this.requestBuckets.delete(other);
        }
      }
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      /** Remaining active count after an idempotent release. */
      const next = (this.counts.get(key) ?? 1) - 1;
      if (next > 0) {
        this.counts.set(key, next);
      } else {
        this.counts.delete(key);
        for (const notify of this.watchers.get(key) ?? []) {
          notify();
        }
      }
    };
  }

  /** Record a completed or aborted HTTP observation, excluding WebSockets and retaining bounded recent samples.
   * @param {string} hostname - Host-controlled route hostname recorded when the session was accepted.
   * @param {number} port - Selected loopback backend port, retained even after route handover.
   * @param {number} durationMs - Finite elapsed milliseconds, capped at one day.
   * @param {number} statusCode - HTTP status in the inclusive range 100–599; 5xx counts as a server error.
   * @returns {void} Retains at most 512 recent completions per backend and 1024 completion histories.
   */
  recordHttp(
    hostname: string,
    port: number,
    durationMs: number,
    statusCode: number
  ): void {
    if (
      !Number.isFinite(durationMs) ||
      durationMs < 0 ||
      durationMs > 86_400_000 ||
      !Number.isSafeInteger(statusCode) ||
      statusCode < 100 ||
      statusCode > 599
    ) {
      throw new RangeError('Invalid HTTP response telemetry');
    }
    /** Stable accepted-endpoint identity, independent of later route mutations. */
    const key = this.key(hostname, port);
    /** Wall-clock observation for bounded arrival or completion accounting. */
    const now = Date.now();
    /** Recent HTTP completion samples retained under the per-backend cap. */
    const items = (this.completions.get(key) ?? []).filter(
      (item) => item.at >= now - 60_000
    );
    items.push({ at: now, durationMs, failed: statusCode >= 500 });
    if (items.length > 512) {
      items.splice(0, items.length - 512);
    }
    this.completions.set(key, items);
    if (this.completions.size > 1024) {
      this.completions.delete(this.completions.keys().next().value!);
    }
  }

  /** Aggregate bounded arrival counters and sampled completions across distinct requested ports.
   * @param {string} hostname - Host-controlled route hostname.
   * @param {readonly number[]} ports - One to 17 valid backend ports; duplicate ports count once.
   * @param {number} windowMs - Recent window in milliseconds, from 1000 to 60000; defaults to 30000.
   * @returns {FleetLoadMetrics} Window counters, active sessions and sampled latency/error summaries; missing samples remain null.
   */
  metrics(
    hostname: string,
    ports: readonly number[],
    windowMs = 30000
  ): FleetLoadMetrics {
    if (
      !Number.isSafeInteger(windowMs) ||
      windowMs < 1000 ||
      windowMs > 60000 ||
      !Array.isArray(ports) ||
      ports.length < 1 ||
      ports.length > 17 ||
      ports.some(
        (port) => !Number.isSafeInteger(port) || port < 1 || port > 65535
      )
    ) {
      throw new RangeError('Invalid backend metrics request');
    }
    /** Wall-clock observation for bounded arrival or completion accounting. */
    const now = Date.now();
    let requests = 0;
    let activeConnections = 0;
    let completedRequests = 0,
      serverErrors = 0;
    /** Completion durations admitted within the requested window for the sampled p95. */
    const latencies: number[] = [];
    /** First complete second included in the arrival-count window. */
    const startSecond = Math.ceil((now - windowMs) / 1000);
    /** Oldest second retained in the rolling arrival history. */
    const cutoff = Math.floor(now / 1000) - 60;
    for (const port of new Set(ports)) {
      /** Stable accepted-endpoint identity, independent of later route mutations. */
      const key = this.key(hostname, port);
      activeConnections += this.counts.get(key) ?? 0;
      /** Stored HTTP samples for this endpoint, if any. */
      const recent = this.completions.get(key);
      if (recent) {
        /** Completion samples within the requested report window. */
        const valid = recent.filter((item) => item.at >= now - windowMs);
        completedRequests += valid.length;
        for (const item of valid) {
          if (item.failed) {
            serverErrors++;
          }
          latencies.push(item.durationMs);
        }
        if (!valid.length && !this.counts.has(key)) {
          this.completions.delete(key);
        }
      }
      /** Per-second arrival counters for this endpoint; old buckets are pruned. */
      const buckets = this.requestBuckets.get(key);
      if (!buckets) {
        continue;
      }
      for (const [second, count] of buckets) {
        if (second < cutoff) {
          buckets.delete(second);
        } else if (second >= startSecond) {
          requests += count;
        }
      }
      if (!buckets.size && !this.counts.has(key)) {
        this.requestBuckets.delete(key);
      }
    }
    latencies.sort((a, b) => a - b);
    return {
      hostname,
      requests,
      requestsPerSecond: requests / (windowMs / 1000),
      activeConnections,
      windowMs,
      sampledAt: now,
      completedRequests,
      serverErrors,
      errorRate: completedRequests ? serverErrors / completedRequests : null,
      p95LatencyMs: latencies.length
        ? latencies[Math.ceil(latencies.length * 0.95) - 1]
        : null,
    };
  }

  /** Observe actual session releases until the endpoint becomes idle or the bounded deadline expires.
   * @param {string} hostname - Host-controlled route hostname recorded when the session was accepted.
   * @param {number} port - Selected loopback backend port, retained even after route handover.
   * @param {number} timeoutMs - Drain wait in milliseconds, from zero to 300000; defaults to 10000.
   * @returns {Promise<boolean>} True when idle, false on deadline; never terminates a session or forces handler cancellation.
   */
  waitForIdle(
    hostname: string,
    port: number,
    timeoutMs = 10_000
  ): Promise<boolean> {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 0 ||
      timeoutMs > 300_000
    ) {
      throw new RangeError('Backend drain timeout must be 0–300000ms');
    }
    if (!this.active(hostname, port)) {
      return Promise.resolve(true);
    }
    if (timeoutMs === 0) {
      return Promise.resolve(false);
    }
    /** Stable accepted-endpoint identity, independent of later route mutations. */
    const key = this.key(hostname, port);
    return new Promise((resolve) => {
      /** Endpoint-specific drain observers removed after settlement. */
      const callbacks = this.watchers.get(key) ?? new Set<() => void>();
      this.watchers.set(key, callbacks);
      let done = false;
      /** Settle one drain observer and release its timer and callback registration.
       * @param {boolean} idle - Whether sessions actually reached zero.
       * @returns {void} Ignores later notifications.
       */
      const finish = (idle: boolean) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        callbacks.delete(notify);
        if (!callbacks.size) {
          this.watchers.delete(key);
        }
        resolve(idle);
      };
      /** Recheck actual active sessions after a release.
       * @returns {void} Settles only when the endpoint is idle.
       */
      const notify = () => {
        if (!this.active(hostname, port)) {
          finish(true);
        }
      };
      callbacks.add(notify);
      /** Owned drain deadline, cleared by whichever terminal observation wins. */
      const timer = setTimeout(() => finish(false), timeoutMs);
      notify();
    });
  }
}
