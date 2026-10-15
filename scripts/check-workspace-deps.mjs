#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectWorkspaceLock, syncLocalLock } from './workspace-lock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(a => !['--json', '--sync-local'].includes(a))) {
  console.error('Usage: node scripts/check-workspace-deps.mjs [--json] [--sync-local]');
  process.exit(2);
}
try {
  if (args.includes('--sync-local')) {
    const result = syncLocalLock(root, { write: true });
    if (!args.includes('--json')) console.log(`[deps] ${result.changed ? 'Updated' : 'Verified'} local lock metadata (${result.workspaceCount} packages).`);
  }
  const report = inspectWorkspaceLock(root);
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`[deps] ${report.workspaceCount} local workspaces`);
    if (report.staleWorkspaceMetadata) console.error('[deps] Stale workspace lock entries: run npm run deps:sync-local');
    if (report.unresolvedExternal.length) {
      console.error(`[deps] ${report.unresolvedExternal.length} external packages lack lockfile resolutions:`);
      for (const item of report.unresolvedExternal) console.error(`  ${item.name}: ${item.requiredBy.join(', ')}`);
      console.error('[deps] With registry access, run: npm install --package-lock-only --ignore-scripts && npm ci && npm run deps:check');
    }
    if (report.missingDependencies.length) {
      console.error(`[deps] ${report.missingDependencies.length} required dependency edges are missing from the lockfile:`);
      for (const item of report.missingDependencies.slice(0, 50)) console.error(`  ${item.owner} -> ${item.dependency}`);
      if (report.missingDependencies.length > 50) console.error('  (truncated; use --json for all missing edges)');
    }
    if (report.malformedEntries.length) console.error(`[deps] ${report.malformedEntries.length} malformed external lock entries (version/integrity)`);
    if (report.insecureResolutions.length) console.error(`[deps] ${report.insecureResolutions.length} insecure HTTP dependency downloads`);
    if (report.unresolvedOptional.length) console.warn(`[deps] ${report.unresolvedOptional.length} optional external dependencies lack lock entries`);
    if (report.ok) console.log('[deps] Manifest and lock resolution checks passed (install/build still required).');
    else if (args.includes('--sync-local')) console.warn('[deps] Local metadata is synchronized, but external lock resolutions are not verified. deps:check and CI will still fail.');
  }
  if (!report.ok && !args.includes('--sync-local')) process.exitCode = 1;
} catch (error) {
  console.error(`[deps] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
