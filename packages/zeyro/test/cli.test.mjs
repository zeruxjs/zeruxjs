import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {main} from '../dist/bin/cli.js';
test('cli finds nested tests, filters by name and reports failing exit status',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'zeyro-cli-'));mkdirSync(join(dir,'deep'));
 const entry=pathToFileURL(new URL('../dist/index.js',import.meta.url).pathname).href;
 try {
  writeFileSync(join(dir,'deep','sample.test.mjs'),`import {test,expect} from '${entry}';test('works',()=>expect(2).toBe(2));test('fails',()=>expect(2).toBe(3));`);
  writeFileSync(join(dir,'config.json'),JSON.stringify({root:dir,reporter:'tap'}));
  const original=process.stdout.write;let collected='';process.stdout.write=(v)=>{collected+=String(v);return true;};
  try {assert.equal(await main(['--config',join(dir,'config.json'),'--match','works']),0);assert.equal(await main(['--config',join(dir,'config.json')]),1);}
  finally{process.stdout.write=original;}
  assert.match(collected,/TAP version 13/);assert.match(collected,/not ok/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
