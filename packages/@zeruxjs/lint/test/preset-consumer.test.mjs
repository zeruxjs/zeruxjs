import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(import.meta.url);
const run=(bin,args,cwd)=>execFileSync(bin,args,{cwd,encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024});

test('real prepack archive exposes opt-in configs, verified bundle and optional extractor failure',()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'zerux-lint-consumer-'));
 try{
  const report=JSON.parse(run('npm',['pack','--json','--pack-destination',temporary,'--cache','/tmp/zerux-lint-npm-cache'],root));
  const packed=Array.isArray(report)?report[0]:Object.values(report)[0];
  assert.equal(packed.integrity,'sha512-'+createHash('sha512').update(fs.readFileSync(path.join(temporary,packed.filename))).digest('base64'));
  const installed=path.join(temporary,'node_modules/@zeruxjs/lint');fs.mkdirSync(installed,{recursive:true});
  run('tar',['-xzf',path.join(temporary,packed.filename),'-C',installed,'--strip-components=1'],temporary);
  const manifest=JSON.parse(fs.readFileSync(path.join(installed,'package.json'),'utf8'));
  assert.equal(manifest.scripts.prepack,'node scripts/prepare-stylelint-bundle.mjs && npm run build');assert.equal(manifest.version,'0.0.4');
  const locked=JSON.parse(fs.readFileSync(path.join(installed,'node_modules/braces/package.json'),'utf8'));
  assert.equal(locked.name,'@zklogic/braces');assert.equal(locked.version,'3.0.7');
  const adapter=JSON.parse(fs.readFileSync(path.join(installed,'node_modules/postcss-media-query-parser/package.json'),'utf8'));assert.equal(adapter.name,'@zeruxjs/scss-media-parser');
  for(const name of ['LICENSE-MIT','LICENSE-APACHE'])assert.ok(fs.readFileSync(path.join(installed,'node_modules/postcss-media-query-parser',name),'utf8').length>100);
  for(const name of Object.keys(manifest.dependencies)){
   const target=path.join(installed,'node_modules',name);if(fs.existsSync(target))continue;
   // Borrow actual installed engine packages; the lint package itself is extracted from its real archive.
   const search=require.resolve.paths(name).find(directory=>fs.existsSync(path.join(directory,name,'package.json')));assert.ok(search,name);
   fs.mkdirSync(path.dirname(target),{recursive:true});fs.symlinkSync(path.join(search,name),target,'dir');
  }
  fs.writeFileSync(path.join(temporary,'package.json'),'{"type":"module"}');
  fs.writeFileSync(path.join(temporary,'light.mjs'),`import assert from 'node:assert/strict';import config from '@zeruxjs/lint/presets/package';import {createPackageConfig,createApplicationConfig} from '@zeruxjs/lint/presets';if(!Array.isArray(config)||!Array.isArray(createPackageConfig()))throw Error();await assert.rejects(createApplicationConfig(),{code:'ERR_MODULE_NOT_FOUND'});`);
  run(process.execPath,[path.join(temporary,'light.mjs')],temporary);
  const localeRoot=fileURLToPath(new URL('../../../zlocale',import.meta.url));
  // Actual installed public zlocale exports, with no source-only module specifiers.
  fs.symlinkSync(localeRoot,path.join(temporary,'node_modules/zlocale'),'dir');
  fs.writeFileSync(path.join(temporary,'strict.mjs'),`import assert from 'node:assert/strict';import config from '@zeruxjs/lint/presets/application';import {createApplicationConfig} from '@zeruxjs/lint/presets';const {Linter}=await import(${JSON.stringify(require.resolve('eslint'))});const source="'use client';import 'node:fs';";const messages=new Linter().verify(source,await createApplicationConfig({environment:'browser'}),{filename:'test.js'});assert.ok(messages.some(item=>item.ruleId==='zerux/client-server-import'));assert.ok(Array.isArray(config));`);
  run(process.execPath,[path.join(temporary,'strict.mjs')],temporary);
  const code=fs.readFileSync(path.join(root,'README.md'),'utf8').split('## Opt-in flat-config presets')[1].match(/```ts\n([\s\S]*?)```/)[1];
  fs.writeFileSync(path.join(temporary,'example.ts'),code+`\nimport {createPackageConfig} from '@zeruxjs/lint/presets';\n// @ts-expect-error invalid declared environment\ncreatePackageConfig({environment:'unknown'});\n`);
  fs.writeFileSync(path.join(temporary,'example.mjs'),code);run(process.execPath,[path.join(temporary,'example.mjs')],temporary);
  const nodeTypes=path.dirname(require.resolve('@types/node/package.json'));fs.mkdirSync(path.join(temporary,'node_modules/@types'),{recursive:true});fs.symlinkSync(nodeTypes,path.join(temporary,'node_modules/@types/node'),'dir');
  const eslintRoot=path.dirname(require.resolve('eslint/package.json'));fs.symlinkSync(eslintRoot,path.join(temporary,'node_modules/eslint'),'dir');
  fs.writeFileSync(path.join(temporary,'tsconfig.json'),JSON.stringify({compilerOptions:{module:'NodeNext',moduleResolution:'NodeNext',target:'ES2022',strict:true,noEmit:true,skipLibCheck:true,types:['node']},include:['example.ts']}));
  run(process.execPath,[require.resolve('typescript/bin/tsc'),'-p',path.join(temporary,'tsconfig.json')],temporary);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
