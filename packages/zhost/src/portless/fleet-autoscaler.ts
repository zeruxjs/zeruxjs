import {
  LinuxFleetResourceSampler,
  type FleetResourceSource,
} from './fleet-resources.js';
/** Policy runner: sampling happens at the real proxy; failed samples never scale down. */
import {
  AutoscalePolicy,
  type AutoscaleConfig,
  type AutoscaleState,
  validateAutoscaleConfig,
} from './autoscale-policy.js';
import type { InstanceFleet } from './fleet-types.js';
export interface FleetLoadMetrics {
  /** Host-authorized operational fleet label. */
  hostname: string;
  /** Observed proxy arrivals in the reporting window. */
  requests: number;
  /** Observed proxy arrivals per second. */
  requestsPerSecond: number;
  /** Current accepted connections across supplied backend ports. */
  activeConnections: number;
  /** Actual bounded telemetry window in milliseconds. */
  windowMs: number;
  /** Epoch milliseconds at observation time. */
  sampledAt: number;
  /** Optional completed-response denominator for HTTP quality. */
  completedRequests?: number;
  /** Optional completed HTTP 5xx count. */
  serverErrors?: number;
  /** Optional observed 5xx fraction; null denotes missing coverage. */
  errorRate?: number | null;
  /** Optional approximate completed-response p95 milliseconds; null denotes missing coverage. */
  p95LatencyMs?: number | null;
}
export interface FleetLoadSource {
  /** Read aggregate telemetry only for the caller-authorized fleet and backend inventory.
   * @param {string} hostname - Host-authorized operational label.
   * @param {readonly number[]} ports - Validated fleet backend ports.
   * @param {number} windowMs - Validated bounded observation window in milliseconds.
   * @returns {Promise<FleetLoadMetrics> | FleetLoadMetrics} Coverage-aware aggregate; never private request bodies or identifiers.
   */
  metrics(
    hostname: string,
    ports: readonly number[],
    windowMs: number
  ): Promise<FleetLoadMetrics> | FleetLoadMetrics;
}
export interface FleetAutoscaleObservation {
  /** Epoch milliseconds at observation time. */
  sampledAt: number;
  /** Supported aggregate measurement dimension. */
  metric: 'rps' | 'cpu' | 'memory';
  /** Finite nonnegative aggregate in the dimension’s documented units. */
  value: number;
  /** Controller capacity at observation time. */
  desiredReplicas: number;
  /** Whether declared quality safeguards permitted a reduction. */
  downscaleAllowed: boolean;
}
export interface FleetAutoscaler {
  /** Latest detached policy state, not live process health. */
  readonly status: Readonly<AutoscaleState>;
  /** Frozen copied public policy snapshot; runtime policy still retains its original host reference. */
  readonly config: Readonly<AutoscaleConfig>;
  /** Detached latest aggregate, or null before a successful observation. */
  readonly lastObservation: Readonly<FleetAutoscaleObservation> | null;
  /** Request a sample; concurrent calls share the current operation.
   * @returns {Promise<void>} Actual shared sampling/scale settlement.
   */
  sample(): Promise<void>;
  /** Pause future decisions and persist the policy transition through the host callback.
   * @returns {void} No in-flight scale operation is forcibly cancelled.
   */
  pause(): void;
  /** Resume future decisions and persist the policy transition through the host callback.
   * @returns {void} Does not synchronously collect a sample.
   */
  resume(): void;
  /** Fence new work and clear this sampler timer without disposing borrowed fleet/load sources.
   * @returns {void} In-flight sampling may still settle; this method does not expose a drain promise.
   */
  stop(): void;
}
/** Own a periodic local sampler over borrowed fleet/load/resource owners; samples coalesce and failed/stale readings never trigger downscale.
 * @param {InstanceFleet} fleet - Borrowed running fleet controller; its host owns final stop/drain.
 * @param {readonly number[]} ports - Validated complete inventory including at least one spare.
 * @param {FleetLoadSource} source - Borrowed actual proxy aggregate source; no synthetic throughput is assumed.
 * @param {AutoscaleConfig} config - Trusted validated host policy retained by reference; do not mutate after creation.
 * @param {Partial<AutoscaleState>} restored - Optional private policy checkpoint fields.
 * @param {(state: Readonly<AutoscaleState>) => void} onChange - Optional synchronous host persistence callback for pause/cooldown transitions.
 * @param {FleetResourceSource} resources - Borrowed injected sampler or local Linux sampler; native process ownership remains separate.
 * @param {(observation: Readonly<FleetAutoscaleObservation>) => void} onObservation - Optional best-effort aggregate callback, excluding user/request dimensions.
 * @returns {FleetAutoscaler} Owned timer/control handle; stop fences future work but does not await an already-running sample.
 */
