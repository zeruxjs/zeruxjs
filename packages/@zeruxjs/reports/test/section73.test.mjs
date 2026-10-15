import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReports,createMemoryReportsStore,queryChart,validateReports,marketingDeliveryPageCharts,campaignActivityCharts} from '../dist/index.js';
const chart={id:'events',title:'Events',type:'table',metric:'count',groupBy:'event',limit:20};
const report=(id='r',charts=[chart])=>({version:1,reports:[{id,name:id,pages:[{id:'overview',name:'Overview',charts}]}]});
const source={events:async ({site})=>[{site,event_name:'purchase',source:'web',pathname:'/',occurred_at:Date.UTC(2026,9,14),properties_json:'{"amount":5}'}],
 aggregate:async ({site})=>({groups:[{category:site??'default',value:13}],total:13,truncated:false,mode:'database',groupBy:'event'})};
const req=(path,options={})=>new Request('https://example.test/_reports'+path,options);
const getRoutes=options=>new Map(createReports({analytics:source,...options}).routes().map(r=>[r.pattern.slice('/_reports'.length),r.handler]));

test('role-separated editor, viewer and exporter permissions have no fallback',async()=>{
 const store=createMemoryReportsStore(report());
 const routes=getRoutes({store,authorize:async(req,action)=>({viewer:['read'],writer:['read','edit'],exporter:['read','export']})[req.headers.get('x-role')]?.includes(action)??false});
 const put=role=>req('/api',{method:'PUT',headers:{'x-role':role,origin:'https://example.test'},body:JSON.stringify({...report(),version:2})});
 assert.equal((await routes.get('/api')(put('viewer'))).status,403);
 assert.equal((await routes.get('/export')(req('/export?report=r&page=overview',{headers:{'x-role':'viewer'}}))).status,403);
 assert.equal((await routes.get('/api')(put('writer'))).status,200);
 assert.equal((await routes.get('/export')(req('/export?report=r&page=overview&format=csv',{headers:{'x-role':'exporter'}}))).status,200);
 assert.equal((await routes.get('/api')(put('exporter'))).status,403);
});
test('dynamic tenant scope isolates both definitions and query data, even when chart filters lie',async()=>{
 const a=createMemoryReportsStore(report('alice',[{...chart,site:'bob'}]));
 const b=createMemoryReportsStore(report('bob',[{...chart,site:'alice'}]));
 const calls=[];const local={...source,aggregate:async q=>{calls.push(q);return source.aggregate(q);}};
 const routes=getRoutes({resolveScope:req=>({site:req.headers.get('x-tenant'),store:req.headers.get('x-tenant')==='alice'?a:b,source:local}),
   authorize:req=>['alice','bob'].includes(req.headers.get('x-tenant'))});
 const page=async(tenant,chartId='events')=>(await routes.get('/query')(req(`/query?report=${tenant}&page=overview&chart=${chartId}`,{headers:{'x-tenant':tenant}}))).json();
 assert.equal((await page('alice')).labels[0],'alice');assert.equal((await page('bob')).labels[0],'bob');
 assert.deepEqual(calls.map(q=>q.site),['alice','bob']);
 assert.equal((await routes.get('/query')(req('/query?report=bob&page=overview&chart=events',{headers:{'x-tenant':'alice'}}))).status,404);
 const unscoped=createReports({analytics:source,resolveScope:()=>({site:'alice',store:a}),authorize:()=>true});
 await assert.rejects(()=>unscoped.query('alice','overview','events'),/Tenant-scoped/);
});
test('scope resolver failure and missing site are rejected, never query a cross-tenant source',async()=>{
 let read=0;
 const routes=getRoutes({resolveScope:()=>({site:'',store:createMemoryReportsStore()}),authorize:()=>true,source:{events:async()=>{read++;return [];}}});
 assert.equal((await routes.get('/query')(req('/query?report=r&page=overview&chart=events'))).status,503);assert.equal(read,0);
});
test('catalog paginates with version-aware cursors',async()=>{
 const store=createMemoryReportsStore({version:1,reports:Array.from({length:43},(_,i)=>({id:'r'+i,name:'Report '+i,pages:[]}))});
 const routes=getRoutes({store,authorize:()=>true});
 let cursor=null,count=0;
 for(let i=0;i<3;i++){
  const p=cursor?'?limit=20&cursor='+encodeURIComponent(cursor):'?limit=20';
  const res=await (await routes.get('/catalog')(req('/catalog'+p))).json();count+=res.items.length;cursor=res.nextCursor;
 }
 assert.equal(count,43);assert.equal(cursor,null);
 assert.equal((await routes.get('/catalog')(req('/catalog?cursor=0:20'))).status,409);
 assert.equal((await routes.get('/catalog')(req('/catalog?limit=500'))).status,422);
});
test('UTC date query overrides are bounded and do not update stored definitions',async()=>{
 const seen=[];const routes=getRoutes({store:createMemoryReportsStore(report()),source:{events:source.events,aggregate:async q=>{seen.push(q);return source.aggregate(q);}},authorize:()=>true,site:'alice'});
 let path='/query?report=r&page=overview&chart=events';
 assert.equal((await routes.get('/query')(req(path+'&since=1800000000000'))).status,422);
 assert.equal((await routes.get('/query')(req(path+'&since=0&until=9999999999999'))).status,422);
 const now=Date.UTC(2026,9,13),later=Date.UTC(2026,9,14);
 assert.equal((await routes.get('/query')(req(path+`&since=${now}&until=${later}`))).status,200);
 assert.equal(seen[0].since,now);assert.equal(seen[0].until,later);
 assert.equal((await routes.get('/api')(req('/api'))).status,200);
});
test('CSV is bounded, quotes cells, and neutralizes spreadsheet formula payloads',async()=>{
 const store=createMemoryReportsStore(report('r',[{...chart,groupBy:'property:unsafe'}]));
 const events={events:async()=>[{event_name:'view',site:'alice',source:'web',pathname:'/',occurred_at:Date.now(),properties_json:JSON.stringify({unsafe:'=HYPERLINK("https://bad")'})}]};
 const routes=getRoutes({source:events,site:'alice',store,authorize:(_req,action)=>['read','export','sensitive'].includes(action)});
 const route=routes.get('/export');
 const res=await route(req('/export?report=r&page=overview&format=csv'));
 assert.equal(res.status,200);const contents=await res.text();assert.match(contents,/"'=HYPERLINK/);
 assert.match(res.headers.get('content-disposition'),/attachment/);
 const deny=getRoutes({source:events,site:'alice',store,authorize:(_req,action)=>action!=='sensitive'});
 assert.equal((await deny.get('/query')(req('/query?report=r&page=overview&chart=events'))).status,403);
 assert.equal((await deny.get('/export')(req('/export?report=r&page=overview'))).status,403);
});
test('sampling average excludes missing/non-numeric facts and overall total is not sum of per-group averages',async()=>{
 const src={events:async()=>[
   {site:'a',event_name:'x',properties_json:'{"cost":10}',occurred_at:1},
   {site:'a',event_name:'x',properties_json:'{"cost":20}',occurred_at:1},
   {site:'a',event_name:'x',properties_json:'{}',occurred_at:1},
   {site:'a',event_name:'y',properties_json:'{"cost":30}',occurred_at:1}]};
 const data=await queryChart(src,{...chart,metric:'average',valueField:'cost'},20,'a');
 assert.equal(data.total,20);assert.deepEqual(data.values,[30,15]);
 await assert.rejects(()=>queryChart({events:async()=>Array(21).fill({})},chart,20),/more than/);
});
test('invalid saved time range and prototype property dimension are refused',()=>{
 assert.throws(()=>validateReports(report('r',[{...chart,since:99,until:5}])));
 assert.throws(()=>validateReports(report('r',[{...chart,groupBy:'property:constructor'}])));
});
const states={notQueued:0,pending:0,claimed:0,sending:0,smtpAccepted:1,suppressed:1,uncertain:0,rejected:0,missing:0};
const delivery={campaignCode:'send',status:'ready',scanned:2,states,nextCursor:null,done:true,scope:'complete',disclaimer:'smtpAccepted is not confirmed mailbox delivery'};
test('marketing delivery charts never represent a partial page as campaign-wide',()=>{
 const complete=marketingDeliveryPageCharts(delivery);assert.equal(complete.statuses.coverage,'complete-recipient-scan');
 const partial=marketingDeliveryPageCharts({...delivery,done:false,nextCursor:'next',scope:'page'});
 assert.equal(partial.statuses.queryMode,'sampled');assert.equal(partial.coverage.nextCursor,'next');
 assert.throws(()=>marketingDeliveryPageCharts({...delivery,scanned:100}));
});
test('campaign action auth, scope and bounded page controls enforced before reading campaign',async()=>{
 let reads=0;const routes=getRoutes({site:'alice',authorize:(_req,action,code)=>action==='campaign'&&code==='send',
  campaigns:{async report(code,{site,limit}){reads++;assert.equal(site,'alice');assert.equal(limit,200);return {...delivery,campaignCode:code}}}});
 const route=routes.get('/campaign');
 assert.equal((await route(req('/campaign?code=other'))).status,403);assert.equal(reads,0);
 assert.equal((await route(req('/campaign?code=send&limit=201'))).status,422);assert.equal(reads,0);
 const summary=await (await route(req('/campaign?code=send'))).json();assert.equal(summary.coverage.scope,'complete');assert.equal(reads,1);
});
test('activity charts disclose observed events only, never unique readers',()=>{
 const value={campaignCode:'send',from:'2026-10-01',to:'2026-10-02',opens:45,clicks:12,downloads:4,downloadClicks:5,coverage:'observed-tracking-events-only',uniqueRecipients:null};
 assert.equal(campaignActivityCharts(value).activity.values[0],45);
 assert.match(campaignActivityCharts(value).disclaimer,/prefetched/);
 assert.throws(()=>campaignActivityCharts({...value,uniqueRecipients:25}));
});
test('report dashboard uses script/style hashes rather than unsafe-inline CSP',async()=>{
 const routes=getRoutes({authorize:()=>true});const res=await routes.get('')(req(''));
 const csp=res.headers.get('content-security-policy');assert.match(csp,/sha256-/);assert.doesNotMatch(csp,/unsafe-inline/);
});
test('native adapters cannot fabricate count totals or return invalid numeric coverage',async()=>{
 await assert.rejects(()=>queryChart({...source,aggregate:async()=>({groups:[{category:'a',value:8}],total:4,truncated:false,mode:'database',groupBy:'event'})},chart),/Invalid native/);
 await assert.rejects(()=>queryChart({...source,aggregateNumeric:async()=>({groups:[{category:'a',value:10}],total:10,matchedFacts:2,truncated:false,mode:'materialized',coverage:'complete',groupBy:'event',metric:'sum',valueField:'amount'})},
 {...chart,metric:'sum',valueField:'amount'}),/Invalid indexed/);
});
test('multi-chart export refuses over-budget pages and native day-query amplification',async()=>{
 const many=Array.from({length:13},(_,i)=>({...chart,id:'c'+i}));
 const routes=getRoutes({store:createMemoryReportsStore(report('r',many)),authorize:()=>true});
 assert.equal((await routes.get('/export')(req('/export?report=r&page=overview'))).status,422);
 const daily=[{...chart,id:'a',groupBy:'day',since:0,until:365*86400000},{...chart,id:'b',groupBy:'day',since:0,until:365*86400000}];
 const other=getRoutes({store:createMemoryReportsStore(report('r',daily)),authorize:()=>true});
 assert.equal((await other.get('/export')(req('/export?report=r&page=overview'))).status,422);
});
test('native report queries respect contract boundaries with direct validation',async()=>{
 const a=await queryChart(source,{...chart,id:'ReportValidation'});
 assert.equal(a.total,13);
 const b=await queryChart(source,{...chart,id:'PageValidation'});
 assert.equal(b.total,13);
});
test('campaign daily route rejects date errors and campaign scope mismatch',async()=>{
 let calls=0;
 const routes=getRoutes({site:'tenant',authorize:(_req,action)=>action==='campaign',
   campaigns:{report:async()=>delivery,dailyTrends:async()=>{calls++;return {campaignId:'other'};}}});
 const route=routes.get('/campaign');
 assert.equal((await route(req('/campaign?code=send&kind=daily&from=2026-02-30&to=2026-03-01'))).status,422);
 assert.equal(calls,0);
 assert.equal((await route(req('/campaign?code=send&kind=daily&from=2026-10-01&to=2026-10-02'))).status,503);
 assert.equal(calls,1);
});
test('malformed persisted documents are unavailable, not invalid user submissions',async()=>{
 const corrupted={load:async()=>({version:1,reports:[{id:'x',name:'A',pages:[{id:'x',name:'B',charts:[]}]}]}),save:async()=>true};
 const routes=getRoutes({store:corrupted,authorize:()=>true});
 assert.equal((await routes.get('/api')(req('/api'))).status,503);
});
