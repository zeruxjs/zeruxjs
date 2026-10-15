import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEmailManager, createRecipientFilter, createTemplateRegistry, createEmailLayout, emailRow, emailButton, validateSmtp} from '../dist/index.js';
const mail=(to='a@example.com',override={})=>({to,subject:'Hi',text:'Hello',...override});
test('multiple accounts on same SMTP settings select independent transports',async()=>{
  const sent=[];const make=(name)=>({async sendMail(body){sent.push({name,body});return {accepted:body.to.map(x=>typeof x==='string'?x:x.address),messageId:name};},async verify(){return true;}});
  const service=createEmailManager({accounts:[{name:'sales',transport:make('sales'),defaults:{from:'sales@example.com'}},{name:'support',transport:make('support'),defaults:{from:'support@example.com'}}]});
  assert.equal((await service.send(mail())).messageId,'sales');
  assert.equal((await service.send(mail('b@example.com',{account:'support'}))).messageId,'support');
  assert.equal(sent[1].body.from,'support@example.com');
  assert.equal(sent[0].body.to[0],'a@example.com');
  assert.deepEqual(service.accounts().map(x=>x.name),['sales','support']);
  await service.close();await assert.rejects(()=>service.send(mail()),/closed/);
});
test('credentials are validated and never exposed in account inventory',()=>{
  assert.throws(()=>validateSmtp({host:'mail.local',port:587,tls:{rejectUnauthorized:false}}),/unsafe/);
  assert.throws(()=>validateSmtp({host:'mail.local',port:587,auth:{type:'oauth2',user:'u'}}),/token source/);
  const service=createEmailManager({accounts:[{name:'prod',smtp:{host:'mail.example.com',port:587,auth:{type:'password',user:'x',pass:'SECRET'}},defaults:{from:'x@example.com'}}]});
  assert.doesNotMatch(JSON.stringify(service.accounts()),/SECRET/);
});
test('recipient suppression, account filters, and injection blocking',async()=>{
  let count=0;
  const service=createEmailManager({accounts:[{name:'a',transport:{sendMail:async()=>{count++;return {}; }},defaults:{from:'a@example.com'}}],rules:[{action:'block',pattern:'*@blocked.test',reason:'policy'}],suppressions:['held@example.com']});
  for(const addr of ['x@blocked.test','held@example.com','line\r\nBcc:x@example.com'])await assert.rejects(()=>service.send(mail(addr)),/Recipient rejected|email address/);
  assert.equal(count,0);
  service.filter.unsuppress('held@example.com');await service.send(mail('held@example.com'));
  assert.equal(count,1);
});
test('header injection is rejected and protected envelope headers cannot be overridden',async()=>{
  const svc=createEmailManager({accounts:[{name:'a',transport:{async sendMail(){throw new Error('must not send');}},defaults:{from:'a@example.com'}}]});
  for(const headers of [{'X-Tag':'ok\nBcc: x@example.com'},{Bcc:'hidden@example.com'},{'content-type':'text/html'}])await assert.rejects(()=>svc.send(mail('a@example.com',{headers})),/header/i);
});
test('idempotency coalesces concurrent submissions and expires successful results',async()=>{
  let sends=0;let resume;
  const manager=createEmailManager({accounts:[{name:'a',transport:{sendMail:async()=>{sends++;await new Promise(resolve=>resume=resolve);return {messageId:'id-1',accepted:['a@example.com']};}},defaults:{from:'a@example.com'}}],idempotencyTtlMs:1000});
  const first=manager.send(mail('a@example.com',{idempotencyKey:'invoice-1'}));
  const second=manager.send(mail('a@example.com',{idempotencyKey:'invoice-1'}));
  await new Promise(r=>setTimeout(r,5));resume();
  assert.equal((await first).messageId,'id-1');assert.equal((await second).messageId,'id-1');
  assert.equal(sends,1);
  const repeat=await manager.send(mail('a@example.com',{idempotencyKey:'invoice-1'}));assert.equal(repeat.skipped,true);
});
test('templates substitute HTML-escaped values and block prototype keys',()=>{
  const registry=createTemplateRegistry([{id:'welcome',subject:'Hi {{user.name}}',html:'<h1>{{user.name}}</h1>',text:'Hello {{user.name}}'}]);
  const result=registry.render('welcome',{user:{name:'<Emil & Co>'}});
  assert.equal(result.html,'<h1>&lt;Emil &amp; Co&gt;</h1>');
  assert.equal(result.text,'Hello <Emil & Co>');
  assert.throws(()=>registry.render('welcome',{user:{}}).html===undefined?undefined:registry.set({id:'__proto__',subject:'x',html:'z'}),/./);
});
test('email-safe layout uses presentation tables and URL escape',()=>{
  assert.match(createEmailLayout(emailRow(['One','Two'])),/role="presentation"/);
  assert.match(emailButton('<Buy>','https://example.org?a=1&b=2'),/&lt;Buy&gt;/);
  assert.throws(()=>emailButton('X','javascript:alert(1)'),/Invalid email link/);
});
test('unsubscribe headers use https and one-click headers',async()=>{
  let headers;
  const service=createEmailManager({accounts:[{name:'a',transport:{async sendMail(body){headers=body.headers;return {}; }},defaults:{from:'a@example.com'}}]});
  await service.send(mail('a@example.com',{listUnsubscribe:{url:'https://example.com/unsubscribe/abc',email:'unsubscribe@example.com'}}));
  assert.match(headers['List-Unsubscribe'],/mailto:unsubscribe@example.com/);
  assert.equal(headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
  await assert.rejects(()=>service.send(mail('a@example.com',{listUnsubscribe:{url:'http://example.com/'}})),/HTTPS/);
});
