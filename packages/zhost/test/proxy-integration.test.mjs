import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createProxyServer } from '../dist/portless/proxy.js';

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
});
const close = server => new Promise(resolve => server.close(resolve));
function request(port, host, headers = {}, body = '') {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname:'127.0.0.1',port, method: body ? 'POST' : 'GET',headers:{Host:host,...headers}}, res => {
      const chunks=[];
      res.on('data', chunk=> chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
    });
    req.on('error',reject); req.end(body);
  });
}

test('HTTP proxy forwards body and overwrites spoofed forwarding headers', async () => {
  const upstream = http.createServer((req,res)=> {
    const chunks=[];
    req.on('data',x=>chunks.push(x));
    req.on('end',()=>{res.setHeader('content-type','application/json'); res.end(JSON.stringify({host:req.headers.host, forwarded:req.headers['x-forwarded-for'], proto:req.headers['x-forwarded-proto'], body:Buffer.concat(chunks).toString(), hops:req.headers['x-portless-hops']}));});
  });
  const upstreamPort=await listen(upstream);
  const proxy=createProxyServer({getRoutes:()=>[{hostname:'app.localhost',port:upstreamPort}],proxyPort:0,onError:()=>{}});
  try {
    const port=await listen(proxy);
    const result=await request(port,'app.localhost',{'x-forwarded-for':'8.8.8.8','x-forwarded-proto':'https'},'hello');
    assert.equal(result.status,200);
    const payload=JSON.parse(result.body);
    assert.equal(payload.body,'hello');
    assert.equal(payload.forwarded,'127.0.0.1');
    assert.equal(payload.proto,'http');
    assert.equal(payload.hops,'1');
    assert.equal((await request(port,'app.localhost',{'x-portless-hops':'invalid'})).status,400);
    assert.equal((await request(port,'app.localhost',{'x-portless-hops':'5'})).status,508);
    assert.equal((await request(port,'unknown.localhost')).status,404);
    assert.equal((await request(port,'bad host')).status,400);
  } finally { await close(proxy); await close(upstream); }
});
