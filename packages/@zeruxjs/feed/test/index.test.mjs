import test from 'node:test';
import assert from 'node:assert/strict';
import {createRssFeed,createAtomFeed,createJsonFeed,getFeedContentType} from '../dist/index.js';
const feed={title:'Example & Co',description:'News',siteUrl:'https://example.com',feedUrl:'https://example.com/feed',items:[{id:'one',title:'A < B',url:'https://example.com/one',date:'2025-01-01',author:'Bob',tags:['news'],enclosure:{url:'https://example.com/a.mp3',type:'audio/mpeg',length:200}}]};
test('well-escaped feeds with metadata',()=>{
 assert.match(createRssFeed(feed),/Example &amp; Co/);
 assert.match(createRssFeed(feed),/enclosure/);
 assert.match(createAtomFeed(feed),/<entry>/);
 assert.equal(JSON.parse(createJsonFeed(feed)).items[0].attachments[0].size_in_bytes,200);
 assert.match(getFeedContentType('json'),/feed\+json/);
});
test('rejects invalid dates, urls and enclosures',()=>{
 assert.throws(()=>createRssFeed({...feed,items:[{...feed.items[0],date:'not a date'}]}),/date/);
 assert.throws(()=>createJsonFeed({...feed,items:[{...feed.items[0],url:'javascript:alert(1)'}]}),/URL/);
 assert.throws(()=>createAtomFeed({...feed,items:[{...feed.items[0],enclosure:{url:'https://example.com/a',type:'a',length:-1}}]}),/length/);
});
