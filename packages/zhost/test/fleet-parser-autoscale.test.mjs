import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFleetRunArguments } from '../dist/bin/parse-fleet.js';
const basic=['--name','api','--ports','4100,4101,4102,4103','--replicas','2'];
test('CLI accepts autoscale configuration and passes child args through verbatim',()=>{
 const r=parseFleetRunArguments([...basic,'--autoscale','--min-replicas','2','--max-replicas','3',
  '--scale-up-rps','20.5','--scale-down-rps','3','--scale-cooldown','0','--scale-samples','2',
  '--scale-interval','500','--scale-window','1000','--','node','a.js','--flag','--last']);
 assert.equal(r.autoscale.enabled,true);assert.equal(r.autoscale.maxReplicas,3);
 assert.equal(r.autoscale.scaleUpRps,20.5);assert.equal(r.autoscale.cooldownMs,0);
 assert.deepEqual(r.command,['node','a.js','--flag','--last']);
});
test('CLI refuses autoscale configuration without opt-in or invalid replica bounds',()=>{
 assert.throws(()=>parseFleetRunArguments([...basic,'--scale-up-rps','25','--','node']),/require --autoscale/);
 assert.throws(()=>parseFleetRunArguments([...basic,'--autoscale','--max-replicas','4','--','node']),/bounds/);
 assert.throws(()=>parseFleetRunArguments([...basic,'--autoscale','--min-replicas','3','--','node']),/bounds/);
 assert.throws(()=>parseFleetRunArguments([...basic,'--autoscale','--scale-down-rps','50','--','node']),/scaleDownRps/);
 assert.throws(()=>parseFleetRunArguments([...basic,'--autoscale','--scale-window','0','--','node']),/scale-window/);
 assert.throws(()=>parseFleetRunArguments([...basic,'--autoscale','--autoscale','--','node']),/Repeated/);
});
