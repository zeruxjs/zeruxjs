#!/usr/bin/env node
/** Reproducible bounded in-process stress smoke. NOT a production load or browser benchmark. */
import { performance } from 'node:perf_hooks';
import { createRateLimiter, escapeHtml, serializeCookie, createCsrfProtection } from '../packages/@zeruxjs/security/dist/index.js';

const counts = Object.freeze({ limiter: 80_000, escaping: 50_000, cookie: 30_000, csrf: 5_000 });
const heapStart = process.memoryUsage().heapUsed;
const timings = {};
const run = (label, count, fn) => {
  const start = performance.now();
  for (let i = 0; i < count; i++) fn(i);
  timings[label] = { operations: count, elapsedMs: Math.round((performance.now() - start) * 100) / 100 };
};
const limiter = createRateLimiter({ windowMs: 60_000, max: 20, maxKeys: 512 });
run('limiter', counts.limiter, i => {
  const r = limiter.check(`key-${i % 5_000}`);
  if (typeof r.allowed !== 'boolean' || limiter.size > 512) throw new Error('Limiter exceeded key-space budget');
});
run('escaping', counts.escaping, i => {
  const output = escapeHtml(`<script id="${i}">&'</script>`);
  if (output.includes('<script')) throw new Error('Unsafe escaped HTML');
});
run('cookie', counts.cookie, i => {
  if (!serializeCookie('sess', String(i), { secure: true }).includes('HttpOnly')) throw new Error('Cookie lost HttpOnly');
});
const manager = createCsrfProtection({ secret: 's'.repeat(48) });
run('csrf', counts.csrf, i => {
  const token = manager.issue(`session-${i}`);
  if (!manager.verify(token, `session-${i}`) || manager.verify(token, `other-${i}`)) throw new Error('Invalid session binding');
});
const elapsed = Object.values(timings).reduce((sum, item) => sum + item.elapsedMs, 0);
const memoryChangeMiB = Math.round((process.memoryUsage().heapUsed - heapStart) / 1048576 * 100) / 100;
const budgets = { maxActiveLimiterKeys: 512, maxElapsedMs: 30_000, maxPositiveHeapGrowthMiB: 128 };
const ok = limiter.size <= budgets.maxActiveLimiterKeys && elapsed < budgets.maxElapsedMs && memoryChangeMiB < budgets.maxPositiveHeapGrowthMiB;
const report = { ok, platform: process.platform, node: process.version, benchmark: 'in-process bounded smoke; NOT production load evidence', counts, timings, memoryChangeMiB, activeLimiterKeys: limiter.size, budgets };
console.log(JSON.stringify(report, null, 2));
if (!ok) process.exitCode = 1;
