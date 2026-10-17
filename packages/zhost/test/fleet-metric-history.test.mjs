import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FleetMetricHistory,readFleetMetricHistory,fleetMetricHistoryPath } from '../dist/portless/fleet-metric-history.js';
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'fleet-history-'));
test('metrics persist privately, survive restarts, and throttle writes',()=>{
 const dir=temp(),hostname='history.localhost';
 try{
  const now=Date.now()-35000, point={sampledAt:now,metric:'cpu',value:35,desiredReplicas:2,downscaleAllowed:true};
  const writer=new FleetMetricHistory(dir,hostname);
  assert.equal(writer.record(point,now),true);
  assert.equal(writer.record({...point,sampledAt:now+1000},now+1000),false);
  assert.equal(new FleetMetricHistory(dir,hostname).record({...point,sampledAt:now+31000},now+31000),true);
  assert.equal(readFleetMetricHistory(dir,hostname,now+31000).length,2);
  assert.equal(fs.statSync(fleetMetricHistoryPath(dir,hostname)).mode & 0o077,0);
  assert.deepEqual(readFleetMetricHistory(dir,hostname,now+2*24*60*60*1000),[]);

 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('symlinks and invalid metric history are refused rather than overwritten',()=>{
 const dir=temp(),hostname='history.localhost';
 try{
  const file=fleetMetricHistoryPath(dir,hostname);fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.symlinkSync('/etc/passwd',file);assert.throws(()=>readFleetMetricHistory(dir,hostname),/Unsafe/);
  assert.throws(()=>new FleetMetricHistory(dir,hostname),/Unsafe/);
  fs.unlinkSync(file);fs.writeFileSync(file,'not JSON',{mode:0o600});
  assert.throws(()=>readFleetMetricHistory(dir,hostname));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
