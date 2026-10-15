import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEmailManager,createEmailPreferenceService,createMemoryConsentStore} from '../dist/index.js';

const config=()=>({baseUrl:'https://mail.example.test',secret:'unit-test-secret-only-'.repeat(4)});
const message=(to='subscriber@example.com',purpose='marketing')=>({to,purpose,subject:'Newsletter',text:'News'});
function setup(store){
  const sent=[];
  const preferences=createEmailPreferenceService({...config(),store});
  const manager=createEmailManager({accounts:[{name:'news',defaults:{from:'hello@example.test',purpose:'marketing'},transport:{async sendMail(mail){sent.push(mail);return {messageId:String(sent.length),accepted:mail.to};}}}],preferences});
  return {preferences,manager,sent};
}
test('marketing requires explicit opt-in even if account defaults include marketing purpose',async()=>{
  const {manager,preferences,sent}=setup();
  const standard=await manager.send({to:'subscriber@example.com',subject:'Receipt',text:'Paid'});
  assert.equal(standard.messageId,'1');
  await assert.rejects(manager.send(message()),{code:'EMAIL_CONSENT_REQUIRED'});
  await assert.rejects(manager.send(message('subscriber@example.com','marketing'),{tracking:{enabled:false}}),{code:'EMAIL_CONSENT_REQUIRED'});
  await preferences.subscribe('SUBSCRIBER@EXAMPLE.COM',{source:'signup-form',proof:'double-opt-in-event-123'});
  await manager.send(message());
  assert.equal(sent.length,2);
  assert.match(sent[1].headers['List-Unsubscribe'],/^<https:\/\/mail\.example\.test\/_zerux\/email\/unsubscribe\//);
  assert.equal(sent[1].headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
  assert.doesNotMatch(sent[1].headers['List-Unsubscribe'],/subscriber|example.com/i);
});
test('marketing is single-recipient and blocked with Cc/Bcc, invalid purpose, or unavailable service',async()=>{
  const {manager,preferences,sent}=setup();
  await preferences.subscribe('subscriber@example.com',{source:'checkout',proof:'yes'});
  await assert.rejects(manager.send({...message(),to:['subscriber@example.com','friend@example.com']}),{code:'EMAIL_MARKETING_RECIPIENTS'});
  await assert.rejects(manager.send({...message(),cc:'other@example.com'}),{code:'EMAIL_MARKETING_RECIPIENTS'});
  await assert.rejects(manager.send({...message(),bcc:'other@example.com'}),{code:'EMAIL_MARKETING_RECIPIENTS'});
  await assert.rejects(manager.send({...message(),purpose:'promotion'}),/Invalid email purpose/);
  assert.equal(sent.length,0);
  const noPrefs=createEmailManager({accounts:[{name:'news',defaults:{from:'sender@example.com'},transport:{async sendMail(){throw Error('no');}}}]});
  await assert.rejects(noPrefs.send(message()),{code:'EMAIL_CONSENT_UNAVAILABLE'});
});
test('one-click GET and HEAD never unsubscribe; POST commits and retries are idempotent',async()=>{
  const {preferences,manager,sent}=setup();
  await preferences.subscribe('subscriber@example.com',{source:'verified',proof:'signup-record'});
  const url=preferences.makeUnsubscribeUrl('subscriber@example.com');
  for(const method of ['GET','HEAD']){
    const response=await preferences.handle(new Request(url,{method}));
    assert.equal(response.status,200);
    if(method==='GET')assert.match(await response.text(),/Unsubscribe from marketing emails/);
  }
  assert.equal(await preferences.isSubscribed('subscriber@example.com'),true);
  const post=()=>preferences.handle(new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'}));
  assert.equal((await post()).status,200);
  assert.equal((await post()).status,200);
  assert.equal(await preferences.isSubscribed('subscriber@example.com'),false);
  await assert.rejects(manager.send(message()),{code:'EMAIL_CONSENT_REQUIRED'});
  assert.equal(sent.length,0);
});
test('link cannot be tampered with, is encrypted, and rejects bad request bodies',async()=>{
  const preferences=createEmailPreferenceService(config());
  const url=preferences.makeUnsubscribeUrl('private+secret@example.com');
  assert.doesNotMatch(url,/private|secret@example.com/i);
  const invalid=url.slice(0,-1)+(url.endsWith('A')?'B':'A');
  assert.equal((await preferences.handle(new Request(invalid))).status,404);
  assert.equal((await preferences.handle(new Request(url,{method:'POST',headers:{'content-type':'text/plain'},body:'List-Unsubscribe=One-Click'}))).status,400);
  assert.equal((await preferences.handle(new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click&other=1'}))).status,400);
  assert.equal((await preferences.handle(new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'x'.repeat(400)}))).status,400);
  assert.equal((await preferences.handle(new Request(url,{method:'DELETE'}))).status,405);
  assert.equal((await preferences.handle(new Request(url+'?tracking=1'))).status,404);
});
test('shared store coordinates different service instances and refuses sends when unavailable',async()=>{
  const store=createMemoryConsentStore();
  const a=setup(store),b=setup(store);
  await a.preferences.subscribe('subscriber@example.com',{source:'verified',proof:'db-proof'});
  await b.manager.send(message());
  assert.equal(b.sent.length,1);
  const link=a.preferences.makeUnsubscribeUrl('subscriber@example.com');
  assert.equal((await b.preferences.handle(new Request(link,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'}))).status,200);
  await assert.rejects(a.manager.send(message()),{code:'EMAIL_CONSENT_REQUIRED'});
  const failed=setup({async get(){throw Error('db offline');},async set(){throw Error('db offline');}});
  await assert.rejects(failed.manager.send(message()),{code:'EMAIL_CONSENT_UNAVAILABLE'});
  assert.equal((await failed.preferences.handle(new Request(link,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'}))).status,503);
  assert.equal(failed.sent.length,0);
});
test('opt-in needs evidence and expired links cannot update preferences',async()=>{
  const service=createEmailPreferenceService({...config(),maxAgeMs:86_400_000});
  await assert.rejects(service.subscribe('reader@example.com',{source:'',proof:''}),/evidence/);
  assert.throws(()=>createEmailPreferenceService({...config(),secret:'short'}),/32 bytes/);
  assert.throws(()=>createEmailPreferenceService({...config(),baseUrl:'http://example.test'}),/HTTPS/);
  assert.throws(()=>createEmailPreferenceService({...config(),maxAgeMs:1}),/lifetime/);
  const url=service.makeUnsubscribeUrl('reader@example.com');
  assert.equal((await service.handle(new Request(url))).status,200);
});
