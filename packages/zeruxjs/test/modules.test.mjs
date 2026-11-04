import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer,request} from 'node:http';
import {once} from 'node:events';
import {createApplicationLifecycle} from 'zeruxjs';
import {registerModule,defineProvider,createProviderToken} from 'zeruxjs/modules';
import {object,string} from '@zeruxjs/validator/schemas';
async function fixture(){const rootDir=await mkdtemp(path.join(os.tmpdir(),'zx006-'));const app=await createApplicationLifecycle({rootDir,config:{},mode:'dev',providers:{database:async()=>null,cache:async()=>null},drainTimeoutMs:100});const server=createServer((req,res)=>void app.handle(req,res).catch(()=>res.destroy()));server.listen(0,'127.0.0.1');await once(server,'listening');return {app,api:app.runtime().asPluginApi(),server,async call(url,body){return new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:server.address().port,path:url,method:body===undefined?'GET':'POST',headers:{accept:'application/json','content-type':'application/json'}},res=>{let text='';res.on('data',x=>text+=x);res.on('end',()=>resolve({status:res.statusCode,body:text}));});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});},async close(){await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(rootDir,{recursive:true,force:true});}};}
const tick=()=>new Promise(r=>setImmediate(r));
test('concurrent requests share a singleton, isolate request scope and dispose dependents first',async()=>{
 const f=await fixture(),s=createProviderToken('singleton'),r=createProviderToken('request'),t=createProviderToken('transient'),log=[];let singleton=0,requestId=0,transient=0;
 try{await registerModule(f.api,{name:'scopes',providers:[defineProvider({token:s,scope:'singleton',dependencies:[],create:async()=>{singleton++;await tick();return 'shared';},dispose:()=>log.push('singleton')}),defineProvider({token:r,scope:'request',dependencies:[s],create:()=>++requestId,dispose:value=>log.push(`request:${value}`)}),defineProvider({token:t,scope:'transient',dependencies:[r],create:()=>++transient,dispose:value=>log.push(`transient:${value}`)})],controllers:[{path:'/scope',async handle(_input,ctx,providers){const [a,b]=await Promise.all([providers.get(r),providers.get(r)]);const x=await providers.get(t),y=await providers.get(t);await tick();return {a,b,x,y};}}]});
 const results=await Promise.all([f.call('/scope'),f.call('/scope')]);for(const result of results)assert.equal(result.status,200);const [a,b]=results.map(x=>JSON.parse(x.body));assert.equal(a.a,a.b);assert.notEqual(a.a,b.a);assert.notEqual(a.x,a.y);assert.equal(singleton,1);await tick();assert.equal(log.length,6);for(const id of [a.a,b.a])assert.ok(log.indexOf(`request:${id}`)>log.indexOf(`transient:${id===a.a?a.x:b.x}`));
 }finally{await f.close();}assert.equal(log.at(-1),'singleton');
});
test('guard denial and validation failure do not instantiate privileged providers',async()=>{
 const f=await fixture(),p=createProviderToken('privileged');let calls=0;const order=[];
 try{await registerModule(f.api,{name:'guard',providers:[defineProvider({token:p,scope:'request',dependencies:[],create:()=>++calls})],controllers:[{path:'/denied',guards:[()=>false],handle:(_i,_c,r)=>r.get(p)},{path:'/validated',method:'POST',guards:[()=>{order.push('guard');return true;}],schema:object({name:string()}),middleware:[async(_ctx,next)=>{order.push('middleware');await next();}],async handle(input,_c,r){order.push('handler');await r.get(p);return input;}}]});assert.equal((await f.call('/denied')).status,403);assert.equal((await f.call('/validated',{name:123})).status,400);assert.equal(calls,0);const valid=await f.call('/validated',{name:'safe'});assert.equal(valid.status,200);assert.equal(calls,1);assert.deepEqual(order,['guard','guard','middleware','handler']);assert.doesNotMatch((await f.call('/validated',{name:123})).body,/123/);
 }finally{await f.close();}
});
test('cycles, captive scopes and route conflicts fail before constructors or mutation',async()=>{
 const f=await fixture(),a=createProviderToken('a'),b=createProviderToken('b');let calls=0;
 try{const provider=(token,dependencies,scope='singleton')=>defineProvider({token,scope,dependencies,create:()=>++calls});await assert.rejects(registerModule(f.api,{name:'cycle',providers:[provider(a,[b]),provider(b,[a])]}),e=>e.code.includes('PROVIDER_CYCLE:a -> b -> a'));assert.equal(calls,0);
 await assert.rejects(registerModule(f.api,{name:'captive',providers:[provider(a,[b]),provider(b,[],'request')]}),e=>e.code==='PROVIDER_CAPTIVE_SCOPE');
 f.api.addRoute({pattern:'/existing',handler:()=>({existing:true})});await assert.rejects(registerModule(f.api,{name:'conflict',controllers:[{path:'/existing',handle:()=>null}]}));assert.equal((await f.call('/existing')).status,200);
 }finally{await f.close();}
});
test('eager dependency failure cleans partial construction and rolls back acquired dependencies',async()=>{
 const f=await fixture(),a=createProviderToken('a'),b=createProviderToken('b'),log=[];
 try{await assert.rejects(registerModule(f.api,{name:'partial',providers:[defineProvider({token:a,scope:'singleton',dependencies:[],create:()=>({}),dispose:()=>log.push('dependency')}),defineProvider({token:b,scope:'singleton',dependencies:[a],eager:true,create(ctx){ctx.onDispose(()=>log.push('partial'));throw Error('PRIVATE failure');}})],controllers:[{path:'/not-added',handle:()=>null}]}),/PRIVATE failure/);assert.deepEqual(log,['partial','dependency']);assert.equal(f.api.hasRoute('/not-added','GET'),false);
 }finally{await f.close();}
});
test('module filters use existing sanitized responses and cleanup survives handler failure',async()=>{
 const f=await fixture(),p=createProviderToken('resource');let closed=0;
 try{await registerModule(f.api,{name:'filter',providers:[defineProvider({token:p,scope:'request',dependencies:[],create:()=>1,dispose:()=>closed++})],controllers:[{path:'/failure',async handle(_i,_c,r){await r.get(p);throw Error('PRIVATE');},filter(error,ctx){assert.equal(error.message,'PRIVATE');ctx.res.writeHead(409,{'content-type':'application/json'});ctx.res.end(JSON.stringify({error:'conflict'}));}}]});const result=await f.call('/failure');assert.equal(result.status,409);assert.equal(result.body,'{"error":"conflict"}');await tick();assert.equal(closed,1);
 }finally{await f.close();}
});

