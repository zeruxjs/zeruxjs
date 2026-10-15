import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ProxyAdmission } from '../dist/portless/proxy-admission.js';
import { createProxyServer } from '../dist/portless/proxy.js';

test('bounded token bucket rejects bursts and releases concurrent permits only once', () => {
 let time = 0;
 const admission = new ProxyAdmission({ ratePerSecond: 2, burst: 2, maxActiveRequests: 1 }, () => time);
 const first = admission.acquire('127.0.0.1');
 assert.equal(first.status,200);
 assert.equal(admission.acquire('127.0.0.1').status,503);
 first.release();first.release();
 assert.equal(admission.activeRequests,0);
 const second = admission.acquire('127.0.0.1');
 second.release();
 assert.equal(admission.acquire('127.0.0.1').status,429);
 time += 500;
 assert.equal(admission.acquire('127.0.0.1').status,200);
 assert.throws(()=>new ProxyAdmission({burst:1}),/requires/);
 assert.throws(()=>new ProxyAdmission({maxBodyBytes:-1}),/body/);
});

const listen = server => new Promise((resolve,reject)=>{
 server.once('error',reject);
 server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve(server.address().port);});
});
const close = server => new Promise(resolve=>server.close(resolve));
const request = (port,headers={},body,chunked=false) => new Promise((resolve,reject)=>{
 const req=http.request({hostname:'127.0.0.1',port,method:body?'POST':'GET',headers:{Host:'api.localhost',...headers}},res=>{
  let content='';res.on('data',b=>content+=b);res.on('end',()=>resolve({status:res.statusCode,body:content}));
 });
 req.on('error',reject);
 if(chunked){ req.write(body.slice(0,5));req.end(body.slice(5)); }
 else req.end(body);
});

test('HTTP proxy can reject excess rates and declared/streamed oversized bodies', async()=>{
 const backend=http.createServer((req,res)=> {req.resume();req.on('end',()=>res.end('ok'));});
 const backendPort=await listen(backend);
 const proxy=createProxyServer({getRoutes:()=>[{hostname:'api.localhost',port:backendPort}],proxyPort:0,
  limits:{ratePerSecond:20,burst:2,maxActiveRequests:2,maxBodyBytes:10},onError:()=>{}});
 try {
  const port=await listen(proxy);
  assert.equal((await request(port)).status,200);
  assert.equal((await request(port)).status,200);
  assert.equal((await request(port)).status,429);
  // Another proxy, so the rate limiter doesn't prevent size assertions.
  const sizes=createProxyServer({getRoutes:()=>[{hostname:'api.localhost',port:backendPort}],proxyPort:0,
    limits:{maxBodyBytes:10},onError:()=>{}});
  try {
   const p=await listen(sizes);
   assert.equal((await request(p,{},'01234567890')).status,413);
   assert.equal((await request(p,{'transfer-encoding':'chunked'},'01234567890',true)).status,413);
   assert.equal((await request(p,{},'short')).status,200);
  } finally {await sizes.connectionTracker.drain({timeoutMs:1000});}
 } finally {await proxy.connectionTracker.drain({timeoutMs:1000});await close(backend);}
});
