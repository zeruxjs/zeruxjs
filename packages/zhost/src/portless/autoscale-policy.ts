/** Hysteretic, rate-based replica decisions. Pure policy logic, no process ownership. */
export type AutoscaleMetric = 'rps' | 'cpu' | 'memory';
export interface AutoscaleConfig {
  /** rps: incoming requests per replica; cpu: one-core CPU %; memory: mean RSS MiB. */
  metric?: AutoscaleMetric;
  /** Required for CPU and memory modes. Overrides RPS thresholds. */
  scaleUpThreshold?: number;
  /** Required positive resource-mode lower threshold, below the upper threshold. */
  scaleDownThreshold?: number;
  /** Optional safeguards: only allow downscaling with valid healthy proxy telemetry. */
  maxErrorRate?: number;
  /** Optional maximum observed HTTP p95 milliseconds for downscale safety. */
  maxP95LatencyMs?: number;
  /** Whether valid observations may produce automatic decisions. */
  enabled: boolean;
  /** Minimum desired capacity from two through sixteen. */
  minReplicas: number;
  /** Maximum desired capacity leaving at least one spare inventory port. */
  maxReplicas: number;
  /** Positive per-replica arrival threshold for scale-up. */
  scaleUpRps: number;
  /** Positive per-replica arrival threshold below scaleUpRps for scale-down. */
  scaleDownRps: number;
  /** Minimum milliseconds between recorded scale decisions. */
  cooldownMs: number;
  /** Required consecutive threshold crossings from one through twenty. */
  consecutiveSamples: number;
  /** Periodic sampling milliseconds from 200 through 300000. */
  sampleIntervalMs: number;
  /** Bounded proxy observation window in milliseconds from 1000 through 60000. */
  windowMs: number;
}
export interface AutoscaleState {
  /** Explicit local operator pause state. */
  paused: boolean;
  /** Host-clock timestamp of the last recorded decision, not confirmed cutover time. */
  lastScaledAt: number;
  /** Last RPS observation, or null for resource modes/unobserved state. */
  lastRps: number | null;
  /** Last observed metric value, or null before observation. */
  lastMetric?: number | null;
  /** Current consecutive upper-threshold crossings. */
  upSamples: number;
  /** Current consecutive lower-threshold crossings. */
  downSamples: number;
  /** Host-only operational decision explanation, or null before a decision. */
  lastDecision: string | null;
}
/** Validate declared capacity, metric thresholds and sampling budgets before starting any autoscale timer.
 * @param {AutoscaleConfig} config - Host-authored complete policy; resource modes require explicit upper/lower thresholds.
 * @param {number} ports - Number of validated inventory ports including the required spare.
 * @param {number} desired - Current desired capacity that must fit the configured range.
 * @returns {AutoscaleConfig} Detached shallow configuration copy; this helper creates no process or timer.
 */
