import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAnalytics,createAnalyticsCollector,createEventClient,createEmailTrackingService} from '../dist/index.js';

test('analytics calls never throw if the DB is omitted, disconnected, or filter throws',async()=>{
  const warnings=[];
  const analytics=createAnalytics({analytics:'events',onWarning:warning=>warnings.push(warning)});
  assert.equal(await analytics.initialize(),false);
  assert.equal(await analytics.track({name:'page.view'}),undefined);
  assert.deepEqual(await analytics.events(),[]);
  assert.deepEqual({...await analytics.counts()},{});
  assert.equal(warnings.length,1);
  analytics.setEnabled(false);
  assert.equal(await analytics.track({name:'page.view'}),undefined);
  assert.equal(analytics.status().enabled,false);
  analytics.setEnabled(true);
  assert.equal(await analytics.track({name:'page.view'}),undefined);
  assert.equal(warnings.length,1);
  const throwsDb={connectionSlugs:['events'],getConnectionFacade(){throw Error('offline');}};
  const offline=createAnalytics({analytics:'events',database:throwsDb,onWarning:()=>{throw Error('logger unavailable');}});
  assert.equal(await offline.track({name:'page.view'}),undefined);
  assert.deepEqual(await offline.events(),[]);
  assert.equal(await offline.initialize(),false);
  assert.deepEqual({...await offline.counts()},{});
  const rejectDb={connectionSlugs:['events'],getConnectionFacade(){return {
    createTable:async()=>{throw Error('offline');},insert:async()=>{throw Error('offline');},select:async()=>{throw Error('offline');}
  };}};
  const rejecting=createAnalytics({analytics:'events',database:rejectDb,onWarning:()=>{}});
  assert.equal(await rejecting.initialize(),false);
  assert.equal(await rejecting.track({name:'page.view'}),undefined);
  assert.deepEqual(await rejecting.events(),[]);
  assert.deepEqual({...await rejecting.counts()},{});
  const filtered=createAnalytics({analytics:'events',database:rejectDb,filter:()=>{throw Error('no');},onWarning:()=>{}});
  assert.equal(await filtered.track({name:'page.view'}),undefined);
});

test('analytics connection can appear later; events recover without re-creating manager',async()=>{
  const records=[];
  const db={connectionSlugs:[],getConnectionFacade(){return {
    createTable:async()=>({ok:true}),insert:async({values})=>{records.push(values);return {ok:true};},select:async()=>({ok:true,rows:records})
  };}};
  const warnings=[];
  const a=createAnalytics({database:db,analytics:'events',onWarning:m=>warnings.push(m)});
  assert.equal(await a.track({name:'page.view'}),undefined);
  db.connectionSlugs.push('events');
  assert.equal(await a.initialize(),true);
  assert.equal(typeof await a.track({name:'page.view'}),'string');
  assert.equal(records.length,1);
  assert.equal(a.status().recorded,1);
});

test('HTTP collection stays available even when DB is missing',async()=>{
  const analytics=createAnalytics({analytics:'disconnected',onWarning:()=>{}});
  const collector=createAnalyticsCollector({analytics,serverToken:'top-secret'});
  const res=await collector.handler(new Request('https://events.example/_analytics/collect',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer top-secret'},body:JSON.stringify({name:'page.view'})}));
  assert.equal(res.status,204);
});

test('browser telemetry never propagates network or response failures; still supports pausing',async()=>{
  let attempts=0,warnings=0;
  const client=createEventClient({endpoint:'https://events.example/collect',fetch:async()=>{attempts++;throw Error('offline');},onWarning:()=>warnings++});
  assert.equal(await client.track('page.view'),false);
  assert.equal(await client.track('page.view'),false);
  assert.equal(warnings,1);
  client.setEnabled(false);
  assert.equal(await client.track('page.view'),false);
  assert.equal(attempts,2);
});

test('email opens and clicks work with analytics down and support explicit disable',async()=>{
  const telemetry=createEmailTrackingService({analytics:{track:async()=>{throw Error('storage unavailable');}},baseUrl:'https://events.example',secret:'Z'.repeat(40),onWarning:()=>{}});
  const html=telemetry.instrumentHtml('<a href="https://app.example/posts">open</a>',{id:'mail1',account:'marketing',message:{tracking:{enabled:true,campaign:'launch'}}});
  const pixel=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match=>match[1]).find(url=>url.includes('/open/'));
  const click=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match=>match[1]).find(url=>url.includes('/click/'));
  assert.equal((await telemetry.handle(new Request(pixel))).status,200);
  assert.equal((await telemetry.handle(new Request(click))).status,302);
  telemetry.setEnabled(false);
  assert.equal(telemetry.instrumentHtml('unchanged',{id:'mail1',account:'marketing',message:{tracking:{enabled:true}}}),'unchanged');
  assert.equal((await telemetry.handle(new Request(pixel))).status,200);
  assert.equal((await telemetry.handle(new Request(click))).status,302);
});
