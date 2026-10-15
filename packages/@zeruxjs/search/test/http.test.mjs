import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchIndex } from '../dist/index.js';
import { createSearchHandler } from '../dist/http.js';
test('search HTTP pagination, projection, conditional responses and mutation correctness',async()=>{
 const index=createSearchIndex();index.addMany([{id:'a',text:'apple banana',private:'secret'},{id:'b',text:'banana apricot',private:'hidden'}]);
 const handle=createSearchHandler({index,fields:['id','text'],maxResults:1,cacheSeconds:30});
 const first=handle(new Request('http://localhost/search?q=banana&limit=99'));const value=await first.json();
 assert.equal(first.status,200);assert.equal(value.results.length,1);assert.equal(value.limit,1);assert.equal(value.results[0].document.private,undefined);
 assert.equal(first.headers.get('cache-control'),'public, max-age=30');
 const cond=handle(new Request('http://localhost/search?q=banana&limit=99',{headers:{'if-none-match':first.headers.get('etag')}}));assert.equal(cond.status,304);
 const head=handle(new Request('http://localhost/search?q=banana',{method:'HEAD'}));assert.equal(await head.text(),'');
 index.add({id:'c',text:'banana mango'});const updated=handle(new Request('http://localhost/search?q=banana&limit=99'));assert.notEqual(updated.headers.get('etag'),first.headers.get('etag'));
});
test('search HTTP rejects bad query parameters, unsupported methods, protects filter state',async()=>{
 const index=createSearchIndex();index.add({id:'a',text:'Hi',role:'public'});
 const handle=createSearchHandler({index,filter:doc=>{doc.role='mutated';return true},maxQueryLength:4});
 assert.equal(handle(new Request('http://localhost/?q=12345')).status,414);
 assert.equal(handle(new Request('http://localhost/?limit=-1')).status,400);
 assert.equal(handle(new Request('http://localhost/?prefix=x')).status,400);
 assert.equal(handle(new Request('http://localhost/',{method:'POST'})).status,405);
 assert.equal(handle(new Request('http://localhost/?q=hi')).status,200);
 assert.equal(index.get('a').role,'public');
});
test('search suggestion and visibility guard',async()=>{
 const index=createSearchIndex();index.addMany([{id:'a',text:'grapefruit',role:'public'},{id:'b',text:'grapefruit',role:'private'}]);
 const handle=createSearchHandler({index,filter:doc=>doc.role==='public'});
 const result=await handle(new Request('http://localhost/?q=grape&prefix=1')).json();assert.equal(result.results.length,1);
 assert.equal(handle(new Request('http://localhost/?q=grape&suggest=1')).status,403);
 const suggested=await createSearchHandler({index})(new Request('http://localhost/?q=grape&suggest=1')).json();assert.ok(suggested.suggestions.includes('grapefruit'));
});
