import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApplicationLifecycle} from 'zeruxjs';
import {registerServiceEndpoints,createServiceClient,createTransactionalOutbox} from 'zeruxjs/service-endpoints';
import {createProtocolGateway} from 'zhost/protocols';
import {createPinnedTransaction} from '@zeruxjs/db';
import {object,string} from '@zeruxjs/validator/schemas';
const limits={maxMessageBytes:4096,maxConcurrent:4,timeoutMs:500};
const schema=object({value:string()});
const listen=async server=>{server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;};
async function fixture(){const rootDir=await mkdtemp(path.join(os.tmpdir(),'zx007-'));const app=await createApplicationLifecycle({rootDir,config:{},providers:{database:async()=>null,cache:async()=>null}});return {app,api:app.runtime().asPluginApi(),async close(){await app.close();await rm(rootDir,{recursive:true,force:true});}};}
function endpoint(name,gateway,extra={}){return {name,transport:'http',bind:{host:'127.0.0.1',port:0},limits,gateway,authorize:req=>req.headers.authorization==='test',...extra};}
function options(endpoint,extra={}){return {endpoint,timeoutMs:200,maxPayloadBytes:4096,maxConcurrent:2,transport:fetch,allowDestination:url=>url.hostname==='127.0.0.1',headers:()=>({authorization:'test'}),schema,retry:{maxAttempts:1,idempotent:false},...extra};}

