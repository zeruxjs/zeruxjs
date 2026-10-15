import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initializeRuntimeServices} from '../dist/bootstrap/services.js';
const providers=events=>({
 database:async()=>({close(){events.push('db')}}),
 cache:async()=>({close(){events.push('cache')}}),
 queue:async config=>({queue:name=>({add:async()=>({id:'1'})}),close:async()=>events.push('queue')}),
});
test('queue config is private and queue closes before cache/database',async()=>{
 const events=[];
 const config={queue:{enabled:true,redis:{url:'redis://:secret@localhost:6379'},queues:['emails']}};
 const scope=await initializeRuntimeServices(config,process.cwd(),providers(events));
 assert.equal(config.queue,undefined);
 assert.equal(scope.status().find(x=>x.name==='queue').state,'ready');
 assert.equal((await scope.get('queue').queue('emails').add()).id,'1');
 await scope.close();assert.deepEqual(events,['queue','cache','db']);
});
test('queue defaults to optional; required queue failure rolls back startup',async()=>{
 const events=[];const p={...providers(events),queue:async()=>{throw Error('Redis offline')}};
 const saved=console.warn;console.warn=()=>{};
 try {
   const scope=await initializeRuntimeServices({queue:{enabled:true,redis:{host:'localhost'},queues:['emails']}},process.cwd(),p);
   assert.equal(scope.status().find(x=>x.name==='queue').state,'degraded');await scope.close();
   assert.deepEqual(events,['cache','db']);
   events.length=0;
   await assert.rejects(initializeRuntimeServices({queue:{enabled:true,required:true,redis:{host:'localhost'},queues:['emails']}},process.cwd(),p),/Redis offline/);
   assert.deepEqual(events,['cache','db']);
 }finally{console.warn=saved;}
});
test('optional queue dashboard HTTP routes are generation-owned and private',async()=>{
 const events=[];
 const p={...providers(events),queue:async()=>({routes:()=>[
  {pattern:'/_queue/admin',handler:async()=>new Response('private')},
  {pattern:'/_queue/admin/api',handler:async()=>new Response('{}')}
 ],close:async()=>events.push('queue')})};
 const config={queue:{enabled:true,required:true,redis:{url:'redis://secret'},queues:['emails'],dashboard:{authorize:()=>({id:1}),csrfToken:()=>''}}};
 const scope=await initializeRuntimeServices(config,process.cwd(),p);
 assert.equal(config.queue,undefined);
 assert.deepEqual(scope.httpRoutes().map(r=>[r.service,r.pattern]),[['queue','/_queue/admin'],['queue','/_queue/admin/api']]);
 await scope.close();assert.deepEqual(scope.httpRoutes(),[]);assert.deepEqual(events,['queue','cache','db']);
});
test('a failed queue route mount closes the newly created queue and fails required startup',async()=>{
 const events=[];
 const p={...providers(events),queue:async()=>({routes:()=>[{pattern:'/unsafe/../admin',handler:()=>new Response()}],close:async()=>events.push('queue')})};
 await assert.rejects(initializeRuntimeServices({queue:{enabled:true,required:true,redis:{host:'localhost'},queues:['emails']}},process.cwd(),p),/Invalid service HTTP route/);
 assert.deepEqual(events,['queue','cache','db']);
});
