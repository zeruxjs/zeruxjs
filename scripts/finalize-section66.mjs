#!/usr/bin/env node
/** One-shot clean release gate. Requires working npm registry access. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalizeWorkspaceRelease } from './workspace-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => !['--keep-on-failure', '--no-write-lock'].includes(arg))) {
  console.error('Usage: npm run section66:finalize -- [--keep-on-failure] [--no-write-lock]');
  process.exitCode = 2;
} else {
  try {
    const result = finalizeWorkspaceRelease(root, {
      keepOnFailure: args.includes('--keep-on-failure'),
      writeLock: !args.includes('--no-write-lock'),
      onStep: name => console.log(`[release] ${name}`),
    });
    console.log(`[release] PASS: ${result.checks.length} release checks; clean lockfile ${result.lockfileWritten ? 'committed' : 'validated only'}`);
  } catch (error) {
    console.error(`[release] BLOCKED: ${error instanceof Error ? error.message : String(error)}`);
    console.error('[release] The original source and package-lock are unchanged when a release check fails.');
    process.exitCode = 1;
  }
}
