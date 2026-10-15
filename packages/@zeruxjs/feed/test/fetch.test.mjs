import test from 'node:test';import assert from 'node:assert/strict';import {createFeedFetchHandler} from '../dist/fetch.js';
const data={title:'Releases',description:'notes',siteUrl:'https://example.com',updated:'2025-01-02T02:00:00Z',items:[{id:'1',title:'One',url:'https://example.com/1',date:'2025-01-01T00:00:00Z'}]};
test('negotiate RSS/Atom/JSON Feed with cache separation',async()=>{
 const handler=createFeedFetchHandler({feed:data,format:'negotiate'});
 const json=await handler(new Request('https://example.com/feed',{headers:{accept:'application/feed+json;q=1, application/rss+xml;q=0.2'}}));
 assert.equal(json.headers.get('vary'),'Accept');assert.match(json.headers.get('content-type'),/feed\+json/);assert.equal((await json.json()).items.length,1);
 const atom=await handler(new Request('https://example.com/feed',{headers:{accept:'application/atom+xml'}}));assert.match(atom.headers.get('content-type'),/atom\+xml/);
 const rss=await handler(new Request('https://example.com/feed'));assert.match(rss.headers.get('content-type'),/rss\+xml/);
 assert.notEqual(rss.headers.get('etag'),atom.headers.get('etag'));
});
test('feed returns 304, HEAD, 405, limits, and dynamic changed content',async()=>{
 let current=data;const handler=createFeedFetchHandler({feed:()=>current,maxItems:1});
 const first=await handler(new Request('https://example.com/feed'));const etag=first.headers.get('etag');
 assert.equal((await handler(new Request('https://example.com/feed',{headers:{'if-none-match':etag}}))).status,304);
 assert.equal((await handler(new Request('https://example.com/feed',{method:'HEAD'}))).body,null);
 assert.equal((await handler(new Request('https://example.com/feed',{method:'POST'}))).status,405);
 current={...data,items:[{...data.items[0],title:'Updated'}]};assert.notEqual((await handler(new Request('https://example.com/feed'))).headers.get('etag'),etag);
 assert.throws(()=>createFeedFetchHandler({feed:data,maxItems:0}),RangeError);
});

test('Accept negotiation rejects unsupported and zero-quality media and supports wildcards',async()=>{
 const handler=createFeedFetchHandler({feed:data,format:'negotiate'});
 assert.equal((await handler(new Request('https://example.com/feed',{headers:{accept:'text/html'}}))).status,406);
 assert.equal((await handler(new Request('https://example.com/feed',{headers:{accept:'application/rss+xml;q=0, */*;q=0'}}))).status,406);
 assert.equal((await handler(new Request('https://example.com/feed',{headers:{accept:'*/*'}}))).status,200);
 const atom=await handler(new Request('https://example.com/feed',{headers:{accept:'application/atom+xml;q=0.7, application/rss+xml;q=0.1'}}));assert.match(atom.headers.get('content-type'),/atom\+xml/);
});
