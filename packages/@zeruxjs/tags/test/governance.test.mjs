import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {createTagManager,emptyTagContainer,createMemoryTagStore,validateContainer,releaseSummary} from '../dist/index.js';
import {createMemoryRequestIdStore,createRequestId} from '@zeruxjs/analytics';

function app(options={}){
  const hits=[];const store=options.store??createMemoryTagStore(emptyTagContainer());
  const runtime=createTagManager({analytics:{track:async e=>{hits.push(e);return 'persisted';}},requestIds:createMemoryRequestIdStore(),store,
    authorizeAdmin:request=>request.headers.get('x-role')==='editor'||request.headers.get('x-role')==='publisher',
    authorizePublish:request=>request.headers.get('x-role')==='publisher',dashboardHost:'tags.example.com',...options});
  const route=name=>runtime.routes().find(r=>r.pattern==='/_tags/'+name).handler;
  const req=(name,method='GET',body=undefined,role='publisher',origin='https://tags.example.com')=>new Request('https://tags.example.com/_tags/'+name,{method,headers:{origin,'x-role':role,'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const call=async(name,method='GET',body,role='publisher',origin='https://tags.example.com')=>route(name)(req(name,method,body,role,origin));
  return {hits,store,runtime,req,call,route};
}

async function draft(app,modify){
  const current=await (await app.call('admin/api')).json();
  const proposal=structuredClone(current);modify(proposal);proposal.version++;
  const response=await app.call('admin/api','PUT',proposal,'editor');assert.equal(response.status,200);return proposal.version;
}

test('draft is isolated from published server/browser until role-checked publish; rollback restores live release',async()=>{
  const a=app();
  const astag=a.runtime.createAstag({site:'demo'});
  assert.equal((await astag('event','visit')).firedTags.length,1);
  const revision=await draft(a,c=>{c.triggers.push({id:'page',name:'Page',type:'pageview'});c.tags[0].triggerIds=['page'];});
  assert.equal(revision,2);
  assert.equal((await astag('event','visit')).firedTags.length,1,'draft cannot affect active server');
  const publishedPreview=await (await a.call('admin/preview','POST',{name:'visit',mode:'published'})).json();
  const draftPreview=await (await a.call('admin/preview','POST',{name:'visit',mode:'draft'})).json();
  assert.deepEqual(publishedPreview.candidateTags.map(t=>t.id),['internal_analytics']);
  assert.deepEqual(draftPreview.candidateTags,[]);
  const before=await (await a.call('ttag.js')).text();assert.ok(!before.includes('"pageview"'));
  assert.equal((await a.call('admin/publish','POST',{expectedVersion:revision},'editor')).status,403);
  assert.equal((await a.call('admin/publish','POST',{expectedVersion:revision},'publisher','https://evil.test')).status,403);
  assert.equal((await a.call('admin/publish','POST',{expectedVersion:revision-1})).status,409);
  const published=await a.call('admin/publish','POST',{expectedVersion:revision});assert.equal(published.status,200);
  assert.equal((await astag('event','visit')).firedTags.length,0);
  const liveScript=await (await a.call('ttag.js')).text();assert.ok(liveScript.includes('"pageview"'));
  const active=a.runtime.published;assert.equal((await active()).triggers.length,2);
  const history=await (await a.call('admin/status')).json();assert.equal(history.publishedRelease,2);assert.deepEqual(history.history.map(x=>x.id),[1,2]);
  assert.equal((await a.call('admin/rollback','POST',{expectedVersion:3,releaseId:100})).status,422);
  assert.equal((await a.call('admin/rollback','POST',{expectedVersion:3,releaseId:1},'editor')).status,403);
  assert.equal((await a.call('admin/rollback','POST',{expectedVersion:3,releaseId:1})).status,200);
  assert.equal((await astag('event','visit')).firedTags.length,1);
  assert.ok(!(await (await a.call('ttag.js')).text()).includes('"pageview"'));
  const rolled=await (await a.call('admin/status')).json();assert.equal(rolled.publishedRelease,3);
  assert.equal(rolled.publishedRevision,1);assert.equal(rolled.draftRevision,4);
  assert.equal(rolled.unpublishedChanges,true,'rollback retains draft for rework');
  assert.equal((await a.call('admin/publish','POST',{expectedVersion:3})).status,409);
  assert.equal((await a.call('admin/publish','POST',{expectedVersion:4})).status,200);
  assert.equal((await astag('event','visit')).firedTags.length,0,'re-published draft becomes live');
});

test('publisher permission is explicit even if editor is authenticated; governance metadata cannot be forged',async()=>{
  const a=app({authorizePublish:undefined});
  const first=await (await a.call('admin/api')).json();
  const malicious=structuredClone(first);malicious.version=2;malicious.governance={release:99,published:structuredClone(first),history:[]};
  assert.equal((await a.call('admin/api','PUT',malicious)).status,422);
  assert.equal((await a.call('admin/publish','POST',{expectedVersion:1})).status,403);
  assert.equal((await a.call('admin/rollback','POST',{expectedVersion:1,releaseId:1})).status,403);
  assert.equal((await a.call('admin/preview','POST',{name:'view'},'editor')).status,200);
  assert.equal((await a.call('admin/api','PUT',{...first,version:2},'publisher')).status,200);
  const after=await a.store.load();assert.equal(after.governance.release,1);
  assert.equal(after.version,2);
  assert.equal((await a.call('admin/status','GET',undefined,'none')).status,403);
});

test('two manager instances sharing durable CAS document cannot lose updates',async()=>{
  const store=createMemoryTagStore(emptyTagContainer());const a=app({store}),b=app({store});
  const current=await store.load();
  const first={...current,version:2,name:'first'},second={...current,version:2,name:'second'};
  const responses=await Promise.all([a.call('admin/api','PUT',first),b.call('admin/api','PUT',second)]);
  assert.deepEqual(responses.map(x=>x.status).sort(),[200,409]);
  assert.equal((await a.runtime.published()).name,'Default');
  assert.equal((await b.call('admin/publish','POST',{expectedVersion:2})).status,200);
  assert.equal((await a.runtime.published()).name,(await b.runtime.published()).name);
  assert.equal((await a.call('admin/publish','POST',{expectedVersion:2})).status,409);
});

test('consent defaults and tenant binding apply to web and server; rejected beacons never dispatch',async()=>{
  const a=app({defaultConsent:'denied',allowedOrigins:['https://site.example.com'],siteByOrigin:{'https://site.example.com':'bound_site'}});
  const astag=a.runtime.createAstag({site:'bound_site'});assert.equal(await astag('event','view'),undefined);
  await astag('consent','granted');assert.equal((await astag('event','view')).firedTags.length,1);
  const send=(consent,site)=>a.route('collect')(new Request('https://tags.example.com/_tags/collect',{method:'POST',headers:{origin:'https://site.example.com','content-type':'text/plain'},body:JSON.stringify({name:'page_view',requestId:createRequestId(),site,consent,properties:{ok:true}})}));
  assert.equal((await send(undefined,'bound_site')).status,204);
  assert.equal((await send('denied','bound_site')).status,204);
  assert.equal(a.hits.length,1);
  assert.equal((await send('granted','attacker_site')).status,403);
  assert.equal((await send('granted','bound_site')).status,204);
  assert.equal(a.hits.length,2);assert.equal(a.hits[1].site,'bound_site');
});

test('browser cannot overwrite configured site/debug or choose request IDs; deny purges pending events',async()=>{
  const a=app({defaultConsent:'denied'}),js=await (await a.call('ttag.js')).text();
  const sent=[],win={crypto:webcrypto,addEventListener(){}},doc={addEventListener(){}};
  vm.runInNewContext(js,{window:win,document:doc,navigator:{sendBeacon:(url,blob)=>{sent.push(blob);return true;}},Uint8Array,Blob,Promise,location:{pathname:'/'} });
  assert.equal(win.ttag('config',{site:'attacker',debug:true}),false);
  assert.equal(win.ttag('get','site'),'', 'compiled site stays read-only');
  assert.equal(win.ttag('event','view'),null);
  win.ttag('consent','granted');
  win.dataLayer.push({event:'view',zRequestId:'ATTACKERCHOSEN00',properties:{ok:true}});
  win.ttag('consent','denied');await Promise.resolve();assert.equal(sent.length,0,'revoking consent empties unsent batch');
  win.ttag('consent','granted');win.dataLayer.push({event:'view',zRequestId:'ATTACKERCHOSEN00'});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(sent.length,1);
  const event=JSON.parse(await sent[0].text());assert.notEqual(event.requestId,'ATTACKERCHOSEN00');assert.equal(event.consent,'granted');
});

test('admin CSP uses an exact script hash instead of unrestricted inline scripts',async()=>{
  const a=app(),res=await a.call('admin');const html=await res.text(),source=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const hash=createHash('sha256').update(source).digest('base64');
  assert.ok(res.headers.get('content-security-policy').includes(`script-src 'sha256-${hash}'`));
  assert.ok(!res.headers.get('content-security-policy').includes("script-src 'unsafe-inline'"));
  assert.equal(res.headers.get('x-frame-options'),'DENY');
  assert.doesNotThrow(()=>new vm.Script(source));
});

test('release record validation rejects nested, mismatched or tampered snapshots',()=>{
  const c=emptyTagContainer();c.governance={release:1,published:{...c,id:'different'},history:[{id:1,at:new Date().toISOString(),action:'initial',container:{...c,id:'different'}}]};
  assert.throws(()=>validateContainer(c));
  c.governance.published={...c};assert.throws(()=>validateContainer(c),'nested release loop rejected');
  const stats=releaseSummary(emptyTagContainer());assert.equal(stats.publishedRelease,1);
});

test('live telemetry store/ID failures are warning-only; invalid caller values still fail validation',async()=>{
  const warnings=[],a=app({onWarning:message=>warnings.push(message)});
  const broken=createTagManager({analytics:{track:async()=>{throw Error('DB down');}},
    requestIds:{reserve:async()=>{throw Error('request store down');}},
    store:{load:async()=>{throw Error('config DB down');},save:async()=>false},
    onWarning:message=>warnings.push(message)});
  const missing=await broken.createAstag()('event','checkout',{value:100});
  assert.deepEqual(missing.failures,['request_id_unavailable']);
  const evaluation=await broken.evaluate({name:'checkout',properties:{value:10},source:'server',requestId:createRequestId(),requestUtcDay:'2026-10-14'});
  assert.deepEqual(evaluation.failures,['container_unavailable']);
  assert.equal(warnings.length,2);assert.ok(warnings.every(w=>!w.includes('DB down')));
  assert.equal((await a.runtime.createAstag()('event','view')).firedTags.length,1);
  await assert.rejects(a.runtime.createAstag()('event','bad event',{}),TypeError);
});

test('publishing refuses unresolved external sinks and prevents IPv6/local webhook targets',async()=>{
  const a=app();const rev=await draft(a,c=>c.tags.push({id:'external',name:'External',type:'webhook',destinationRef:'absent',triggerIds:['all_events']}));
  const outcome=await a.call('admin/publish','POST',{expectedVersion:rev});assert.equal(outcome.status,422);
  assert.equal((await a.runtime.published()).tags.length,1);
  assert.throws(()=>app({destinations:{blocked:{url:'https://[::1]/event'}}}),/public HTTPS DNS/);
  assert.throws(()=>app({destinations:{blocked:{url:'https://localhost./event'}}}),/public HTTPS DNS/);
});

test('retained release history is bounded and stale revision cannot overwrite published state',async()=>{
  const a=app();
  for(let i=0;i<15;i++){
    const revision=await draft(a,c=>c.name='Release '+i);
    assert.equal((await a.call('admin/publish','POST',{expectedVersion:revision})).status,200);
  }
  const summary=releaseSummary(await a.store.load());assert.ok(summary.history.length<=12);
  assert.equal(summary.history.at(-1).id,summary.publishedRelease);
  assert.equal((await a.call('admin/rollback','POST',{expectedVersion:31,releaseId:1})).status,422,'evicted history cannot be restored');
  assert.ok(Buffer.byteLength(JSON.stringify(await a.store.load()),'utf8')<58_000);
});

test('registered variables interpolate bounded destination parameters without evaluating script',async()=>{
  const hits=[],calls=[],container=emptyTagContainer();
  container.variables=[{id:'cart_total',name:'Cart total',type:'event',key:'total'},{id:'channel',name:'Channel',type:'constant',value:'web'}];
  container.tags[0].parameters={revenue:'{{cart_total}}',channel:'{{channel}}'};
  container.tags.push({id:'hook',name:'CRM',type:'webhook',destinationRef:'crm',triggerIds:['all_events'],parameters:{total:'{{cart_total}}'}});
  const runtime=createTagManager({analytics:{track:async ev=>{hits.push(ev);return true;}},requestIds:createMemoryRequestIdStore(),container,
    destinations:{crm:{url:'https://hooks.example.com/tag'}},fetch:async(_url,options)=>{calls.push(JSON.parse(options.body));return new Response(null,{status:204});}});
  const result=await runtime.createAstag()('event','checkout',{total:42});
  assert.deepEqual(result.firedTags,['internal_analytics','hook']);assert.equal(hits[0].properties.revenue,42);
  assert.equal(hits[0].properties.channel,'web');assert.equal(calls[0].parameters.total,42);
  const invalid=structuredClone(container);invalid.tags[0].parameters.revenue='{{not_registered}}';
  assert.throws(()=>validateContainer(invalid),/parameter variable/);
  invalid.tags[0].parameters.revenue='{{cart_total}}';invalid.tags[0].parameters.secret='{{channel}};process.exit(1)';
  assert.throws(()=>validateContainer(invalid),/parameter variable/);
});
