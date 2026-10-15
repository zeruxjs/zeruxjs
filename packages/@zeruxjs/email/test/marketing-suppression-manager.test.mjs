import {test} from 'node:test';import assert from 'node:assert/strict';
import {createEmailManager,createEmailPreferenceService} from '../dist/index.js';
const mk=(check)=>{let sent=0;const prefs=createEmailPreferenceService({baseUrl:'https://mail.example.test',secret:'very-secret'.repeat(10)});
 const manager=createEmailManager({accounts:[{name:'campaign',defaults:{from:'noreply@example.test'},transport:{async sendMail(){sent++;return {messageId:`smtp-${sent}`}}}}],preferences:prefs,marketingSuppression:{isSuppressed:check}});
 return {manager,prefs,sends:()=>sent};};
test('direct marketing sends honor durable suppression independently of subscription and tracking',async()=>{
 const f=mk(async()=>true);await f.prefs.subscribe('a@example.test',{source:'signup',proof:'verified'});
 await assert.rejects(f.manager.send({to:'a@example.test',subject:'Promo',text:'Sale',purpose:'marketing',tracking:{enabled:true,opens:true}}),{code:'EMAIL_SUPPRESSED'});
 assert.equal(f.sends(),0);
 const transactional=await f.manager.send({to:'a@example.test',subject:'Receipt',text:'Paid'});assert.equal(transactional.messageId,'smtp-1');
});
test('suppression backend outage fails closed and pre-SMTP changes can block delivery',async()=>{
 let calls=0;
 const f=mk(async()=>{calls++;if(calls===2)return true;return false;});await f.prefs.subscribe('a@example.test',{source:'signup',proof:'verified'});
 await assert.rejects(f.manager.send({to:'a@example.test',subject:'News',text:'Hello',purpose:'marketing'}),{code:'EMAIL_SUPPRESSED'});
 assert.equal(f.sends(),0);
 const broken=mk(async()=>{throw new Error('offline')});await broken.prefs.subscribe('a@example.test',{source:'signup',proof:'verified'});
 await assert.rejects(broken.manager.send({to:'a@example.test',subject:'News',text:'Hello',purpose:'marketing'}),{code:'EMAIL_SUPPRESSION_UNAVAILABLE'});
});
