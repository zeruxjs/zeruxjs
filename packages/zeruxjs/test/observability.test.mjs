import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Logger, createRequestObserver, getRequestCorrelation, parseTraceParent, createHealthHandler, ApplicationError, normalizeApiError, createApplicationLifecycle } from 'zeruxjs';
const response=()=>Object.assign(new EventEmitter(),{headersSent:false,statusCode:200,writableFinished:false,setHeader(){}});
const request=(headers={})=>({headers});
test('propagation validates exact version zero; incoming request IDs never become identity',async()=>{
 assert.equal(parseTraceParent('00-'+'0'.repeat(32)+'-'+'1'.repeat(16)+'-01'),undefined);
 assert.equal(parseTraceParent(['malformed']),undefined);
 const trace='00-'+'a'.repeat(32)+'-'+'b'.repeat(16)+'-01';const spans=[],starts=[];
 const observer=createRequestObserver({applicationId:'app',generationId:'generation',trustTraceParent:true,adapter:{start:c=>starts.push(c),export:s=>spans.push(s)}});
 const res=response();await observer.wrap(async()=>{assert.notEqual(getRequestCorrelation().requestId,'caller');})(request({traceparent:trace,'x-request-id':'caller'}),res);
 res.writableFinished=true;res.emit('finish');res.emit('close');await new Promise(setImmediate);
 assert.equal(starts.length,1);assert.equal(spans.length,1);assert.equal(spans[0].traceId,'a'.repeat(32));assert.equal(spans[0].parentSpanId,'b'.repeat(16));await observer.close();
});
test('disconnect and handler exceptions end each span once',async()=>{
 const ended=[];const observer=createRequestObserver({adapter:{end:s=>ended.push(s),export(){}}});
 const res=response();await observer.wrap(()=>{})(request(),res);res.emit('close');res.emit('finish');
 const failed=response();await assert.rejects(observer.wrap(()=>{throw Error('secret');})(request(),failed));failed.emit('close');
 assert.equal(ended.length,2);assert.equal(ended[0].status,499);assert.equal(ended[1].outcome,'error');await observer.close();
});
test('exporter outage/overload cannot create unbounded work and shutdown has a deadline',async()=>{
 let calls=0,signal;const observer=createRequestObserver({maxQueue:2,shutdownTimeoutMs:20,adapter:{export:(_,s)=>{calls++;signal=s;return new Promise(()=>{});},shutdown:()=>new Promise(()=>{})}});
 for(let i=0;i<20;i++){const res=response();await observer.wrap(()=>{})(request(),res);res.writableFinished=true;res.emit('finish');}
 assert.equal(calls,1);assert.ok(observer.status().queued<=1);assert.ok(observer.status().dropped>0);await observer.close();assert.equal(signal.aborted,true);assert.equal(observer.status().active,0);
 const failing=createRequestObserver({adapter:{export(){throw Error('private');}}});const res=response();await failing.wrap(()=>{})(request(),res);res.emit('close');await new Promise(setImmediate);assert.equal(failing.status().failures,1);await failing.close();
});
test('health responses redact dependencies and diagnostics require explicit authorization',async()=>{
 const handler=createHealthHandler(()=>({live:true,ready:false}),{diagnostics:()=>({private:'details'})});
 assert.equal((await handler(new Request('http://test/'),'liveness')).status,200);
 const ready=await handler(new Request('http://test/'),'readiness');assert.equal(ready.status,503);assert.deepEqual(await ready.json(),{status:'unavailable'});
 assert.equal((await handler(new Request('http://test/'),'diagnostics')).status,403);
 const authorized=createHealthHandler(()=>({live:true,ready:true}),{authorize:()=>true,diagnostics:()=>({active:1})});assert.deepEqual(await(await authorized(new Request('http://test/'),'diagnostics')).json(),{active:1});
});
test('real runtime success, validation/internal failures, sanitized errors and metrics',async()=>{
 const rootDir=await mkdtemp(path.join(os.tmpdir(),'zerux-observe-'));const spans=[],causes=[];let app,server;
 try{
 app=await createApplicationLifecycle({rootDir,config:{observability:{adapter:{export:s=>spans.push(s)},onError:e=>causes.push(e)}},providers:{database:async()=>null,cache:async()=>null}});
 const api=app.runtime().asPluginApi();api.addRoute({pattern:'/ok',handler:()=>({ok:true})});api.addRoute({pattern:'/invalid',handler:()=>{throw new ApplicationError(422,Error('PRIVATE password'));}});api.addRoute({pattern:'/broken',handler:()=>{throw Error('PRIVATE token');}});
 server=http.createServer(app.handle);server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 for(const [route,status,code] of [['/ok',200],['/invalid',422,'VALIDATION_FAILED'],['/broken',500,'INTERNAL_ERROR'],['/missing',404,'NOT_FOUND']]){
 const res=await fetch(base+route,{headers:{accept:'application/json',traceparent:'bad','x-request-id':'PRIVATE'}});assert.equal(res.status,status);const text=await res.text();assert.equal(text.includes('PRIVATE'),false);assert.equal(text.includes('stack'),false);if(code)assert.equal(JSON.parse(text).error.code,code);
 }
 const bad=await fetch(base+'/ok',{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:'{PRIVATE'});assert.equal(bad.status,400);assert.equal((await bad.json()).error.code,'BAD_REQUEST');
 await new Promise(setImmediate);assert.equal(spans.length,5);assert.equal(causes.length,3);assert.equal(app.runtime().getLoadStatus().completed,5);assert.equal(app.runtime().getHealthStatus().ready,true);assert.equal(JSON.stringify(app.runtime().toManifest()).includes('observability'),false);
 api.addRoute({pattern:'/html',handler:()=>'<h1>safe</h1>'});
 assert.equal(await(await fetch(base+'/html',{headers:{accept:'text/html'}})).text(),'<h1>safe</h1>');
 api.addRoute({pattern:'/declared',meta:{api:true},handler:()=>{throw new ApplicationError(403,Error('PRIVATE'));}});
 assert.equal((await(await fetch(base+'/declared',{headers:{accept:'text/html'}})).json()).error.code,'FORBIDDEN');
 const legacy=await(await fetch(base+'/broken',{headers:{accept:'text/html'}})).json();assert.equal(legacy.message,'Internal server error');assert.equal(legacy.stack,undefined);

 }finally{if(server)await new Promise(resolve=>server.close(resolve));await app?.close();await rm(rootDir,{recursive:true,force:true});}
 assert.equal(app.runtime().getHealthStatus().live,false);
 assert.equal(normalizeApiError(Error('SECRET')).body.error.code,'INTERNAL_ERROR');
});
test('sampling off is inert; invalid telemetry options fail before providers',async()=>{
 let called=0;const observer=createRequestObserver({sampleRate:0,adapter:{start(){called++;},export(){called++;}}});
 const res=response();await observer.wrap(()=>{})(request(),res);res.emit('close');await observer.close();assert.equal(called,0);
 await assert.rejects(createApplicationLifecycle({rootDir:process.cwd(),config:{observability:{maxQueue:0}},providers:{database:async()=>{called++;}}}));assert.equal(called,0);
});
test('reload keeps application correlation and uses independent generation adapters',async()=>{
 const rootDir=await mkdtemp(path.join(os.tmpdir(),'zerux-span-generations-'));const spans=[],closed=[];
 let created=0;const observability={createAdapter(){const instance=++created;return {export:s=>spans.push(s),shutdown(){closed.push(instance);}};}};
 let app;try{
 const config={observability};app=await createApplicationLifecycle({rootDir,config,providers:{database:async()=>null,cache:async()=>null}});
 const previous=app.runtime().getTelemetryStatus();
 await app.reload(config);const next=app.runtime().getTelemetryStatus();assert.equal(previous.applicationId,next.applicationId);assert.notEqual(previous.generationId,next.generationId);assert.equal(created,2);assert.deepEqual(closed,[1]);await app.close();assert.deepEqual(closed,[1,2]);
 }finally{await app?.close();await rm(rootDir,{recursive:true,force:true});}
});

