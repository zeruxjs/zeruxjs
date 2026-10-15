import test from 'node:test';import assert from 'node:assert/strict';import {createCrawlerRoutes} from '../dist/fetch.js';
const item=n=>({loc:`https://example.com/${n}`,lastmod:'2025-10-01'});
test('sitemap splits into discoverable pages with proper route patterns',async()=>{
 const routes=createCrawlerRoutes({origin:'https://example.com',entries:[item(1),item(2),item(3)],maxUrlsPerSitemap:2});
 assert.deepEqual(routes.map(x=>x.path),['/robots.txt','/sitemap.xml','/sitemaps/:page']);
 const handler=routes[1].handler;
 const index=await handler(new Request('https://example.com/sitemap.xml'));assert.equal(index.status,200);assert.match(await index.text(),/sitemaps\/2/);
 const page=await handler(new Request('https://example.com/sitemaps/2'));assert.match(await page.text(),/https:\/\/example.com\/3/);
 assert.equal((await handler(new Request('https://example.com/sitemaps/3'))).status,404);
 assert.match(await (await handler(new Request('https://example.com/robots.txt'))).text(),/sitemap.xml/);
});
test('crawler responses support HEAD and conditional requests, strict URL size limits',async()=>{
 const routes=createCrawlerRoutes({origin:'https://example.com',entries:[item(1)]});const handler=routes[0].handler;
 const first=await handler(new Request('https://example.com/sitemap.xml'));
 assert.match(await first.text(),/urlset/);
 assert.equal((await handler(new Request('https://example.com/sitemap.xml',{headers:{'if-none-match':first.headers.get('etag')}}))).status,304);
 assert.equal((await handler(new Request('https://example.com/sitemap.xml',{method:'HEAD'}))).body,null);
 assert.equal((await handler(new Request('https://example.com/sitemap.xml',{method:'POST'}))).status,405);
 assert.throws(()=>createCrawlerRoutes({origin:'file:///tmp',entries:[]}),TypeError);
 assert.throws(()=>createCrawlerRoutes({origin:'https://example.com',entries:[],maxXmlBytes:100}),RangeError);
});
test('sitemap page size limits split long URLs without exceeding bytes',async()=>{
 const entries=Array.from({length:8},(_,i)=>({loc:`https://example.com/${i}-`+'x'.repeat(800)}));
 const handler=createCrawlerRoutes({origin:'https://example.com',entries,maxXmlBytes:2048})[0].handler;
 const index=await handler(new Request('https://example.com/sitemap.xml'));const xml=await index.text();assert.match(xml,/sitemapindex/);
 const matches=[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];assert.ok(matches.length>=4);
 for(const m of matches){const page=await handler(new Request(m[1]));const body=await page.text();assert.ok(Buffer.byteLength(body)<=2048);}
});

test('crawler snapshots coalesce concurrent rebuilds and allow explicit invalidation',async()=>{
 const {createCrawlerService}=await import('../dist/fetch.js');
 let calls=0;let content=[item(1)];
 const service=createCrawlerService({origin:'https://example.com',entries:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return content},snapshotTtlMs:5000});
 const handler=service.routes[0].handler;
 await Promise.all(Array.from({length:8},()=>handler(new Request('https://example.com/sitemap.xml'))));
 assert.equal(calls,1);
 const before=await (await handler(new Request('https://example.com/sitemap.xml'))).text();assert.match(before,/example.com\/1/);
 content=[item(2)];assert.equal(calls,1);
 service.invalidate();const after=await(await handler(new Request('https://example.com/sitemap.xml'))).text();assert.match(after,/example.com\/2/);assert.equal(calls,2);
});
