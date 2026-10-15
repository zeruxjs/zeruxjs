import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAnalyticsCollector,createEmailTrackingService} from '../dist/index.js';

const never=()=>new Promise(()=>{});

test('hung email storage and event callback cannot stall a delivery or click redirect',async()=>{
  let trackingAttempts=0,warnings=0;
  const service=createEmailTrackingService({
    baseUrl:'https://events.example',secret:'deadline-test-secret-'.repeat(3),
    analytics:{track:()=>{trackingAttempts++;return never();}},
    onEvent:()=>never(),telemetryTimeoutMs:15,maxPendingTelemetry:1,onWarning:()=>warnings++
  });
  const markup=service.instrumentHtml('<a href="https://site.example/product">Product</a>',{
    id:'id-43',account:'transactional',message:{tracking:{enabled:true,campaign:'october'}}
  });
  const urls=[...markup.matchAll(/(?:href|src)="([^"]+)"/g)].map(x=>x[1]);
  const click=urls.find(x=>x.includes('/click/'));
  const pixel=urls.find(x=>x.includes('/open/'));
  const start=Date.now();
  await service.onSent({id:'id-43',account:'transactional',message:{tracking:{enabled:true}}});
  const clicked=await service.handle(new Request(click));
  const opened=await service.handle(new Request(pixel));
  assert.equal(clicked.status,302);
  assert.equal(opened.status,200);
  assert.ok(Date.now()-start<1500,'tracked redirects and pixels must have a deadline');
  assert.equal(trackingAttempts,1,'unresolved writes are counted against concurrency cap');
  assert.equal(warnings,1,'telemetry warning is deduplicated');
});

test('hung collector writes return 204 and do not create unbounded pending operations',async()=>{
  let attempts=0;
  const collector=createAnalyticsCollector({analytics:{track:()=>{attempts++;return never();}},serverToken:'key',storageTimeoutMs:15,maxPendingEvents:1});
  const request=()=>new Request('https://events.example/_analytics/collect',{
    method:'POST',headers:{authorization:'Bearer key','content-type':'application/json'},body:JSON.stringify({name:'page.view'})
  });
  const start=Date.now();
  assert.equal((await collector.handler(request())).status,204);
  assert.equal((await collector.handler(request())).status,204);
  assert.ok(Date.now()-start<1500,'collector responses must be bounded');
  assert.equal(attempts,1,'unresolved storage request cannot spawn unlimited writes');
});
