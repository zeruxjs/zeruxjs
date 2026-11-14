/** Linux /proc fleet resource sampling. No shell execution or cross-process credentials.
 * A missing/reused process is never treated as zero load (which would downscale).
 */
import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import {
  readLinuxContainerLimits,
  type LinuxContainerLimits,
} from './fleet-container.js';

export interface FleetResourceMetrics {
  /** Wall-clock observation timestamp in milliseconds. */
  sampledAt: number;
  /** Number of distinct admitted child PIDs. */
  processCount: number;
  /** Mean per-process CPU percentage relative to one core, not summed machine utilization. */
  cpuPercent: number;
  /** Mean child resident memory in MiB. */
  memoryMiB: number;
  /** Maximum observed child resident memory in MiB. */
  maxMemoryMiB: number;
  /** Container-wide limits, when detectable; not a measurement of fleet-only usage. */
  container?: LinuxContainerLimits;
}
export interface FleetResourceSource {
  /** Sample distinct host-owned children using a primed monotonic baseline; reused/missing identities never become fabricated zero load.
   * @param {readonly number[]} pids - One to 16 distinct host-authorized child PIDs; the native path requires Linux.
   * @returns {FleetResourceMetrics} Mean per-process one-core CPU percent/RSS, maximum RSS and optional container-wide advisory metadata.
   */
  sample(
    pids: readonly number[]
  ): Promise<FleetResourceMetrics> | FleetResourceMetrics;
}
interface ProcessReading {
  /** Host-selected local child PID, never process-management authorization. */
  pid: number;
  /** Process-start tick identity used to reject PID reuse across samples. */
  startTicks: bigint;
  /** Combined user/system CPU ticks observed for this process. */
  cpuTicks: bigint;
  /** Validated child resident bytes. */
  rssBytes: number;
}
interface Baseline {
  /** Process-start tick identity used to reject PID reuse across samples. */
  startTicks: bigint;
  /** Combined user/system CPU ticks observed for this process. */
  cpuTicks: bigint;
  /** Monotonic nanosecond baseline timestamp. */
  atNs: bigint;
}
/** Existing default USER_HZ, explicitly overridable by a qualified host. */
const HZ = 100; // Existing default; hosts can explicitly inject a qualified tick frequency.
/** Bytes per binary mebibyte for RSS reporting. */
const MIB = 1024 * 1024;
/** Validate a bounded local PID shape before filesystem inspection; ownership authorization remains host-side.
 * @param {number} pid - Host-selected owned child PID.
 * @returns {void} Rejects malformed/out-of-range PID values, without signaling a process.
 */
function positivePid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid < 2 || pid > 4194304) {
    throw new RangeError('Invalid fleet child pid');
  }
}
/** Parse fixed Linux stat counters after the final comm parenthesis, validating field count and decimal syntax before BigInt conversion.
 * @param {string} stat - Local /proc/PID/stat text or a synthetic fixture.
 * @param {number} pid - Expected host-verified child PID whose textual prefix must match.
 * @returns {{startTicks: bigint; cpuTicks: bigint}} Process start identity and combined user/system CPU ticks.
 */
export function parseLinuxProcessStat(
  stat: string,
  pid: number
): {
  /** Process-start tick identity used to reject PID reuse across samples. */
  startTicks: bigint;
  /** Combined user/system CPU ticks observed for this process. */
  cpuTicks: bigint;
} {
  positivePid(pid);
  /** Final comm-name closing parenthesis; names may contain spaces and earlier parentheses. */
  const close = stat.lastIndexOf(')');
  if (!stat.startsWith(`${pid} (`) || close < 0) {
    throw new Error('Malformed Linux process stat');
  }
  /** Fields after comm, checked for the required fixed counter positions. */
  const fields = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  // fields[0] = state (field 3); utime=field 14; stime=15; starttime=22
  if (fields.length < 20) {
    throw new Error('Incomplete Linux process stat');
  }
  /** Exactly three validated-position decimal tokens; mapping preserves this fixed tuple length. */
  const raw = [fields[11]!, fields[12]!, fields[19]!] as const;
  if (raw.some((v) => !/^\d+$/.test(v))) {
    throw new Error('Invalid Linux process counters');
  }
  /** Three exact converted counters, with tuple shape proven by the fixed three-element input. */
  const [user, system, startTicks] = raw.map(BigInt) as [
    bigint,
    bigint,
    bigint,
  ];
  if (startTicks <= 0n) {
    throw new Error('Invalid Linux process start timestamp');
  }
  return { startTicks, cpuTicks: user + system };
}
/** Read fixed stat/status files for a host-selected local child without shell execution or process signaling.
 * @param {number} pid - Host-verified owned child PID; this helper validates shape, not tenant authorization.
 * @returns {ProcessReading} Local identity/CPU/RSS observation; unavailable or malformed counters throw.
 */
