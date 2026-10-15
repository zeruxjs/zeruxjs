import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoscalePolicy, validateAutoscaleConfig, DEFAULT_AUTOSCALE } from '../dist/portless/autoscale-policy.js';
import { createFleetAutoscaler } from '../dist/portless/fleet-autoscaler.js';
import { parseFleetRunArguments } from '../dist/bin/parse-fleet.js';
const base = { ...DEFAULT_AUTOSCALE, enabled:true, minReplicas:2,maxReplicas:4,
  consecutiveSamples:1,cooldownMs:0,sampleIntervalMs:300000,windowMs:30000 };

test('CPU and memory policy use measured per-child usage rather than dividing by replica count',()=>{
 const p=new AutoscalePolicy({...base,metric:'cpu',scaleUpThreshold:70,scaleDownThreshold:20});
 assert.equal(p.observe(80,2),3);
 assert.equal(p.observe(10,3),2);
 const rss=new AutoscalePolicy({...base,metric:'memory',scaleUpThreshold:512,scaleDownThreshold:100});
 assert.equal(rss.observe(600,2),3);
 assert.equal(rss.observe(50,3),2);
 assert.throws(()=>validateAutoscaleConfig({...base,metric:'memory',scaleUpThreshold:5,scaleDownThreshold:6},5,2),/threshold/);
});

test('scale-down safety guards block unhealthy service without consuming cooldown',()=>{
 const p=new AutoscalePolicy({...base,maxErrorRate:0.05,maxP95LatencyMs:500});
 assert.equal(p.observe(0,3,100,true),2);
 assert.equal(p.observe(0,3,101,false),null);
 assert.match(p.snapshot.lastDecision,/blocked/);
 assert.equal(p.observe(0,3,102,true),2);
});

test('CPU autoscaler reads member PIDs and validates resource timestamps before changing capacity',async()=>{
 const changes=[];let desired=2;
 const members=Array.from({length:3},(_,i)=>({pid:321+i,port:4400+i,healthy:true,routed:true}));
 const fleet={get status(){return {phase:'running',hostname:'api.localhost',desiredReplicas:desired,members:members.slice(0,desired)}},
    async scaleTo(n){changes.push(n);desired=n;}};
 const resource={sample(pids){assert.equal(pids.length,desired);return {sampledAt:Date.now(),processCount:pids.length,cpuPercent:90,memoryMiB:100,maxMemoryMiB:100};}};
 const source={metrics(){throw Error('no traffic fetch needed')}},
 config={...base,metric:'cpu',scaleUpThreshold:70,scaleDownThreshold:20};
 const auto=createFleetAutoscaler(fleet,[4400,4401,4402,4403,4404],source,config,undefined,undefined,resource);
 try {await auto.sample();assert.deepEqual(changes,[3]);assert.equal(auto.lastObservation.metric,'cpu');}
 finally{auto.stop();}
});

test('high error rate blocks scale-down, while healthy request metrics permit it',async()=>{
 let desired=3, errorRate=0.25;const calls=[];
 const fleet={get status(){return {phase:'running',hostname:'api.localhost',desiredReplicas:desired,
   members:Array.from({length:desired},(_,i)=>({pid:123+i,port:4400+i,healthy:true,routed:true}))}},
   async scaleTo(n){calls.push(n);desired=n;}};
 const source={metrics:(host,ports,windowMs)=>({hostname:host,requests:0,requestsPerSecond:0,activeConnections:0,
   windowMs,sampledAt:Date.now(),completedRequests:20,serverErrors:Math.round(errorRate*20),errorRate,p95LatencyMs:120})};
 const auto=createFleetAutoscaler(fleet,[4400,4401,4402,4403,4404],source,{...base,maxErrorRate:0.1});
 try{await auto.sample();assert.deepEqual(calls,[]);assert.equal(auto.lastObservation.downscaleAllowed,false);
   errorRate=0;await auto.sample();assert.deepEqual(calls,[2]);}finally{auto.stop();}
});

test('CLI validates resource thresholds and optional error/latency guards',()=>{
 const run=['--name','api','--ports','4400,4401,4402,4403','--replicas','2','--autoscale',
  '--scale-mode','memory','--scale-up','512','--scale-down','256','--scale-max-error-rate','0.1',
  '--scale-max-p95','900','--','node','server.js'];
 const options=parseFleetRunArguments(run);
 assert.equal(options.autoscale.metric,'memory');assert.equal(options.autoscale.maxErrorRate,0.1);
 assert.throws(()=>parseFleetRunArguments(run.filter((x,i)=>x!=='--scale-down' && run[i-1]!=='--scale-down')),/requires/);
 assert.throws(()=>parseFleetRunArguments(run.map(x=>x==='512'?'no':x)),/Invalid/);
});
