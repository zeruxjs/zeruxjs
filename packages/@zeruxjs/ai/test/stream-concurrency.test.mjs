import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAICompatibleProvider, createAiClient, withConcurrencyLimit, withRetry, AiProviderError, parseAiSse } from '../dist/index.js';
const encode = value => new TextEncoder().encode(value);
function chunks(value, n=3) {
 const data=encode(value); return new ReadableStream({start(ctrl){for(let i=0;i<data.length;i+=n) ctrl.enqueue(data.slice(i,i+n));ctrl.close();}});
}
test('streamed completion decodes fragmented SSE, unicode and DONE',async()=>{
 const stream=': ping\r\n\r\ndata: {"choices":[{"delta":{"content":"Hi 🌟"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":" there"}}]}\n\ndata: [DONE]\n\n';
 let body;
 const provider=createOpenAICompatibleProvider({apiKey:'secret',baseUrl:'https://provider.test/v1',model:'a',fetch:async(_url,options)=>{
   body=JSON.parse(options.body);
   return new Response(chunks(stream,2),{headers:{'Content-Type':'text/event-stream; charset=utf-8'}});
 }});
 const result=[]; for await (const part of createAiClient(provider).streamComplete('hello')) result.push(part);
 assert.equal(result.join(''),'Hi 🌟 there'); assert.equal(body.stream,true);
});
test('stream enforces cumulative response bytes, event size and MIME',async()=>{
 const payload='data: {"choices":[{"delta":{"content":"123456789"}}]}\n\n';
 const provider=createOpenAICompatibleProvider({apiKey:'secret',baseUrl:'https://provider.test/v1',model:'a',maxResponseBytes:20,fetch:async()=>new Response(chunks(payload),{headers:{'Content-Type':'text/event-stream'}})});
 await assert.rejects(async()=>{for await(const _ of provider.stream([{role:'user',content:'hi'}])){}},/size limit/);
 const invalid=createOpenAICompatibleProvider({apiKey:'secret',baseUrl:'https://provider.test/v1',model:'a',fetch:async()=>new Response('plain',{headers:{'content-type':'text/plain'}})});
 await assert.rejects(async()=>{for await(const _ of invalid.stream([{role:'user',content:'hi'}])){}},/event-stream/);
});
test('provider refuses redirect and prevents Authorization override',async()=>{
 let authorization,redirect;
 const provider=createOpenAICompatibleProvider({apiKey:'configured',baseUrl:'https://provider.test',model:'a',headers:{authorization:'attacker'},fetch:async(_url,init)=>{
   authorization=init.headers.get('Authorization');redirect=init.redirect;
   return new Response(JSON.stringify({choices:[{message:{content:'okay'}}]}));
 }});
 assert.equal(await provider.chat([{role:'user',content:'hi'}]),'okay');
 assert.equal(authorization,'Bearer configured');assert.equal(redirect,'error');
});
test('retry only retries explicit transient provider errors, honors cap and abort',async()=>{
 let n=0;
 const retry=withRetry({async chat(){if(++n<3)throw new AiProviderError('limited',429,true);return 'ok';}},{attempts:3,delayMs:0});
 assert.equal(await retry.chat([]),'ok'); assert.equal(n,3);
 let failed=0;
 await assert.rejects(withRetry({async chat(){failed++;throw Error('not safe to retry');}},{attempts:3,delayMs:0}).chat([]),/not safe/);
 assert.equal(failed,1);
});
test('concurrency limit holds slots until stream closes, queued abort removes waiter',async()=>{
 let release;
 const provider={async chat(){await new Promise(r=>{release=r});return 'done';},async *stream(){yield 'one'; await new Promise(r=>{release=r});yield 'two';}};
 const limited=withConcurrencyLimit(provider,{maxConcurrent:1,maxQueued:1});
 const iterator=limited.stream([])[Symbol.asyncIterator]();
 assert.equal((await iterator.next()).value,'one');assert.deepEqual(limited.status(),{active:1,queued:0});
 const abort=new AbortController();const pending=limited.chat([],{signal:abort.signal});
 await new Promise(r=>setImmediate(r));assert.equal(limited.status().queued,1);
 abort.abort();await assert.rejects(pending);assert.equal(limited.status().queued,0);
 await iterator.return();assert.equal(limited.status().active,0);
 const next=limited.chat([]); await new Promise(r=>setImmediate(r)); release();assert.equal(await next,'done');
 assert.deepEqual(limited.status(),{active:0,queued:0});
});
test('parseAiSse ignores comments and decodes event chunks across boundaries',async()=>{
 let assembled='';for await(const part of parseAiSse(chunks(': test\n\ndata: {"choices":[{"delta":{"content":"yes"}}]}\n\n'),10000))assembled+=part;
 assert.equal(assembled,'yes');
});
