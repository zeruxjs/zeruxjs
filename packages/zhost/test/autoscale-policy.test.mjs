import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoscalePolicy, validateAutoscaleConfig, DEFAULT_AUTOSCALE } from '../dist/portless/autoscale-policy.js';
import { createFleetAutoscaler } from '../dist/portless/fleet-autoscaler.js';
const config={...DEFAULT_AUTOSCALE,enabled:true,minReplicas:2,maxReplicas:4,scaleUpRps:10,scaleDownRps:2,cooldownMs:0,consecutiveSamples:2,sampleIntervalMs:300000,windowMs:30000};

test('policy requires hysteresis and validates capacity, cooldown and sampling bounds',()=>{
  assert.equal(validateAutoscaleConfig(config,5,2).maxReplicas,4);
  assert.throws(()=>validateAutoscaleConfig({...config,scaleDownRps:10},5,2),/scaleDownRps/);
  assert.throws(()=>validateAutoscaleConfig({...config,maxReplicas:5},5,2),/replica/);
  assert.throws(()=>validateAutoscaleConfig({...config,sampleIntervalMs:1},5,2),/sampling/);
});

test('consecutive samples, up/down hysteresis, cooldown and capacity bounds',()=>{
 const p=new AutoscalePolicy({...config,cooldownMs:30000});
 assert.equal(p.observe(50,2,40000),null);
 assert.equal(p.observe(50,2,40001),3);
 assert.equal(p.observe(70,3,40002),null);
 assert.equal(p.observe(70,3,40003),null); // cooldown
 assert.equal(p.observe(70,3,70003),4);
 assert.equal(p.observe(0,4,70004),null);
 assert.equal(p.observe(0,4,100004),3);
 p.setPaused(true);assert.equal(p.observe(1000,3,200004),null);
 p.setPaused(false);assert.equal(p.observe(1000,3,200005),null);
 assert.equal(p.observe(1000,3,200006),4);
});

test('invalid or forged observations cannot trigger scale-down',()=>{
 const p=new AutoscalePolicy(config);
 for(const v of [-1,NaN,Infinity]) assert.throws(()=>p.observe(v,3),/Invalid/);
 assert.equal(p.snapshot.lastRps,null);
 assert.throws(()=>new AutoscalePolicy(config,{lastScaledAt:-1}),/checkpoint/);
});

test('autoscaler observes real proxy metrics, reacts to load, and respects pause',async()=>{
 let status={phase:'running',hostname:'demo.localhost',desiredReplicas:2,members:[{port:4100,healthy:true,routed:true},{port:4101,healthy:true,routed:true}]};
 const calls=[];
 let load=60;
 const fleet={get status(){return status;},async scaleTo(target){calls.push(target);status={...status,desiredReplicas:target,members:Array.from({length:target},(_,i)=>({port:4100+i,healthy:true,routed:true}))};return status;}};
 const source={async metrics(hostname,ports,windowMs){assert.equal(ports.length,status.desiredReplicas);return {hostname,windowMs,requestsPerSecond:load,requests:load*30,activeConnections:0,sampledAt:Date.now()};}};
 const auto=createFleetAutoscaler(fleet,[4100,4101,4102,4103,4104],source,config);
 try {
   await auto.sample();await auto.sample();assert.deepEqual(calls,[3]);
   auto.pause();load=0;await auto.sample();await auto.sample();assert.deepEqual(calls,[3]);
   auto.resume();await auto.sample();await auto.sample();assert.deepEqual(calls,[3,2]);
 } finally{auto.stop();}
});

test('autoscaler fails closed on stale metrics or degraded fleet',async()=>{
 let called=0;
 const status={phase:'running',hostname:'demo.localhost',desiredReplicas:2,members:[{port:4100,healthy:true,routed:true},{port:4101,healthy:true,routed:true}]};
 const fleet={status,async scaleTo(){called++;}};
 const source={metrics:(hostname,ports,windowMs)=>({hostname,windowMs,requestsPerSecond:0,requests:0,activeConnections:0,sampledAt:Date.now()-40000})};
 const auto=createFleetAutoscaler(fleet,[4100,4101,4102],source,{...config,maxReplicas:2});
 try {await assert.rejects(auto.sample(),/stale/);assert.equal(called,0);}finally{auto.stop();}
});