export function validateAutoscaleConfig(
  config: AutoscaleConfig,
  ports: number,
  desired: number
): AutoscaleConfig {
  /** Validate an inclusive safe-integer bound without coercion.
   * @param {number} n Candidate host setting.
   * @param {number} min Inclusive lower supported bound.
   * @param {number} max Inclusive upper supported bound.
   * @returns {boolean} Whether the candidate is a safe integer within bounds. */
  const validInt = (n: number, min: number, max: number) =>
    Number.isSafeInteger(n) && n >= min && n <= max;
  if (
    !validInt(config.minReplicas, 2, 16) ||
    !validInt(
      config.maxReplicas,
      config.minReplicas,
      Math.min(16, ports - 1)
    ) ||
    !validInt(desired, config.minReplicas, config.maxReplicas)
  ) {
    throw new RangeError('Invalid autoscaling replica bounds');
  }
  if (
    config.metric !== undefined &&
    !['rps', 'cpu', 'memory'].includes(config.metric)
  ) {
    throw new RangeError('Invalid autoscale metric');
  }
  if (config.metric && config.metric !== 'rps') {
    /** Explicit supported upper resource threshold, CPU percent or RSS MiB. */
    const limit = config.metric === 'cpu' ? 1000 : 1048576;
    if (
      !Number.isFinite(config.scaleUpThreshold) ||
      !Number.isFinite(config.scaleDownThreshold) ||
      (config.scaleDownThreshold as number) <= 0 ||
      (config.scaleUpThreshold as number) <=
        (config.scaleDownThreshold as number) ||
      (config.scaleUpThreshold as number) > limit
    ) {
      throw new RangeError('Invalid resource autoscaling thresholds');
    }
  }
  if (
    (config.maxErrorRate !== undefined &&
      (!Number.isFinite(config.maxErrorRate) ||
        config.maxErrorRate < 0 ||
        config.maxErrorRate > 1)) ||
    (config.maxP95LatencyMs !== undefined &&
      (!Number.isSafeInteger(config.maxP95LatencyMs) ||
        config.maxP95LatencyMs < 1 ||
        config.maxP95LatencyMs > 300000))
  ) {
    throw new RangeError('Invalid autoscale safety guard');
  }
  if (
    ![config.scaleUpRps, config.scaleDownRps].every(
      (n) => Number.isFinite(n) && n > 0 && n <= 1_000_000
    ) ||
    config.scaleDownRps >= config.scaleUpRps
  ) {
    throw new RangeError('Autoscaling requires 0 < scaleDownRps < scaleUpRps');
  }
  if (
    !validInt(config.cooldownMs, 0, 3_600_000) ||
    !validInt(config.consecutiveSamples, 1, 20) ||
    !validInt(config.sampleIntervalMs, 200, 300_000) ||
    !validInt(config.windowMs, 1000, 60000)
  ) {
    throw new RangeError('Invalid autoscaling sampling or cooldown settings');
  }
  return { ...config };
}
/** Local hysteresis/cooldown state machine; decisions do not acquire or terminate processes. */
export class AutoscalePolicy {
  /** Mutable policy counters owned by this controller, exposed only through copied snapshots. */
  private state: AutoscaleState;
  /** Create controller-local hysteresis state from validated host configuration and limited persisted pause/cooldown fields.
   * @param {AutoscaleConfig} config - Host-validated policy retained by reference; do not mutate while running.
   * @param {Partial<AutoscaleState>} restored - Optional host-private pause and last-scale checkpoint; counters are reset.
   */
  constructor(
    readonly config: AutoscaleConfig,
    restored?: Partial<AutoscaleState>
  ) {
    this.state = {
      paused: restored?.paused ?? false,
      lastScaledAt: restored?.lastScaledAt ?? 0,
      lastRps: null,
      lastMetric: null,
      upSamples: 0,
      downSamples: 0,
      lastDecision: null,
    };
    if (
      !Number.isSafeInteger(this.state.lastScaledAt) ||
      this.state.lastScaledAt < 0 ||
      this.state.lastScaledAt > Date.now() + 30_000 ||
      typeof this.state.paused !== 'boolean'
    ) {
      throw new TypeError('Invalid autoscale checkpoint state');
    }
  }
  /**
   * Read a detached frozen policy observation without starting work.
   * @returns {Readonly<AutoscaleState>} Copied counters and host-only decision metadata.
   */
  get snapshot(): Readonly<AutoscaleState> {
    return Object.freeze({ ...this.state });
  }
  /** Explicitly pause or resume future policy decisions and reset accumulated consecutive samples.
   * @param {boolean} paused - Boolean host operator decision, not a browser role claim.
   * @returns {void} Updates only this local policy state.
   */
  setPaused(paused: boolean): void {
    if (typeof paused !== 'boolean') {
      throw new TypeError('paused must be boolean');
    }
    this.state.paused = paused;
    this.state.upSamples = this.state.downSamples = 0;
    this.state.lastDecision = paused
      ? 'Autoscaling paused'
      : 'Autoscaling resumed';
  }
  /** Apply threshold hysteresis and cooldown to one valid observation; missing safety coverage must disable downscaling at the caller.
   * @param {number} requestsPerSecond - Observed rate, one-core CPU percent or mean RSS MiB according to config.metric.
   * @param {number} desired - Current controller target; the caller maintains validated inventory bounds.
   * @param {number} now - Nonnegative epoch milliseconds used for cooldown decisions.
   * @param {boolean} allowDownscale - Caller-evaluated safety guard, default true.
   * @returns {number | null} One-step next target or null; recording a decision is not successful process scaling.
   */
  observe(
    requestsPerSecond: number,
    desired: number,
    now = Date.now(),
    allowDownscale = true
  ): number | null {
    if (
      !Number.isFinite(requestsPerSecond) ||
      requestsPerSecond < 0 ||
      !Number.isSafeInteger(desired) ||
      !Number.isSafeInteger(now) ||
      now < 0
    ) {
      throw new TypeError('Invalid autoscale observation');
    }
    /** Configured measurement dimension, defaulting only absent settings to RPS. */
    const metric = this.config.metric ?? 'rps';
    this.state.lastRps = metric === 'rps' ? requestsPerSecond : null;
    this.state.lastMetric = requestsPerSecond;
    if (this.state.paused || !this.config.enabled) {
      return null;
    }
    /** Per-replica RPS or already-aggregated resource value used for hysteresis. */
    const observed =
      metric === 'rps'
        ? requestsPerSecond / Math.max(1, desired)
        : requestsPerSecond;
    /** Validated upper threshold for the selected dimension. */
    const upper =
      metric === 'rps' ? this.config.scaleUpRps : this.config.scaleUpThreshold!;
    /** Validated lower threshold for the selected dimension. */
    const lower =
      metric === 'rps'
        ? this.config.scaleDownRps
        : this.config.scaleDownThreshold!;
    this.state.upSamples = observed > upper ? this.state.upSamples + 1 : 0;
    this.state.downSamples = observed < lower ? this.state.downSamples + 1 : 0;
    if (now - this.state.lastScaledAt < this.config.cooldownMs) {
      return null;
    }
    let next: number | null = null;
    if (
      this.state.upSamples >= this.config.consecutiveSamples &&
      desired < this.config.maxReplicas
    ) {
      next = desired + 1;
    } else if (
      this.state.downSamples >= this.config.consecutiveSamples &&
      desired > this.config.minReplicas
    ) {
      if (!allowDownscale) {
        this.state.downSamples = 0;
        this.state.lastDecision =
          'Scale-down blocked by error rate or latency guard';
        return null;
      }
      next = desired - 1;
    }
    if (next !== null) {
      this.state.lastScaledAt = now;
      this.state.upSamples = this.state.downSamples = 0;
      let unit: string;
      if (metric === 'rps') {
        unit = 'req/s';
      } else if (metric === 'cpu') {
        unit = '% CPU';
      } else {
        unit = 'MiB RSS';
      }
      this.state.lastDecision = `Scale ${desired} -> ${next} at ${requestsPerSecond.toFixed(2)} ${unit}`;
    }
    return next;
  }
}
/** Inert opt-in defaults; hosts must supply capacity bounds and explicitly enable sampling. */
export const DEFAULT_AUTOSCALE: Omit<
  AutoscaleConfig,
  'minReplicas' | 'maxReplicas'
> = {
  enabled: false,
  scaleUpRps: 25,
  scaleDownRps: 5,
  cooldownMs: 30000,
  consecutiveSamples: 3,
  sampleIntervalMs: 5000,
  windowMs: 30000,
};
