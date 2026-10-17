import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createProxyServer } from '../dist/portless/proxy.js';
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve(server.address().port);});});
const close=server=>new Promise(resolve=>server.close(resolve));
const nodeServer = label => {
  const server=http.createServer();
  server.on('upgrade',(req,socket)=>{
    const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.end(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nX-Backend: ${label}\r\n\r\n`);
  });
  return server;
};
function upgrade(port) {
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,headers:{Host:'ws.localhost',Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Key':Buffer.alloc(16,9).toString('base64'),'Sec-WebSocket-Version':'13'}});
    req.once('upgrade',(res,socket)=>{socket.destroy();resolve(res.headers['x-backend']);});
    req.once('response',res=>{res.resume();resolve(`error-${res.statusCode}`);});
    req.once('error',reject);req.end();
  });
}
test('WebSocket upgrades use the same multi-backend selection and health isolation',async()=>{
  const one=nodeServer('one'),two=nodeServer('two');
  const a=await listen(one),b=await listen(two);
  const route={hostname:'ws.localhost',port:a,backends:[{port:a},{port:b}]};
  const proxy=createProxyServer({getRoutes:()=>[route],proxyPort:0,onError:()=>{}});
  const port=await listen(proxy);
  try {
    assert.deepEqual([await upgrade(port),await upgrade(port)],['one','two']);
    proxy.backendPool.markFailure('ws.localhost',a);
    assert.equal(await upgrade(port),'two');
    proxy.backendPool.markFailure('ws.localhost',b);
    assert.equal(await upgrade(port),'error-503');
  } finally {await close(proxy);await close(one);await close(two);}
});
