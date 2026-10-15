#!/usr/bin/env node
/** Real offline npm-pack consumer for independent foundation packages.
 * The caller MUST build each package first; this deliberately never fakes dist.
 * No publication, registry access or lockfile modification is performed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = ['cache', 'db', 'hooks', 'security'];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-foundations-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(bin, args, cwd) {
  const child = spawnSync(bin, args, {
    cwd, encoding: 'utf8', timeout: 90_000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_ignore_scripts: 'true' }
  });
  if (child.error || child.status !== 0) throw new Error(`${bin} ${args[0]} failed: ${String(child.error?.message ?? child.stderr ?? child.stdout).slice(0, 500)}`);
  return child.stdout.trim();
}
try {
  const consumer = path.join(tmp, 'consumer'); fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer, 'package.json'), '{"name":"zerux-foundation-consumer","private":true,"type":"module"}\n');
  const tarballs = [];
  for (const name of names) {
    const dir = path.join(root, 'packages', '@zeruxjs', name);
    if (!fs.existsSync(path.join(dir, 'dist', 'index.js')) || !fs.existsSync(path.join(dir, 'dist', 'index.d.ts'))) {
      throw new Error(`${name}: build outputs missing; build the package before running the consumer test`);
    }
    const tarball = run(npm, ['pack', '--ignore-scripts', '--offline', '--pack-destination', tmp], dir).split(/\r?\n/).at(-1);
    if (!tarball || !fs.existsSync(path.join(tmp, tarball))) throw new Error(`${name}: npm pack produced no tarball`);
    tarballs.push(path.join(tmp, tarball));
  }
  run(npm, ['install', '--offline', '--no-audit', '--no-fund', '--ignore-scripts', ...tarballs], consumer);
  const test = `const names=${JSON.stringify(names)};\n` +
    `import { createRequire } from 'node:module'; const req=createRequire(import.meta.url);\n` +
    `for (const name of names) { const id='@zeruxjs/'+name; const esm=await import(id); if(!Object.keys(esm).length) throw Error(id+' ESM has no exports'); if(['cache','db'].includes(name)){const cjs=req(id);if(!Object.keys(cjs).length)throw Error(id+' CJS has no exports');} console.log('PASS '+id); }\n`;
  fs.writeFileSync(path.join(consumer, 'index.mjs'), test);
  const stdout = run(process.execPath, ['index.mjs'], consumer);
  console.log(stdout);
  console.log('[consumer] PASS: four independently packed foundations installed and loaded offline via their declared ESM/CJS entry points');
} catch (error) {
  console.error(`[consumer] FAIL: ${error.message}`);
  process.exitCode = 1;
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
