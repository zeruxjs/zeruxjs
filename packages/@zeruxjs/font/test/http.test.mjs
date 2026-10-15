import test from 'node:test';import assert from 'node:assert/strict';import {createFontRegistry} from '../dist/index.js';
import {createFontStylesheetHandler} from '../dist/http.js';
test('font stylesheet ETag follows registry mutations, preload links and head',async()=>{
 const fonts=createFontRegistry();fonts.add('regular',{family:'Inter',sources:[{url:'/inter.woff2',format:'woff2'}]});
 const handler=createFontStylesheetHandler({registry:fonts,preloadKeys:['regular']});
 const first=handler(new Request('https://example.com/fonts.css'));
 assert.match(first.headers.get('link'),/rel=preload/);assert.match(await first.text(),/@font-face/);
 const etag=first.headers.get('etag');
 assert.equal(handler(new Request('https://example.com/fonts.css',{headers:{'if-none-match':etag}})).status,304);
 assert.equal(handler(new Request('https://example.com/fonts.css',{method:'HEAD'})).body,null);
 fonts.add('bold',{family:'Inter',weight:700,sources:[{url:'/bold.woff2'}]});
 assert.notEqual(handler(new Request('https://example.com/fonts.css')).headers.get('etag'),etag);
 assert.equal(handler(new Request('https://example.com/fonts.css',{method:'POST'})).status,405);
});
