import { readFileSync } from 'node:fs';

/** Cgroup capacity is advisory. Missing/unlimited values remain null, never
 * zero, so they cannot accidentally authorize a scale-down. */
export interface LinuxContainerLimits {
  /** Detected cgroup layout, or null when no supported metadata is readable. */
  version: 1 | 2 | null;
  /** Configured container-wide CPU quota in core units, or null for missing/unlimited. */
  cpuQuotaCores: number | null;
  /** Positive finite container memory limit in MiB, or null when unavailable/unlimited. */
  memoryLimitMiB: number | null;
  /** Positive finite container-wide usage in MiB, not this fleet’s memory alone. */
  memoryUsageMiB: number | null;
}
/** Bytes per binary mebibyte for explicitly labeled reporting units. */
const MIB = 1024 * 1024;
/** Existing cgroup v1 sentinel threshold treated as unlimited capacity. */
const UNLIMITED_V1 = 1n << 60n;
/** Read one fixed cgroup path through a trusted injected reader, treating missing/unreadable values as unavailable.
 * @param {string} path - Fixed implementation-owned cgroup filename.
 * @param {(file: string) => string} readFile - Borrowed trusted local reader, never supplied by remote request data.
 * @returns {string | null} Trimmed local metadata, or null on read failure.
 */
function read(path: string, readFile: (file: string) => string): string | null {
  try {
    return readFile(path).trim();
  } catch {
    return null;
  }
}
/** Parse a strictly positive decimal counter without unsafe floating-point coercion.
 * @param {string | null} value - Trimmed local counter text, or null when unavailable.
 * @returns {bigint | null} Positive integer counter, or null for malformed/unlimited/zero values.
 */
function positiveBigInt(value: string | null): bigint | null {
  if (value === null || !/^\d+$/.test(value)) {
    return null;
  }
  /** Exact integer candidate before admitting a positive counter. */
  const parsed = BigInt(value);
  return parsed > 0n ? parsed : null;
}
/** Convert bounded-semantic cgroup memory metadata into finite MiB, retaining unavailable/unlimited as null.
 * @param {string | null} value - Trimmed byte counter, or null.
 * @param {boolean} v1 - Whether to apply the existing v1 unlimited sentinel threshold.
 * @returns {number | null} Positive finite MiB, or null; never invents zero available capacity.
 */
function memoryMiB(value: string | null, v1 = false): number | null {
  /** Validated positive byte count; unavailable/unlimited values stay null. */
  const bytes = positiveBigInt(value);
  if (bytes === null || (v1 && bytes >= UNLIMITED_V1)) {
    return null;
  }
  /** Finite MiB conversion checked before publishing advisory metadata. */
  const mb = Number(bytes) / MIB;
  return Number.isFinite(mb) && mb > 0 ? mb : null;
}
/** Inspect fixed local cgroup v2/v1 metadata without shell execution, network work or implicit scale-down decisions.
 * @param {(file: string) => string} readFile - Optional trusted synchronous reader; defaults to native UTF-8 fixed-path reads.
 * @returns {LinuxContainerLimits} Advisory container-wide limits/usage with unknowns retained as null.
 */
export function readLinuxContainerLimits(
  readFile: (file: string) => string = (file: string) =>
    readFileSync(file, 'utf8')
): LinuxContainerLimits {
  /** Readable v2 controller marker, selecting v2 paths when present. */
  const v2 = read('/sys/fs/cgroup/cgroup.controllers', readFile);
  if (v2 !== null) {
    /** Optional quota/period pair; the two-field guard proves both tuple positions exist. */
    const quotaRaw = read('/sys/fs/cgroup/cpu.max', readFile)?.split(/\s+/);
    let cpuQuotaCores: number | null = null;
    if (quotaRaw && quotaRaw.length === 2) {
      /** Positive CPU quota counter, or null for missing/unlimited. */
      const quota = positiveBigInt(quotaRaw[0]!);
      /** Positive CPU accounting period, or null when unavailable. */
      const period = positiveBigInt(quotaRaw[1]!);
      if (quota && period) {
        /** Finite quota/period ratio checked before publishing core units. */
        const value = Number(quota) / Number(period);
        if (Number.isFinite(value) && value > 0) {
          cpuQuotaCores = value;
        }
      }
    }
    return {
      version: 2,
      cpuQuotaCores,
      memoryLimitMiB: memoryMiB(read('/sys/fs/cgroup/memory.max', readFile)),
      memoryUsageMiB: memoryMiB(
        read('/sys/fs/cgroup/memory.current', readFile)
      ),
    };
  }
  /** Optional v1 CPU quota text from a fixed local path. */
  const v1Quota = read('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', readFile);
  /** Optional v1 memory-limit text from a fixed local path. */
  const v1Memory = read(
    '/sys/fs/cgroup/memory/memory.limit_in_bytes',
    readFile
  );
  if (v1Quota === null && v1Memory === null) {
    return {
      version: null,
      cpuQuotaCores: null,
      memoryLimitMiB: null,
      memoryUsageMiB: null,
    };
  }
  /** Positive CPU quota counter, or null for missing/unlimited. */
  const quota = positiveBigInt(v1Quota);
  /** Positive CPU accounting period, or null when unavailable. */
  const period = positiveBigInt(
    read('/sys/fs/cgroup/cpu/cpu.cfs_period_us', readFile)
  );
  /** Advisory v1 quota ratio, retaining missing counters as null. */
  const cpu = quota && period ? Number(quota) / Number(period) : null;
  return {
    version: 1,
    cpuQuotaCores: cpu !== null && Number.isFinite(cpu) && cpu > 0 ? cpu : null,
    memoryLimitMiB: memoryMiB(v1Memory, true),
    memoryUsageMiB: memoryMiB(
      read('/sys/fs/cgroup/memory/memory.usage_in_bytes', readFile)
    ),
  };
}
