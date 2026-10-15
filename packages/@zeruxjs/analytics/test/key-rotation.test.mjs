import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createEmailTrackingService} from '../dist/index.js';

const first={id:'oct-2026',secret:'long-and-private-first-secret-'.repeat(2)};
const second={id:'nov_2026',secret:'second-super-private-tracking-secret-'.repeat(2)};
const third={id:'dec-2026',secret:'third-super-private-tracking-secret-'.repeat(2)};
const analytics={track:async()=>undefined};
const baseUrl='https://events.example.test';
const make=(options)=>createEmailTrackingService({analytics,baseUrl,...options});
const context={id:'mail-rotation',account:'marketing',message:{tracking:{enabled:true,campaign:'winter-sale'}}};
const links=(tracking)=>{
  const html=tracking.instrumentHtml('<body><a href="https://store.example.test/offer?customer=opaque">Offer</a></body>',context);
  const found=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(x=>x[1]);
  return {click:found.find(x=>x.includes('/click/')),open:found.find(x=>x.includes('/open/'))};
};
const request=(url)=>new Request(url,{method:'GET'});

// Existing single-secret users still emit *the same v2 wire format*.
test('Section 45: v2 single-secret URLs survive a rotation to an explicit key ring',async()=>{
  const old=make({secret:first.secret});
  const issued=links(old);
  assert.match(issued.click,/\/v2\.[A-Za-z0-9_-]+$/);
  const rotated=make({keyRing:{current:second,previous:[first]}});
  const newer=links(rotated);
  assert.match(newer.click,/\/v3\.nov_2026\.[A-Za-z0-9_-]+$/);
  assert.equal((await rotated.handle(request(issued.click))).headers.get('location'),'https://store.example.test/offer?customer=opaque');
  assert.equal((await rotated.handle(request(issued.open))).status,200);
  assert.equal((await rotated.handle(request(newer.click))).status,302);
  assert.equal((await old.handle(request(newer.click))).status,404);
});

test('Section 45: v3 links stay valid across multiple rotations then fail closed after retiring their key',async()=>{
  const middle=make({keyRing:{current:second,previous:[first]}});
  const issued=links(middle);
  const future=make({keyRing:{current:third,previous:[second,first]}});
  assert.equal((await future.handle(request(issued.click))).status,302);
  assert.equal((await future.handle(request(issued.open))).status,200);
  const oldKeyRetired=make({keyRing:{current:third,previous:[first]}});
  assert.equal((await oldKeyRetired.handle(request(issued.click))).status,404);
  const differentId=issued.click.replace('v3.nov_2026.','v3.dec-2026.');
  assert.equal((await future.handle(request(differentId))).status,404,'key ID is bound into the authenticated ciphertext');
  const tamper=issued.click.replace(/.$/u,ch=>ch==='A'?'B':'A');
  assert.equal((await future.handle(request(tamper))).status,404);
  assert.equal((await future.handle(request(issued.click+'/extra'))).status,404);
});

test('Section 45: legacy HMAC can be disabled without invalidating v2 or v3 encrypted links',async()=>{
  const payload=Buffer.from(JSON.stringify({kind:'click',id:'old-43',account:'marketing',campaign:'winter',url:'https://store.example.test/legacy',expires:Date.now()+120_000,nonce:'legacy'})).toString('base64url');
  const legacy=`${baseUrl}/_analytics/email/click/${payload}.${createHmac('sha256',first.secret).update(payload).digest('base64url')}`;
  const oldV2=links(make({secret:first.secret})).click;
  const rotated=make({keyRing:{current:second,previous:[first]}});
  assert.equal((await rotated.handle(request(legacy))).status,302);
  const strict=make({keyRing:{current:second,previous:[first]},acceptLegacyHmac:false});
  assert.equal((await strict.handle(request(legacy))).status,404);
  assert.equal((await strict.handle(request(oldV2))).status,302);
  assert.equal((await strict.handle(request(links(strict).click))).status,302);
});

test('Section 45: key ring rejects ambiguous or unsafe configurations',()=>{
  assert.throws(()=>make({}),/32 bytes/);
  assert.throws(()=>make({secret:first.secret,keyRing:{current:second}}),/either/);
  assert.throws(()=>make({keyRing:{current:{id:'weak',secret:'short'}}}),/32 bytes/);
  assert.throws(()=>make({keyRing:{current:second,previous:[{id:second.id,secret:first.secret}]}}),/duplicate/);
  assert.throws(()=>make({keyRing:{current:{...second,id:'bad.key'}}}),/key ID/);
  assert.throws(()=>make({keyRing:{current:second,previous:[first,third,first,third,first]}}),/key ring/);
  assert.throws(()=>make({secret:first.secret,acceptLegacyHmac:'false'}),/legacy tracking token policy/);
});

test('Section 45: rotatable links honor click allowlists and expiry validation',async()=>{
  const sender=make({keyRing:{current:first},ttlMs:60_000});
  const url=links(sender).click;
  const blocked=make({keyRing:{current:second,previous:[first]},allowedLinkHosts:['elsewhere.example.test']});
  assert.equal((await blocked.handle(request(url))).status,404);
  const allowed=make({keyRing:{current:second,previous:[first]},allowedLinkHosts:['store.example.test']});
  assert.equal((await allowed.handle(request(url))).status,302);
  assert.equal((await allowed.handle(new Request(url,{method:'HEAD'}))).status,302);
});
