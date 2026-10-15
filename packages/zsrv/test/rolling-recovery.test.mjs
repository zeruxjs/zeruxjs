import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {
 createGenerationRegistry, readGenerationRecord, generationRecordPath,
 recoverRollingGenerationsLocked
} from '../dist/portless/generation-registry.js';
import { createDeploymentHistory, readDeploymentHistory, pruneDeploymentHistory } from '../dist/portless/deployment-history.js';
import { RouteStore } from '../dist/portless/routes.js';
import { processIdentity } from '../dist/portless/lifecycle.js';
import { launchSupervisedCommand } from '../dist/portless/process-supervisor.js';
const delay = ms => new Promise(r => setTimeout(r, ms));
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zsrv-recovery-'));
const alive = pid => { try {process.kill(pid,0);return true;}catch{return false;} };
async function waitFor(check, timeout=5000) {const deadline=Date.now()+timeout;while(Date.now()<deadline){if(check())return;await delay(25);}throw Error('Timed out waiting for process');}

// The detached child and its tracking state are deliberately owned by a process
// that will be SIGKILLed, simulating a hard crash rather than normal shutdown.
async function crashFixture(state, name, port=4300) {
 const moduleURL = new URL('../dist/portless/generation-registry.js', import.meta.url).href;
 const workerCode = `import {spawn} from 'node:child_process';
 import {createGenerationRegistry} from ${JSON.stringify(moduleURL)};
 const reg=createGenerationRegistry(${JSON.stringify(state)},${JSON.stringify(name)});
 const child=spawn(process.execPath,['-e', 'setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
 reg.track(child.pid, ${port});
 console.log(child.pid);
 setInterval(()=>{},1000);`;
 const owner=spawn(process.execPath,['--input-type=module','-e',workerCode],{stdio:['ignore','pipe','pipe']});
 let output='';owner.stdout.on('data',b=>output+=b.toString());
 await waitFor(()=>Number.isInteger(Number(output.trim())) && Number(output.trim())>1);
 return {owner, pid:Number(output.trim()), async crash(){owner.kill('SIGKILL');await new Promise(r=>owner.once('exit',r));}};
}

test('crashed controller can recover identified detached child without leaving a route', {timeout:20000}, async()=>{
 const state=dir();let fixture;
 try {
  fixture=await crashFixture(state,'orphan.localhost');
  const record=readGenerationRecord(state,'orphan.localhost');
  assert.equal(record.children[0].pid,fixture.pid);
  assert.equal(record.owner.pid,fixture.owner.pid);
  await fixture.crash();
  const preview=await recoverRollingGenerationsLocked(state,'orphan.localhost',{dryRun:true});
  assert.equal(preview.dryRun,true);
  assert.deepEqual(preview.wouldTerminate,[fixture.pid]);
  assert.ok(readGenerationRecord(state,'orphan.localhost'));
  const result=await recoverRollingGenerationsLocked(state,'orphan.localhost',{waitMs:2500});
  assert.equal(result.recovered,true);
  assert.deepEqual(result.terminated,[fixture.pid]);
  assert.equal(readGenerationRecord(state,'orphan.localhost'),null);
  assert.equal((await recoverRollingGenerationsLocked(state,'orphan.localhost')).recovered,false);
 }finally{
  fixture?.owner.kill('SIGKILL');
  if(fixture?.pid && alive(fixture.pid)) {try{process.kill(-fixture.pid,'SIGKILL');}catch{}}
  fs.rmSync(state,{recursive:true,force:true});
 }
});

test('recovery refuses live controllers and refuses unverifiable files',async()=>{
 const state=dir();
 try {
  const tracker=createGenerationRegistry(state,'live.localhost');
  await assert.rejects(recoverRollingGenerationsLocked(state,'live.localhost'),/still running/);
  assert.equal(tracker.close(),true);
  const file=generationRecordPath(state,'live.localhost');
  fs.symlinkSync('/etc/passwd',file);
  assert.throws(()=>readGenerationRecord(state,'live.localhost'),/Unsafe/);
 }finally{fs.rmSync(state,{recursive:true,force:true});}
});

