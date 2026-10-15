/** Hysteretic, rate-based replica decisions. Pure policy logic, no process ownership. */
export type AutoscaleMetric = 'rps' | 'cpu' | 'memory';
export interface AutoscaleConfig {
  /** rps: incoming requests per replica; cpu: one-core CPU %; memory: mean RSS MiB. */
  metric?: AutoscaleMetric;
  /** Required for CPU and memory modes. Overrides RPS thresholds. */
  scaleUpThreshold?: number;
  scaleDownThreshold?: number;
  /** Optional safeguards: only allow downscaling with valid healthy proxy telemetry. */
  maxErrorRate?: number;
  maxP95LatencyMs?: number;
  enabled: boolean;
  minReplicas: number;
  maxReplicas: number;
  scaleUpRps: number;
  scaleDownRps: number;
  cooldownMs: number;
  consecutiveSamples: number;
  sampleIntervalMs: number;
  windowMs: number;
}
export interface AutoscaleState {
  paused: boolean;
  lastScaledAt: number;
  lastRps: number | null;
  lastMetric?: number | null;
  upSamples: number;
  downSamples: number;
  lastDecision: string | null;
}
export function validateAutoscaleConfig(config: AutoscaleConfig, ports: number, desired: number): AutoscaleConfig {
  const validInt = (n: number, min: number, max: number) => Number.isSafeInteger(n) && n >= min && n <= max;
  if (!validInt(config.minReplicas, 2, 16) || !validInt(config.maxReplicas, config.minReplicas, Math.min(16, ports - 1)) ||
    !validInt(desired, config.minReplicas, config.maxReplicas)) throw new RangeError('Invalid autoscaling replica bounds');
  if (config.metric !== undefined && !['rps', 'cpu', 'memory'].includes(config.metric)) throw new RangeError('Invalid autoscale metric');
  if (config.metric && config.metric !== 'rps') {
    const limit = config.metric === 'cpu' ? 1000 : 1048576;
    if (!Number.isFinite(config.scaleUpThreshold) || !Number.isFinite(config.scaleDownThreshold) ||
      (config.scaleDownThreshold as number) <= 0 || (config.scaleUpThreshold as number) <= (config.scaleDownThreshold as number) ||
      (config.scaleUpThreshold as number) > limit) throw new RangeError('Invalid resource autoscaling thresholds');
  }
  if (config.maxErrorRate !== undefined && (!Number.isFinite(config.maxErrorRate) || config.maxErrorRate < 0 || config.maxErrorRate > 1) ||
      config.maxP95LatencyMs !== undefined && (!Number.isSafeInteger(config.maxP95LatencyMs) || config.maxP95LatencyMs < 1 || config.maxP95LatencyMs > 300000)) {
    throw new RangeError('Invalid autoscale safety guard');
  }
  if (![config.scaleUpRps, config.scaleDownRps].every(n => Number.isFinite(n) && n > 0 && n <= 1_000_000) ||
    config.scaleDownRps >= config.scaleUpRps) throw new RangeError('Autoscaling requires 0 < scaleDownRps < scaleUpRps');
  if (!validInt(config.cooldownMs, 0, 3_600_000) || !validInt(config.consecutiveSamples, 1, 20) ||
    !validInt(config.sampleIntervalMs, 200, 300_000) || !validInt(config.windowMs, 1000, 60000)) {
    throw new RangeError('Invalid autoscaling sampling or cooldown settings');
  }
  return { ...config };
}
export class AutoscalePolicy {
  private state: AutoscaleState;
  constructor(readonly config: AutoscaleConfig, restored?: Partial<AutoscaleState>) {
    this.state = { paused: restored?.paused ?? false, lastScaledAt: restored?.lastScaledAt ?? 0,
      lastRps: null, lastMetric: null, upSamples: 0, downSamples: 0, lastDecision: null };
    if (!Number.isSafeInteger(this.state.lastScaledAt) || this.state.lastScaledAt < 0 ||
        this.state.lastScaledAt > Date.now() + 30_000 || typeof this.state.paused !== 'boolean') {
      throw new TypeError('Invalid autoscale checkpoint state');
    }
  }
  get snapshot(): Readonly<AutoscaleState> { return Object.freeze({ ...this.state }); }
  setPaused(paused: boolean): void {
    if (typeof paused !== 'boolean') throw new TypeError('paused must be boolean');
    this.state.paused = paused;
    this.state.upSamples = this.state.downSamples = 0;
    this.state.lastDecision = paused ? 'Autoscaling paused' : 'Autoscaling resumed';
  }
  /** Do not allow a stale or malformed load reading to trigger downscaling. */
  observe(requestsPerSecond: number, desired: number, now = Date.now(), allowDownscale = true): number | null {
    if (!Number.isFinite(requestsPerSecond) || requestsPerSecond < 0 || !Number.isSafeInteger(desired) ||
      !Number.isSafeInteger(now) || now < 0) throw new TypeError('Invalid autoscale observation');
    const metric = this.config.metric ?? 'rps';
    this.state.lastRps = metric === 'rps' ? requestsPerSecond : null;
    this.state.lastMetric = requestsPerSecond;
    if (this.state.paused || !this.config.enabled) return null;
    const observed = metric === 'rps' ? requestsPerSecond / Math.max(1, desired) : requestsPerSecond;
    const upper = metric === 'rps' ? this.config.scaleUpRps : this.config.scaleUpThreshold!;
    const lower = metric === 'rps' ? this.config.scaleDownRps : this.config.scaleDownThreshold!;
    this.state.upSamples = observed > upper ? this.state.upSamples + 1 : 0;
    this.state.downSamples = observed < lower ? this.state.downSamples + 1 : 0;
    if (now - this.state.lastScaledAt < this.config.cooldownMs) return null;
    let next: number | null = null;
    if (this.state.upSamples >= this.config.consecutiveSamples && desired < this.config.maxReplicas) next = desired + 1;
    else if (this.state.downSamples >= this.config.consecutiveSamples && desired > this.config.minReplicas) {
      if (!allowDownscale) {
        this.state.downSamples = 0;
        this.state.lastDecision = 'Scale-down blocked by error rate or latency guard';
        return null;
      }
      next = desired - 1;
    }
    if (next !== null) {
      this.state.lastScaledAt = now;
      this.state.upSamples = this.state.downSamples = 0;
      this.state.lastDecision = `Scale ${desired} -> ${next} at ${requestsPerSecond.toFixed(2)} ${metric === 'rps' ? 'req/s' : metric === 'cpu' ? '% CPU' : 'MiB RSS'}`;
    }
    return next;
  }
}
export const DEFAULT_AUTOSCALE: Omit<AutoscaleConfig, 'minReplicas' | 'maxReplicas'> = {
  enabled: false, scaleUpRps: 25, scaleDownRps: 5, cooldownMs: 30000,
  consecutiveSamples: 3, sampleIntervalMs: 5000, windowMs: 30000,
};
