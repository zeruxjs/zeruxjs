import test from 'node:test';
import assert from 'node:assert/strict';
import { cliFixture, cli, request } from './helpers/fleet-cli-fixture.mjs';

test('local CLI exposes verified HTTP service metrics, Prometheus format and live doctor', {timeout:45000},async()=>
  cliFixture(async({env,proxyPort,start})=>{
   await start();
   for(let i=0;i<8;i++) assert.equal((await request(proxyPort,'scale.localhost')).status,200);
   const output=await cli(['fleet','metrics','scale','--json'],env);
   const metrics=JSON.parse(output);
   assert.equal(metrics.metrics.hostname,'scale.localhost');
   assert.ok(metrics.metrics.completedRequests>=8);
   assert.equal(metrics.metrics.errorRate,0);
   assert.ok(metrics.metrics.p95LatencyMs>=0);
   const exposition=await cli(['fleet','metrics','scale','--prometheus'],env);
   assert.match(exposition,/zerux_fleet_healthy_replicas\{fleet="scale.localhost"\} 2/);
   assert.match(exposition,/zerux_fleet_http_error_ratio/);
   const live=JSON.parse(await cli(['fleet','doctor','scale','--live','--json'],env));
   assert.equal(live.healthy,true);
   const history=JSON.parse(await cli(['fleet','samples','scale','--json'],env));
   assert.deepEqual(history,[]); // no configured autoscaling = no samples
  }));
