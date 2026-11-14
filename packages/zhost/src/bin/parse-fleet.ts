import {
  DEFAULT_AUTOSCALE,
  validateAutoscaleConfig,
  type AutoscaleConfig,
} from '../portless/autoscale-policy.js';
/** Strict fleet command parser. Child arguments remain unmodified after --. */
export interface FleetRunArguments {
  /** Validated application name; this identifier does not authorize process management. */
  name: string;
  /** Distinct validated application ports, including required spare capacity. */
  ports: number[];
  /** Initial desired replica count within available ports. */
  replicas: number;
  /** Trusted operator command and arguments preserved verbatim, never interpreted by a shell here. */
  command: string[];
  /** Validated relative HTTP health endpoint; never an arbitrary remote URL. */
  healthPath?: string;
  /** Interval between active health checks in milliseconds. */
  healthIntervalMs: number;
  /** Consecutive failed probes required before marking a child unhealthy. */
  unhealthyThreshold: number;
  /** Maximum readiness wait in milliseconds. */
  readyTimeoutMs: number;
  /** Graceful child shutdown deadline in milliseconds. */
  shutdownTimeoutMs: number;
  /** Maximum connection-drain wait in milliseconds; not forced JavaScript cancellation. */
  drainTimeoutMs: number;
  /** Maximum replacement attempts within the restart window. */
  maxReplacements: number;
  /** Sliding restart accounting window in milliseconds. */
  restartWindowMs: number;
  /** Initial replacement delay in milliseconds. */
  replacementDelayMs: number;
  /** Upper bound on exponential replacement delay in milliseconds. */
  maxReplacementDelayMs: number;
  /** Explicit operator request to replace an existing route reservation. */
  force: boolean;
  /** Explicit validated autoscaling policy; omitted unless the operator enables it. */
  autoscale?: AutoscaleConfig;
}
/** Parse a complete decimal integer token within this option’s explicit bounds.
 * @param {string} value - Complete decimal argument token.
 * @param {string} flag - Option label used in validation errors.
 * @param {number} min - Inclusive permitted lower bound.
 * @param {number} max - Inclusive permitted upper bound.
 * @returns {number} Validated safe integer; malformed or out-of-range input throws.
 */
function integer(
  value: string,
  flag: string,
  min: number,
  max: number
): number {
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  ) {
    throw new Error(`${flag} must be an integer between ${min} and ${max}`);
  }
  return Number(value);
}
/** Parse the fleet command into validated configuration without starting children, listeners or checkpoint writers.
 * @param {readonly string[]} args - Trusted CLI tokens; child arguments remain unchanged after the command boundary.
 * @returns {FleetRunArguments} Validated supervisor options and the untouched child command.
 */