test('unidentifiable PID is never signalled; reused PID fingerprint is ignored', {timeout:20000},async()=>{
 const state=dir();let fixture;
 try {
  fixture=await crashFixture(state,'reused.localhost');
  await fixture.crash();
  const file=generationRecordPath(state,'reused.localhost');
  const doc=readGenerationRecord(state,'reused.localhost');
  doc.children[0].identity='linux:0';
  fs.writeFileSync(file,JSON.stringify(doc),{mode:0o600});
  const result=await recoverRollingGenerationsLocked(state,'reused.localhost');
  assert.deepEqual(result.alreadyExited,[fixture.pid]);
  assert.ok(alive(fixture.pid));
 }finally{
  if(fixture?.pid && alive(fixture.pid)) {try{process.kill(-fixture.pid,'SIGKILL');}catch{}}
  fs.rmSync(state,{recursive:true,force:true});
 }
});

test('supervisor aborts startup and reaps child when the persistence hook fails',{timeout:10000},async()=>{
 let pid;
 await assert.rejects(launchSupervisedCommand([process.execPath,'-e','setInterval(()=>{},1000)'],{
  stdio:'ignore',shutdownTimeoutMs:1000,
  onSpawn(child){pid=child.pid;throw Error('persistence unavailable');}
 }),/persistence unavailable/);
 assert.ok(pid);await delay(50);
 // PID can remain a zombie momentarily; its identity must no longer be running.
 assert.equal(processIdentity(pid),null);
});

test('history compaction prunes old entries, bounds count and retains latest status',()=>{
 const state=dir();
 try {
  const status={phase:'running',generation:1,port:4300,pid:process.pid,previousPort:null,updatedAt:new Date().toISOString()};
  const book=createDeploymentHistory(state,'retention.localhost',status,{days:365,maxEvents:50});
  for(let i=0;i<5;i++)book.record('deployed',{fromPort:4300,toPort:4301});
  const before=readDeploymentHistory(state,'retention.localhost');
  assert.equal(before.history.length,5);
  const result=pruneDeploymentHistory(state,'retention.localhost',{days:30,maxEvents:2});
  assert.deepEqual(result,{hostname:'retention.localhost',removed:3,remaining:2});
  assert.equal(readDeploymentHistory(state,'retention.localhost').status.port,4300);
  assert.equal(pruneDeploymentHistory(state,'retention.localhost',{days:0,maxEvents:0}).remaining,0);
  assert.throws(()=>pruneDeploymentHistory(state,'retention.localhost',{days:-1}),/retention/);
  assert.throws(()=>pruneDeploymentHistory(state,'retention.localhost',{maxEvents:51}),/retention/);
 }finally{fs.rmSync(state,{recursive:true,force:true});}
});


test('recovery cannot delete a route registered by a newer owner', {timeout:20000}, async()=>{
 const state=dir();let fixture;
 try {
  fixture=await crashFixture(state,'replace.localhost');
  const prior=new RouteStore(state).registerRoute('replace.localhost',4300,fixture.owner.pid);
  const record=readGenerationRecord(state,'replace.localhost');
  record.leaseId=prior.leaseId;
  fs.writeFileSync(generationRecordPath(state,'replace.localhost'),JSON.stringify(record),{mode:0o600});
  await fixture.crash();
  const newer=new RouteStore(state).registerRoute('replace.localhost',4500,process.pid,true);
  const report=await recoverRollingGenerationsLocked(state,'replace.localhost',{waitMs:1500});
  assert.equal(report.recovered,true);
  assert.equal(report.routeRemoved,false);
  assert.equal(new RouteStore(state).loadRoutes()[0].port,4500);
  newer.release();
 }finally{
  if(fixture?.pid && alive(fixture.pid)) {try{process.kill(-fixture.pid,'SIGKILL');}catch{}}
  fs.rmSync(state,{recursive:true,force:true});
 }
});

test('untracked child cannot be hidden by a premature registry close',async()=>{
 const state=dir();let child;
 try {
  const tracker=createGenerationRegistry(state,'close.localhost');
  child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
  await waitFor(()=>processIdentity(child.pid)!==null);
  tracker.track(child.pid,4300);
  assert.throws(()=>tracker.close(),/tracked children/);
  assert.ok(readGenerationRecord(state,'close.localhost'));
  child.kill('SIGTERM');
  await new Promise(r=>child.once('close',r));
  tracker.untrack(child.pid);
  assert.equal(tracker.close(),true);
 }finally{
  if(child?.pid && alive(child.pid)) {try{process.kill(-child.pid,'SIGKILL');}catch{}}
  fs.rmSync(state,{recursive:true,force:true});
 }
});
