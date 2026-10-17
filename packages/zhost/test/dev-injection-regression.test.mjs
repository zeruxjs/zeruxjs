import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createInjectedAppHandler, MAX_INJECTED_HTML_BYTES } from '../dist/dev/injection.js';
const options = { serviceName:'dev',routeName:'site',devServerUrl:'http://127.0.0.1:4000',devPortLessAlias: {value:null} };
function exercise(handler) {
 return new Promise((resolve,reject)=> {
  const server = http.createServer(createInjectedAppHandler(handler,options));
  server.listen(0,'127.0.0.1',()=> {
   const req = http.get({hostname:'127.0.0.1',port:server.address().port,headers:{accept:'text/html'}},res=> {
    const chunks=[];
    res.on('data',chunk=>chunks.push(chunk));
    res.on('end',()=>server.close(()=>resolve({headers:res.headers,body:Buffer.concat(chunks)})));
   });
   req.on('error',reject);
  });
 });
}
test('HTML injection updates content length and preserves status', async()=> {
 const response=await exercise((_req,res)=> {res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Length','25');res.writeHead(201);res.end('<html><body></body></html>');});
 assert.equal(response.headers['content-length'],String(response.body.length));
 assert.equal(response.body.toString().includes('</body>'),true);
});
test('large HTML streams are not buffered indefinitely or transformed',async()=> {
 const chunk='x'.repeat(1024*1024);
 const response=await exercise((_req,res)=> {res.setHeader('Content-Type','text/html');res.write(chunk);res.write(chunk);res.write(chunk);res.end();});
 assert.equal(response.body.length,3*1024*1024);
 assert.equal(response.body.toString().includes('dev-client'),false);
 assert.ok(MAX_INJECTED_HTML_BYTES<response.body.length);
});
test('compressed HTML and non-HTML content are passed through unchanged',async()=> {
 const response=await exercise((_req,res)=>{res.setHeader('Content-Type','text/html');res.setHeader('Content-Encoding','gzip');res.end('RAW');});
 assert.equal(response.body.toString(),'RAW');
 assert.equal(response.headers['content-encoding'],'gzip');
});
