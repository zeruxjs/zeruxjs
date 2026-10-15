import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {bootstrapApplication} from '../dist/bootstrap/runtime.js';
import {registerFetchRoutes} from '../dist/fetch-route.js';
import {createFeedFetchHandler} from '../../@zeruxjs/feed/dist/fetch.js';
import {createCrawlerRoutes} from '../../@zeruxjs/seo/dist/fetch.js';
import {createSearchIndex} from '../../@zeruxjs/search/dist/index.js';
import {createSearchHandler} from '../../@zeruxjs/search/dist/http.js';
import {createFontRegistry} from '../../@zeruxjs/font/dist/index.js';
import {createFontStylesheetHandler} from '../../@zeruxjs/font/dist/http.js';
const listen=server=>new Promise(ok=>server.listen(0,'127.0.0.1',()=>ok(server.address().port)));
const stop=server=>new Promise(ok=>server.close(ok));
async function request(port,pathname,{method='GET',headers={},body}={}) {
 return await new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,method,path:pathname,headers:{host:'localhost',...headers}},res=>{
   const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));res.on('error',reject);
  });req.on('error',reject);req.end(body);
 });
}
test('real ZeruxJS routes serve searchable docs, dynamic sitemap, feed and font CSS',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'zerux-fetch-'));
 const structure={mode:'fix',rootDir:dir,serviceName:'app',entryPointName:'index',appDir:null,middlewareDirs:[],controllerDirs:[],composableDirs:[],pluginDirs:[],envFiles:[],publicDirs:[],outputDir:dir,raw:{}};
 const {runtime}=await bootstrapApplication(dir,'start',{server:{allowedDomains:['localhost']}},structure);
 const search=createSearchIndex();search.add({id:'doc',text:'Hello Zerux ecosystem'});
 const fonts=createFontRegistry();fonts.add('ui',{family:'Inter',sources:[{url:'/inter.woff2'}]});
 registerFetchRoutes(runtime.asPluginApi(),[
  {pattern:'/search',handler:createSearchHandler({index:search})},
  {pattern:'/feed',handler:createFeedFetchHandler({feed:{title:'News',description:'News feed',siteUrl:'https://example.com',items:[{id:'1',title:'Post',url:'https://example.com/post'}]}})},
  ...createCrawlerRoutes({origin:'https://example.com',entries:[{loc:'https://example.com/post'},{loc:'https://example.com/other'}],maxUrlsPerSitemap:1}),
  {pattern:'/fonts.css',handler:createFontStylesheetHandler({registry:fonts})},
  {pattern:'/download',handler:()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('abc'));c.enqueue(new TextEncoder().encode('def'));c.close()}}),{headers:{'content-type':'application/octet-stream'}})},
  {pattern:'/upload',handler:async request=>new Response(JSON.stringify({bytes:(await request.arrayBuffer()).byteLength}),{headers:{'content-type':'application/json'}})}
 ]);
 const server=http.createServer(runtime.createHandler());const port=await listen(server);
 try {
  const found=await request(port,'/search?q=hello');assert.equal(found.status,200);assert.equal(JSON.parse(found.body).results[0].document.id,'doc');
  const etag=found.headers.etag;assert.equal((await request(port,'/search?q=hello',{headers:{'if-none-match':etag}})).status,304);
  assert.equal((await request(port,'/search?q=hello',{method:'HEAD'})).body.length,0);
  const feed=await request(port,'/feed');assert.match(feed.headers['content-type'],/rss\+xml/);assert.match(feed.body.toString(),/News/);
  const site=await request(port,'/sitemap.xml');assert.match(site.body.toString(),/sitemapindex/);
  const sub=await request(port,'/sitemaps/1');assert.match(sub.body.toString(),/urlset/);
  const robots=await request(port,'/robots.txt');assert.match(robots.body.toString(),/sitemap.xml/);
  const font=await request(port,'/fonts.css');assert.match(font.body.toString(),/@font-face/);
  const down=await request(port,'/download');assert.equal(down.body.toString(),'abcdef');
  assert.equal((await request(port,'/feed',{method:'POST'})).status,405);
  const upload=await request(port,'/upload',{method:'POST',body:Buffer.alloc(1024*1024+67)});assert.deepEqual(JSON.parse(upload.body),{bytes:1024*1024+67});
  assert.ok(runtime.getLoadStatus().statusFamilies['2xx']>=7);
 } finally{runtime.closeProtocols();await stop(server);await rm(dir,{recursive:true,force:true})}
});
