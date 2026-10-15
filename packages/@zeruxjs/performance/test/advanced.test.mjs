import test from 'node:test';import assert from 'node:assert/strict';
import {observeWebVitals,createVitalCollector,createVitalReporter,createPerformanceMetric,auditLighthouse,matchesETag,matchesStrongETag} from '../dist/index.js';
test('native web vitals observes LCP, CLS sessions, FCP, TTFB, and stops',()=>{
 const observers=new Map(), stopped=[];const received=[];
 const dispose=observeWebVitals({onMetric:metric=>received.push(metric),navigation:()=>({responseStart:102,requestStart:2}),
  createObserver:callback=>({observe({type}){observers.set(type,callback)},disconnect(){stopped.push(true)}})});
 observers.get('paint')([{name:'first-contentful-paint',startTime:250}]);
 observers.get('largest-contentful-paint')([{startTime:2000},{startTime:2200}]);
 observers.get('layout-shift')([{startTime:100,value:.04},{startTime:150,value:.05,hadRecentInput:true},{startTime:200,value:.05},{startTime:3000,value:.08}]);
 assert.deepEqual(received.map(e=>e.name),['TTFB','FCP','LCP','LCP','CLS','CLS']);
 assert.equal(received.at(-1).value,.09);dispose();assert.equal(stopped.length,3);
 observers.get('paint')([{name:'first-contentful-paint',startTime:400}]);assert.equal(received.length,6);
});
test('collector limits samples and reports bounded percentiles',()=>{
 const collector=createVitalCollector({maxPerMetric:3});for(const n of [10,20,30,40])collector.record(createPerformanceMetric('FCP',n));
 const snapshot=collector.snapshot();assert.equal(snapshot.length,1);assert.deepEqual([snapshot[0].count,snapshot[0].p50,snapshot[0].p95],[3,30,40]);
 assert.throws(()=>collector.record({...createPerformanceMetric('FCP',1),value:NaN}),RangeError);
 collector.clear();assert.equal(collector.snapshot().length,0);
});
test('RUM delivery batches, retries and does not transmit credentials',async()=>{
 const calls=[];let fails=true;const reporter=createVitalReporter({url:'https://example.com/metrics',maxBatch:2,
  fetch:async(url,init)=>{calls.push({url,init});return {ok:!fails,status:503}}});
 for(const n of [1,2,3])reporter.add(createPerformanceMetric('LCP',n));assert.equal(reporter.pending,2);
 await assert.rejects(reporter.flush(),/503/);assert.equal(reporter.pending,2);fails=false;
 assert.equal(await reporter.flush(),2);assert.equal(reporter.pending,0);
 assert.equal(calls.at(-1).init.credentials,'omit');assert.deepEqual(JSON.parse(calls.at(-1).init.body).map(x=>x.value),[2,3]);
 reporter.destroy();assert.throws(()=>reporter.add(createPerformanceMetric('FCP',2)));
});
test('Lighthouse adapter validates URL, port and normalizes reports',async()=>{
 const result=await auditLighthouse('https://example.org/page',{port:9222,runner:async(url,options)=>{
  assert.equal(options.port,9222);assert.equal(url,'https://example.org/page');return{lhr:{categories:{performance:{score:.95,title:'Performance'}},audits:{'largest-contentful-paint':{numericValue:900}}}}}});
 assert.equal(result.categories.performance.score,.95);assert.equal(result.metrics['largest-contentful-paint'].value,900);
 await assert.rejects(auditLighthouse('javascript:alert(1)',{runner:async()=>({})}),TypeError);
 await assert.rejects(auditLighthouse('https://example.com',{port:99999,runner:async()=>({})}),RangeError);
});
test('conditional ETag matching supports weak cache revalidation, not strong preconditions',()=>{
 assert.equal(matchesETag('"abc"','W/"abc"'),true);assert.equal(matchesStrongETag('"abc"','W/"abc"'),false);
 assert.equal(matchesStrongETag('"abc"','"abc"'),true);
});
