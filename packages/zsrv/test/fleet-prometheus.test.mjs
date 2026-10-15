import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFleetPrometheus } from '../dist/portless/fleet-prometheus.js';
const status={hostname:'api.localhost',desiredReplicas:3,members:[{healthy:true,routed:true},{healthy:true,routed:true},{healthy:false,routed:false}],replacementAttempts:2};
const metrics={hostname:'api.localhost',requestsPerSecond:11,activeConnections:3,errorRate:0.1,p95LatencyMs:250};
test('Prometheus output exports bounded, numeric fleet service and resource metrics',()=>{
 const output=renderFleetPrometheus({status,metrics,observation:{metric:'memory',value:200}});
 for(const label of ['zerux_fleet_healthy_replicas{fleet="api.localhost"} 2',
  'zerux_fleet_http_error_ratio{fleet="api.localhost"} 0.1',
  'zerux_fleet_http_p95_duration_seconds{fleet="api.localhost"} 0.25',
  'zerux_fleet_autoscale_observed_mib{fleet="api.localhost"} 200']) assert.ok(output.includes(label));
 assert.ok(!output.includes('undefined'));assert.ok(output.endsWith('\n'));
});
test('Prometheus export rejects inconsistent hostnames or nonfinite values',()=>{
 assert.throws(()=>renderFleetPrometheus({status,metrics:{...metrics,hostname:'other.localhost'}}),/Invalid/);
 assert.throws(()=>renderFleetPrometheus({status,metrics:{...metrics,requestsPerSecond:Infinity}}),/Invalid/);
});
