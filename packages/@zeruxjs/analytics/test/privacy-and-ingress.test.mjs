import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createEmailTrackingService,createAnalyticsCollector} from '../dist/index.js';

const secret='Section44-secret-'.repeat(4);
function tracking(){
  const events=[];
  return {events, service:createEmailTrackingService({
    analytics:{track:async event=>{events.push(event);return 'id';}},
    baseUrl:'https://events.example.com', secret
  })};
}
const htmlContext={id:'message-44',account:'marketing',message:{tracking:{enabled:true,campaign:'campaign-44'}}};
const urls=html=>[...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(x=>x[1]);

test('new signed tracking tokens encrypt destinations and metadata, and remain tamper-resistant',async()=>{
  const {events,service}=tracking();
  const destination='https://shop.example/orders?secretCustomerToken=private-in-query';
  const html=service.instrumentHtml(`<body><a href="${destination}">View</a></body>`,htmlContext);
  const click=urls(html).find(u=>u.includes('/click/'));
  const open=urls(html).find(u=>u.includes('/open/'));
  assert.ok(click&&open);
  const token=click.split('/click/')[1];
  assert.match(token,/^v2\.[A-Za-z0-9_-]+$/);
  const bytes=Buffer.from(token.split('.')[1],'base64url').toString('utf8');
  assert.ok(!bytes.includes('secretCustomerToken')&&!bytes.includes('message-44')&&!bytes.includes('campaign-44'));
  const clicked=await service.handle(new Request(click));
  assert.equal(clicked.status,302);
  assert.equal(clicked.headers.get('location'),destination);
  assert.equal((await service.handle(new Request(open))).status,200);
  assert.deepEqual(events.map(e=>e.name),['email.click','email.open']);
  const corrupted=token.slice(0,-1)+(token.at(-1)==='a'?'b':'a');
  assert.equal((await service.handle(new Request(click.replace(token,corrupted)))).status,404);
});

test('previous-generation signed HMAC tokens remain valid until their original expiry',async()=>{
  const {service}=tracking();
  const payload=Buffer.from(JSON.stringify({kind:'click',id:'legacy-1',account:'marketing',campaign:'old',
    url:'https://shop.example/old?query=one',expires:Date.now()+60000,nonce:'legacy'})).toString('base64url');
  const mac=createHmac('sha256',secret).update(payload).digest('base64url');
  const result=await service.handle(new Request(`https://events.example.com/_analytics/email/click/${payload}.${mac}`));
  assert.equal(result.status,302);
  assert.equal(result.headers.get('location'),'https://shop.example/old?query=one');
});

test('email instrumentation is idempotent and never rewrites unsubscribe or excluded anchors',()=>{
  const {service}=tracking();
  const original='<html><body><a href="https://shop.example/normal">Normal</a>'+ 
    '<a href="https://shop.example/manage?unsubscribe=1">Unsubscribe query</a>'+ 
    '<a href="https://shop.example/manage?opt_out=true">Opt-out query</a>'+ 
    '<a href="https://shop.example/no" rel="noopener unsubscribe">Unsubscribe rel</a>'+ 
    '<a href="https://shop.example/no-track" data-no-track>Excluded</a>'+ 
    '<a data-tracking="off" href="https://shop.example/disabled">Disabled</a></body></html>';
  const marked=service.instrumentHtml(original,htmlContext);
  assert.equal(urls(marked).filter(u=>u.includes('/click/')).length,1);
  assert.equal(urls(marked).filter(u=>u.includes('/open/')).length,1);
  assert.match(marked,/href="https:\/\/shop\.example\/manage\?unsubscribe=1"/);
  assert.match(marked,/href="https:\/\/shop\.example\/manage\?opt_out=true"/);
  assert.match(marked,/href="https:\/\/shop\.example\/no" rel="noopener unsubscribe"/);
  const second=service.instrumentHtml(marked,htmlContext);
  assert.equal(second,marked,'renderer retries must not add tracking layers or multiple pixels');
});

const collectorRequest=(body,headers={})=>new Request('https://events.example.com/_analytics/collect',{
  method:'POST',headers:{origin:'https://app.example.com','content-type':'application/json',...headers},body,
  ...(body instanceof ReadableStream?{duplex:'half'}:{})
});
function collector(options={}){
  return createAnalyticsCollector({analytics:{track:async()=>undefined},allowedOrigins:['https://app.example.com'],bodyTimeoutMs:25,...options});
}

test('slow request body times out with 408, keeps CORS response readable and releases the concurrency slot',async()=>{
  let cancelCalls=0;
  const stuck=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelCalls++;}});
  const instance=collector({maxConcurrentReads:1});
  const processing=instance.handler(collectorRequest(stuck));
  await new Promise(r=>setTimeout(r,5));
  const throttled=await instance.handler(collectorRequest(JSON.stringify({name:'page.view'})));
  assert.equal(throttled.status,429);
  assert.equal(throttled.headers.get('access-control-allow-origin'),'https://app.example.com');
  const timedOut=await processing;
  assert.equal(timedOut.status,408);
  assert.equal(timedOut.headers.get('access-control-allow-origin'),'https://app.example.com');
  assert.equal(cancelCalls,1);
  assert.equal((await instance.handler(collectorRequest('{"name":"ok"}'))).status,204);
});

test('oversized indicated bodies and invalid collector limits fail without storage access',async()=>{
  const instance=collector({maxBodyBytes:256});
  assert.equal((await instance.handler(collectorRequest('{"name":"view"}',{'content-length':'10000'}))).status,413);
  assert.equal((await instance.handler(collectorRequest('{oops'))).status,400);
  assert.throws(()=>collector({bodyTimeoutMs:0}),/Invalid collection limits/);
  assert.throws(()=>collector({maxConcurrentReads:0}),/Invalid collection limits/);
});

test('links too long to decode remain unwrapped and do not break mail rendering',()=>{
  const {service}=tracking();
  const huge='https://shop.example/docs?state='+encodeURIComponent('x'.repeat(3900));
  const html=`<body><a href="${huge}">Docs</a></body>`;
  const output=service.instrumentHtml(html,htmlContext);
  assert.ok(output.includes(`href="${huge}"`));
  assert.equal(urls(output).filter(u=>u.includes('/click/')).length,0);
  assert.equal(urls(output).filter(u=>u.includes('/open/')).length,1);
});
