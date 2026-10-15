import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEmailManager,createEmailPreferenceService} from '../dist/index.js';

function setup(){
  const delivered=[],events=[];
  const preferences=createEmailPreferenceService({baseUrl:'https://mail.example.test',secret:'secure-preferences-'.repeat(3)});
  const manager=createEmailManager({accounts:[{name:'main',defaults:{from:'sender@example.test'},transport:{async sendMail(mail){delivered.push(mail);return {messageId:`smtp-${delivered.length}`,accepted:mail.to};}}}],preferences,
    tracking:{instrumentHtml(html,event){events.push(['render',event]);return html+'<img src="https://events.example.test/1x1.gif">';},onSent(event){events.push(['sent',event]);}}});
  return {delivered,events,preferences,manager};
}
test('transactional tracking is independent of marketing consent and exposes report ID',async()=>{
  const {delivered,events,preferences,manager}=setup();
  await preferences.unsubscribe('reader@example.test');
  const result=await manager.send({to:'reader@example.test',subject:'Invoice',text:'Paid',html:'<p>Paid</p>',purpose:'transactional',tracking:{enabled:true,opens:true,clicks:true}},{htmlMode:'trusted'});
  assert.match(result.trackingId,/^[0-9a-f-]{36}$/);
  assert.equal(events.length,2);
  assert.match(delivered[0].html,/1x1\.gif/);
  assert.equal(delivered[0].headers['List-Unsubscribe'],undefined);
  await assert.rejects(manager.send({to:'reader@example.test',subject:'Promotion',text:'News',purpose:'marketing',tracking:{enabled:true}}),{code:'EMAIL_CONSENT_REQUIRED'});
});
test('marketing consent never enables email activity tracking implicitly',async()=>{
  const {delivered,events,preferences,manager}=setup();
  await preferences.subscribe('reader@example.test',{source:'signup',proof:'verified-example'});
  const result=await manager.send({to:'reader@example.test',subject:'News',text:'News',html:'<p>New</p>',purpose:'marketing'},{htmlMode:'trusted'});
  assert.equal(result.trackingId,undefined);
  assert.equal(events.length,0);
  assert.doesNotMatch(delivered[0].html,/1x1\.gif/);
  assert.equal(delivered[0].headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
});