test('stream disconnect aborts request providers and retained resolvers cannot reopen scope',async()=>{
 const f=await fixture(),p=createProviderToken('stream');let escaped,closed=0,signal;
 try{await registerModule(f.api,{name:'stream',providers:[defineProvider({token:p,scope:'request',dependencies:[],create(ctx){signal=ctx.signal;return 1;},dispose:()=>closed++})],controllers:[{path:'/stream',async handle(_i,ctx,r){escaped=r;await r.get(p);ctx.res.writeHead(200,{'content-type':'text/event-stream'});ctx.res.write('data: first\n\n');await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));}}]});
 await new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:f.server.address().port,path:'/stream'},res=>res.once('data',()=>{req.destroy();resolve();}));req.on('error',reject);req.end();});for(let i=0;i<20&&closed===0;i++)await tick();assert.equal(signal.aborted,true);assert.equal(closed,1);await assert.rejects(escaped.get(p),e=>e.code==='PROVIDER_SCOPE_CLOSED');
 }finally{await f.close();}
});
test('a later startup error disposes registered modules and preserves the active generation',async()=>{
 const f=await fixture();
 try{f.api.addRoute({pattern:'/alive',handler:()=>({alive:true})});const root=f.app.runtime().rootDir,log=path.join(root,'cleanup.txt');await symlink(path.resolve('../../node_modules'),path.join(root,'node_modules'),'dir');
 await writeFile(path.join(root,'index.mjs'),`import {registerModule,defineProvider,createProviderToken} from 'zeruxjs/modules';\nimport {appendFile} from 'node:fs/promises';\nexport default async function(api){const token=createProviderToken('resource');await registerModule(api,{name:'candidate',providers:[defineProvider({token,scope:'singleton',dependencies:[],eager:true,create:()=>1,dispose:()=>appendFile(${JSON.stringify(log)},'closed')})]});throw Error('candidate failed');}`);
 await assert.rejects(f.app.reload({}),/candidate failed/);assert.equal(await readFile(log,'utf8'),'closed');assert.equal((await f.call('/alive')).status,200);
 }finally{await f.close();}
});
