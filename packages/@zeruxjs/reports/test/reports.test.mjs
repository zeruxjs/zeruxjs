import {test} from 'node:test';import assert from 'node:assert/strict';
import {createReports,createMemoryReportsStore,validateReports,queryChart} from '../dist/index.js';
const doc={version:1,reports:[{id:'report',name:'Traffic',pages:[{id:'overview',name:'Overview',charts:[{id:'events',title:'Events by day',type:'line',metric:'count',groupBy:'day',limit:500},{id:'purchase',title:'Sales',type:'bar',metric:'sum',groupBy:'event',eventName:'purchase',valueField:'amount'}]}]}]};
const rows=[{event_name:'page_view',source:'web',site:'app',pathname:'/',occurred_at:Date.UTC(2026,9,11),properties_json:'{}'},{event_name:'purchase',source:'server',site:'app',pathname:'/checkout',occurred_at:Date.UTC(2026,9,11),properties_json:'{"amount":25}'},{event_name:'purchase',source:'web',site:'app',pathname:'/checkout',occurred_at:Date.UTC(2026,9,12),properties_json:'{"amount":15}'}];
const src={events:async(query)=>rows.filter(row=>(!query.name||row.event_name===query.name)&&(!query.source||row.source===query.source)).slice(0,query.limit??500)};
test('groups internal analytics rows into chart series and sums numeric metrics',async()=>{
 const a=await queryChart(src,doc.reports[0].pages[0].charts[0]);assert.deepEqual(a.labels,['2026-10-11','2026-10-12']);assert.deepEqual(a.values,[2,1]);assert.equal(a.truncated,false);
 const b=await queryChart(src,doc.reports[0].pages[0].charts[1]);assert.deepEqual(b.labels,['purchase']);assert.deepEqual(b.values,[40]);
});
test('reports endpoints are authenticated, guarded for CSRF, and honor optimistic versions',async()=>{
 const rt=createReports({analytics:src,store:createMemoryReportsStore(doc),authorize:req=>req.headers.get('x-admin')==='yes',dashboardHost:'reports.example.com'});
 const routes=new Map(rt.routes().map(r=>[r.pattern,r.handler]));const api=routes.get('/_reports/api');const query=routes.get('/_reports/query');
 const get=(path,headers={})=>new Request('https://reports.example.com'+path,{headers});
 assert.equal((await api(get('/_reports/api'))).status,403);
 const current=await (await api(get('/_reports/api',{'x-admin':'yes'}))).json();assert.equal(current.version,1);
 const url='/ _reports/query'.replace(' ','')+'?report=report&page=overview&chart=events';
 const result=await (await query(get(url,{'x-admin':'yes'}))).json();assert.deepEqual(result.values,[2,1]);
 const changed=structuredClone(current);changed.version=2;
 const put=(origin='https://reports.example.com')=>new Request('https://reports.example.com/_reports/api',{method:'PUT',headers:{'x-admin':'yes',origin,'content-type':'application/json'},body:JSON.stringify(changed)});
 assert.equal((await api(put('https://evil.example.com'))).status,403);assert.equal((await api(put())).status,200);assert.equal((await api(put())).status,409);
 assert.equal((await routes.get('/_reports')(get('/_reports',{'x-admin':'yes'}))).status,200);
 assert.equal((await routes.get('/_reports')(new Request('https://evil.example.com/_reports',{headers:{'x-admin':'yes'}}))).status,404);
});
test('invalid charts and field injections are rejected',()=>{
 const modified=structuredClone(doc);modified.reports[0].pages[0].charts[0].groupBy='property:__proto__';assert.throws(()=>validateReports(modified));
 const modified2=structuredClone(doc);modified2.reports[0].pages[0].charts[0].type='eval';assert.throws(()=>validateReports(modified2));
});
test('chart queries signal truncation when source row limit is reached',async()=>{
 const a=await queryChart({events:async()=>Array(5).fill(rows[0])},{...doc.reports[0].pages[0].charts[0],limit:5},5);
 assert.equal(a.truncated,true);assert.equal(a.sampledRows,5);
});
