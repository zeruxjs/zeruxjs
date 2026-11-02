import test from 'node:test';
import assert from 'node:assert/strict';
import {SaxesParser} from 'saxes';
import {createRssFeed,createAtomFeed,createJsonFeed,createFeedResponse} from '@zeruxjs/feed';
import {createFeedFetchHandler} from '@zeruxjs/feed/fetch';
const data={strict:true,title:'A & <B>',description:'News',siteUrl:'https://example.test/',feedUrl:'https://example.test/feed',id:'urn:example:feed',language:'en-US',authors:[{name:'Team',url:'https://example.test/team',email:'team@example.test'}],categories:[{term:'news',scheme:'https://example.test/categories',label:'News'}],updated:'2025-01-02T00:00:00Z',items:[{id:'one',atomId:'urn:example:one',title:'One <Two>',url:'https://example.test/one?q=1&lang=en',contentText:'Plain text',contentHtml:'<p>Text &amp; safe</p>',date:'2025-01-01',updated:'2025-01-03T00:00:00Z',authors:[{name:'Alice',email:'alice@example.test',url:'https://example.test/alice',avatar:'https://example.test/avatar.png'}],language:'fr',categories:[{term:'release',scheme:'https://example.test/categories',label:'Release'}],attachments:[{url:'https://example.test/audio.mp3',type:'audio/mpeg',length:123,title:'Audio',duration:12}]}]};
function parse(xml){const tags=[],texts=[];const parser=new SaxesParser({xmlns:true});parser.on('opentag',tag=>tags.push(tag));parser.on('text',value=>texts.push(value));parser.write(xml).close();return {tags,texts};}
test('standard XML parser reads RSS/Atom namespaces, authors, categories, enclosure metadata and language',()=>{
 const rss=parse(createRssFeed(data)),atom=parse(createAtomFeed(data));
 assert(rss.tags.some(t=>t.local==='creator'&&t.uri==='http://purl.org/dc/elements/1.1/'));
 assert(rss.tags.some(t=>t.local==='encoded'&&t.uri==='http://purl.org/rss/1.0/modules/content/'));
 assert(rss.tags.some(t=>t.local==='enclosure'&&t.attributes.length.value==='123'));
 assert(atom.tags.every(t=>t.uri==='http://www.w3.org/2005/Atom'));
 assert(atom.tags.some(t=>t.local==='link'&&t.attributes.rel?.value==='enclosure'&&t.attributes.type.value==='audio/mpeg'));
 assert(atom.tags.some(t=>t.local==='feed'&&t.attributes['xml:lang'].value==='en-US'));
 assert(atom.texts.includes('A & <B>'));assert(atom.texts.includes('urn:example:one'));
 const json=JSON.parse(createJsonFeed(data));assert.equal(json.authors[0].name,'Team');assert.equal(json.items[0].authors[0].avatar,'https://example.test/avatar.png');assert.equal(json.items[0].attachments[0].duration_in_seconds,12);assert.equal(json.items[0].language,'fr');
 assert.equal(createAtomFeed(data),createAtomFeed(data));assert.match(createRssFeed(data),/Fri, 03 Jan 2025 00:00:00 GMT/);
});
test('duplicate IDs, strict missing facts, invalid dates/URLs/MIME, accessors and byte limits reject directly',()=>{
 const cloned=()=>structuredClone(data);
 let f=cloned();f.items.push({...f.items[0]});assert.throws(()=>createJsonFeed(f),/Duplicate/);
 f=cloned();f.items.push({...f.items[0],id:'two'});assert.throws(()=>createAtomFeed(f),/Duplicate Atom/);
 f=cloned();delete f.authors;delete f.items[0].authors;assert.throws(()=>createAtomFeed(f),/authors/);
 f=cloned();delete f.items[0].date;delete f.items[0].updated;assert.throws(()=>createAtomFeed(f),/updated/);
 for(const date of ['2025-02-30','2025-01-01T24:00:00Z','not-date']){f=cloned();f.items[0].date=date;assert.throws(()=>createRssFeed(f),/date/);}
 for(const url of ['javascript:alert(1)','https://user:pass@example.test/a']){f=cloned();f.items[0].attachments[0].url=url;assert.throws(()=>createAtomFeed(f),/URL/);}
 f=cloned();f.items[0].attachments[0].type='audio/mpeg" hacked="x';assert.throws(()=>createJsonFeed(f),/MIME/);
 f=cloned();f.items[0].attachments.push({...f.items[0].attachments[0],url:'https://example.test/second.mp3'});assert.throws(()=>createRssFeed(f),/one enclosure/);assert.equal(JSON.parse(createJsonFeed(f)).items[0].attachments.length,2);
 f=cloned();f.maxBytes=256;assert.throws(()=>createRssFeed(f),/byte limit/);
 let getter=false;f=cloned();Object.defineProperty(f.items[0],'contentHtml',{enumerable:true,get(){getter=true;return 'unsafe'}});assert.throws(()=>createJsonFeed(f));assert.equal(getter,false);
 assert.throws(()=>createFeedResponse('bogus',data),/format/);
});
test('negotiation quality/specificity, representation ETags, weak 304/HEAD and last-modified maximum',async()=>{
 const feed=createFeedFetchHandler({feed:data,format:'negotiate'});
 try{
  const get=(accept,headers={})=>feed(new Request('https://example.test/feed',{headers:{accept,...headers}}));
  const first=await get('application/atom+xml');assert.match(first.headers.get('last-modified'),/03 Jan 2025/);
  assert.equal((await get('application/atom+xml',{'if-none-match':'W/'+first.headers.get('etag')})).status,304);
  assert.equal((await feed(new Request('https://example.test/feed',{method:'HEAD',headers:{accept:'application/feed+json'}}))).body,null);
  const rss=await get('application/rss+xml'),json=await get('application/feed+json');assert.notEqual(rss.headers.get('etag'),json.headers.get('etag'));
  const specific=await get('application/rss+xml;q=0, */*;q=1');assert.match(specific.headers.get('content-type'),/atom\+xml/);
  assert.equal((await get('text/html')).status,406);assert.equal((await get('application/rss+xml;q=1.5')).status,406);
  const privateResponse=await get('application/rss+xml',{cookie:'session=private'});assert.equal(privateResponse.headers.get('cache-control'),'private, no-store');
  assert.equal((await get('application/rss+xml',{'if-modified-since':'Thu, 02 Jan 2025 00:00:00 GMT'})).status,200);
 }finally{await feed.close();}
});
test('supplier outage/cancellation retains native slot and close drains; no raw causes or remote URL fetches',async()=>{
 const outage=createFeedFetchHandler({feed:async()=>{throw Error('private database token')}});try{const response=await outage(new Request('https://example.test/feed'));assert.equal(response.status,503);assert.equal(await response.text(),'');}finally{await outage.close();}
 let finish,signal;const blocked=createFeedFetchHandler({maxPending:1,timeoutMs:10,feed:async ctx=>{signal=ctx.signal;return new Promise(r=>finish=r);}});
 const response=await blocked(new Request('https://example.test/feed'));assert.equal(response.status,503);assert(signal.aborted);assert.equal(blocked.status().pending,1);
 assert.equal((await blocked(new Request('https://example.test/feed'))).status,503);
 let closed=false;const closing=blocked.close().then(()=>closed=true);await new Promise(r=>setImmediate(r));assert.equal(closed,false);finish(data);await closing;
 assert.equal(blocked.status().pending,0);
 const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('Generation must not fetch attachments');};try{createRssFeed(data);createAtomFeed(data);createJsonFeed(data);}finally{globalThis.fetch=original;}
});

test('XML attribute whitespace survives namespace-aware parsing without becoming extra markup',()=>{
 const feed=structuredClone(data);feed.items[0].categories=[{term:'line\nsecond\tpart',label:'label\rending'}];
 const atom=parse(createAtomFeed(feed));const category=atom.tags.find(t=>t.local==='category'&&t.attributes.term.value.includes('second'));
 assert.equal(category.attributes.term.value,'line\nsecond\tpart');assert.equal(category.attributes.label.value,'label\rending');
});
