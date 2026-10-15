import {test} from 'node:test';import assert from 'node:assert/strict';
import {initializeRuntimeServices} from '../dist/bootstrap/services.js';
import {createTagManager,emptyTagContainer} from '@zeruxjs/tags';
import {createReports} from '@zeruxjs/reports';
import {createMemoryRequestIdStore} from '@zeruxjs/analytics';
const hits=[];
const analytics={track:async ev=>{hits.push(ev);return 'ok';},events:async()=>[],createRequestIdStore:()=>createMemoryRequestIdStore()};
function providers(){return {
 database:async()=>({}),cache:async()=>({}),analytics:async()=>analytics,
 tags:async(config,a)=>createTagManager({...config,analytics:a,requestIds:config.requestIds??createMemoryRequestIdStore(),container:emptyTagContainer()}),
 reports:async(config,a)=>createReports({...config,analytics:a})
};}
test('tags and reports HTTP mounts, lifecycle, redacted config and browser ingress',async()=>{
 const config={analytics:{analytics:'main',enabled:true},tags:{enabled:true,allowedOrigins:['https://myapp.test'],authorizeAdmin:r=>r.headers.get('x-access')==='yes'},reports:{enabled:true,authorize:r=>r.headers.get('x-access')==='yes'}};
 const scope=await initializeRuntimeServices(config,process.cwd(),providers());
 try{
  assert.deepEqual(scope.status().slice(-2).map(x=>x.name),['tags','reports']);
  assert.equal(config.tags,undefined);assert.equal(config.reports,undefined);
  const routes=scope.httpRoutes(),paths=routes.map(r=>r.pattern);
  assert.ok(paths.includes('/_tags/collect'));assert.ok(paths.includes('/_tags/ttag.js'));assert.ok(paths.includes('/_reports/api'));
  const script=await routes.find(r=>r.pattern==='/_tags/ttag.js').handler(new Request('https://myapp.test/_tags/ttag.js'));
  assert.equal(script.status,200);assert.ok((await script.text()).includes('sendBeacon'));
  const id='ABCDEFGHIJ123456';const collector=routes.find(r=>r.pattern==='/_tags/collect');
  const request=()=>new Request('https://myapp.test/_tags/collect',{method:'POST',headers:{origin:'https://myapp.test','content-type':'application/json'},body:JSON.stringify({name:'signup',requestId:id,properties:{tier:'free'}})});
  assert.equal((await collector.handler(request())).status,204);assert.equal(hits.length,1);
  assert.equal((await collector.handler(request())).status,409);assert.equal(hits.length,1);
  const api=routes.find(r=>r.pattern==='/_reports/api');assert.equal((await api.handler(new Request('https://myapp.test/_reports/api'))).status,403);
 }finally{await scope.close();}
 assert.equal(scope.httpRoutes().length,0);
});
test('invalid report authentication config never mounts insecure admin',async()=>{
 const cfg={analytics:{enabled:true},reports:{enabled:true}};
 const scope=await initializeRuntimeServices(cfg,process.cwd(),{
  ...providers(),reports:async(config,a)=>createReports({...config,analytics:a})
 });try{assert.equal(scope.status().find(x=>x.name==='reports').state,'degraded');assert.equal(scope.httpRoutes().length,0);}finally{await scope.close();}
});
test('default framework initializers dynamically mount real Tags/Reports packages',async()=>{
 const cfg={analytics:{enabled:true},tags:{enabled:true,allowedOrigins:['https://myapp.test'],authorizeAdmin:()=>true},reports:{enabled:true,authorize:()=>true}};
 const scope=await initializeRuntimeServices(cfg,process.cwd(),{database:async()=>({}),cache:async()=>({}),analytics:async()=>analytics});
 try{assert.equal(scope.status().find(x=>x.name==='tags').state,'ready');assert.equal(scope.status().find(x=>x.name==='reports').state,'ready');
 assert.ok(scope.httpRoutes().some(r=>r.pattern==='/_tags/admin/preview'));assert.ok(scope.httpRoutes().some(r=>r.pattern==='/_reports/query'));
 }finally{await scope.close();}
});
