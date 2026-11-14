/** Bounded per-application request telemetry; no URL or sensitive header retention. */
import type { IncomingMessage, ServerResponse } from 'node:http';
export type HttpStatusFamily = '1xx' | '2xx' | '3xx' | '4xx' | '5xx';
export interface ApplicationHttpStatus {
  /** Snapshot wall-clock time in Unix milliseconds. */
  sampledAt: number;
  /** Currently unfinished tracked responses. */
  active: number;
  /** Lifetime tracked request admissions for this application instance. */
  total: number;
  /** Retained completions in the requested window; retention caps may truncate history. */
  completed: number;
  /** Retained completion count divided by requested window seconds. */
  requestsPerSecond: number;
  /** Mean retained elapsed time, zero when no completions are present. */
  averageLatencyMs: number;
  /** Fixed status-family counts from retained completions. */
  statusFamilies: Record<HttpStatusFamily, number>;
  /** Numeric status counts from retained completions. */
  statusCodes: Record<string, number>;
  /** Protocol-version counts from retained completions. */
  httpVersions: Record<string, number>;
}
interface Sample {
  /** Completion wall-clock timestamp. */
  time: number;
  /** Observed status or synthetic499 on premature disconnect. */
  status: number;
  /** Monotonic elapsed milliseconds capped at one day. */
  elapsed: number;
  /** Request protocol version, without URL/header/body retention. */
  version: string;
}
/** Allocate fresh fixed status-family counters for each snapshot.
 * @returns {Record<HttpStatusFamily, number>} Zeroed family counts.
 */
const families = (): Record<HttpStatusFamily, number> => ({
  '1xx': 0,
  '2xx': 0,
  '3xx': 0,
  '4xx': 0,
  '5xx': 0,
});
/** Own bounded process-local request observations; no background sampler or durable store is allocated. */
export class ApplicationHttpMetrics {
  private samples: Sample[] = [];
  private active = 0;
  private total = 0;
  /** Observe native response finish/close with an exactly-once local completion fence.
   * @param {IncomingMessage} req - Borrowed native request; only its protocol version is retained.
   * @param {ServerResponse} res - Borrowed response owning the terminal event listeners.
   * @returns {void} Registers observation without wrapping or owning the server.
   */
  track(req: IncomingMessage, res: ServerResponse): void {
    this.active++;
    this.total++;
    /** Monotonic request start used only for bounded elapsed measurements. */
    const started = performance.now();
    let counted = false;
    /** Count terminal finish/close once and detach both observation listeners.
     * @returns {void} Records one bounded metadata-only completion sample.
     */
    const finish = () => {
      if (counted) {
        return;
      }
      res.off('finish', finish);
      res.off('close', finish);
      counted = true;
      this.active = Math.max(0, this.active - 1);
      this.samples.push({
        time: Date.now(),
        status: res.writableFinished ? res.statusCode : 499,
        elapsed: Math.min(86_400_000, performance.now() - started),
        version: req.httpVersion || '1.1',
      });
      this.prune();
    };
    res.once('finish', finish);
    res.once('close', finish);
  }
  /** Retain at most two thousand completions from the last two minutes.
   * @param {number} now - Current wall time, default Date.now().
   * @returns {void} Drops old samples without claiming persisted analytics coverage.
   */
  private prune(now = Date.now()) {
    /** Oldest wall-clock completion retained in the two-minute rolling buffer. */
    const cutoff = now - 120_000;
    this.samples = this.samples
      .filter((sample) => sample.time >= cutoff)
      .slice(-2000);
  }
  /** Aggregate only the bounded retained completion window and current active/lifetime counters.
   * @param {number} windowMs - Integer window from one to one hundred twenty seconds.
   * @returns {ApplicationHttpStatus} Metadata-only bounded rolling measurements, not durable exact traffic history.
   */
  snapshot(windowMs = 30_000): ApplicationHttpStatus {
    if (
      !Number.isSafeInteger(windowMs) ||
      windowMs < 1000 ||
      windowMs > 120000
    ) {
      throw new RangeError('Monitoring window must be 1-120 seconds');
    }
    /** Snapshot wall time used consistently for pruning and the requested window. */
    const now = Date.now();
    this.prune(now);
    /** Bounded retained completions in the selected time window, not a durable full-history count. */
    const samples = this.samples.filter((s) => s.time >= now - windowMs);
    /** Fresh fixed-family aggregation without URL/tenant labels. */
    const statusFamilies = families();
    /** Observed numeric status counters in this bounded window. */
    const statusCodes: Record<string, number> = Object.create(null);
    /** Observed protocol-version counters, excluding headers and request bodies. */
    const httpVersions: Record<string, number> = Object.create(null);
    for (const item of samples) {
      /** Status family derived from the completion code, including synthetic disconnect499. */
      const family = `${Math.floor(item.status / 100)}xx` as HttpStatusFamily;
      if (family in statusFamilies) {
        statusFamilies[family]++;
      }
      statusCodes[item.status] = (statusCodes[item.status] ?? 0) + 1;
      httpVersions[item.version] = (httpVersions[item.version] ?? 0) + 1;
    }
    return {
      sampledAt: now,
      active: this.active,
      total: this.total,
      completed: samples.length,
      requestsPerSecond: samples.length / (windowMs / 1000),
      averageLatencyMs: samples.length
        ? samples.reduce((sum, s) => sum + s.elapsed, 0) / samples.length
        : 0,
      statusFamilies,
      statusCodes,
      httpVersions,
    };
  }
}
