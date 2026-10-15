// Section 73: use real SQLite for report CAS, isolated tenant documents and native analytics COUNT.
// Run after building @zeruxjs/db, db-sql-core, db-sqlite, analytics and reports.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createConnector} from '@zeruxjs/db-sqlite';
import {createAnalytics,createDatabaseDocumentStore} from '@zeruxjs/analytics';
import {createReports} from '@zeruxjs/reports';
const connection={slug:'analytics',connector:'sqlite',options:{},name:'Report integration'};
const doc=name=>({version:1,reports:[{id:'traffic',name,pages:[{id:'overview',name:'Overview',charts:[{id:'views',title:'Page views',type:'kpi',metric:'count',groupBy:'event',limit:10,site:'danger-other-tenant'}]}]}]});
function adapter(driver){const ctx={connection};return {
  createTable:op=>driver.execute({...op,op:'createTable'},ctx),
  insert:op=>driver.execute({...op,op:'insert'},ctx),
  select:op=>driver.execute({...op,op:'select'},ctx),
  update:op=>driver.execute({...op,op:'update'},ctx),
  createIndex:op=>driver.execute({...op,op:'createIndex'},ctx)
};}
test('tenant-isolated saved reports, exact SQLite counts and two-manager CAS conflicts',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'zerux-reports-'));
 let d1,d2;
 try{
  const file=join(directory,'reports.sqlite');
  d1=await createConnector({filename:file,driver:'node'},connection);
  d2=await createConnector({filename:file,driver:'node'},connection);
  const a=adapter(d1),b=adapter(d2);
  const analytics=createAnalytics({analytics:'analytics',database:{connectionSlugs:['analytics'],getConnectionFacade:()=>a}});
  assert.equal(await analytics.initialize(),true);
  for(let i=0;i<515;i++)assert.ok(await analytics.track({name:'page_view',site:'alice',source:'server'}));
  for(let i=0;i<9;i++)assert.ok(await analytics.track({name:'page_view',site:'bob',source:'server'}));
  const alice1=createDatabaseDocumentStore(a,'analytics_report_documents','alice',doc('Alice'));
  const alice2=createDatabaseDocumentStore(b,'analytics_report_documents','alice',doc('Alice'));
  const bob=createDatabaseDocumentStore(b,'analytics_report_documents','bob',doc('Bob'));
  const runtime=createReports({analytics,authorize:request=>['alice','bob'].includes(request.headers.get('x-tenant')),
   resolveScope:request=>({site:request.headers.get('x-tenant'),store:request.headers.get('x-tenant')==='alice'?alice2:bob})});
  const routes=new Map(runtime.routes().map(route=>[route.pattern,route.handler]));
  const query=async tenant=>{
    const request=new Request('https://example.com/_reports/query?report=traffic&page=overview&chart=views',{headers:{'x-tenant':tenant}});
    const response=await routes.get('/_reports/query')(request);assert.equal(response.status,200);return response.json();
  };
  assert.equal((await query('alice')).total,515);
  assert.equal((await query('bob')).total,9);
  assert.equal((await alice1.load()).reports[0].name,'Alice');
  const old=await alice1.load();const changed=structuredClone(old);changed.version++;changed.reports[0].name='Updated';
  assert.equal(await alice1.save(changed,old.version),true);
  assert.equal(await alice2.save({...old,version:2},old.version),false);
  assert.equal((await alice2.load()).reports[0].name,'Updated');
  assert.equal((await bob.load()).reports[0].name,'Bob');
 }finally{await d1?.disconnect?.();await d2?.disconnect?.();await rm(directory,{recursive:true,force:true});}
});
