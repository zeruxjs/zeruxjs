#!/usr/bin/env node
/** Section 80 gate: package builds, existing package regressions and content workflow. */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/** Local value for root. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Local value for packages. */
const packages = [
  'files',
  'media',
  'asset-manager',
  'ai',
  'ai-model',
  'search',
  'seo',
  'feed',
  'font',
  'share',
  'performance',
  'validator',
  'security',
];
/** Perform the run operation.
 * @param {unknown} args - Input value for args.
 * @param {unknown} timeout - Input value for timeout.
 * @returns {unknown} Result produced by run.
 */
function run(args, timeout) {
  /** Local value for result. */
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    timeout,
  });
  if (result.error || result.status !== 0) {
    console.error(
      `[ecosystem] ${args.join(' ')} failed: ${result.error?.message ?? result.status}`
    );
    process.exit(1);
  }
}
if (process.argv.slice(2).some((arg) => arg !== '--offline')) {
  console.error('Usage: test-ecosystem.mjs [--offline]');
  process.exit(2);
}
// Offline mode is a targeted LOCAL gate, not a substitute for S3 and cloud providers.
/** Local value for offline. */
const offline = process.argv.includes('--offline');
run(
  [
    'scripts/build-workspaces.mjs',
    ...packages.flatMap((pkg) => ['--scope', `@zeruxjs/${pkg}`]),
    '--verify',
  ],
  1_200_000
);
for (const pkg of packages) {
  /** Local value for directory. */
  const directory = path.join(root, 'packages/@zeruxjs', pkg, 'test');
  /** Local value for tests. */
  const tests = readdirSync(directory)
    .filter(
      (file) =>
        /\.test\.(?:cjs|mjs)$/.test(file) &&
        (!offline || !(pkg === 'files' && file === 'aws-s3.test.mjs'))
    )
    .sort()
    .map((file) => `packages/@zeruxjs/${pkg}/test/${file}`);
  if (tests.length) {
    run(['--test', ...tests], 300_000);
  }
}
run(
  ['--test', 'tests/integration/section80-content-workflow.test.mjs'],
  180_000
);
console.log(
  `[ecosystem] Passed ${packages.length} package suites and the content workflow (${offline ? 'local-only' : 'SDK-dependent'} gate).`
);
