import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicCrawlerService,createPublicRedirects,renderHtmlSitemap} from '@zeruxjs/seo/public';
import {createSitemapIndex} from '@zeruxjs/seo';
const site={origin:'https://example.test',basePath:'/docs/',locales:{fr:'https://example.test/docs/fr/'}};
const row=n=>({visibility:'public',loc:`https://example.test/docs/page${n}`,alternates:{fr:`https://example.test/docs/fr/page${n}`},images:['https://example.test/image.png']});
const request=path=>new Request('https://example.test'+path);
test('paged source emits bounded indexed XML, content lastmod only, HEAD and weak conditional GET',async()=>{
 let calls=0;const app=createPublicCrawlerService({site,pageSize:2,maxUrlsPerFile:1,source:{async load({cursor,limit,signal}){calls++;assert.equal(limit,2);assert(signal instanceof AbortSignal);return cursor?{items:[{...row(3),lastmod:'2025-01-02'}]}:{items:[row(1),row(2)],nextCursor:'next'};}},snapshotTtlMs:5000,trustTxt:'contact: owner@example.test\n'});
 try{
  const [a,b]=await Promise.all([app.handler(request('/docs/sitemap.xml')),app.handler(request('/docs/sitemap.xml'))]);assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(calls,2);const index=await a.text();assert(index.includes('<sitemapindex'));assert(!index.includes('lastmod'));
  const page=await app.handler(request('/docs/sitemaps/3'));const xml=await page.text();assert.match(xml,/<lastmod>2025-01-02<\/lastmod>/);assert.match(xml,/hreflang="fr"/);
  const etag=page.headers.get('etag');assert.equal((await app.handler(new Request('https://example.test/docs/sitemaps/3',{method:'HEAD'}))).status,200);assert.equal(await(await app.handler(new Request('https://example.test/docs/sitemaps/3',{method:'HEAD'}))).text(),'');
  assert.equal((await app.handler(new Request('https://example.test/docs/sitemaps/3',{headers:{'if-none-match':'W/'+etag}}))).status,304);
  assert.match(await(await app.handler(request('/robots.txt'))).text(),/https:\/\/example.test\/docs\/sitemap.xml/);
  assert.equal(await(await app.handler(request('/trust.txt'))).text(),'contact: owner@example.test\n');
 }finally{await app.close();}assert.equal((await app.handler(request('/docs/sitemap.xml'))).status,503);
});
test('private/signed URLs, hostile Host/forwarded origin, and repeated cursors fail closed',async()=>{
 for(const value of [{...row(1),visibility:'private'},{...row(1),images:['https://example.test/file?signature=private']},{...row(1),loc:'https://example.test/docs/a?token=private'},{...row(1),alternates:{de:'https://example.test/docs/a'}}]){
  const app=createPublicCrawlerService({site,source:{load:async()=>({items:[value]})}});try{const result=await app.handler(request('/docs/sitemap.xml'));assert.equal(result.status,503);assert(!await result.text());}finally{await app.close();}
 }
 const app=createPublicCrawlerService({site,source:{load:async()=>({items:[],nextCursor:'same'})}});
 try{
  assert.equal((await app.handler(new Request('https://evil.test/docs/sitemap.xml',{headers:{'x-forwarded-host':'example.test'}}))).status,421);
  assert.equal((await app.handler(new Request('https://example.test/docs/sitemap.xml',{headers:{host:'evil.test'}}))).status,421);
  assert.equal((await app.handler(request('/docs/sitemap.xml'))).status,503);
 }finally{await app.close();}
});
test('verified direct proxy peer can admit configured internal origin without trusting forwarded headers',async()=>{
 const app=createPublicCrawlerService({site:{...site,trustedProxy:{peers:['127.0.0.1'],internalOrigins:['http://internal.test']}},source:{load:async()=>({items:[row(1)]})}});
 try{const req=new Request('http://internal.test/docs/sitemap.xml',{headers:{'x-forwarded-host':'evil.test',forwarded:'host=evil.test;proto=http'}});assert.equal((await app.handler(req,{peerAddress:'192.0.2.1'})).status,421);const result=await app.handler(req,{peerAddress:'127.0.0.1'});assert.equal(result.status,200);const xml=await result.text();assert(!xml.includes('evil.test'));assert(xml.includes('https://example.test/'));}finally{await app.close();}
});
test('deadline preserves native ownership; close drains, failures retry and iterator cleanup is bounded',async()=>{
 let finish,signal,calls=0;const app=createPublicCrawlerService({site,timeoutMs:10,source:{load:async input=>{signal=input.signal;calls++;return new Promise(r=>finish=r);}}});
 const response=await app.handler(request('/docs/sitemap.xml'));assert.equal(response.status,503);assert.equal(app.status().pending,true);assert(signal.aborted);let closed=false;const closing=app.close().then(()=>closed=true);await new Promise(r=>setImmediate(r));assert.equal(closed,false);finish({items:[]});await closing;assert.equal(calls,1);
 let failed=true;const retry=createPublicCrawlerService({site,source:{load:async()=>{if(failed)throw Error('private DB credentials');return {items:[row(1)]};}}});try{assert.equal((await retry.handler(request('/docs/sitemap.xml'))).status,503);failed=false;assert.equal((await retry.handler(request('/docs/sitemap.xml'))).status,200);}finally{await retry.close();}
 let finalized=false;function* excessive(){try{for(let i=0;i<50001;i++)yield {loc:'https://example.test/sitemap'+i};}finally{finalized=true;}}
 assert.throws(()=>createSitemapIndex(excessive()),RangeError);assert(finalized);
});
test('fixed redirects reject cycles/open targets and never copy query/forwarded values',()=>{
 assert.throws(()=>createPublicRedirects({site,rules:[{from:'/docs/a',to:'/docs/b',status:308},{from:'/docs/b',to:'/docs/a',status:307}]}),/loop/);
 assert.throws(()=>createPublicRedirects({site,rules:[{from:'/docs/a',to:'https://evil.test/x',status:302}]}),/Open/);
 assert.throws(()=>createPublicRedirects({site,rules:[{from:'/docs/a',to:'/docs/x/../new',status:308}]}));
 const redirects=createPublicRedirects({site,rules:[{from:'/docs/old',to:'/docs/new',status:308}]});
 const response=redirects.handler(new Request('https://example.test/docs/old?next=https://evil.test',{headers:{'x-forwarded-host':'evil.test'}}));assert.equal(response.status,308);assert.equal(response.headers.get('location'),'https://example.test/docs/new');assert.equal(redirects.handler(new Request('https://evil.test/docs/old')).status,421);
 assert.equal(redirects.handler(new Request('https://example.test/docs/old',{method:'POST'})).status,405);
});
test('HTML sitemap is a separate bounded escaped renderer with explicit public labels',()=>{
 const html=renderHtmlSitemap(site,[{visibility:'public',loc:'https://example.test/docs/a',title:'<img onerror=bad>'}]);assert(html.includes('&lt;img'));assert(!html.includes('<img'));
 assert.throws(()=>renderHtmlSitemap(site,[{visibility:'private',loc:'https://example.test/docs/a',title:'Secret'}]));
 assert.throws(()=>renderHtmlSitemap(site,[{visibility:'public',loc:'https://example.test/docs/a?secret=x',title:'Secret'}]));
});
