#!/usr/bin/env node
/** No-publish artifact acceptance: actual npm tarballs in an isolated consumer.
 * This is intentionally stricter than npm pack --dry-run and never synthesizes
 * missing dependencies or treats skipped packages as a full-matrix pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planPublicReleasesFromRoot } from './workspace-release-plan.mjs';
import { discoverWorkspaces } from './workspace-graph.mjs';
import { checkConsumerSelection, checkEntryTargets } from './workspace-public-consumer.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const allowed = /^--only=[@a-z0-9./,_-]+$/;
if (args.length > 1 || (args.length === 1 && !allowed.test(args[0]))) {
  console.error('Usage: node scripts/public-package-consumer.mjs [--only=package-name[,package-name]]');
  process.exit(2);
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const entries = discoverWorkspaces(root);
const plan = planPublicReleasesFromRoot(root);
if (!plan.ok) { console.error('[consumer] Release graph is not publishable'); process.exit(1); }
let selected;
try { selected = checkConsumerSelection(plan, args[0]?.slice('--only='.length)); }
catch (err) { console.error(`[consumer] ${err.message}`); process.exit(2); }
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-public-consumer-'));
const consumer = path.join(temp, 'consumer');
const log = (name, bin, callArgs, cwd, timeout = 180000) => {
  const run = spawnSync(bin, callArgs, { cwd, encoding: 'utf8', timeout, maxBuffer: 5*1024*1024,
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false', npm_config_ignore_scripts: 'true', npm_config_offline: 'true' } });
  if (run.error || run.status !== 0) throw Error(`${name} failed: ${String(run.error?.message ?? run.stderr ?? run.stdout).slice(0, 1000)}`);
  return run.stdout;
};
try {
  fs.mkdirSync(consumer);
  fs.writeFileSync(path.join(consumer,'package.json'), JSON.stringify({ name:'zerux-public-package-consumer',private:true,type:'module' }));
  const tarballs=[];
  for (const name of selected) {
    const {dir,pkg}=entries.get(name);
    const missing=checkEntryTargets(dir,pkg);
    if (missing.length) throw Error(`${name}: missing built entrypoint(s): ${missing.join(', ')}. Build all workspaces first.`);
    const packed = JSON.parse(log(`${name} npm pack`,npm,['pack','--json','--ignore-scripts','--offline','--pack-destination',temp],dir));
    if (packed.length!==1 || !packed[0].filename) throw Error(`${name}: malformed pack report`);
    const tarball=path.join(temp,packed[0].filename);
    if (!fs.statSync(tarball,{throwIfNoEntry:false})?.isFile()) throw Error(`${name}: tarball not produced`);
    tarballs.push(tarball);
  }
  const rootManifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const nodeTypes=rootManifest.devDependencies?.['@types/node'];
  if (!nodeTypes) throw Error('Missing declared @types/node consumer baseline');
  log('isolated offline install',npm,['install','--offline','--no-audit','--no-fund','--ignore-scripts',...tarballs,`@types/node@${nodeTypes}`],consumer,300000);
  const script=`const names=${JSON.stringify(selected)};\n`+
    `import { createRequire } from 'node:module';const req=createRequire(import.meta.url);\n`+
    `for(const name of names){const esm=await import(name);if(!esm||typeof esm!=='object'||Object.keys(esm).length===0)throw Error(name+': empty ESM exports');console.log('PASS import '+name);}\n`;
  fs.writeFileSync(path.join(consumer,'smoke.mjs'),script);
  const results=log('public runtime imports',process.execPath,['smoke.mjs'],consumer);
  process.stdout.write(results);
  // No TypeScript dependency is installed implicitly. Use the workspace-pinned
  // compiler from the clean npm ci, and reject missing compiler artifacts.
  const tsc = path.join(root,'node_modules','typescript','bin','tsc');
  if (!fs.existsSync(tsc)) throw Error('Workspace TypeScript compiler absent: clean npm ci required for declaration consumer check');
  fs.writeFileSync(path.join(consumer,'types.mts'),selected.map((name,i)=>`import * as P${i} from ${JSON.stringify(name)};\nexport type Package${i} = typeof P${i};`).join('\n')+'\n');
  fs.writeFileSync(path.join(consumer,'tsconfig.json'),JSON.stringify({ compilerOptions:{ module:'NodeNext',moduleResolution:'NodeNext',target:'ES2022',strict:true,noEmit:true,skipLibCheck:false,types:[] },files:['types.mts'] }));
  log('isolated TypeScript declaration resolution',process.execPath,[tsc,'-p','tsconfig.json'],consumer);
  console.log(`[consumer] PASS: ${selected.length}/${plan.publicPackages} actual packed package(s) installed, imported and typechecked offline${selected.length===plan.publicPackages?' (FULL CANDIDATE MATRIX)':' (SCOPED; NOT A RELEASE CERTIFICATION)'}`);
} catch (err) {
  console.error(`[consumer] FAIL: ${err.message}`);
  process.exitCode=1;
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