test('real HTTP disconnect ends one application span and releases listeners',async()=>{
 const ended=[];const observer=createRequestObserver({adapter:{end:s=>ended.push(s),export(){}}});
 const server=http.createServer(observer.wrap((req,res)=>{res.writeHead(200);res.write('partial');}));
 try{
 server.listen(0,'127.0.0.1');await once(server,'listening');
 await new Promise((resolve,reject)=>{const req=http.get(`http://127.0.0.1:${server.address().port}`,res=>{res.once('data',()=>{res.destroy();req.destroy();});res.once('close',resolve);});req.once('error',reject);});
 for(let attempt=0;attempt<20&&ended.length===0;attempt++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(ended.length,1);assert.equal(ended[0].outcome,'disconnected');assert.equal(observer.status().active,0);
 }finally{await new Promise(resolve=>server.close(resolve));await observer.close();}
});
test('direct adapter reload is denied before exporter disposal',async()=>{
 const rootDir=await mkdtemp(path.join(os.tmpdir(),'zerux-owned-exporter-'));let shut=0,app;
 const config={observability:{adapter:{export(){},shutdown(){shut++;}}}};
 try{app=await createApplicationLifecycle({rootDir,config,providers:{database:async()=>null,cache:async()=>null}});await assert.rejects(app.reload(config),{name:'RestartRequiredError'});assert.equal(shut,0);assert.equal(app.runtime().getHealthStatus().live,true);}
 finally{await app?.close();await rm(rootDir,{recursive:true,force:true});}assert.equal(shut,1);
});

test('default logs correlate requests and omit argument payloads and token URLs',async()=>{
 const rootDir=await mkdtemp(path.join(os.tmpdir(),'zerux-log-safe-'));const output=[];
 const log=new Logger({filePath:path.join(rootDir,'app.log')});const original=console.info;console.info=value=>output.push(value);
 const observer=createRequestObserver({applicationId:'logs'});
 try{await observer.wrap(()=>log.info('Failed URL https://user:password@example.test/?token=PRIVATE',{cookie:'PRIVATE',body:'PRIVATE'}))(request(),response());
 assert.equal(output.length,1);assert.equal(output[0].includes('PRIVATE'),false);assert.equal(output[0].includes('requestId'),true);assert.equal(output[0].includes('logs'),true);
 }finally{console.info=original;log.close();await observer.close();await rm(rootDir,{recursive:true,force:true});}
});
