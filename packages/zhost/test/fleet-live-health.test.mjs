import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFleetLiveHealth } from '../dist/portless/fleet-live-health.js';
const members = [{port:4400,healthy:true,routed:true},{port:4401,healthy:true,routed:true}];
const status={hostname:'api.localhost',phase:'running',desiredReplicas:2,members,lastError:null};
const metrics=()=>({hostname:'api.localhost',sampledAt:Date.now(),requestsPerSecond:20,completedRequests:30,errorRate:0.01,p95LatencyMs:400});
test('live health combines capacity, fresh telemetry, error ratio and latency',()=>{
 assert.equal(evaluateFleetLiveHealth(status,metrics()).healthy,true);
 assert.match(evaluateFleetLiveHealth(status,{...metrics(),errorRate:0.4}).failures.join(' '),/error ratio/);
 assert.match(evaluateFleetLiveHealth(status,{...metrics(),p95LatencyMs:4000}).failures.join(' '),/latency/);
 assert.match(evaluateFleetLiveHealth({...status,desiredReplicas:3},metrics()).failures.join(' '),/replicas/);
 assert.match(evaluateFleetLiveHealth(status,{...metrics(),sampledAt:Date.now()-50000}).failures.join(' '),/stale/);
});
test('idle services report unknown quality rather than fabricated success metrics',()=>{
 const report=evaluateFleetLiveHealth(status,{...metrics(),completedRequests:0,errorRate:null,p95LatencyMs:null});
 assert.equal(report.healthy,true);assert.match(report.warnings[0],/Not enough/);
 assert.throws(()=>evaluateFleetLiveHealth(status,metrics(),{maxErrorRate:2}),/Invalid/);
});
