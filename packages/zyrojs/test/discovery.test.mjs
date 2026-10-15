import test from 'node:test';import assert from 'node:assert/strict';import {createDiscoveryClient,DiscoveryHttpError} from '../dist/network/index.js';
test('browser discovery client builds safe queries and isolates origin',async()=>{
 const seen=[];const client=createDiscoveryClient({baseUrl:'https://example.com',fetch:async (url,options)=>{seen.push({url,options});return new Response(JSON.stringify({query:'alpha',results:[],limit:20,offset:0}),{headers:{'content-type':'application/json'}})}});
 const result=await client.search('alpha',{limit:20,prefix:true});assert.equal(result.query,'alpha');assert.match(seen[0].url,/q=alpha/);assert.match(seen[0].url,/prefix=1/);
 assert.equal(seen[0].options.credentials,'omit');assert.equal(await client.suggest('hello').catch(()=>null),null);
 assert.throws(()=>createDiscoveryClient({baseUrl:'file:///etc'}));assert.throws(()=>createDiscoveryClient({searchPath:'//attacker.test/path'}));
 client.dispose();await assert.rejects(()=>client.search('x'),/disposed/);
});
test('feed conditional GET caches each representation separately',async()=>{
 let requests=0;const client=createDiscoveryClient({baseUrl:'https://example.com',fetch:async (_url,options)=>{
  requests++;const format=options.headers.get('accept');const etag=format.includes('json')?'"json"':'"rss"';
  if(options.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers:{etag}});
  return new Response(format,{headers:{'content-type':format+'; charset=utf-8',etag}});
 }});
 const a=await client.feed('rss');assert.equal(a,'application/rss+xml');assert.equal(await client.feed('rss'),a);
 assert.equal(await client.feed('json'),'application/feed+json');assert.equal(await client.feed('json'),'application/feed+json');assert.equal(requests,4);
 client.dispose();
});
test('oversized streaming content is rejected; cancellation propagates',async()=>{
 const client=createDiscoveryClient({baseUrl:'https://example.com',maxResponseBytes:256,fetch:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(200));c.enqueue(new Uint8Array(200));c.close();}}),{headers:{'content-type':'application/json'}})});
 await assert.rejects(()=>client.search('abc'),e=>e instanceof DiscoveryHttpError&&e.status===413);
 client.dispose();
});
