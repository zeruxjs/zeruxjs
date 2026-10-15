import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createGenerationRegistry, generationRecordPath, readGenerationRecord} from '../dist/portless/generation-registry.js';
import {inspectRollingControllers, reconcileRollingControllers} from '../dist/portless/rolling-reconciler.js';

const fixture=()=>fs.mkdtempSync(path.join(os.tmpdir(),'zsrv-reconcile-'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitUntil(fn,timeout=4000){const limit=Date.now()+timeout;while(Date.now()<limit){if(await fn())return;await delay(30);}throw new Error('Timed out');}

// Force a supervisor crash while preserving its recorded child.
async function spawnOrphan(state,name){
 const moduleURL=new URL('../dist/portless/generation-registry.js',import.meta.url).href;
 const code=`import {spawn} from 'node:child_process';\nimport {createGenerationRegistry} from ${JSON.stringify(moduleURL)};\nconst reg=createGenerationRegistry(${JSON.stringify(state)},${JSON.stringify(name)});\nconst child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});\nreg.track(child.pid,4400);\nconsole.log(child.pid);\nsetInterval(()=>{},1000);`;
 const owner=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe']});
 let stdout=''; owner.stdout.on('data',value=>stdout+=value.toString());
 await waitUntil(()=>Number(stdout.trim())>1);
 const pid=Number(stdout.trim());
 owner.kill('SIGKILL');
 await new Promise(resolve=>owner.once('exit',resolve));
 return {pid,owner};
}

test('bulk reconciliation reports live controllers, refuses overwrite of unverified records',async()=>{
 const state=fixture();
 try {
  const registry=createGenerationRegistry(state,'active.localhost');
  assert.deepEqual(inspectRollingControllers(state).map(x=>[x.hostname,x.state]),[['active.localhost','live']]);
  const report=await reconcileRollingControllers(state);
  assert.deepEqual([report.scanned,report.recovered,report.failed],[1,0,0]);
  assert.ok(readGenerationRecord(state,'active.localhost'));
  registry.close();
  const invalid=generationRecordPath(state,'broken.localhost');
  fs.symlinkSync('/etc/passwd',invalid);
  const preview=inspectRollingControllers(state);
  assert.equal(preview[0].state,'invalid');
  assert.equal((await reconcileRollingControllers(state)).failed,1);
  assert.throws(()=>inspectRollingControllers(state,0),/maxRecords/);
 }finally {fs.rmSync(state,{recursive:true,force:true});}
});

test('reconcile dry-run does not terminate orphans; real reconciliation cleans verified child', {timeout:16000},async()=>{
 const state=fixture(); let fixtureProcess;
 try {
  fixtureProcess=await spawnOrphan(state,'crashed.localhost');
  const preview=await reconcileRollingControllers(state,{dryRun:true});
  assert.equal(preview.recovered,0);
  assert.equal(preview.items[0].state,'recoverable');
  assert.deepEqual(preview.items[0].recovery.wouldTerminate,[fixtureProcess.pid]);
  const live=await reconcileRollingControllers(state,{waitMs:2500});
  assert.equal(live.recovered,1);
  assert.deepEqual(live.items[0].recovery.terminated,[fixtureProcess.pid]);
  assert.equal(inspectRollingControllers(state).length,0);
 }finally {
  if(fixtureProcess){try{process.kill(-fixtureProcess.pid,'SIGKILL');}catch{}}
  fs.rmSync(state,{recursive:true,force:true});
 }
});