export function parseFleetRunArguments(
  args: readonly string[]
): FleetRunArguments {
  /** Candidate supervisor options; returned only after cross-option validation. */
  const result: FleetRunArguments = {
    name: '',
    ports: [],
    replicas: 2,
    command: [],
    force: false,
    healthIntervalMs: 2000,
    unhealthyThreshold: 2,
    readyTimeoutMs: 15_000,
    shutdownTimeoutMs: 5_000,
    drainTimeoutMs: 10_000,
    maxReplacements: 5,
    restartWindowMs: 60_000,
    replacementDelayMs: 100,
    maxReplacementDelayMs: 5000,
  };
  /** Detached autoscaling defaults, changed only by explicitly supplied scaling options. */
  const scale: AutoscaleConfig = {
    ...DEFAULT_AUTOSCALE,
    minReplicas: 2,
    maxReplicas: 2,
  };
  let autoscaleRequested = false;
  let autoscaleFlags = false;
  /** Consumed flags, preventing repeated options from silently overriding policy. */
  const seen = new Set<string>();
  let i = 0;
  for (; i < args.length && args[i] !== '--'; i++) {
    /** Argument proven present by the loop bounds before consuming a following value. */
    const flag = args[i]!;
    if (seen.has(flag)) {
      throw new Error(`Repeated fleet option: ${flag}`);
    }
    seen.add(flag);
    if (flag === '--force') {
      result.force = true;
      continue;
    }
    if (flag === '--autoscale') {
      autoscaleRequested = scale.enabled = true;
      continue;
    }
    /** Following value token, checked before conversion or policy assignment. */
    const value = args[++i];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    switch (flag) {
      case '--min-replicas':
        scale.minReplicas = integer(value, flag, 2, 16);
        autoscaleFlags = true;
        break;
      case '--max-replicas':
        scale.maxReplicas = integer(value, flag, 2, 16);
        autoscaleFlags = true;
        break;
      case '--scale-mode':
        if (!['rps', 'cpu', 'memory'].includes(value)) {
          throw new Error('Invalid autoscaling metric');
        }
        scale.metric = value as 'rps' | 'cpu' | 'memory';
        autoscaleFlags = true;
        break;
      case '--scale-up':
      case '--scale-down': {
        if (!/^(?:\d+)(?:\.\d{1,3})?$/.test(value) || Number(value) <= 0) {
          throw new Error(`Invalid ${flag}`);
        }
        if (flag === '--scale-up') {
          scale.scaleUpThreshold = Number(value);
        } else {
          scale.scaleDownThreshold = Number(value);
        }
        autoscaleFlags = true;
        break;
      }
      case '--scale-up-rps':
      case '--scale-down-rps': {
        if (
          !/^(?:\d+)(?:\.\d{1,3})?$/.test(value) ||
          Number(value) <= 0 ||
          Number(value) > 1000000
        ) {
          throw new Error(`Invalid ${flag}`);
        }
        if (flag === '--scale-up-rps') {
          scale.scaleUpRps = Number(value);
        } else {
          scale.scaleDownRps = Number(value);
        }
        autoscaleFlags = true;
        break;
      }
      case '--scale-max-error-rate': {
        if (!/^(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/.test(value)) {
          throw new Error('Invalid scale-max-error-rate');
        }
        scale.maxErrorRate = Number(value);
        autoscaleFlags = true;
        break;
      }
      case '--scale-max-p95':
        scale.maxP95LatencyMs = integer(value, flag, 1, 300000);
        autoscaleFlags = true;
        break;
      case '--scale-cooldown':
        scale.cooldownMs = integer(value, flag, 0, 3600000);
        autoscaleFlags = true;
        break;
      case '--scale-samples':
        scale.consecutiveSamples = integer(value, flag, 1, 20);
        autoscaleFlags = true;
        break;
      case '--scale-interval':
        scale.sampleIntervalMs = integer(value, flag, 200, 300000);
        autoscaleFlags = true;
        break;
      case '--scale-window':
        scale.windowMs = integer(value, flag, 1000, 60000);
        autoscaleFlags = true;
        break;
      case '--name':
        if (
          !/^[a-z0-9][a-z0-9._-]{0,100}$/.test(value) ||
          value.includes('..')
        ) {
          throw new Error('Invalid fleet name');
        }
        result.name = value;
        break;
      case '--ports':
        result.ports = value
          .split(',')
          .map((p) => integer(p, 'port', 1, 65535));
        if (
          result.ports.length < 3 ||
          result.ports.length > 17 ||
          new Set(result.ports).size !== result.ports.length
        ) {
          throw new Error('Use 3–17 distinct ports including a spare');
        }
        break;
      case '--replicas':
        result.replicas = integer(value, flag, 2, 16);
        break;
      case '--health-path':
        if (
          !value.startsWith('/') ||
          value.startsWith('//') ||
          value.length > 2048 ||
          /[^\x21-\x7e]|#/.test(value)
        ) {
          throw new Error('Invalid health path');
        }
        result.healthPath = value;
        break;
      case '--health-interval':
        result.healthIntervalMs = integer(value, flag, 100, 3_600_000);
        break;
      case '--unhealthy-threshold':
        result.unhealthyThreshold = integer(value, flag, 1, 20);
        break;
      case '--ready-timeout':
        result.readyTimeoutMs = integer(value, flag, 1, 300_000);
        break;
      case '--shutdown-timeout':
        result.shutdownTimeoutMs = integer(value, flag, 1, 120_000);
        break;
      case '--drain-timeout':
        result.drainTimeoutMs = integer(value, flag, 0, 300_000);
        break;
      case '--max-replacements':
        result.maxReplacements = integer(value, flag, 0, 1000);
        break;
      case '--restart-window':
        result.restartWindowMs = integer(value, flag, 100, 86_400_000);
        break;
      case '--restart-delay':
        result.replacementDelayMs = integer(value, flag, 0, 60_000);
        break;
      case '--max-restart-delay':
        result.maxReplacementDelayMs = integer(value, flag, 0, 300_000);
        break;
      default:
        throw new Error(`Unknown fleet option: ${flag}`);
    }
  }
  if (args[i] !== '--') {
    throw new Error('Fleet command requires -- separator');
  }
  result.command = args.slice(i + 1);
  if (
    !result.name ||
    result.ports.length < result.replicas + 1 ||
    !result.command.length ||
    !result.command[0]
  ) {
    throw new Error(
      'Usage: fleet run --name NAME --ports P1,P2,P3 --replicas 2 [OPTIONS] -- COMMAND [ARGS...]'
    );
  }
  if (autoscaleFlags && !autoscaleRequested) {
    throw new Error('Autoscaling options require --autoscale');
  }
  if (autoscaleRequested) {
    if (
      (scale.metric ?? 'rps') !== 'rps' &&
      (!seen.has('--scale-up') || !seen.has('--scale-down'))
    ) {
      throw new Error(
        'Resource autoscaling requires --scale-up and --scale-down thresholds'
      );
    }
    if (
      (scale.metric ?? 'rps') === 'rps' &&
      (seen.has('--scale-up') || seen.has('--scale-down'))
    ) {
      throw new Error(
        'Use --scale-up-rps and --scale-down-rps for RPS scaling'
      );
    }
    if (!seen.has('--max-replicas')) {
      scale.maxReplicas = Math.min(16, result.ports.length - 1);
    }
    if (
      result.replicas < scale.minReplicas ||
      result.replicas > scale.maxReplicas
    ) {
      throw new Error('Initial replicas must be within autoscaling bounds');
    }
    result.autoscale = validateAutoscaleConfig(
      scale,
      result.ports.length,
      result.replicas
    );
  }
  return result;
}
