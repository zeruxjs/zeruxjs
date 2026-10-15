import test from 'node:test';import assert from 'node:assert/strict';
import {createShareController,createShareMetadata,createCanonicalShareLink,shareLinkAttributes} from '../dist/index.js';
test('share metadata escapes HTML and rejects unsafe image URLs',()=>{
 const tags=createShareMetadata({url:'https://example.org/a?x=1&y=2',title:'<title>"',image:'https://example.org/logo.png'});
 assert.ok(tags.find(s=>s.includes('og:title')).includes('&lt;title&gt;&quot;'));
 assert.ok(createCanonicalShareLink('https://example.org/x?a=1&b=2').includes('a=1&amp;b=2'));
 assert.throws(()=>createShareMetadata({url:'https://example.org',image:'javascript:alert(1)'}),TypeError);
 assert.equal(shareLinkAttributes('x',{url:'https://example.org'}).rel,'noopener noreferrer');
});
test('native sharing is preferred',async()=>{
 const calls=[];const controller=createShareController({share:async payload=>calls.push(payload),writeText:async()=>{throw Error('should not copy')}});
 assert.equal(await controller.share({url:'https://example.org',title:'Hi'}),'shared');assert.equal(calls.length,1);
});
test('unsupported native share falls back to copy',async()=>{
 const calls=[];const controller=createShareController({share:async()=>{throw Object.assign(Error('unsupported'),{name:'NotSupportedError'})},writeText:async value=>calls.push(value)});
 assert.equal(await controller.share({url:'https://example.org'}),'copied');assert.deepEqual(calls,['https://example.org/']);
});
test('user-cancelled native sharing does not unexpectedly copy',async()=>{
 let copies=0;const controller=createShareController({share:async()=>{throw Object.assign(Error('cancel'),{name:'AbortError'})},writeText:async()=>{copies++}});
 await assert.rejects(controller.share({url:'https://example.org'}),{name:'AbortError'});assert.equal(copies,0);
});
test('share controller in SSR reports unavailable',async()=>{
 const controller=createShareController({});assert.deepEqual(controller.capabilities,{native:false,clipboard:false});
 assert.equal(await controller.share({url:'https://example.org'}),'unavailable');
});
