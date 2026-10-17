import test from 'node:test';
import assert from 'node:assert/strict';
import { readLinuxContainerLimits } from '../dist/portless/fleet-container.js';
const reader = files => file => { if (!(file in files)) throw Object.assign(new Error('ENOENT'), { code:'ENOENT' }); return files[file]; };
test('cgroup v2 quota, usage, max and unlimited values', () => {
 const root = '/sys/fs/cgroup/';
 const found = readLinuxContainerLimits(reader({
  [root+'cgroup.controllers']:'cpu memory',
  [root+'cpu.max']:'200000 100000',
  [root+'memory.max']:'1073741824',
  [root+'memory.current']:'536870912',
 }));
 assert.deepEqual(found,{version:2,cpuQuotaCores:2,memoryLimitMiB:1024,memoryUsageMiB:512});
 const unlimited = readLinuxContainerLimits(reader({[root+'cgroup.controllers']:'cpu memory',[root+'cpu.max']:'max 100000',[root+'memory.max']:'max'}));
 assert.equal(unlimited.cpuQuotaCores,null);assert.equal(unlimited.memoryLimitMiB,null);
});
test('cgroup v1 parser refuses unlimited and malformed values', () => {
 const base='/sys/fs/cgroup/';
 assert.deepEqual(readLinuxContainerLimits(reader({
   [base+'cpu/cpu.cfs_quota_us']:'50000', [base+'cpu/cpu.cfs_period_us']:'100000',
   [base+'memory/memory.limit_in_bytes']:'9223372036854771712',
   [base+'memory/memory.usage_in_bytes']:'104857600',
 })),{version:1,cpuQuotaCores:0.5,memoryLimitMiB:null,memoryUsageMiB:100});
 assert.equal(readLinuxContainerLimits(reader({})).version,null);
});
