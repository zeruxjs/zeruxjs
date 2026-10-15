import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRunner,validateConfig} from '../dist/index.js';
import {main} from '../dist/bin/cli.js';

test('bail invokes nested suite afterAll hooks exactly once for started suites',async()=>{
 const runner=createRunner(),events=[];
 runner.describe('outer',()=>{
  runner.beforeAll(()=>events.push('beforeAll'));
  runner.afterAll(()=>events.push('outerDone'));
  runner.describe('inner',()=>{
   runner.afterAll(()=>events.push('innerDone'));
   runner.test('fail',()=>{throw new Error('intentional')});
   runner.test('skipped by bail',()=>assert.fail('must not execute'));
  });
 });
 const summary=await runner.runTests({bail:true});
 assert.equal(summary.failed,1);assert.equal(summary.skipped,1);
 assert.deepEqual(events,['beforeAll','innerDone','outerDone']);
});
test('failure in emergency afterAll reports a failed cleanup and never reports green',async()=>{
 const runner=createRunner();runner.afterAll(()=>{throw new Error('cleanup failed')});
 runner.test('fails',()=>{throw new Error('test failed')});runner.test('skipped',()=>{});
 const summary=await runner.runTests({bail:true});
 assert.equal(summary.failed,2);assert.ok(summary.results.some(r=>r.name.startsWith('afterAll') && r.error.message==='cleanup failed'));
});
test('CLI fails on empty discovery, absent values, invalid reporter; config root resolves relative to config',async()=>{
 const root=mkdtempSync(join(tmpdir(),'zeyro-sec79-'));const old=process.stderr.write,oldOut=process.stdout.write;
 let errors='';process.stderr.write=(v)=>{errors+=String(v);return true;};process.stdout.write=()=>true;
 try {
  mkdirSync(join(root,'tests'));writeFileSync(join(root,'zeyro.json'),JSON.stringify({root:'tests',files:['**/*.test.mjs'],reporter:'json'}));
  assert.equal(await main(['--config',join(root,'zeyro.json')]),2);
  assert.match(errors,/No test files/);
  assert.equal(await main(['--timeout','wat']),2);
  writeFileSync(join(root,'tests','one.test.mjs'),"export const harmless = true;\n");
  assert.equal(await main(['--config',join(root,'zeyro.json')]),2);
  assert.match(errors,/No registered test cases/);
  assert.equal(await main(['--reporter','invalid']),2);
  assert.equal(await main(['--config']),2);
  assert.throws(()=>validateConfig({throwOnFailure:'yes'}),/Invalid throwOnFailure/);
  assert.throws(()=>validateConfig({timeoutMs:999999999}),/Timeout exceeds/);
  assert.throws(()=>validateConfig({retries:101}),/Invalid retries/);
 } finally {process.stderr.write=old;process.stdout.write=oldOut;rmSync(root,{recursive:true,force:true});}
});
