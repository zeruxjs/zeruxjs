#!/usr/bin/env node
/** Section 82: reproducible zero-runtime-dependency package and offline consumer test. */
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const project=join(root,'packages/zuix');
const npm=process.platform==='win32'?'npm.cmd':'npm';
const tsc=process.platform==='win32'?'tsc.cmd':'tsc';
function run(bin,args,cwd=root,capture=false){
 const r=spawnSync(bin,args,{cwd,encoding:'utf8',stdio:capture?['ignore','pipe','inherit']:'inherit',timeout:120000});
 if(r.error||r.status!==0)throw new Error(`${bin} ${args.join(' ')} failed: ${r.error?.message??r.status}`);
 return r.stdout??'';
}
run(tsc,['-p','packages/zuix/tsconfig.json','--pretty','false']);
run(process.execPath,['--test',...readdirSync(join(project,'tests')).filter(n=>n.endsWith('.mjs')).map(n=>'packages/zuix/tests/'+n)]);
const tmp=mkdtempSync(join(tmpdir(),'zuix-pack-'));
try{
 const pack=JSON.parse(run(npm,['pack','--ignore-scripts','--json','--pack-destination',tmp],project,true));
 if(pack.length!==1||!pack[0].filename)throw new Error('Invalid npm pack manifest');
 const files=new Set(pack[0].files.map(f=>f.path));
 for(const name of ['dist/index.js','dist/index.d.ts','dist/node.js','dist/node.d.ts','dist/adapters.js','dist/adapters.d.ts','dist/theme.js','dist/theme.d.ts','dist/cli.js'])if(!files.has(name))throw new Error(`Missing tarball entry: ${name}`);
 const consumer=join(tmp,'consumer');mkdirSync(consumer);
 writeFileSync(join(consumer,'package.json'),' {"private":true,"type":"module"}\n');
 run(npm,['install','--offline','--ignore-scripts','--no-audit','--no-fund','--no-package-lock',join(tmp,pack[0].filename)],consumer);
 writeFileSync(join(consumer,'check.mjs'),`import assert from 'node:assert/strict';
import {createZuix,extractClasses,renderZuixStyle} from 'zuix';
import {buildZuix,scanProject} from 'zuix/node';
import {zuixVite} from 'zuix/vite';
import {resolveTheme} from 'zuix/theme';
const css=createZuix({preflight:false}).generate(['p-4']).css;
assert.match(css,/padding:1rem/);
assert(extractClasses('<div class="p-4"></div>').includes('p-4'));
assert.equal(typeof buildZuix,'function');assert.equal(typeof scanProject,'function');
assert.equal(typeof zuixVite,'function');assert.equal(typeof renderZuixStyle,'function');
assert.equal(resolveTheme().screens.md,'768px');
console.log('Zuix zero-dependency packed consumer PASS');
`);
 run(process.execPath,['check.mjs'],consumer);
}finally{rmSync(tmp,{recursive:true,force:true});}
