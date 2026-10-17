/** Linux /proc fleet resource sampling. No shell execution or cross-process credentials.
 * A missing/reused process is never treated as zero load (which would downscale).
 */
import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { readLinuxContainerLimits, type LinuxContainerLimits } from './fleet-container.js';

export interface FleetResourceMetrics {
  sampledAt: number;
  processCount: number;
  cpuPercent: number;
  memoryMiB: number;
  maxMemoryMiB: number;
  /** Container-wide limits, when detectable; not a measurement of fleet-only usage. */
  container?: LinuxContainerLimits;
}
export interface FleetResourceSource {
  sample(pids: readonly number[]): Promise<FleetResourceMetrics> | FleetResourceMetrics;
}
interface ProcessReading { pid: number; startTicks: bigint; cpuTicks: bigint; rssBytes: number }
interface Baseline { startTicks: bigint; cpuTicks: bigint; atNs: bigint }
const HZ = 100; // Linux USER_HZ is 100 on mainstream architectures, but use getconf when possible.
const MIB = 1024 * 1024;
function positivePid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid < 2 || pid > 4194304) throw new RangeError('Invalid fleet child pid');
}
/** Parse /proc/PID/stat after the FINAL right parenthesis (comm may contain spaces and ')'). */
export function parseLinuxProcessStat(stat: string, pid: number): { startTicks: bigint; cpuTicks: bigint } {
  positivePid(pid);
  const close = stat.lastIndexOf(')');
  if (!stat.startsWith(`${pid} (`) || close < 0) throw new Error('Malformed Linux process stat');
  const fields = stat.slice(close + 1).trim().split(/\s+/);
  // fields[0] = state (field 3); utime=field 14; stime=15; starttime=22
  if (fields.length < 20) throw new Error('Incomplete Linux process stat');
  const raw = [fields[11], fields[12], fields[19]];
  if (raw.some(v => !/^\d+$/.test(v))) throw new Error('Invalid Linux process counters');
  const [user, system, startTicks] = raw.map(BigInt);
  if (startTicks <= 0n) throw new Error('Invalid Linux process start timestamp');
  return { startTicks, cpuTicks: user + system };
}
function readProcess(pid: number): ProcessReading {
  positivePid(pid);
  const dir = join('/proc', String(pid));
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Unsafe process directory');
  const stat = parseLinuxProcessStat(readFileSync(join(dir, 'stat'), 'utf8'), pid);
  const status = readFileSync(join(dir, 'status'), 'utf8');
  const match = /^VmRSS:\s+(\d+)\s+kB\s*$/m.exec(status);
  if (!match) throw new Error('Process RSS unavailable');
  const kb = Number(match[1]);
  if (!Number.isSafeInteger(kb) || kb < 0) throw new Error('Invalid process RSS');
  return { pid, ...stat, rssBytes: kb * 1024 };
}
/**
 * CPU is percent of one CPU core, not percent of the entire machine.
 * Requires a priming sample; no observation => no scaling decision.
 * Linux-only by design: unsupported platforms fail closed instead of inventing zero utilization.
 */
export class LinuxFleetResourceSampler implements FleetResourceSource {
  private previous = new Map<number, Baseline>();
  constructor(private readonly read: (pid: number) => ProcessReading = readProcess,
    private readonly clock: () => bigint = () => process.hrtime.bigint(),
    private readonly clockTicksPerSecond = HZ) {
    if (!Number.isFinite(clockTicksPerSecond) || clockTicksPerSecond <= 0) throw new RangeError('Invalid clock ticks per second');
  }
  sample(pids: readonly number[]): FleetResourceMetrics {
    if (process.platform !== 'linux' && this.read === readProcess) throw new Error('Process resource monitoring requires Linux');
    if (!pids.length || new Set(pids).size !== pids.length || pids.length > 16) throw new Error('Invalid monitored fleet processes');
    const now = this.clock();
    const next = new Map<number, Baseline>();
    let cpuTotal = 0, memoryTotal = 0, maxMemory = 0;
    let primed = true;
    for (const pid of pids) {
      const value = this.read(pid);
      if (value.pid !== pid || !Number.isSafeInteger(value.rssBytes) || value.rssBytes < 0) throw new Error('Invalid process resource sample');
      const prior = this.previous.get(pid);
      if (!prior || prior.startTicks !== value.startTicks) primed = false;
      else {
        const elapsed = now - prior.atNs;
        const used = value.cpuTicks - prior.cpuTicks;
        if (elapsed <= 0n || used < 0n) throw new Error('Non-monotonic CPU sample');
        cpuTotal += Number(used) * this.clockTicksPerSecond ** -1 * 1e11 / Number(elapsed);
      }
      next.set(pid, { startTicks: value.startTicks, cpuTicks: value.cpuTicks, atNs: now });
      memoryTotal += value.rssBytes / MIB;
      maxMemory = Math.max(maxMemory, value.rssBytes / MIB);
    }
    this.previous = next;
    if (!primed) throw new Error('Process resource sample is warming up or process identity changed');
    return { sampledAt: Date.now(), processCount: pids.length, cpuPercent: cpuTotal / pids.length,
      memoryMiB: memoryTotal / pids.length, maxMemoryMiB: maxMemory,
      ...(process.platform === 'linux' ? { container: readLinuxContainerLimits() } : {}) };
  }
}
