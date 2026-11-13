#!/usr/bin/env node
/** Section 78 reusable frontend gate. Requires TypeScript and @types/node installed. */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { executeWorkspacePlan } from './workspace-graph.mjs';
/** Local value for root. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Local value for test env. */
const testEnv = {
  ...process.env,
  ...(process.argv.includes('--browser') ? { RUN_BROWSER_TESTS: '1' } : {}),
};
/**
 * Run the run callback.
 * @param {unknown} bin - Input value for bin.
 * @param {unknown} args - Input value for args.
 * @returns {unknown} Result produced by run.
 * @throws {Error} If the callback rejects or validation fails.
 */
const run = (bin, args) => {
  /** Local value for result. */
  const result = spawnSync(bin, args, {
    cwd: root,
    stdio: 'inherit',
    env: testEnv,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};
/** Local value for builds. */
const builds = new Map(
  ['react', 'vue', 'zyro'].map((pkg) => [
    pkg,
    ['-p', `packages/@zeruxjs/${pkg}/tsconfig.json`, '--pretty', 'false'],
  ])
);
builds.set('accessibility', [
  '--target',
  'ES2022',
  '--module',
  'NodeNext',
  '--moduleResolution',
  'NodeNext',
  '--lib',
  'ES2022,DOM,DOM.Iterable',
  '--strict',
  '--skipLibCheck',
  '--declaration',
  '--outDir',
  'packages/zeruxjs/dist',
  'packages/zeruxjs/src/accessibility.ts',
  '--pretty',
  'false',
]);
/**
 * Title: Compile one independent frontend target.
 * Description: Uses the target package's compiler with shell-free invocation and abort support; outputs are separate for each target.
 * Global Variables: Reads process.execPath and inherited environment; writes the target's build output and inherited console streams.
 * @param {unknown} name Frontend build target.
 * @param {unknown} signal Scheduler cancellation signal.
 * @returns {unknown} Promise resolving when the compiler succeeds.
 */
function compile(name, signal) {
  /** Local value for directory. */
  const directory =
    name === 'accessibility' ? 'packages/zeruxjs' : `packages/@zeruxjs/${name}`;
  /** Local value for compiler. */
  const compiler = createRequire(
    path.join(root, directory, 'package.json')
  ).resolve('typescript/bin/tsc');
  return new Promise((resolve, reject) => {
    /** Local value for child. */
    const child = spawn(process.execPath, [compiler, ...builds.get(name)], {
      cwd: root,
      stdio: 'inherit',
      env: testEnv,
      signal,
    });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${name}: compiler exited ${code}`))
    );
  });
}
// These four targets write separate output files; finish all builds before running tests.
await executeWorkspacePlan(
  {
    ordered: [...builds.keys()],
    dependencies: new Map([...builds.keys()].map((name) => [name, []])),
  },
  {
    run: compile,
    onEvent: (event) => console.log(`[frontend] ${event.type}: ${event.name}`),
  }
);
run(process.execPath, [
  '--test',
  ...['react', 'vue', 'zyro'].flatMap((pkg) =>
    ['advanced', 'integration'].map(
      (test) => `packages/@zeruxjs/${pkg}/test/${test}.test.mjs`
    )
  ),
  'packages/@zeruxjs/react/test/ssr-lifecycle.test.mjs',
  'packages/@zeruxjs/vue/test/vue-scope.test.mjs',
  'packages/@zeruxjs/zyro/test/subscription-scope.test.mjs',
  'packages/zeruxjs/test/accessibility.test.mjs',
  'tests/browser/harness.test.mjs',
  'tests/browser/section78.test.mjs',
]);