function readProcess(pid: number): ProcessReading {
  positivePid(pid);
  /** Fixed /proc child directory derived only from a validated host-selected PID. */
  const dir = join('/proc', String(pid));
  /** Child-directory metadata rejecting a symlink or non-directory. */
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) {
    throw new Error('Unsafe process directory');
  }
  /** Validated start identity and CPU counters from this child’s stat record. */
  const stat = parseLinuxProcessStat(
    readFileSync(join(dir, 'stat'), 'utf8'),
    pid
  );
  /** Local status metadata inspected only for the fixed RSS field. */
  const status = readFileSync(join(dir, 'status'), 'utf8');
  /** Anchored RSS counter match; its required digit capture is validated numerically. */
  const match = /^VmRSS:\s+(\d+)\s+kB\s*$/m.exec(status);
  if (!match) {
    throw new Error('Process RSS unavailable');
  }
  /** Validated RSS kilobytes before conversion to bytes. */
  const kb = Number(match[1]);
  if (!Number.isSafeInteger(kb) || kb < 0) {
    throw new Error('Invalid process RSS');
  }
  return { pid, ...stat, rssBytes: kb * 1024 };
}
/**
 * CPU is percent of one CPU core, not percent of the entire machine.
 * Requires a priming sample; no observation => no scaling decision.
 * Linux-only by design: unsupported platforms fail closed instead of inventing zero utilization.
 */
export class LinuxFleetResourceSampler implements FleetResourceSource {
  private previous = new Map<number, Baseline>();
  /** Create bounded baseline state without timers or persistent descriptors; injected readers/clocks remain trusted host code.
   * @param {(pid: number) => ProcessReading} read - Optional trusted process reader, defaulting to fixed native /proc reads.
   * @param {() => bigint} clock - Optional trusted monotonic nanosecond clock.
   * @param {number} clockTicksPerSecond - Qualified CPU tick frequency; existing default is 100.
   */
  constructor(
    private readonly read: (pid: number) => ProcessReading = readProcess,
    private readonly clock: () => bigint = () => process.hrtime.bigint(),
    private readonly clockTicksPerSecond = HZ
  ) {
    if (!Number.isFinite(clockTicksPerSecond) || clockTicksPerSecond <= 0) {
      throw new RangeError('Invalid clock ticks per second');
    }
  }
  /** Sample distinct host-owned children using a primed monotonic baseline; reused/missing identities never become fabricated zero load.
   * @param {readonly number[]} pids - One to 16 distinct host-authorized child PIDs; the native path requires Linux.
   * @returns {FleetResourceMetrics} Mean per-process one-core CPU percent/RSS, maximum RSS and optional container-wide advisory metadata.
   */
  sample(pids: readonly number[]): FleetResourceMetrics {
    if (process.platform !== 'linux' && this.read === readProcess) {
      throw new Error('Process resource monitoring requires Linux');
    }
    if (
      !pids.length ||
      new Set(pids).size !== pids.length ||
      pids.length > 16
    ) {
      throw new Error('Invalid monitored fleet processes');
    }
    /** Trusted monotonic clock observation shared across this sample. */
    const now = this.clock();
    /** Candidate next baseline, replacing prior state only after all readings validate. */
    const next = new Map<number, Baseline>();
    let cpuTotal = 0,
      memoryTotal = 0,
      maxMemory = 0;
    let primed = true;
    for (const pid of pids) {
      /** Trusted reader result still checked for matching PID and safe RSS metadata. */
      const value = this.read(pid);
      if (
        value.pid !== pid ||
        !Number.isSafeInteger(value.rssBytes) ||
        value.rssBytes < 0
      ) {
        throw new Error('Invalid process resource sample');
      }
      /** Previous baseline, required to match this process-start identity. */
      const prior = this.previous.get(pid);
      if (!prior || prior.startTicks !== value.startTicks) {
        primed = false;
      } else {
        /** Positive monotonic nanoseconds elapsed since the prior identity-matched sample. */
        const elapsed = now - prior.atNs;
        /** Nonnegative CPU tick delta for the identity-matched child. */
        const used = value.cpuTicks - prior.cpuTicks;
        if (elapsed <= 0n || used < 0n) {
          throw new Error('Non-monotonic CPU sample');
        }
        cpuTotal +=
          (Number(used) * this.clockTicksPerSecond ** -1 * 1e11) /
          Number(elapsed);
      }
      next.set(pid, {
        startTicks: value.startTicks,
        cpuTicks: value.cpuTicks,
        atNs: now,
      });
      memoryTotal += value.rssBytes / MIB;
      maxMemory = Math.max(maxMemory, value.rssBytes / MIB);
    }
    this.previous = next;
    if (!primed) {
      throw new Error(
        'Process resource sample is warming up or process identity changed'
      );
    }
    return {
      sampledAt: Date.now(),
      processCount: pids.length,
      cpuPercent: cpuTotal / pids.length,
      memoryMiB: memoryTotal / pids.length,
      maxMemoryMiB: maxMemory,
      ...(process.platform === 'linux'
        ? { container: readLinuxContainerLimits() }
        : {}),
    };
  }
}