test('multiple inert endpoints start independently and close with their owning generation',async()=>{
 const f=await fixture();let client;
 try{const a=createProtocolGateway({authorize:()=>true}),b=createProtocolGateway({authorize:()=>true});let deadline;
 a.connect.register('app.Status','Get',(input,ctx)=>{deadline=ctx.deadline;return input;});b.connect.register('app.Status','Get',()=>({value:'second'}));
 const group=registerServiceEndpoints(f.api,[endpoint('first',a),endpoint('second',b)]);assert.equal(group.address('first'),null);assert.throws(()=>registerServiceEndpoints(f.api,[endpoint('other',createProtocolGateway())]));
 const cleanup=await f.app.runtime().workers.get('service-endpoints').start({});
 assert.notEqual(group.address('first').port,group.address('second').port);
 client=createServiceClient(options(`http://127.0.0.1:${group.address('first').port}/app.Status/Get`));const until=Date.now()+150;
 assert.deepEqual(await client.call({value:'normal'},{deadline:until}),{value:'normal'});assert.equal(deadline,until);
 const denied=createServiceClient(options(`http://127.0.0.1:${group.address('second').port}/app.Status/Get`,{headers:()=>({authorization:'denied'})}));await assert.rejects(denied.call({value:'private'}),e=>e.code==='CALL_HTTP_FAILED');await denied.close();
 await cleanup();assert.equal(group.address('first'),null);assert.equal(group.address('second'),null);
 }finally{await client?.close();await f.close();}
});
test('conflicts and missing endpoint policy reject without listeners; bind failure rolls back siblings',async()=>{
 const f=await fixture(),blocker=createServer();const port=await listen(blocker);
 try{assert.throws(()=>registerServiceEndpoints(f.api,[endpoint('a',createProtocolGateway(),{authorize:undefined})]));assert.throws(()=>registerServiceEndpoints(f.api,[endpoint('a',createProtocolGateway(),{bind:{host:'127.0.0.1',port}}),endpoint('b',createProtocolGateway(),{bind:{host:'0.0.0.0',port}})]));
 const group=registerServiceEndpoints(f.api,[endpoint('first',createProtocolGateway()),endpoint('blocked',createProtocolGateway(),{bind:{host:'127.0.0.1',port}})]);
 await assert.rejects(group.start(),{code:'TRANSPORT_START_FAILED'});assert.equal(group.address('first'),null);assert.equal(group.address('blocked'),null);
 }finally{await new Promise(r=>blocker.close(r));await f.close();}
});
test('caller cancellation aborts an in-flight service handler and does not retry a write',async()=>{
 const f=await fixture();let client,started,stopped,calls=0;const began=new Promise(r=>started=r),ended=new Promise(r=>stopped=r);
 try{const gateway=createProtocolGateway({authorize:()=>true});gateway.connect.register('app.Write','Run',(_input,{signal})=>new Promise(resolve=>{calls++;started();signal.addEventListener('abort',()=>{stopped();resolve({value:'cancelled'});},{once:true});}));const group=registerServiceEndpoints(f.api,[endpoint('writer',gateway)]);await group.start();client=createServiceClient(options(`http://127.0.0.1:${group.address('writer').port}/app.Write/Run`));const controller=new AbortController(),call=client.call({value:'write'},{signal:controller.signal});const rejected=assert.rejects(call,e=>e.code==='CALL_CANCELLED');await began;controller.abort();await rejected;await ended;assert.equal(calls,1);assert.equal(client.activeCalls,0);
 }finally{await client?.close();await f.close();}
});
test('client bounds, response cleanup, explicit retry policy and closed use',async()=>{
 let calls=0,cancelled=0;
 const make=(extra={})=>options('http://127.0.0.1:12345/test',{transport:async()=>{calls++;return Response.json({value:'ok'});},...extra});
 assert.throws(()=>createServiceClient(make({retry:{maxAttempts:2,idempotent:false}})));assert.throws(()=>createServiceClient(make({allowDestination:()=>false})));
 const limited=createServiceClient(make({maxPayloadBytes:8}));await assert.rejects(limited.call({value:'too large'}),e=>e.code==='PAYLOAD_LIMIT');assert.equal(calls,0);await limited.close();await assert.rejects(limited.call({}),e=>e.code==='CLIENT_CLOSED');
 const retry=createServiceClient(make({retry:{maxAttempts:2,idempotent:true},transport:async()=>{calls++;return calls===1?new Response('failure',{status:503}):Response.json({value:'retry'});}}));assert.deepEqual(await retry.call({}),{value:'retry'});assert.equal(calls,2);await retry.close();
 const oversized=createServiceClient(make({maxPayloadBytes:8,transport:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(9));},cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}})}));await assert.rejects(oversized.call({}),e=>e.code==='CALL_BODY_LIMIT');assert.equal(cancelled,1);await oversized.close();
 const slow=createServiceClient(make({timeoutMs:10,transport:async req=>new Promise((_resolve,reject)=>req.signal.addEventListener('abort',()=>reject(Error('private')),{once:true}))}));await assert.rejects(slow.call({}),e=>e.code==='CALL_CANCELLED'&&!e.message.includes('private'));assert.equal(slow.activeCalls,0);await slow.close();
});
function pinned(){const log=[];let id=0;const capabilities={isolationLevels:['serializable'],timeout:'cooperative',savepoints:false,transactionalDdl:false};const adapter={capabilities,async acquire(){const pin=++id;return {begin(){log.push(['begin',pin]);},execute(operation){log.push([operation.table,pin]);return {ok:true,affectedCount:1};},commit(){log.push(['commit',pin]);},rollback(){log.push(['rollback',pin]);},release(){log.push(['release',pin]);}};}};return {log,facade:{transaction:createPinnedTransaction(adapter,{name:'test',slug:'test',connector:'synthetic',options:{}}),transactionCapabilities:()=>capabilities}};}
test('outbox uses the real shared pin, awaits journal writes and rolls back on journal failure',async()=>{
 assert.throws(()=>createTransactionalOutbox({}, {enqueue(){}}),e=>e.code==='OUTBOX_PINNED_TRANSACTION_REQUIRED');
 const f=pinned();let pin,escaped;
 const outbox=createTransactionalOutbox(f.facade,{async enqueue(tx,event){assert.equal(tx,pin);await tx.query({op:'insert',table:'outbox',values:event});}});
 await outbox.run(async(tx,enqueue)=>{pin=tx;escaped=enqueue;await tx.query({op:'insert',table:'business',values:{id:1}});void enqueue({id:2});},{isolation:'serializable'});
 assert.deepEqual(f.log,[['begin',1],['business',1],['outbox',1],['commit',1],['release',1]]);await assert.rejects(escaped({id:3}),e=>e.code==='OUTBOX_SCOPE_CLOSED');
 const failed=pinned(),broken=createTransactionalOutbox(failed.facade,{enqueue(){throw Error('journal failed');}});await assert.rejects(broken.run(async(_tx,enqueue)=>{await enqueue({id:1}).catch(()=>{});}),/journal failed/);assert.deepEqual(failed.log,[['begin',1],['rollback',1],['release',1]]);
});

test('outbox budgets taint the pin even if application code catches enqueue failures',async()=>{
 const f=pinned(),outbox=createTransactionalOutbox(f.facade,{enqueue(){}});
 await assert.rejects(outbox.run(async(_tx,enqueue)=>{for(let i=0;i<65;i++)await enqueue({id:i}).catch(()=>{});}),e=>e.code==='OUTBOX_EVENT_LIMIT');assert.equal(f.log.some(([name])=>name==='commit'),false);assert.equal(f.log.at(-1)[0],'release');
});

test('noncooperative client transport retains capacity until its actual settlement',async()=>{
 let finish,started;const began=new Promise(resolve=>started=resolve);
 const client=createServiceClient(options('http://127.0.0.1:1/call',{maxConcurrent:1,transport:async()=>{started();return new Promise(resolve=>finish=()=>resolve(Response.json({value:'late'})));}}));
 const controller=new AbortController(),call=client.call({},{signal:controller.signal});const rejected=assert.rejects(call,e=>e.code==='CALL_CANCELLED');await began;controller.abort();assert.equal(client.activeCalls,1);await assert.rejects(client.call({}),e=>e.code==='CLIENT_OVERLOAD');finish();await rejected;assert.equal(client.activeCalls,0);await client.close();
});