export function createFleetAutoscaler(
  fleet: InstanceFleet,
  ports: readonly number[],
  source: FleetLoadSource,
  config: AutoscaleConfig,
  restored?: Partial<AutoscaleState>,
  onChange?: (state: Readonly<AutoscaleState>) => void,
  resources: FleetResourceSource = new LinuxFleetResourceSampler(),
  onObservation?: (observation: Readonly<FleetAutoscaleObservation>) => void
): FleetAutoscaler {
  validateAutoscaleConfig(config, ports.length, fleet.status.desiredReplicas);
  /** Local hysteresis owner; constructor does not start timers. */
  const policy = new AutoscalePolicy(config, restored);
  let stopped = false;
  let observation: FleetAutoscaleObservation | null = null;
  let current: Promise<void> | undefined;
  let persisted = {
    paused: policy.snapshot.paused,
    lastScaledAt: policy.snapshot.lastScaledAt,
  };
  /** Persist only pause/cooldown transitions to avoid synchronous disk writes for every sample.
   * @returns {void} Calls the trusted host callback when transition fields change. */
  const report = () => {
    /** Detached current policy state considered for checkpointing. */
    const state = policy.snapshot;
    // Runtime metrics update on every sample, but only policy transitions need
    // fsync-backed persistence. Avoid needless writes under high traffic.
    if (
      state.paused === persisted.paused &&
      state.lastScaledAt === persisted.lastScaledAt
    ) {
      return;
    }
    onChange?.(state);
    persisted = { paused: state.paused, lastScaledAt: state.lastScaledAt };
  };
  /** Evaluate one complete fresh telemetry sample and optionally request serialized fleet scaling.
   * @returns {Promise<void>} Settles after native sampling and any requested scale operation; failures reach the sample caller.
   */
  async function run(): Promise<void> {
    if (stopped || policy.snapshot.paused || !config.enabled) {
      return;
    }
    /** Published fleet snapshot captured before this asynchronous sample. */
    const status = fleet.status;
    if (status.phase !== 'running') {
      return;
    } // preserve healthy capacity during recovery
    /** Current healthy routed ports; incomplete serving capacity suppresses decisions. */
    const routed = status.members
      .filter((m) => m.routed && m.healthy)
      .map((m) => m.port);
    if (routed.length !== status.desiredReplicas) {
      return;
    }
    let reading: number;
    let traffic: FleetLoadMetrics | undefined;
    if (
      config.maxErrorRate !== undefined ||
      config.maxP95LatencyMs !== undefined
    ) {
      traffic = await source.metrics(status.hostname, routed, config.windowMs);
      if (
        traffic.hostname !== status.hostname ||
        traffic.windowMs !== config.windowMs ||
        !Number.isSafeInteger(traffic.sampledAt) ||
        Math.abs(Date.now() - traffic.sampledAt) > config.windowMs ||
        !Number.isSafeInteger(traffic.completedRequests) ||
        !Number.isSafeInteger(traffic.serverErrors) ||
        typeof traffic.errorRate !== 'number' ||
        !Number.isFinite(traffic.errorRate) ||
        traffic.errorRate < 0 ||
        traffic.errorRate > 1 ||
        (config.maxP95LatencyMs !== undefined &&
          traffic.p95LatencyMs !== null &&
          (typeof traffic.p95LatencyMs !== 'number' ||
            !Number.isFinite(traffic.p95LatencyMs)))
      ) {
        throw new Error('Fleet safety telemetry is missing or stale');
      }
    }
    if (config.metric && config.metric !== 'rps') {
      /** Healthy routed child observations for explicit native PID sampling. */
      const members = status.members.filter((m) => m.routed && m.healthy);
      if (
        members.some(
          (m) => !Number.isSafeInteger(m.pid) || (m.pid as number) < 2
        )
      ) {
        throw new Error(
          'Cannot measure fleet resources without verified child PIDs'
        );
      }
      /** Borrowed native resource observation requiring count, freshness and finite-value validation. */
      const snapshot = await resources.sample(
        members.map((m) => m.pid as number)
      );
      if (
        snapshot.processCount !== routed.length ||
        !Number.isSafeInteger(snapshot.sampledAt) ||
        Math.abs(Date.now() - snapshot.sampledAt) > config.windowMs ||
        !Number.isFinite(snapshot.cpuPercent) ||
        !Number.isFinite(snapshot.memoryMiB) ||
        snapshot.cpuPercent < 0 ||
        snapshot.memoryMiB < 0
      ) {
        throw new Error('Resource autoscaling metrics are stale or invalid');
      }
      reading =
        config.metric === 'cpu' ? snapshot.cpuPercent : snapshot.memoryMiB;
    } else {
      /** Coalesced sampling operation.
       * @returns {Promise<void>} Shared actual work promise, released only after settlement. */
      const sample =
        traffic ??
        (await source.metrics(status.hostname, routed, config.windowMs));
      if (
        sample.hostname !== status.hostname ||
        !Number.isSafeInteger(sample.sampledAt) ||
        Math.abs(Date.now() - sample.sampledAt) > config.windowMs ||
        sample.windowMs !== config.windowMs ||
        !Number.isFinite(sample.requestsPerSecond) ||
        sample.requestsPerSecond < 0
      ) {
        throw new Error('Autoscaling metrics are stale or invalid');
      }
      reading = sample.requestsPerSecond;
    }
    if (stopped) {
      return;
    }
    /** Coverage-aware error/latency guards evaluated before lower-capacity decisions. */
    const safeToDownscale =
      !traffic ||
      ((config.maxErrorRate === undefined ||
        traffic.errorRate! <= config.maxErrorRate) &&
        (config.maxP95LatencyMs === undefined ||
          (traffic.p95LatencyMs !== null &&
            traffic.p95LatencyMs! <= config.maxP95LatencyMs)));
    observation = {
      sampledAt: Date.now(),
      metric: config.metric ?? 'rps',
      value: reading,
      desiredReplicas: status.desiredReplicas,
      downscaleAllowed: safeToDownscale,
    };
    // Diagnostics are best effort; a full disk must not crash a healthy fleet.
    try {
      onObservation?.(observation);
    } catch (error) {
      console.error('Fleet metric history write failed:', error);
    }
    /** Nullable one-step policy decision; process scaling may still fail independently. */
    const target = policy.observe(
      reading,
      status.desiredReplicas,
      Date.now(),
      safeToDownscale
    );
    report();
    if (target !== null && !stopped) {
      await fleet.scaleTo(target);
    }
  }
  /** Coalesced sampling operation.
   * @returns {Promise<void>} Shared actual work promise, released only after settlement. */
  const sample = (): Promise<void> => {
    if (current) {
      return current;
    }
    current = run().finally(() => {
      current = undefined;
    });
    return current;
  };
  /** Owned unreferenced periodic sampler; stop clears future ticks. */
  const timer = setInterval(() => {
    void sample().catch((error) =>
      console.error('Fleet autoscaler sample failed:', error)
    );
  }, config.sampleIntervalMs);
  timer.unref?.();
  return {
    get status() {
      return policy.snapshot;
    },
    get lastObservation() {
      return observation ? Object.freeze({ ...observation }) : null;
    },
    config: Object.freeze({ ...config }),
    sample,
    /** Pause future decisions and persist the policy transition through the host callback.
     * @returns {void} No in-flight scale operation is forcibly cancelled.
     */
    pause() {
      policy.setPaused(true);
      report();
    },
    /** Resume future decisions and persist the policy transition through the host callback.
     * @returns {void} Does not synchronously collect a sample.
     */ resume() {
      policy.setPaused(false);
      report();
    },
    /** Fence new work and clear this sampler timer without disposing borrowed fleet/load sources.
     * @returns {void} In-flight sampling may still settle; this method does not expose a drain promise.
     */
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
