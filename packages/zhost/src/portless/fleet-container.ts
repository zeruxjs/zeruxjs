import { readFileSync } from 'node:fs';

/** Cgroup capacity is advisory. Missing/unlimited values remain null, never
 * zero, so they cannot accidentally authorize a scale-down. */
export interface LinuxContainerLimits {
  version: 1 | 2 | null;
  cpuQuotaCores: number | null;
  memoryLimitMiB: number | null;
  memoryUsageMiB: number | null;
}
const MIB = 1024 * 1024;
const UNLIMITED_V1 = 1n << 60n;
function read(path: string, readFile: (file: string) => string): string | null {
  try { return readFile(path).trim(); } catch { return null; }
}
function positiveBigInt(value: string | null): bigint | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed > 0n ? parsed : null;
}
function memoryMiB(value: string | null, v1 = false): number | null {
  const bytes = positiveBigInt(value);
  if (bytes === null || (v1 && bytes >= UNLIMITED_V1)) return null;
  const mb = Number(bytes) / MIB;
  return Number.isFinite(mb) && mb > 0 ? mb : null;
}
export function readLinuxContainerLimits(
  readFile: (file: string) => string = (file: string) => readFileSync(file, 'utf8'),
): LinuxContainerLimits {
  const v2 = read('/sys/fs/cgroup/cgroup.controllers', readFile);
  if (v2 !== null) {
    const quotaRaw = read('/sys/fs/cgroup/cpu.max', readFile)?.split(/\s+/);
    let cpuQuotaCores: number | null = null;
    if (quotaRaw && quotaRaw.length === 2) {
      const quota = positiveBigInt(quotaRaw[0]);
      const period = positiveBigInt(quotaRaw[1]);
      if (quota && period) {
        const value = Number(quota) / Number(period);
        if (Number.isFinite(value) && value > 0) cpuQuotaCores = value;
      }
    }
    return { version: 2, cpuQuotaCores,
      memoryLimitMiB: memoryMiB(read('/sys/fs/cgroup/memory.max', readFile)),
      memoryUsageMiB: memoryMiB(read('/sys/fs/cgroup/memory.current', readFile)),
    };
  }
  const v1Quota = read('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', readFile);
  const v1Memory = read('/sys/fs/cgroup/memory/memory.limit_in_bytes', readFile);
  if (v1Quota === null && v1Memory === null) {
    return { version: null, cpuQuotaCores: null, memoryLimitMiB: null, memoryUsageMiB: null };
  }
  const quota = positiveBigInt(v1Quota);
  const period = positiveBigInt(read('/sys/fs/cgroup/cpu/cpu.cfs_period_us', readFile));
  const cpu = quota && period ? Number(quota) / Number(period) : null;
  return { version: 1, cpuQuotaCores: cpu !== null && Number.isFinite(cpu) && cpu > 0 ? cpu : null,
    memoryLimitMiB: memoryMiB(v1Memory, true),
    memoryUsageMiB: memoryMiB(read('/sys/fs/cgroup/memory/memory.usage_in_bytes', readFile)),
  };
}
