import test from 'node:test';
import assert from 'node:assert/strict';
import { cli,cliFixture,poll,request } from './helpers/fleet-cli-fixture.mjs';

test('fleet CLI scales online processes, reports metrics and writes lifecycle audit history',{timeout:100000},()=>cliFixture(async({env,proxyPort,start,ports})=>{
 await start();
 const status=async()=>JSON.parse(await cli(['fleet','status','scale','--json'],env));
 assert.equal((await status()).desiredReplicas,2);
 const result=JSON.parse(await cli(['fleet','scale','scale','3','--json'],env));
 assert.equal(result.desiredReplicas,3);
 await poll(async()=>(await status()).members.filter(m=>m.routed).length===3);
 const metrics=JSON.parse(await cli(['fleet','metrics','scale','--json'],env));
 assert.equal(metrics.metrics.hostname,'scale.localhost');
 assert.equal(metrics.metrics.windowMs,30000);
 assert.ok(metrics.metrics.requests>=1);
 assert.equal(JSON.parse(await cli(['fleet','backends','scale','--json'],env)).length,3);
 const doctor=JSON.parse(await cli(['fleet','doctor','scale','--json'],env));
 assert.equal(doctor.online,true);
 assert.equal(doctor.readyReplicas,3);
 assert.deepEqual(doctor.warnings,[]);
 const history=JSON.parse(await cli(['fleet','history','scale','--json'],env));
 assert.ok(history.some(e=>e.kind==='scale'&&e.desiredReplicas===3));
 assert.ok(history.some(e=>e.kind==='start'));
 const smaller=JSON.parse(await cli(['fleet','scale','scale','2','--json'],env));
 assert.equal(smaller.desiredReplicas,2);
 assert.equal((await request(proxyPort,'scale.localhost')).status,200);
 await assert.rejects(cli(['fleet','scale','scale','20'],env),/scale target/i);
 await cli(['fleet','stop','scale','--json'],env);
}));

test('fleet autoscale policy pauses on manual scale and resumes with hysteresis',{timeout:100000},()=>cliFixture(async({env,start})=>{
 await start(['--autoscale','--scale-up-rps','0.2','--scale-down-rps','0.01','--scale-cooldown','0',
   '--scale-samples','1','--scale-interval','250','--scale-window','1000','--max-replicas','3']);
 const status=async()=>JSON.parse(await cli(['fleet','status','scale','--json'],env));
 const resized=JSON.parse(await cli(['fleet','scale','scale','3','--json'],env));
 assert.equal(resized.desiredReplicas,3);
 assert.equal((await status()).autoscaling.paused,true);
 const paused=JSON.parse(await cli(['fleet','autoscale','scale','pause','--json'],env));assert.equal(paused.paused,true);
 const resumed=JSON.parse(await cli(['fleet','autoscale','scale','resume','--json'],env));assert.equal(resumed.paused,false);
 await poll(async()=>{const s=await status();return s.desiredReplicas===2&&s.autoscaling.paused===false;},12000);
 const events=JSON.parse(await cli(['fleet','history','scale','--json'],env));
 assert.ok(events.some(e=>e.kind==='autoscale'));
 await cli(['fleet','stop','scale','--json'],env);
}));

test('fleet controller restart restores previously scaled capacity from its checkpoint',{timeout:100000},()=>cliFixture(async({env,start})=>{
 const first=await start();
 assert.equal(JSON.parse(await cli(['fleet','scale','scale','3','--json'],env)).desiredReplicas,3);
 await cli(['fleet','stop','scale','--json'],env);
 await first.end();
 await start();
 const state=JSON.parse(await cli(['fleet','status','scale','--json'],env));
 assert.equal(state.online,true);
 assert.equal(state.desiredReplicas,3);
 assert.equal(state.members.filter(m=>m.routed).length,3);
 await cli(['fleet','stop','scale','--json'],env);
}));
