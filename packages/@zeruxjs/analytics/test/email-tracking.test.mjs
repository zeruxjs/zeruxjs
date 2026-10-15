import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEmailTrackingService} from '../dist/index.js';
function service(){const saved=[];const tracking=createEmailTrackingService({analytics:{track:async e=>{saved.push(e);return 'id';}},baseUrl:'https://events.example.com',secret:'S'.repeat(40),allowedLinkHosts:['app.example.com']});return {saved,tracking};}
test('email tracking is explicit opt-in, signs click and pixel, never inserts JS',async()=>{
  const {saved,tracking}=service();
  const html='<html><body><a href="https://app.example.com/docs?a=1&amp;b=2">Docs</a> <a href="https://evil.example/path">Other</a><a href="https://app.example.com/unsubscribe">Unsubscribe</a></body></html>';
  const unchanged=tracking.instrumentHtml(html,{id:'message-1',account:'support',message:{}});
  assert.equal(unchanged,html);
  const marked=tracking.instrumentHtml(html,{id:'message-1',account:'support',message:{tracking:{enabled:true,campaign:'launch'}}});
  assert.match(marked,/\/open\//);assert.match(marked,/\/click\//);assert.doesNotMatch(marked,/<script/);
  assert.match(marked,/https:\/\/evil.example\/path/);assert.match(marked,/https:\/\/app.example.com\/unsubscribe/);
  const urls=[...marked.matchAll(/(?:src|href)="([^"]+)"/g)].map(x=>x[1].replace(/&amp;/g,'&'));
  const pixel=urls.find(u=>u.includes('/open/')),click=urls.find(u=>u.includes('/click/'));
  assert.equal((await tracking.handle(new Request(pixel))).status,200);
  const redirect=await tracking.handle(new Request(click));
  assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),'https://app.example.com/docs?a=1&b=2');
  assert.deepEqual(saved.map(e=>e.name),['email.open','email.click']);
  assert.equal(saved[0].properties.message_id,'message-1');
  const bad=click.slice(0,-2)+'ab';assert.equal((await tracking.handle(new Request(bad))).status,404);
  assert.equal((await tracking.handle(new Request(pixel,{method:'HEAD'}))).status,200);
  assert.equal(saved.length,2);
});
test('secret length, insecure URLs, and nonallowed targets fail safely',()=>{
  assert.throws(()=>createEmailTrackingService({analytics:{track:async()=>{}},baseUrl:'http://example.org',secret:'secret'}),/HTTPS/);
  const {tracking}=service();
  const markup=tracking.instrumentHtml('<a href="http://app.example.com/insecure">A</a>',{id:'email-1',account:'a',message:{tracking:{enabled:true,opens:false}}});
  assert.doesNotMatch(markup,/\/click\//);
});
