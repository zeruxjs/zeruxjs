/** Package-only acceptance fixture: authenticated tenant -> real SQLite ->
 * analytics -> published tags -> reports HTTP -> marketing suppression.
 * No AIO runtime, external email or Redis queue is simulated as a real provider.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createConnector} from '@zeruxjs/db-sqlite';
import {createAnalytics,createDatabaseDocumentStore} from '@zeruxjs/analytics';
import {emptyTagContainer,saveTagDraft,publishTagDraft,publishedContainer} from '@zeruxjs/tags';
import {createReports} from '@zeruxjs/reports';
import {createMarketingSuppressionService,createDatabaseMarketingSuppressionStore} from '../../packages/@zeruxjs/email/dist/index.js';
const require=createRequire(import.meta.url);
const {createSession,verifySession,hasTenantPermission}=require('../../packages/@zeruxjs/auth/dist/index.js');
const context={connection:{slug:'test',connector:'sqlite',options:{},name:'Package lab'}};
const adapter=driver=>Object.fromEntries(['createTable','createIndex','insert','select','update','delete'].map(op=>[op,request=>driver.execute({...request,op},context)]));
const reportDocument=()=>({version:1,reports:[{id:'traffic',name:'Traffic',pages:[{id:'overview',name:'Overview',charts:[{id:'events',title:'Events',type:'kpi',metric:'count',groupBy:'event',limit:10}]}]}]});

test('signed session and tenant scope control a real SQLite analytics-to-report pipeline',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'section83-pipeline-'));
 let db;
 try{
  db=await createConnector({filename:join(directory,'lab.sqlite'),driver:'node'},context.connection);
  const storage=adapter(db);
  const analytics=createAnalytics({analytics:'test',database:{connectionSlugs:['test'],getConnectionFacade:()=>storage}});
  assert.equal(await analytics.initialize(),true);
  for(let i=0;i<7;i++)assert.ok(await analytics.track({name:'view',site:'site-a',source:'server'}));
  for(let i=0;i<3;i++)assert.ok(await analytics.track({name:'view',site:'site-b',source:'server'}));
  const stores={
   'site-a':createDatabaseDocumentStore(storage,'section83_reports','site-a',reportDocument()),
   'site-b':createDatabaseDocumentStore(storage,'section83_reports','site-b',reportDocument())
  };
  const principals={a:createSession('editor-a',{tenantId:'site-a',permissions:['reports:read'],siteIds:['site-a']}),b:createSession('editor-b',{tenantId:'site-b',permissions:['reports:read'],siteIds:['site-b']})};
  const identity=request=>verifySession((request.headers.get('authorization')||'').replace(/^Bearer /,''));
  const reports=createReports({analytics,
   authorize:request=>{const principal=identity(request);return !!principal&&hasTenantPermission(principal,{tenantId:principal.tenantId,siteId:principal.tenantId,permission:'reports:read'});},
   resolveScope:request=>{const principal=identity(request);return {site:principal?.tenantId||'unauthorized',store:stores[principal?.tenantId]};}
  });
  const query=reports.routes().find(r=>r.pattern==='/_reports/query')?.handler;
  assert.equal(typeof query,'function');
  const call=async token=>query(new Request('https://local.test/_reports/query?report=traffic&page=overview&chart=events',{
   headers:{...(token?{authorization:`Bearer ${token}`}:{})}
  }));
  const ownA=await call(principals.a),ownB=await call(principals.b),anonymous=await call();
  assert.equal(ownA.status,200);assert.equal((await ownA.json()).total,7);
  assert.equal(ownB.status,200);assert.equal((await ownB.json()).total,3);
  assert.notEqual(anonymous.status,200);
  assert.equal(hasTenantPermission(identity(new Request('https://local.test/',{headers:{authorization:`Bearer ${principals.a}`}})),{tenantId:'site-b',permission:'reports:read'}),false);

  const tags=createDatabaseDocumentStore(storage,'section83_tags','site-a',emptyTagContainer('site-a'));
  const before=await tags.load();
  assert.equal(await saveTagDraft(tags,{...before,version:before.version+1,name:'Draft site A'},before.version),true);
  assert.equal((await publishedContainer(await tags.load())).name,'Default');
  assert.equal(await publishTagDraft(tags,2),true);
  assert.equal((await publishedContainer(await tags.load())).name,'Draft site A');

  const suppress=createMarketingSuppressionService({store:createDatabaseMarketingSuppressionStore(storage)});
  await suppress.recordFeedback({email:'blocked@example.test',kind:'hard-bounce',eventId:'section83-test-1'});
  assert.equal((await suppress.status('blocked@example.test')).blocked,true);
  assert.equal(await suppress.status('ok@example.test'),null);
 }finally{await db?.disconnect?.();await rm(directory,{recursive:true,force:true});}
});
