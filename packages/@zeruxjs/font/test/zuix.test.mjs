import test from 'node:test';
import assert from 'node:assert/strict';
import {createFontRegistry,createFontLoadScope,loadFont} from '../dist/index.js';
import {createFontZuixAdapter} from '../dist/zuix.js';
import {createFontStylesheetHandler} from '../dist/http.js';
import {createZuix} from 'zuixs';
function fixture(){
 const registry=createFontRegistry();
 registry.add('body',{family:'Brand Sans',weight:400,display:'swap',sources:[{url:'/shop/fonts/a.woff2',format:'woff2'}]});
 registry.add('unused',{family:'Unused',weight:700,sources:[{url:'/shop/fonts/b.woff2'}]});
 const license={id:'MIT',source:'local:test',attribution:'Synthetic',redistributionAllowed:true};
 const assets={schema:1,digest:'fixture',css:{file:'font.css',url:'/shop/fonts/font.css',sha256:'fixture'},fonts:registry.entries().map(([key,face])=>({key,family:face.family,weight:String(face.weight),style:'normal',url:face.sources[0].url,file:key+'.woff2',bytes:64,format:'woff2',sha256:'fixture',sourceSha256:'fixture',license,axes:[]})),icons:[{key:'star',kind:'font',fontKey:'body',codePoint:9733},{key:'mark',kind:'svg',url:'/shop/fonts/mark.svg',file:'mark.svg',bytes:24,sha256:'fixture',license}],preloads:[]};
 return {registry,assets,fonts:[{token:'body',key:'body'}],icons:[{token:'star',key:'star'},{token:'mark',key:'mark'}]};
}
test('explicit font/theme/icon adapter emits selected deterministic mounted assets and honors user overrides',()=>{
 const input=fixture(),adapter=createFontZuixAdapter(input);
 const result=createZuix({preflight:false,prefix:'ui-',important:true,theme:adapter.theme,plugins:[adapter.plugin]}).generate(['ui-font-family-body','ui-font-weight-body','ui-icon-star']);
 assert.deepEqual(result.unmatched,[]);assert.match(result.css,/font-family:var\(--zx-font-body\) !important/);assert.match(result.css,/font-weight:400 !important/);assert.match(result.css,/--zx-font-body:"Brand Sans", system-ui, sans-serif/);
 assert.doesNotMatch(adapter.css,/Unused|b\.woff2/);assert.match(adapter.css,/\/shop\/fonts\/a\.woff2/);assert.equal(adapter.manifest.icons[1].kind,'font');
 assert.deepEqual(adapter.preloads([]),[]);assert.equal(adapter.preloads([['body'],['body']]).length,1);
 assert.throws(()=>adapter.preloads([['body']],{maxCount:0,maxBytes:100}),/budget/);assert.throws(()=>adapter.preloads([['missing']]),/Unknown/);
 const overridden=createZuix({preflight:false,theme:adapter.theme,extend:{fontFamily:{body:'serif'},fontWeight:{body:500}},plugins:[adapter.plugin]}).generate(['font-family-body','font-weight-body']);assert.match(overridden.css,/font-family:serif/);assert.match(overridden.css,/font-weight:500/);
 input.assets.fonts[0].url='/changed';input.fonts[0].key='unused';assert.equal(adapter.preloads([['body']])[0].url,'/shop/fonts/a.woff2');
 const again=createFontZuixAdapter(fixture());assert.equal(adapter.css,again.css);
 const handler=createFontStylesheetHandler({registry:adapter.registry,preloadKeys:['body']});const first=handler(new Request('https://test/fonts.css'));assert.match(first.headers.get('link'),/\/shop\/fonts\/a.woff2/);
 adapter.registry.add('new',{family:'New',sources:[{url:'/shop/fonts/new.woff2'}]});assert.notEqual(handler(new Request('https://test/fonts.css')).headers.get('etag'),first.headers.get('etag'));
});
test('collisions, mismatched manifest, unsafe fallbacks and missing assets reject before compilation',()=>{
 for(const mutate of [i=>i.fonts.push({token:'body',key:'unused'}),i=>i.icons.push({token:'body',key:'mark'}),i=>i.fonts[0].token='x;}',i=>i.fonts[0].key='missing',i=>i.assets.fonts[0].url='https://remote/font',i=>i.fonts[0].fallback=['bad;}'],i=>i.assets.fonts.push(i.assets.fonts[0])]){const input=fixture();mutate(input);assert.throws(()=>createFontZuixAdapter(input));}
});
test('font loading is optional, failure-redacted, cancelled and disposed without DOM import access',async()=>{
 assert.equal(await loadFont('Absent'),false);
 await assert.rejects(loadFont('Bad;',{}));await assert.rejects(loadFont('A',{timeoutMs:Infinity}));
 let starts=0;const scope=createFontLoadScope({document:{fonts:{load:()=>{starts++;return new Promise(()=>{});}}},maxPending:1});
 const pending=scope.load('Brand');await assert.rejects(scope.load('Other'),/concurrency/);scope.dispose();scope.dispose();await assert.rejects(pending,/cancelled/);assert.equal(scope.pendingCount,0);assert.equal(starts,1);await assert.rejects(scope.load('Brand'),/disposed/);
 const failed=createFontLoadScope({document:{fonts:{load:()=>Promise.reject(new Error('secret signed URL'))}}});await assert.rejects(failed.load('Brand'),e=>e.message==='Font loading failed');failed.dispose();await assert.rejects(loadFont('Brand',{document:{fonts:{load(){throw new Error('private source');}}}}),e=>e.message==='Font loading failed');
 const controller=new AbortController();controller.abort();await assert.rejects(loadFont('Brand',{signal:controller.signal}),/cancelled/);
 await assert.rejects(loadFont('Brand',{document:{fonts:{load:()=>new Promise(()=>{})}},timeoutMs:1}),/timed out/);
 const immediate=createFontLoadScope({document:{fonts:{load(){throw new Error('must not start');}}}});const stopped=immediate.load('Brand');immediate.dispose();await assert.rejects(stopped,/cancelled/);
 assert.equal(await loadFont('Brand',{document:{fonts:{load:async()=>[{}]}}}),true);
});
