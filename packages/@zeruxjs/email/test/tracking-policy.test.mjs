import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEmailManager} from '../dist/index.js';

function setup(tracking){const sent=[];const manager=createEmailManager({accounts:[{name:'main',defaults:{from:'team@example.com',tracking:{enabled:true}},transport:{async sendMail(content){sent.push(content);return {messageId:String(sent.length),accepted:['person@example.com']};}}}],tracking,onTrackingError(){throw Error('logging failed');}});return {manager,sent};}

test('email tracking only applies when explicitly enabled on message or send options',async()=>{
  const calls=[];const {manager,sent}=setup({instrumentHtml(html,context){calls.push(context);return html+'<!-- tracked -->';},onSent(){calls.push('sent');}});
  const message={to:'person@example.com',subject:'Info',html:'<p>Hello</p>',text:'Hello'};
  await manager.send(message,{htmlMode:'trusted'});
  await manager.send(message,{htmlMode:'trusted',tracking:{enabled:true,opens:false,clicks:true,campaign:'launch'}});
  await manager.send({...message,tracking:{enabled:true}},{htmlMode:'trusted',tracking:false});
  assert.equal(sent.length,3);
  assert.doesNotMatch(sent[0].html,/tracked/);
  assert.match(sent[1].html,/tracked/);
  assert.doesNotMatch(sent[2].html,/tracked/);
  assert.equal(calls.length,2);
  assert.equal(calls[0].message.tracking.opens,false);
  await manager.close();
});

test('failed instrumentation and failed telemetry never interrupt SMTP delivery',async()=>{
  const {manager,sent}=setup({instrumentHtml(){throw Error('tracking down');},onSent(){throw Error('database down');}});
  const result=await manager.send({to:'person@example.com',subject:'Hi',html:'<p>Safe</p>',text:'Safe',tracking:{enabled:true}},{htmlMode:'trusted'});
  assert.equal(result.messageId,'1');
  assert.equal(sent.length,1);
  assert.equal(sent[0].html,'<p>Safe</p>');
  await manager.close();
});
