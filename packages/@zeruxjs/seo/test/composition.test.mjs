import test from 'node:test';
import assert from 'node:assert/strict';
import {composeMetadata,resolveMetadata,createMetadataHooks,metadataElements,renderMetadata} from '@zeruxjs/seo/composition';
const site={publicBase:'https://example.test/docs/',mediaOrigins:['https://example.test','https://media.example.test'],locales:{'en-US':'https://example.test/docs/en/','fr':'https://example.test/docs/fr/','x-default':'https://example.test/docs/'},pagination:{parameter:'page',maxPage:50}};
const context={url:'https://example.test/docs/en/list',locale:'en-US',visibility:'public',page:2};
const count=(html,pattern)=>[...html.matchAll(pattern)].length;
test('nested/manual overrides are deterministic, title template applies once, singleton tags deduplicate',()=>{
 const layers=[{title:{text:'Fallback',template:'%s | Parent'},description:'Parent',openGraph:{siteName:'Docs',images:['https://media.example.test/a.png']}},{title:{template:'[%s]'},openGraph:{type:'article'}},{title:'Route $&',description:'Route description',openGraph:{images:['https://media.example.test/b.png','https://media.example.test/b.png']},social:{title:'Manual card'},alternates:{fr:'https://example.test/docs/fr/list','en-US':'https://example.test/docs/en/list'},jsonLd:[{'@type':'WebPage',name:'List'},{'@type':'WebPage',name:'List'}]}];
 const original=JSON.stringify(layers),doc=composeMetadata(site,layers,context),html=renderMetadata(doc);
 assert.equal(doc.title,'[Route $&]');assert.equal(doc.canonical,'https://example.test/docs/en/list?page=2');assert.equal(doc.openGraph.siteName,'Docs');assert.equal(doc.openGraph.locale,'en_US');assert.equal(doc.social.title,'Manual card');assert.equal(doc.jsonLd.length,1);
 assert.equal(count(html,/<title>/g),1);assert.equal(count(html,/<meta name="description"/g),1);assert.equal(count(html,/<link rel="canonical"/g),1);assert.equal(count(html,/<meta property="og:image"/g),1);
 assert.equal(doc.alternates.fr,'https://example.test/docs/fr/list?page=2');assert.equal(JSON.stringify(layers),original);assert.equal(renderMetadata(composeMetadata(site,layers,context)),html);assert(Object.isFrozen(doc.openGraph.images));
 const absolute=composeMetadata(site,[...layers,{title:{text:'Absolute',absolute:true},description:null,openGraph:{images:[]},social:{image:null},alternates:{fr:null},jsonLd:null}],context);
 assert.equal(absolute.title,'Absolute');assert.equal(absolute.description,undefined);assert.deepEqual(absolute.openGraph.images,[]);assert.equal(absolute.alternates.fr,undefined);assert.equal(absolute.jsonLd.length,0);
});
test('JSON-LD is inert, script-safe and preserves only supplied facts; invalid accessors never run',()=>{
 const facts={'@context':'https://schema.org','@type':'WebPage',name:'</script><script>alert(1)</script>&\u2028'};
 const doc=composeMetadata(site,[{title:'<img src=x onerror=bad>',jsonLd:[facts]}],context),html=renderMetadata(doc,{nonce:'a'.repeat(24)});
 assert(html.includes('&lt;img'));assert(!html.includes('</script><script>'));assert(html.includes('\\u003c'));assert(html.includes('nonce="'+ 'a'.repeat(24)+'"'));
 const script=metadataElements(doc).find(e=>e.tag==='script');assert.deepEqual(JSON.parse(script.text),facts);assert.equal(JSON.parse(script.text).author,undefined);
 let executed=false;const bad={title:'Title'};Object.defineProperty(bad,'description',{enumerable:true,get(){executed=true;return 'bad';}});assert.throws(()=>composeMetadata(site,[bad],context));assert.equal(executed,false);
 assert.throws(()=>composeMetadata(site,[{title:'x',jsonLd:[new Date()]}],context));
 assert.throws(()=>composeMetadata(site,[{title:'x',jsonLd:[{toJSON(){executed=true;return 'bad'}}]}],context));assert.equal(executed,false);
 assert.throws(()=>renderMetadata({...doc,title:'forged'}));
});
test('canonical/media/locale/page policies reject unsafe direct and hook input',async()=>{
 for(const canonical of ['/relative','javascript:alert(1)','https://user:pass@example.test/docs/en/a','https://attacker.test/docs/en/a','https://example.test/private','https://example.test/docs/en/a?token=private','https://example.test/docs/en/a?page=3','https://example.test/docs/en/a#fragment'])assert.throws(()=>composeMetadata(site,[{title:'x',canonical}],context));
 assert.throws(()=>composeMetadata(site,[{title:'x',canonical:'javascript:bad'}],{...context,visibility:'private'}));
 assert.throws(()=>composeMetadata(site,[{title:'x',openGraph:{images:['https://unapproved.test/a']}}],context));
 assert.throws(()=>composeMetadata(site,[{title:'x',alternates:{de:'https://example.test/docs/de/a'}}],context));
 assert.throws(()=>composeMetadata(site,[{title:'x',alternates:{fr:'https://example.test/docs/en/a'}}],context));
 assert.throws(()=>composeMetadata(site,[{title:'x',titleTemplate:'%s'}],context));
 assert.throws(()=>composeMetadata(site,[{title:{text:'x',template:'%s %s'}}],context));
 assert.throws(()=>composeMetadata(site,[{title:'x'}],{...context,page:51}));
 const hooks=createMetadataHooks();hooks.register('metadata:resolve',(_ctx,meta)=>({...meta,canonical:'javascript:bad'}));
 try{await assert.rejects(resolveMetadata(site,[{title:'x'}],context,{hooks}));}finally{hooks.dispose();await hooks.whenIdle();}
});
test('private pages enforce noindex/nofollow and omit discovery/social/JSON-LD after hooks',async()=>{
 const hooks=createMetadataHooks();hooks.register('metadata:resolve',(_ctx,meta)=>({...meta,robots:{index:true,follow:true},canonical:context.url,alternates:{fr:'https://example.test/docs/fr/list'},jsonLd:[{'@type':'WebPage',name:'private'}]}));
 try{const doc=await resolveMetadata(site,[{title:'Private',openGraph:{images:['https://example.test/private.png']}}],{...context,visibility:'private'},{hooks});const html=renderMetadata(doc);assert.equal(doc.robots.index,false);assert.match(html,/noindex, nofollow/);assert(!html.includes('rel="canonical"'));assert(!html.includes('og:'));assert(!html.includes('application/ld+json'));assert.equal(doc.jsonLd.length,0);}finally{hooks.dispose();await hooks.whenIdle();}
});
test('hook ordering/once, concurrent request isolation, failures and actual cancellation cleanup',async()=>{
 const hooks=createMetadataHooks(),order=[];
 hooks.register('metadata:resolve',(_ctx,meta)=>{order.push('first');return {...meta,description:'first'};},{priority:1,once:true});
 const token=hooks.register('metadata:resolve',(_ctx,meta,route)=>({...meta,description:route.url}),{priority:10});
 const [a,b]=await Promise.all([resolveMetadata(site,[{title:'A'}],context,{hooks}),resolveMetadata(site,[{title:'B'}],{...context,url:'https://example.test/docs/en/b'},{hooks})]);assert.equal(order.length,1);assert.notEqual(a.description,b.description);assert.equal(token.remove(),true);
 hooks.register('metadata:resolve',()=>{throw Error('private dependency failure')});await assert.rejects(resolveMetadata(site,[{title:'x'}],context,{hooks}),/dependency failure/);hooks.dispose();await hooks.whenIdle();assert.equal(hooks.getDiagnostics().handlers,0);
 const waiting=createMetadataHooks();let finish,started;const ready=new Promise(r=>started=r);
 waiting.register('metadata:resolve',async(_ctx,meta)=>{started();await new Promise(r=>finish=r);return meta;});
 const ctrl=new AbortController(),pending=resolveMetadata(site,[{title:'x'}],context,{hooks:waiting,signal:ctrl.signal});await ready;ctrl.abort();waiting.dispose();let idle=false;const draining=waiting.whenIdle().then(()=>idle=true);await new Promise(r=>setImmediate(r));assert.equal(idle,false);finish();await assert.rejects(pending);await draining;assert.equal(waiting.getDiagnostics().pending,0);
});

test('async and collection boundaries validate descriptors before copying or iteration',async()=>{
 let executed=false;
 const badSite={};Object.defineProperty(badSite,'publicBase',{enumerable:true,get(){executed=true;return site.publicBase;}});
 await assert.rejects(resolveMetadata(badSite,[{title:'x'}],context));assert.equal(executed,false);
 const layers=[{title:'x'}];layers[Symbol.iterator]=function*(){executed=true;yield {title:'forged'};};
 assert.throws(()=>composeMetadata(site,layers,context));assert.equal(executed,false);
 assert.throws(()=>composeMetadata(site,[{title:'x',alternates:{'en-us':context.url,'en-US':context.url}}],context));
});

test('direct composition rejects bounded JSON and sparse array abuse',()=>{
 assert.throws(()=>composeMetadata(site,[{title:'x',jsonLd:[{name:'x'.repeat(262145)}]}],context),RangeError);
 assert.throws(()=>composeMetadata(site,[{title:'x',jsonLd:new Array(100000000)}],context));
});
