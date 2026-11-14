#!/usr/bin/env node
/** Section 81 standalone ZyroJS offline gate: TypeScript, unit/DOM tests, bridge, tarball imports. */
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { npmCommand } from './npm-command.ts';
/** Local value for root. */
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
/** Local value for project. */
const project = join(root, 'packages/zyrojs');
/** Local value for npm. */
const npm = 'npm';
/** Local value for require. */
const require = createRequire(import.meta.url);
/** Perform the run operation.
 * @param {unknown} bin - Input value for bin.
 * @param {unknown} args - Input value for args.
 * @param {unknown} cwd - Input value for cwd.
 * @param {unknown} capture - Input value for capture.
 * @returns {unknown} Result produced by run.
 */
function run(bin, args, cwd = root, capture = false) {
  /** Local value for invocation. */
  const invocation = bin === npm ? npmCommand(args) : { command: bin, args };
  /** Local value for result. */
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${bin} ${args.join(' ')} exited ${result.status}`);
  }
  return result.stdout ?? '';
}
if (!process.argv.includes('--consumer-only')) {
  run(process.execPath, [
    'scripts/build-workspaces.ts',
    '--scope',
    'zyrojs',
    '--scope',
    '@zeruxjs/zyro',
    '--verify',
  ]);
  run(process.execPath, [
    '--test',
    ...readdirSync(join(project, 'test'))
      .filter((name) => name.endsWith('.test.ts'))
      .map((name) => `packages/zyrojs/test/${name}`),
  ]);
  run(process.execPath, [
    '--test',
    'packages/@zeruxjs/zyro/test/advanced.test.ts',
    'packages/@zeruxjs/zyro/test/integration.test.ts',
    'packages/@zeruxjs/zyro/test/subscription-scope.test.ts',
  ]);
}
/** Local value for temp. */
const temp = mkdtempSync(join(tmpdir(), 'zyrojs-release-'));
try {
  /** Local value for report. */
  const report = JSON.parse(
    run(
      npm,
      ['pack', '--ignore-scripts', '--json', '--pack-destination', temp],
      project,
      true
    )
  );
  /** Local value for pack. */
  const pack = Array.isArray(report) ? report : Object.values(report);
  if (!Array.isArray(pack) || pack.length !== 1 || !pack[0].filename) {
    throw new Error('Invalid npm pack manifest');
  }
  /** Local value for paths. */
  const paths = new Set(pack[0].files.map((file) => file.path));
  for (const name of [
    'dist/index.js',
    'dist/index.d.ts',
    'dist/dom/index.js',
    'dist/dom/index.d.ts',
    'dist/network/index.js',
    'dist/network/index.d.ts',
  ]) {
    if (!paths.has(name)) {
      throw new Error(`Missing tarball entry: ${name}`);
    }
  }
  /** Local value for consumer. */
  const consumer = join(temp, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, 'package.json'),
    '{"type":"module","private":true}\n'
  );
  /** Local value for dependencies. */
  const dependencies = [];
  for (const directory of [
    resolve(
      dirname(fileURLToPath(import.meta.resolve('@zeruxjs/security/encoding'))),
      '..'
    ),
    dirname(require.resolve('jose/package.json')),
  ]) {
    /** Local value for packed. */
    const packed = JSON.parse(
      run(
        npm,
        ['pack', '--ignore-scripts', '--json', '--pack-destination', temp],
        directory,
        true
      )
    );
    dependencies.push(
      join(
        temp,
        (Array.isArray(packed) ? packed : Object.values(packed))[0].filename
      )
    );
  }
  run(
    npm,
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      join(temp, pack[0].filename),
      ...dependencies,
    ],
    consumer
  );
  /** Local value for check. */
  const check = `import assert from 'node:assert/strict';
import {signal,effect,h,renderToString} from 'zyrojs';
import {renderToString as domSsr} from 'zyrojs/dom';
import {createRemoteResource} from 'zyrojs/network';
const value=signal(1);let count=0;const stop=effect(()=>{value.value;count++});value.value=2;stop();value.value=3;
assert.equal(count,2);assert.equal(domSsr(h('p',{},'<x>')),'<p>&lt;x&gt;</p>');
assert.equal(renderToString(h('p',{},'ok')),'<p>ok</p>');assert.equal(typeof createRemoteResource,'function');
console.log('ZyroJS packed standalone consumer PASS');`;
  writeFileSync(join(consumer, 'check.ts'), check);
  run(process.execPath, ['--experimental-strip-types', 'check.ts'], consumer);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
