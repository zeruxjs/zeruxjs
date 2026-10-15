import { LinuxFleetResourceSampler, type FleetResourceSource } from './fleet-resources.js';
/** Policy runner: sampling happens at the real proxy; failed samples never scale down. */
import { AutoscalePolicy, type AutoscaleConfig, type AutoscaleState, validateAutoscaleConfig } from './autoscale-policy.js';
import type { InstanceFleet } from './fleet-types.js';
export interface FleetLoadMetrics {
  hostname: string;
  requests: number;
  requestsPerSecond: number;
  activeConnections: number;
  windowMs: number;
  sampledAt: number;
  completedRequests?: number;
  serverErrors?: number;
  errorRate?: number | null;
  p95LatencyMs?: number | null;
}
export interface FleetLoadSource { metrics(hostname: string, ports: readonly number[], windowMs: number): Promise<FleetLoadMetrics> | FleetLoadMetrics; }
export interface FleetAutoscaleObservation {
  sampledAt: number;
  metric: 'rps' | 'cpu' | 'memory';
  value: number;
  desiredReplicas: number;
  downscaleAllowed: boolean;
}
export interface FleetAutoscaler {
  readonly status: Readonly<AutoscaleState>;
  readonly config: Readonly<AutoscaleConfig>;
  readonly lastObservation: Readonly<FleetAutoscaleObservation> | null;
  sample(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
}
export function createFleetAutoscaler(fleet: InstanceFleet, ports: readonly number[], source: FleetLoadSource,
  config: AutoscaleConfig, restored?: Partial<AutoscaleState>, onChange?: (state: Readonly<AutoscaleState>) => void,
  resources: FleetResourceSource = new LinuxFleetResourceSampler(),
  onObservation?: (observation: Readonly<FleetAutoscaleObservation>) => void): FleetAutoscaler {
  validateAutoscaleConfig(config, ports.length, fleet.status.desiredReplicas);
  const policy = new AutoscalePolicy(config, restored);
  let stopped = false;
  let observation: FleetAutoscaleObservation | null = null;
  let current: Promise<void> | undefined;
  let persisted = { paused: policy.snapshot.paused, lastScaledAt: policy.snapshot.lastScaledAt };
  const report = () => {
    const state = policy.snapshot;
    // Runtime metrics update on every sample, but only policy transitions need
    // fsync-backed persistence. Avoid needless writes under high traffic.
    if (state.paused === persisted.paused && state.lastScaledAt === persisted.lastScaledAt) return;
    onChange?.(state);
    persisted = { paused: state.paused, lastScaledAt: state.lastScaledAt };
  };
  async function run(): Promise<void> {
    if (stopped || policy.snapshot.paused || !config.enabled) return;
    const status = fleet.status;
    if (status.phase !== 'running') return; // preserve healthy capacity during recovery
    const routed = status.members.filter(m => m.routed && m.healthy).map(m => m.port);
    if (routed.length !== status.desiredReplicas) return;
    let reading: number;
    let traffic: FleetLoadMetrics | undefined;
    if (config.maxErrorRate !== undefined || config.maxP95LatencyMs !== undefined) {
      traffic = await source.metrics(status.hostname, routed, config.windowMs);
      if (traffic.hostname !== status.hostname || traffic.windowMs !== config.windowMs ||
          !Number.isSafeInteger(traffic.sampledAt) || Math.abs(Date.now() - traffic.sampledAt) > config.windowMs ||
          !Number.isSafeInteger(traffic.completedRequests) || !Number.isSafeInteger(traffic.serverErrors) ||
          typeof traffic.errorRate !== 'number' || !Number.isFinite(traffic.errorRate) ||
          traffic.errorRate < 0 || traffic.errorRate > 1 ||
          (config.maxP95LatencyMs !== undefined && traffic.p95LatencyMs !== null &&
            (typeof traffic.p95LatencyMs !== 'number' || !Number.isFinite(traffic.p95LatencyMs)))) {
        throw new Error('Fleet safety telemetry is missing or stale');
      }
    }
    if (config.metric && config.metric !== 'rps') {
      const members = status.members.filter(m => m.routed && m.healthy);
      if (members.some(m => !Number.isSafeInteger(m.pid) || (m.pid as number) < 2)) throw new Error('Cannot measure fleet resources without verified child PIDs');
      const snapshot = await resources.sample(members.map(m => m.pid as number));
      if (snapshot.processCount !== routed.length || !Number.isSafeInteger(snapshot.sampledAt) ||
          Math.abs(Date.now() - snapshot.sampledAt) > config.windowMs ||
          !Number.isFinite(snapshot.cpuPercent) || !Number.isFinite(snapshot.memoryMiB) ||
          snapshot.cpuPercent < 0 || snapshot.memoryMiB < 0) throw new Error('Resource autoscaling metrics are stale or invalid');
      reading = config.metric === 'cpu' ? snapshot.cpuPercent : snapshot.memoryMiB;
    } else {
      const sample = traffic ?? await source.metrics(status.hostname, routed, config.windowMs);
      if (sample.hostname !== status.hostname || !Number.isSafeInteger(sample.sampledAt) ||
        Math.abs(Date.now() - sample.sampledAt) > config.windowMs ||
        sample.windowMs !== config.windowMs || !Number.isFinite(sample.requestsPerSecond) || sample.requestsPerSecond < 0) {
        throw new Error('Autoscaling metrics are stale or invalid');
      }
      reading = sample.requestsPerSecond;
    }
    if (stopped) return;
    const safeToDownscale = !traffic ||
      (config.maxErrorRate === undefined || traffic.errorRate! <= config.maxErrorRate) &&
      (config.maxP95LatencyMs === undefined || traffic.p95LatencyMs !== null && traffic.p95LatencyMs! <= config.maxP95LatencyMs);
    observation = { sampledAt: Date.now(), metric: config.metric ?? 'rps', value: reading,
      desiredReplicas: status.desiredReplicas, downscaleAllowed: safeToDownscale };
    // Diagnostics are best effort; a full disk must not crash a healthy fleet.
    try { onObservation?.(observation); }
    catch (error) { console.error('Fleet metric history write failed:', error); }
    const target = policy.observe(reading, status.desiredReplicas, Date.now(), safeToDownscale);
    report();
    if (target !== null && !stopped) await fleet.scaleTo(target);
  }
  const sample = (): Promise<void> => {
    if (current) return current;
    current = run().finally(() => { current = undefined; });
    return current;
  };
  const timer = setInterval(() => { void sample().catch(error => console.error('Fleet autoscaler sample failed:', error)); }, config.sampleIntervalMs);
  timer.unref?.();
  return { get status() { return policy.snapshot; },
    get lastObservation() { return observation ? Object.freeze({ ...observation }) : null; },
    config: Object.freeze({ ...config }), sample,
    pause() { policy.setPaused(true); report(); }, resume() { policy.setPaused(false); report(); },
    stop() { stopped = true; clearInterval(timer); } };
}
