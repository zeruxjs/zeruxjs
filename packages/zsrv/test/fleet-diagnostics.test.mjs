import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectFleetState } from '../dist/portless/fleet-diagnostics.js';
import { RouteStore } from '../dist/portless/routes.js';
import { createFleetCheckpointWriter, fingerprintFleetConfig } from '../dist/portless/fleet-state.js';
import { processIdentity } from '../dist/portless/lifecycle.js';
const fixture=fn=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-doctor-'));try{return fn(dir)}finally{fs.rmSync(dir,{recursive:true,force:true})}};
test('doctor detects an offline fleet, missing replicas and route drift without mutating anything',()=>fixture(dir=>{
 const host='demo.localhost';const store=new RouteStore(dir);
 const fp=fingerprintFleetConfig(['node','app'],[4100,4101,4102,4103],2,60000);
 const writer=createFleetCheckpointWriter(dir,host,fp,processIdentity(process.pid));
 writer.update({phase:'degraded',hostname:host,desiredReplicas:3,generation:2,replacementAttempts:1,budgetUsed:1,lastError:'test error',
  members:[{port:4100,pid:process.pid,routed:true,healthy:true,failures:0,generation:1}],updatedAt:new Date().toISOString()});
 const result=inspectFleetState(dir,host);
 assert.equal(result.online,false);assert.equal(result.readyReplicas,1);assert.equal(result.desiredReplicas,3);
 assert.equal(result.routePresent,false);
 assert.ok(result.warnings.some(w=>/below desired/.test(w)));
 assert.ok(result.warnings.some(w=>/Route backends/.test(w)));
 assert.equal(store.loadRoutes().length,0);
}));

test('doctor tolerates missing fleet state without inventing online status',()=>fixture(dir=>{
 const r=inspectFleetState(dir,'not-running.localhost');
 assert.equal(r.checkpointPresent,false);assert.equal(r.online,false);assert.equal(r.recoveryRequired,false);
 assert.ok(r.warnings.some(w=>/missing/.test(w)));
}));
