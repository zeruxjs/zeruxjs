import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createAnalytics,createEventSchemaRegistry,readEventSchemaCoverage,createAnalyticsCollector,createEventClient} from '@zeruxjs/analytics';
const require=createRequire(import.meta.url);
const {createConnector}=require('../../db-sqllite/dist/index.js');
const dimension={kind:'dimension',type:'string',values:['docs','home'],maxCardinality:2};
const v1={name:'page.view',version:1,properties:{section:{...dimension,required:true},duration_ms:{kind:'metric',unit:'milliseconds',min:0,max:60000}},userProperties:{plan:{...dimension,values:['free','paid']}},sessionProperties:{campaign:{...dimension,values:['spring','fall']}}};
const v2={...v1,version:2,properties:{...v1.properties,engaged:{kind:'parameter',type:'boolean'}}};
async function database(){const connector=await createConnector({filename:':memory:',driver:'node'});const ctx={connection:{slug:'metrics',name:'metrics',connector:'@zeruxjs/db-sqlite',options:{}}};const connection=Object.fromEntries(['createTable','createIndex','insert','select','update','delete'].map(op=>[op,args=>connector.execute({op,...args},ctx)]));return {connector,connection,manager:{connectionSlugs:['metrics'],getConnectionFacade:()=>connection}};}
const config=(db,registry)=>({analytics:'metrics',database:db.manager,schemaRegistry:registry,numericFields:['duration_ms'],webConsent:'required',onWarning:()=>{}});
test('real SQLite: additive schemas preserve immutable history, numeric units, legacy coverage and deterministic snapshots',async()=>{
 const db=await database();try{
 const first=createEventSchemaRegistry([v1]);const one=createAnalytics(config(db,first));assert.equal(await one.initialize(),true);
 assert.ok(await one.track(first.event('page.view',{site:'north',properties:{section:'docs',duration_ms:12}})));
 const second=createEventSchemaRegistry([v2,v1]);const two=createAnalytics(config(db,second));await two.initialize();
 assert.ok(await two.track(second.event('page.view',{site:'north',properties:{section:'home',duration_ms:8,engaged:true}})));
 assert.ok(await two.track({name:'page.view',schemaVersion:1,site:'north',properties:{section:'docs'}}));
 assert.equal(await two.track({name:'page.view',schemaVersion:1,properties:{section:'docs',engaged:true}}),undefined);
 const rows=await two.events({site:'north'});assert.equal(rows.length,3);assert.deepEqual(rows.map(readEventSchemaCoverage).map(c=>c.schemaVersion).sort(),[1,1,2]);
 assert.equal(readEventSchemaCoverage({properties_json:'{}'}).coverage,'legacy-unversioned');assert.throws(()=>readEventSchemaCoverage({properties_json:'{"zAnalyticsSchema":{"schemaVersion":2}}'}));assert.throws(()=>readEventSchemaCoverage({properties_json:'PRIVATE malformed'}),e=>e.code==='INVALID_STORED_PROPERTIES'&&!e.message.includes('PRIVATE'));
 const numeric=await two.aggregateNumeric({groupBy:'event',valueField:'duration_ms',metric:'sum'});assert.equal(numeric.total,20);assert.equal(numeric.schema.unit,'milliseconds');assert.equal(numeric.schema.coverage,'mixed-history');assert.equal(numeric.coverage,'indexed-only');
 assert.equal(second.describe().catalogId,createEventSchemaRegistry([v1,v2]).describe().catalogId);assert.ok(Object.isFrozen(second.describe().schemas[0].properties));assert.throws(()=>{second.describe().schemas[0].properties.section.values.push('private');});
 }finally{await db.connector.disconnect();}
});
test('schema definition validation rejects breaking upgrades, cardinality overflow, unsafe/free-text properties and executable accessors',()=>{
 for(const candidate of [
 [v1,{...v2,properties:{...v1.properties,duration_ms:{kind:'metric',unit:'seconds'}}}],
 [v1,{...v2,properties:{...v1.properties,needed:{kind:'parameter',type:'boolean',required:true}}}],
 [v1,{...v2,version:3}], [v1,v1],
 [{...v1,properties:{section:{...dimension,maxCardinality:1}}}],
 [{...v1,properties:{email:dimension}}],
 [{...v1,properties:{text:{kind:'parameter',type:'string'}}}],
 [{...v1,properties:{section:{...dimension,values:['private@example.test']}}}],
 ])assert.throws(()=>createEventSchemaRegistry(candidate),e=>e.name==='AnalyticsSchemaError');
 let invoked=0;assert.throws(()=>createEventSchemaRegistry([{...v1,get properties(){invoked++;return {};}}]));assert.equal(invoked,0);
 const brokenValues=['docs'];Object.defineProperty(brokenValues,0,{get(){invoked++;return 'docs';}});assert.throws(()=>createEventSchemaRegistry([{...v1,properties:{section:{...dimension,values:brokenValues}}}]));assert.equal(invoked,0);
 const raw=structuredClone(v1),catalog=createEventSchemaRegistry([raw]);raw.properties.section.values.push('changed');assert.throws(()=>catalog.prepare({name:'page.view',properties:{section:'changed'}}));
});
test('ingestion bounds properties and consent before DB dispatch, across independent managers without cardinality races',async()=>{
 const db=await database();try{
 const registry=createEventSchemaRegistry([v1]),a=createAnalytics(config(db,registry)),b=createAnalytics(config(db,registry));await a.initialize();let inserts=0;const original=db.connection.insert;db.connection.insert=async op=>{inserts++;return original(op);};
 const valid={name:'page.view',source:'web',consent:'granted',properties:{section:'docs'}};
 for(const input of [{...valid,consent:'denied'},{...valid,consent:'unknown'},{...valid,properties:{section:'third'}},{...valid,properties:{section:'docs',extra:1}},{...valid,properties:{section:'docs',duration_ms:60001}},{...valid,schemaVersion:9},{...valid,userProperties:{plan:'free'}},{...valid,sessionProperties:{campaign:'spring'}},{...valid,properties:{section:'docs',zAnalyticsSchema:1}}])assert.equal(await a.track(input),undefined);
 assert.equal(inserts,0);
 const ids=await Promise.all(Array.from({length:20},(_,i)=>(i%2?a:b).track({...valid,site:i%2?'north':'south',properties:{section:i%2?'home':'docs'}})));assert.ok(ids.every(Boolean));
 assert.ok(await a.track({...valid,visitorId:'visitor_0123456789',sessionId:'session_0123456789',userProperties:{plan:'paid'},sessionProperties:{campaign:'spring'}}));
 const stored=JSON.parse((await a.events()).find(r=>r.session_id).properties_json);assert.deepEqual(stored.zAnalyticsSchema.userProperties,{plan:'paid'});assert.deepEqual(stored.zAnalyticsSchema.sessionProperties,{campaign:'spring'});
 const large='x'.repeat(100);const tiny=createEventSchemaRegistry([{...v1,properties:{section:{...dimension,values:[large]}}}],{maxBytes:128});assert.throws(()=>tiny.prepare({...valid,properties:{section:large}}));
 }finally{await db.connector.disconnect();}
});
test('collector rejects forged sites/schema before reservation; outages stay best effort and diagnostics omit private data',async()=>{
 const db=await database();try{
 const registry=createEventSchemaRegistry([v1]);const a=createAnalytics(config(db,registry));await a.initialize();let reservations=0;
 const collector=createAnalyticsCollector({analytics:a,allowedOrigins:['https://public.test'],siteByOrigin:{'https://public.test':'north'},requestIdStore:{async reserve(){reservations++;return true;}}});
 const request=body=>new Request('https://events.test/collect',{method:'POST',headers:{'content-type':'application/json',origin:'https://public.test'},body:JSON.stringify(body)});
 assert.equal((await collector.handler(request({name:'page.view',site:'south',consent:'granted',properties:{section:'docs'}}))).status,403);
 const rejected=await collector.handler(request({name:'page.view',consent:'granted',properties:{section:'PRIVATE'}}));assert.equal(rejected.status,422);assert.doesNotMatch(await rejected.text(),/PRIVATE/);assert.equal(reservations,0);
 assert.equal((await collector.handler(request({name:'page.view',consent:'granted',properties:{section:'docs'}}))).status,204);assert.equal(reservations,1);assert.equal((await a.events({site:'north'})).length,1);
 const warnings=[];db.connection.insert=async()=>{throw Error('PRIVATE database password');};const broken=createAnalytics({...config(db,registry),onWarning:m=>warnings.push(m)});assert.equal(await broken.track({name:'page.view',properties:{section:'docs'}}),undefined);assert.equal(broken.status().dropped,1);assert.doesNotMatch(JSON.stringify(warnings),/PRIVATE/);
 const invalid=createAnalytics({...config(db,registry),eventSchemas:{}});invalid.setEnabled(true);assert.equal(await invalid.initialize(),false);assert.equal(invalid.enabled,false);
 }finally{await db.connector.disconnect();}
});
test('browser versioned fields require explicit consent and identity and remain inert without a network call',async()=>{
 const calls=[];const client=createEventClient({endpoint:'https://events.test/collect',fetch:async(_,options)=>{calls.push(JSON.parse(options.body));return new Response(null,{status:204});}});
 assert.equal(await client.track('page.view',{}, {userProperties:{plan:'paid'}}),false);assert.equal(calls.length,0);client.setConsent('granted');assert.equal(await client.track('page.view',{section:'docs'},{schemaVersion:2,visitorId:'visitor_0123456789',userProperties:{plan:'paid'}}),true);assert.equal(calls[0].schemaVersion,2);assert.deepEqual(calls[0].userProperties,{plan:'paid'});
});
test('metric domains, ambiguous units and malformed registry configuration fail before execution',async()=>{
 const metrics=createEventSchemaRegistry([{name:'a',version:1,properties:{value:{kind:'metric',unit:'count'}}},{name:'b',version:1,properties:{value:{kind:'metric',unit:'bytes'}}}]);
 assert.throws(()=>metrics.metric('value'),e=>e.code==='AMBIGUOUS_METRIC_UNIT');assert.equal(metrics.metric('value','a').unit,'count');
 for(const value of [-1,0.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>metrics.prepare({name:'a',properties:{value}}));
 let calls=0;const analytics=createAnalytics({analytics:'db',database:{connectionSlugs:['db'],getConnectionFacade(){calls++;throw Error('should not initialize');}},schemaRegistry:{prepare(){},describe(){}},onWarning:()=>{}});assert.equal(await analytics.initialize(),false);analytics.setEnabled(true);assert.equal(analytics.enabled,false);assert.equal(calls,0);
});
