import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { RouteStore } from '../dist/portless/routes.js';
import { handoverBackends } from '../dist/portless/handover.js';
import { createProxyServer } from '../dist/portless/proxy.js';

const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve(server.address().port);});});
const close=server=>new Promise(resolve=>server.close(resolve));
const get=(port,host)=>new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port,headers:{Host:host}},res=>{let body='';res.on('data',data=>body+=data);res.on('end',()=>resolve({status:res.statusCode,body}));}).on('error',reject);});
const fixture=async fn=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zsrv-pool-'));try{return await fn(new RouteStore(dir),dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}};

test('pool registration persists validated targets, and lease removal is conditional',()=>fixture(store=>{
  const lease=store.registerPoolRoute('multi.localhost',[{port:4500,weight:2},{port:4501}],process.pid);
  assert.deepEqual(store.loadRoutes()[0].backends,[{port:4500,weight:2},{port:4501}]);
  assert.equal(lease.switchBackends([{port:4501}]),true);
  assert.deepEqual(store.loadRoutes()[0].backends,[{port:4501}]);
  assert.equal(store.loadRoutes()[0].port,4501);
  const successor=store.registerPoolRoute('multi.localhost',[{port:4502}],process.pid);
  assert.equal(lease.switchBackends([{port:4503}]),false);
  assert.equal(lease.release(),false);
  assert.equal(store.loadRoutes()[0].port,4502);
  assert.equal(successor.release(),true);
}));

test('invalid on-disk backend pools are rejected without overwriting registry',()=>fixture((store,dir)=>{
  store.ensureDir(); const file=path.join(dir,'routes.json');
  for(const backends of [[{port:4001},{port:4001}],[],[{port:4002}], [{port:4001,weight:200}]]) {
    const raw=JSON.stringify([{hostname:'multi.localhost',port:4001,pid:0,backends}]);fs.writeFileSync(file,raw);
    assert.throws(()=>store.addRoute('other.localhost',4003,process.pid));
    assert.equal(fs.readFileSync(file,'utf8'),raw);
  }
}));

test('health-checked handover never switches to an unreachable target',()=>fixture(async store=>{
  const original=http.createServer((req,res)=>res.end('old'));
  const next=http.createServer((req,res)=>res.end('new'));
  const originalPort=await listen(original), nextPort=await listen(next);
  const empty=http.createServer();const deadPort=await listen(empty);await close(empty);
  const lease=store.registerPoolRoute('multi.localhost',[{port:originalPort}],process.pid);
  const proxy=createProxyServer({getRoutes:()=>store.loadRoutes(),proxyPort:0,onError:()=>{}});
  const port=await listen(proxy);
  try {
    assert.equal((await get(port,'multi.localhost')).body,'old');
    assert.equal(await handoverBackends(lease,[{port:deadPort}],{health:{path:'/health',timeoutMs:200}}),false);
    assert.equal(store.loadRoutes()[0].port,originalPort);
    assert.equal(await handoverBackends(lease,[{port:nextPort}],{health:{path:'/health',timeoutMs:500}}),true);
    assert.equal((await get(port,'multi.localhost')).body,'new');
    const newer=store.registerRoute('multi.localhost',nextPort,process.pid);
    assert.equal(await handoverBackends(lease,[{port:originalPort}]),false);
    newer.release();
  } finally {await close(proxy);await close(original);await close(next);}
}));

test('HTTP traffic distributes over instances and skips a failed instance',async()=>{
  const first=http.createServer((req,res)=>res.end('first'));
  const second=http.createServer((req,res)=>res.end('second'));
  const a=await listen(first),b=await listen(second);
  const route={hostname:'multi.localhost',port:a,backends:[{port:a},{port:b}]};
  const proxy=createProxyServer({getRoutes:()=>[route],proxyPort:0,onError:()=>{}});
  const port=await listen(proxy);
  try {
    const replies=await Promise.all(Array.from({length:10},()=>get(port,'multi.localhost')));
    assert.equal(replies.filter(x=>x.body==='first').length,5);
    assert.equal(replies.filter(x=>x.body==='second').length,5);
    await close(second);
    // First attempt may fail once, but subsequent requests avoid that port.
    const responses=await Promise.all(Array.from({length:6},()=>get(port,'multi.localhost')));
    assert.ok(responses.some(x=>x.status===502));
    for(let i=0;i<6;i++)assert.deepEqual(await get(port,'multi.localhost'),{status:200,body:'first'});
    proxy.backendPool.markFailure(route.hostname,a);
    assert.equal((await get(port,'multi.localhost')).status,503);
  } finally {await close(proxy);await close(first);}
});

test('a handover keeps in-flight requests connected to the old application',()=>fixture(async store=>{
  let releaseOld;
  const oldStarted = new Promise(resolve => {
    const first=http.createServer((req,res)=>{
      if(req.url==='/hold') {releaseOld=()=>res.end('old-finished'); resolve();}
      else res.end('old');
    });
    resolve(first);
  });
  const first=await oldStarted;
  const second=http.createServer((req,res)=>res.end('new'));
  const a=await listen(first), b=await listen(second);
  const lease=store.registerRoute('switch.localhost',a,process.pid);
  const proxy=createProxyServer({getRoutes:()=>store.loadRoutes(),proxyPort:0,onError:()=>{}});
  const proxyPort=await listen(proxy);
  try {
    const inFlight=new Promise((resolve,reject)=>{
      http.get({host:'127.0.0.1',port:proxyPort,path:'/hold',headers:{Host:'switch.localhost'}},res=>{
        let body='';res.on('data',d=>body+=d);res.on('end',()=>resolve(body));
      }).on('error',reject);
    });
    for(let i=0;i<100 && !releaseOld;i++)await new Promise(r=>setTimeout(r,2));
    assert.ok(releaseOld,'in-flight request reached old app');
    assert.equal(await handoverBackends(lease,[{port:b}]),true);
    assert.equal((await get(proxyPort,'switch.localhost')).body,'new');
    releaseOld();
    assert.equal(await inFlight,'old-finished');
  } finally { releaseOld?.(); await close(proxy);await close(first);await close(second); }
}));
