import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
import {createTagManager,createMemoryTagStore,emptyTagContainer,browserScript,validateContainer} from '../dist/index.js';
import {createMemoryRequestIdStore,createRequestId,requestUtcDay} from '@zeruxjs/analytics';
const analytics=()=>{const hits=[];return {hits,manager:{track:async(ev)=>{hits.push(ev);return 'persisted';}}};};
test('default tag container records server events and exposes astag commands',async()=>{
 const {hits,manager}=analytics(),runtime=createTagManager({analytics:manager,requestIds:createMemoryRequestIdStore()});
 const astag=runtime.createAstag({site:'main',sessionId:'anon1'});
 assert.equal(await astag('set','color','blue'),true);assert.equal(await astag('get','color'),'blue');
 await astag('config',{pathname:'/test'});const a=await astag('event','purchase',{amount:8});const b=await astag('event','step',{step:2});
 assert.equal(a.requestId,b.requestId);assert.equal(a.requestId.length,16);assert.equal(hits[0].properties.amount,8);assert.equal(hits[0].site,'main');assert.equal(hits[0].requestUtcDay,requestUtcDay());
 assert.equal((await astag('consent','denied')),true);assert.equal(await astag('event','blocked'),undefined);assert.equal(hits.length,2);
});
test('collector route fires matching triggers only, echoes ID, and does not store replay',async()=>{
 const {hits,manager}=analytics(),container=emptyTagContainer();container.triggers=[{id:'purchase',name:'Purchase',type:'event',event:'purchase',conditions:[{field:'value',operator:'gte',value:10}]}];container.tags[0].triggerIds=['purchase'];
 const runtime=createTagManager({analytics:manager,requestIds:createMemoryRequestIdStore(),container,allowedOrigins:['https://host.test']});
 const route=runtime.routes().find(x=>x.pattern==='/_tags/collect'),id=createRequestId();
 const req=(name,value)=>new Request('https://host.test/_tags/collect',{method:'POST',headers:{origin:'https://host.test','content-type':'application/json'},body:JSON.stringify({requestId:id,name,properties:{value}})});
 const a=await route.handler(req('purchase',12));assert.equal(a.status,204);assert.equal(a.headers.get('x-zerux-request-id'),id);assert.equal(hits.length,1);
 const duplicate=await route.handler(req('purchase',12));assert.equal(duplicate.status,409);assert.equal(hits.length,1);
 const missing=await route.handler(new Request('https://host.test/_tags/collect',{method:'POST',headers:{origin:'https://host.test','content-type':'application/json'},body:JSON.stringify({name:'purchase',properties:{value:12}})}));assert.equal(missing.status,422);
});
test('external GA4 and allowlisted webhook tags use server secrets; bad destination isolated',async()=>{
 const {hits,manager}=analytics(),container=emptyTagContainer(),calls=[];
 container.tags.push({id:'ga4',name:'GA4',type:'ga4',measurementId:'G-ABC1234',credentialRef:'google',triggerIds:['all_events']});
 container.tags.push({id:'external',name:'Webhook',type:'webhook',destinationRef:'crm',triggerIds:['all_events']});
 container.tags.push({id:'broken',name:'Bad',type:'webhook',destinationRef:'missing',triggerIds:['all_events']});
 const rt=createTagManager({analytics:manager,requestIds:createMemoryRequestIdStore(),container,credentials:{google:{secret:'private-api-secret'}},destinations:{crm:{url:'https://example.com/collect'}},fetch:async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body)});return new Response(null,{status:204});}});
 const res=await rt.createAstag({sessionId:'anon123'})('event','purchase',{amount:25});
 assert.deepEqual(res.firedTags,['internal_analytics','ga4','external']);assert.deepEqual(res.failures,['broken']);assert.equal(hits.length,1);
 assert.ok(calls[0].url.includes('api_secret=private-api-secret'));assert.equal(calls[0].body.client_id,'anon123');
 assert.equal(calls[1].url,'https://example.com/collect');assert.equal(JSON.stringify(await rt.container()).includes('private-api-secret'),false);
});
test('tag authorizer required; versioned dashboard editing and CSRF guarded',async()=>{
 const {manager}=analytics(),store=createMemoryTagStore(emptyTagContainer());const rt=createTagManager({analytics:manager,requestIds:createMemoryRequestIdStore(),store,authorizeAdmin:req=>req.headers.get('x-session')==='valid',dashboardHost:'tag.example.com'});
 const api=rt.routes().find(x=>x.pattern==='/_tags/admin/api'),req=(method,body,origin='https://tag.example.com',session='valid')=>new Request('https://tag.example.com/_tags/admin/api',{method,headers:{'x-session':session,origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await api.handler(req('GET',null,undefined,'invalid'))).status,403);
 const current=await (await api.handler(req('GET'))).json();current.version++;
 assert.equal((await api.handler(req('PUT',current,'https://attacker.com'))).status,403);
 assert.equal((await api.handler(req('PUT',current))).status,200);
 assert.equal((await api.handler(req('PUT',current))).status,409);
 const route=rt.routes().find(x=>x.pattern==='/_tags/admin');assert.equal((await route.handler(new Request('https://elsewhere.com/_tags/admin',{headers:{'x-session':'valid'}}))).status,404);
});
test('browser ttag + dataLayer deliver 16-char IDs via sendBeacon, flush at hidden',async()=>{
 const sent=[],listeners={},window={dataLayer:[{event:'boot',properties:{ready:true}}],crypto:webcrypto,addEventListener:(e,fn)=>listeners[e]=fn,console};
 const document={visibilityState:'visible',addEventListener:(e,fn)=>listeners[e]=fn};
 const ctx={window,document,navigator:{sendBeacon:(url,blob)=>{sent.push({url,blob});return true;}},Blob,Promise,Uint8Array,location:{pathname:'/home'},console};
 vm.runInNewContext(browserScript({endpoint:'/_tags/collect',site:'demo',debug:false}),ctx);
 const id=window.ttag('event','click',{label:'save'});assert.match(id,/^[A-Za-z0-9]{16}$/);await new Promise(resolve=>setImmediate(resolve));assert.equal(sent.length,2);
 const sample=JSON.parse(await sent[1].blob.text());assert.equal(sample.requestId,id);assert.equal(sample.site,'demo');assert.equal(sample.name,'click');
 window.ttag('set','campaign','spring');const id2=window.ttag('event','view',{a:2});listeners.pagehide();const last=JSON.parse(await sent[2].blob.text());assert.equal(last.requestId,id2);assert.equal(last.data.campaign,'spring');
});
test('rejects duplicate IDs and prohibited/untrusted tag shapes',()=>{
 const bad=emptyTagContainer();bad.tags[0].triggerIds=['missing'];assert.throws(()=>validateContainer(bad));
 assert.throws(()=>createTagManager({analytics:analytics().manager,requestIds:createMemoryRequestIdStore(),destinations:{bad:{url:'http://127.0.0.1/p'}}}));
});
test('cross-origin subdomain beacon is CORS-simple text/plain and keeps ID correlation',async()=>{
 const {manager,hits}=analytics(),rt=createTagManager({analytics:manager,requestIds:createMemoryRequestIdStore(),publicOrigin:'https://tags.example.com',allowedOrigins:['https://app.example.com']});
 const js=await rt.routes().find(x=>x.pattern==='/_tags/ttag.js').handler(new Request('https://tags.example.com/_tags/ttag.js'));
 assert.ok((await js.text()).includes('https://tags.example.com/_tags/collect'));
 const req=new Request('https://tags.example.com/_tags/collect',{method:'POST',headers:{origin:'https://app.example.com','content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({name:'page_view',requestId:createRequestId(),properties:{name:'welcome'}})});
 const res=await rt.routes().find(x=>x.pattern==='/_tags/collect').handler(req);
 assert.equal(res.status,204);assert.equal(res.headers.get('access-control-allow-origin'),'https://app.example.com');assert.equal(hits.length,1);
});
test('admin dry-run reports trigger matches without recording or firing network tags',async()=>{
 const {manager,hits}=analytics(),rt=createTagManager({analytics:manager,requestIds:createMemoryRequestIdStore(),authorizeAdmin:()=>true});
 const preview=rt.routes().find(x=>x.pattern==='/_tags/admin/preview');
 const req=new Request('https://app.test/_tags/admin/preview',{method:'POST',headers:{origin:'https://app.test','content-type':'application/json'},body:JSON.stringify({name:'purchase',properties:{value:123}})});
 const result=await (await preview.handler(req)).json();assert.deepEqual(result.matchedTriggers,['all_events']);assert.equal(result.candidateTags[0].id,'internal_analytics');assert.equal(hits.length,0);
});
test('published automatic click and pageview triggers use Beacon without extracting form values',async()=>{
 const container=emptyTagContainer();container.triggers=[{id:'click_trigger',name:'Click',type:'click'},{id:'page_trigger',name:'Page',type:'pageview'}];
 container.tags[0].triggerIds=['click_trigger','page_trigger'];
 const rt=createTagManager({analytics:analytics().manager,requestIds:createMemoryRequestIdStore(),container});
 const script=await (await rt.routes().find(r=>r.pattern==='/_tags/ttag.js').handler(new Request('https://app.test/_tags/ttag.js'))).text();
 const sent=[],listeners={},win={crypto:webcrypto,addEventListener:(k,fn)=>listeners['window:'+k]=fn};
 const doc={addEventListener:(k,fn)=>listeners[k]=fn};
 vm.runInNewContext(script,{window:win,document:doc,navigator:{sendBeacon:(url,blob)=>{sent.push(blob);return true;}},location:{pathname:'/home'},Uint8Array,Blob,Promise});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(JSON.parse(await sent[0].text()).name,'page_view');
 listeners.click({target:{closest:()=>({tagName:'A',id:'checkout-link',textContent:'PRIVATE'})}});
 await new Promise(resolve=>setImmediate(resolve));const click=JSON.parse(await sent[1].text());assert.equal(click.name,'click');assert.equal(click.properties.element,'a');assert.ok(!JSON.stringify(click).includes('PRIVATE'));
});
test('default denied telemetry switch suppresses bootstrap events without coupling to marketing consent',async()=>{
 const container=emptyTagContainer();container.triggers=[{id:'page_trigger',name:'Page',type:'pageview'}];container.tags[0].triggerIds=['page_trigger'];
 const rt=createTagManager({analytics:analytics().manager,requestIds:createMemoryRequestIdStore(),container,defaultConsent:'denied'});
 const script=await (await rt.routes().find(r=>r.pattern==='/_tags/ttag.js').handler(new Request('https://app.test/_tags/ttag.js'))).text();
 const sent=[],listeners={};const win={crypto:webcrypto,addEventListener:(k,f)=>listeners[k]=f};
 vm.runInNewContext(script,{window:win,document:{addEventListener:(k,f)=>listeners[k]=f},navigator:{sendBeacon:(u,b)=>{sent.push(b);return true;}},location:{pathname:'/'},Uint8Array,Blob,Promise});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(sent.length,0);
 win.ttag('consent','granted');win.ttag('event','custom',{ok:true});await new Promise(resolve=>setImmediate(resolve));assert.equal(sent.length,1);
});
