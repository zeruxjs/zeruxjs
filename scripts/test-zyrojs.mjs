#!/usr/bin/env node
/** Section 81 standalone ZyroJS offline gate: TypeScript, unit/DOM tests, bridge, tarball imports. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const project = join(root, 'packages/zyrojs');
const tsc = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(bin, args, cwd = root, capture = false) {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${bin} ${args.join(' ')} exited ${result.status}`);
  return result.stdout ?? '';
}
run(tsc, ['-p', 'packages/zyrojs/tsconfig.json', '--pretty', 'false']);
run(process.execPath, ['--test', ...readdirSync(join(project, 'test')).filter(name => name.endsWith('.test.mjs')).map(name => `packages/zyrojs/test/${name}`)]);
run(tsc, ['-p', 'packages/@zeruxjs/zyro/tsconfig.json', '--pretty', 'false']);
run(process.execPath, ['--test',
  'packages/@zeruxjs/zyro/test/advanced.test.mjs',
  'packages/@zeruxjs/zyro/test/integration.test.mjs',
  'packages/@zeruxjs/zyro/test/section78-scope.test.mjs']);
const temp = mkdtempSync(join(tmpdir(), 'zyrojs-release-'));
try {
  const pack = JSON.parse(run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], project, true));
  if (!Array.isArray(pack) || pack.length !== 1 || !pack[0].filename) throw new Error('Invalid npm pack manifest');
  const paths = new Set(pack[0].files.map(file => file.path));
  for (const name of ['dist/index.js', 'dist/index.d.ts', 'dist/dom/index.js', 'dist/dom/index.d.ts', 'dist/network/index.js', 'dist/network/index.d.ts']) {
    if (!paths.has(name)) throw new Error(`Missing tarball entry: ${name}`);
  }
  const consumer = join(temp, 'consumer'); mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), '{"type":"module","private":true}\n');
  run(npm, ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', join(temp, pack[0].filename)], consumer);
  const check = `import assert from 'node:assert/strict';
import {signal,effect,h,renderToString} from 'zyrojs';
import {renderToString as domSsr} from 'zyrojs/dom';
import {createRemoteResource} from 'zyrojs/network';
const value=signal(1);let count=0;const stop=effect(()=>{value.value;count++});value.value=2;stop();value.value=3;
assert.equal(count,2);assert.equal(domSsr(h('p',{},'<x>')),'<p>&lt;x&gt;</p>');
assert.equal(renderToString(h('p',{},'ok')),'<p>ok</p>');assert.equal(typeof createRemoteResource,'function');
console.log('ZyroJS packed standalone consumer PASS');`;
  writeFileSync(join(consumer, 'check.mjs'), check);
  run(process.execPath, ['check.mjs'], consumer);
} finally { rmSync(temp, { recursive: true, force: true }); }
