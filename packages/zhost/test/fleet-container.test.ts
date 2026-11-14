import test from 'node:test';
import assert from 'node:assert/strict';
import { readLinuxContainerLimits } from '../dist/portless/fleet-container.js';
/** Create a trusted fixed-path synthetic cgroup reader without filesystem or network access.
 * @param {Record<string, string>} files - Explicit fixture values keyed by fixed cgroup paths.
 * @returns {(file: string) => string} Reader throwing ENOENT for missing fixture paths.
 */
const reader =
  (files: Record<string, string>) =>
  (file: string): string => {
    if (!(file in files)) {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }
    /** Resolved fixture content after the explicit missing-file guard. */
    const value = files[file];
    if (value === undefined) {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }
    return value;
  };
test('cgroup v2 quota, usage, max and unlimited values', () => {
  /** Fixed cgroup v2 fixture prefix; never used as a writable path. */
  const root = '/sys/fs/cgroup/';
  /** Observed parsed v2 quota and memory metadata from injected text only. */
  const found = readLinuxContainerLimits(
    reader({
      [root + 'cgroup.controllers']: 'cpu memory',
      [root + 'cpu.max']: '200000 100000',
      [root + 'memory.max']: '1073741824',
      [root + 'memory.current']: '536870912',
    })
  );
  assert.deepEqual(found, {
    version: 2,
    cpuQuotaCores: 2,
    memoryLimitMiB: 1024,
    memoryUsageMiB: 512,
  });
  /** Observed unknown/unlimited capacity, which must stay null rather than zero. */
  const unlimited = readLinuxContainerLimits(
    reader({
      [root + 'cgroup.controllers']: 'cpu memory',
      [root + 'cpu.max']: 'max 100000',
      [root + 'memory.max']: 'max',
    })
  );
  assert.equal(unlimited.cpuQuotaCores, null);
  assert.equal(unlimited.memoryLimitMiB, null);
});
test('cgroup v1 parser refuses unlimited and malformed values', () => {
  /** Fixed cgroup v1 fixture prefix, without accessing a live container. */
  const base = '/sys/fs/cgroup/';
  assert.deepEqual(
    readLinuxContainerLimits(
      reader({
        [base + 'cpu/cpu.cfs_quota_us']: '50000',
        [base + 'cpu/cpu.cfs_period_us']: '100000',
        [base + 'memory/memory.limit_in_bytes']: '9223372036854771712',
        [base + 'memory/memory.usage_in_bytes']: '104857600',
      })
    ),
    {
      version: 1,
      cpuQuotaCores: 0.5,
      memoryLimitMiB: null,
      memoryUsageMiB: 100,
    }
  );
  assert.equal(readLinuxContainerLimits(reader({})).version, null);
});
