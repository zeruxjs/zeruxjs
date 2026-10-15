import test from 'node:test';
import assert from 'node:assert/strict';
import { BackendConnections } from '../dist/portless/backend-connections.js';
import { createProxyServer } from '../dist/portless/proxy.js';
import http from 'node:http';
import { once } from 'node:events';

test('HTTP completion data is bounded and produces error rate and p95 latency',()=>{
 const monitor=new BackendConnections();
 for(let n=0;n<600;n++) monitor.recordHttp('api.localhost',4001,n%300,n%10===0?503:200);
 const data=monitor.metrics('api.localhost',[4001]);
 assert.equal(data.completedRequests,512);assert.ok(data.p95LatencyMs>=200);
 assert.ok(data.errorRate>0 && data.errorRate<1);
 assert.throws(()=>monitor.recordHttp('api.localhost',4001,-1,200),/Invalid/);
 assert.throws(()=>monitor.recordHttp('api.localhost',4001,2,700),/Invalid/);
});

test('proxy records both successful and failing HTTP response telemetry',async()=>{
 const upstream=http.createServer((req,res)=>{res.writeHead(req.url==='/bad'?503:200);res.end('done');});
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const appPort=upstream.address().port;
 const proxy=createProxyServer({getRoutes:()=>[{hostname:'api.localhost',port:appPort}],proxyPort:0});
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 try{
  const port=proxy.address().port;
  for(const url of ['/ok','/bad']) await new Promise((resolve,reject)=>{
   http.get({hostname:'127.0.0.1',port,path:url,headers:{Host:'api.localhost'}},res=>{res.resume();res.on('end',resolve);}).on('error',reject);
  });
  const result=proxy.backendConnections.metrics('api.localhost',[appPort]);
  assert.equal(result.completedRequests,2);assert.equal(result.serverErrors,1);assert.equal(result.errorRate,0.5);
 }finally{await new Promise(resolve=>proxy.close(resolve));await new Promise(resolve=>upstream.close(resolve));}
});
