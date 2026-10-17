import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendFleetHistory, readFleetHistory, fleetHistoryPath } from '../dist/portless/fleet-events.js';
import { createFleetCheckpointWriter, readFleetCheckpoint, fingerprintFleetConfig } from '../dist/portless/fleet-state.js';
import { processIdentity } from '../dist/portless/lifecycle.js';
import { ensureControlDirectory } from '../dist/portless/local-control.js';

const fixture=fn=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-events-'));try{return fn(dir)}finally{fs.rmSync(dir,{recursive:true,force:true})}};
test('fleet history is bounded, private and prunes old entries',()=>fixture(dir=>{
 const e={kind:'scale',message:'3 -> 4',desiredReplicas:4,generation:8};
 for(let i=0;i<125;i++)appendFleetHistory(dir,'api.localhost',e,Date.now()-125000+i*1000);
 const history=readFleetHistory(dir,'api.localhost');
 assert.equal(history.length,100);
 assert.equal(new Set(history.map(item=>item.id)).size,100);
 assert.equal(fs.statSync(fleetHistoryPath(dir,'api.localhost')).mode & 0o077,0);
 appendFleetHistory(dir,'api.localhost',e,Date.now()+1000);
 assert.equal(readFleetHistory(dir,'api.localhost').length,100);
}));

test('fleet history rejects unsafe symlinks, invalid records and traversal',()=>fixture(dir=>{
 assert.throws(()=>readFleetHistory(dir,'../evil'),/Invalid/);
 ensureControlDirectory(dir,true);
 const file=fleetHistoryPath(dir,'api.localhost');
 fs.symlinkSync('/etc/passwd',file);
 assert.throws(()=>readFleetHistory(dir,'api.localhost'),/Unsafe/);
 assert.throws(()=>appendFleetHistory(dir,'api.localhost',{kind:'scale',message:'ok',desiredReplicas:2,generation:1}),/Unsafe/);
 fs.unlinkSync(file);fs.writeFileSync(file,'not json',{mode:0o600});
 assert.throws(()=>readFleetHistory(dir,'api.localhost'),/JSON|Unexpected/);
}));

test('checkpoint restores desired replica counts, retry timestamps and paused policy',()=>fixture(dir=>{
 const hostname='api.localhost'; const fp=fingerprintFleetConfig(['node','app'],[4100,4101,4102,4103],2,60000);
 const own=processIdentity(process.pid);assert.ok(own);
 const writer=createFleetCheckpointWriter(dir,hostname,fp,own);
 const state={phase:'running',hostname,desiredReplicas:3,generation:3,replacementAttempts:0,budgetUsed:0,lastError:null,members:[],updatedAt:new Date().toISOString()};
 writer.update(state);
 writer.attempt([Date.now()]);
 writer.setAutoscale({paused:true,lastScaledAt:Date.now()-100});
 const restored=createFleetCheckpointWriter(dir,hostname,fp,own);
 assert.equal(restored.restoredReplicas,3);
 assert.equal(restored.restoredAutoscale.paused,true);
 assert.equal(restored.restoredAttempts.length,1);
 assert.equal(readFleetCheckpoint(dir,hostname).autoscale.paused,true);
}));

test('invalid event content is rejected without corrupting prior history',()=>fixture(dir=>{
 const good={kind:'start',message:'starting',desiredReplicas:2,generation:1};
 appendFleetHistory(dir,'app.localhost',good);
 assert.throws(()=>appendFleetHistory(dir,'app.localhost',{...good,message:'x'.repeat(2000)}),/Invalid/);
 assert.equal(readFleetHistory(dir,'app.localhost').length,1);
}));
