import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createDatabaseInboxStore,createMemoryInboxStore,createEmailReceiver,createIncomingPollProcessor} from '../dist/index.js';
const require=createRequire(import.meta.url);
const {createConnector}=require('../../db-sqllite/dist/index.js');
const context={connection:{slug:'main',name:'main',connector:'@zeruxjs/db-sqlite',options:{}}};
const dbFrom=c=>Object.fromEntries(['createTable','createIndex','insert','select','update'].map(op=>[op,input=>c.execute({op,...input},context)]));
const sanitizeHtml=async html=>html;
const parse=async raw=>({messageId:`<${raw.toString('utf8')}>`,subject:'New mail',text:'body text',html:'<p>safe test</p>',
  from:{value:[{address:'alice@example.test'}]},to:{value:[{address:'support@example.test'}]},
  attachments:[{filename:'report.txt',contentType:'text/plain',size:3,content:Buffer.from('PDF')}],date:new Date('2026-10-13T04:00:00Z')});
function fakeImap(messages,uidValidity=1n){
 const actions=[];let calls=0;
 const connections={async imap(){return {mailbox:{exists:messages.length,uidValidity},async connect(){actions.push('connect');},
  async getMailboxLock(mailbox,settings){assert.equal(settings.readOnly,true);actions.push('lock:'+mailbox);return {release(){actions.push('unlock');}};},
  async search(){return messages.map(m=>m.uid);},async fetchOne(uid){calls++;const m=messages.find(m=>m.uid===uid);return m?{size:m.source.length,source:m.source}:false;},
  async logout(){actions.push('logout');}};},async pop3(){throw Error('unexpected');}};
 return {connections,actions,calls:()=>calls};
}
function imapAccount(){return {name:'support',protocol:'imap',host:'imap.example.test',auth:{user:'support@example.test',password:'secret'},maxMessagesPerPoll:50};}
test('IMAP TLS receiver is read-only, persists MIME metadata once across two SQLite connections',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'zerux-imap-')),file=join(directory,'mail.sqlite');
 const c1=await createConnector({filename:file,driver:'node'}),c2=await createConnector({filename:file,driver:'node'});
 try{
  const first=createDatabaseInboxStore(dbFrom(c1)),second=createDatabaseInboxStore(dbFrom(c2));
  const messages=[{uid:1,source:Buffer.from('one')},{uid:2,source:Buffer.from('two')}];
  const driver=fakeImap(messages);const uploaded=[];
  const make=store=>createEmailReceiver({accounts:[imapAccount()],store,connections:driver.connections,parse,sanitizeHtml,
    saveAttachment:async({messageId,content})=>{assert.equal(content.toString(),'PDF');uploaded.push(messageId);return `files://${messageId}`;}});
  const a=make(first),b=make(second);
  assert.deepEqual((await a.poll('support')).stored,2);
  assert.equal((await b.poll('support')).stored,0);
  const page=await second.page('support');assert.equal(page.items.length,2);
  assert.ok(page.items.every(m=>m.attachments[0].storedReference?.startsWith('files://')));
  assert.equal(page.items[0].protocol,'imap');assert.equal(page.items[0].uidValidity,'1');
  assert.equal(page.items[0].text,'body text');assert.equal(driver.calls(),2);
  assert.equal(JSON.stringify(await second.page('support')).includes('secret'),false);
  assert.equal(uploaded.length,2);
  assert.deepEqual(driver.actions.slice(0,3),['connect','lock:INBOX','unlock']);
  await a.close();await assert.rejects(a.poll('support'),/closed/);
 }finally{await c1.disconnect();await c2.disconnect();await rm(directory,{recursive:true,force:true});}
});
test('IMAP UIDVALIDITY reset creates distinct inbox identity for reused UID',async()=>{
 const store=createMemoryInboxStore(),msg=[{uid:7,source:Buffer.from('hello')}];
 for(const valid of [10n,11n]){const receiver=createEmailReceiver({accounts:[imapAccount()],store,connections:fakeImap(msg,valid).connections,parse,sanitizeHtml});
  assert.equal((await receiver.poll('support')).stored,1);}
 assert.equal((await store.page('support',null,10)).items.length,2);
});
test('POP3 UIDL deduplicates across message reordering without issuing DELE',async()=>{
 const commands=[];const store=createMemoryInboxStore();
 let order=[['1','stable-a'],['2','stable-b']];
 const connections={async imap(){throw Error('unexpected');},async pop3(){return {async UIDL(){commands.push('UIDL');return order;},async RETR(n){commands.push(`RETR:${n}`);return `Mail ${n}`;},async QUIT(){commands.push('QUIT');}};}};
 const receiver=createEmailReceiver({accounts:[{name:'backup',protocol:'pop3',host:'pop.example.test',auth:{user:'backup@example.test',password:'hidden'}}],store,connections,parse,sanitizeHtml});
 assert.equal((await receiver.poll('backup')).stored,2);
 order=[['1','stable-b'],['2','stable-a']];
 assert.equal((await receiver.poll('backup')).stored,0);
 assert.equal(commands.filter(c=>c.startsWith('RETR')).length,2);
 assert.equal(commands.some(c=>c==='DELE'),false);
 const jobs=createIncomingPollProcessor(receiver);
 assert.equal((await jobs({data:{account:'backup'}})).stored,0);
 await assert.rejects(jobs({data:{account:'backup',password:'oops'}}),/only a receive account/);
});
test('invalid options fail before network, and oversized mail is skipped',async()=>{
 for(const changed of [
  {secure:false},{auth:{user:'a',accessToken:'token'},protocol:'pop3'},
  {host:'invalid:443'},{maxMessageBytes:50},{mailbox:'\r\nInjected'}]){
  assert.throws(()=>createEmailReceiver({accounts:[{...imapAccount(),...changed}],store:createMemoryInboxStore()}));
 }
 const driver=fakeImap([{uid:1,source:Buffer.alloc(1500)}]);
 const receiver=createEmailReceiver({accounts:[{...imapAccount(),maxMessageBytes:1024}],store:createMemoryInboxStore(),connections:driver.connections,parse});
 assert.equal((await receiver.poll('support')).oversized,1);
});
test('mailbox contents are truncated with explicit coverage indicator and no binary attachment in DB',async()=>{
 const store=createMemoryInboxStore(),driver=fakeImap([{uid:3,source:Buffer.from('hello')}]);
 const receiver=createEmailReceiver({accounts:[imapAccount()],store,connections:driver.connections,parse:async()=>({subject:'A',text:'x'.repeat(25000),attachments:[{filename:'big.dat',content:Buffer.from('RAW_SECRET')} ]})});
 assert.equal((await receiver.poll('support')).stored,1);
 const row=(await store.page('support')).items[0];assert.equal(row.bodyTruncated,true);
 assert.equal(row.text.length,24000);assert.equal(JSON.stringify(row).includes('RAW_SECRET'),false);
});

test('IMAP markSeen uses explicit write lock and refuses UIDVALIDITY reuse',async()=>{
 const store=createMemoryInboxStore(),events=[];
 let validity=5n;
 const connections={async imap(){return {mailbox:{exists:1,uidValidity:validity},async connect(){},
  async getMailboxLock(mailbox,{readOnly}){events.push(`lock:${readOnly}`);return {release(){events.push('unlock');}};},
  async search(){return [23];},async fetchOne(){return {source:Buffer.from('hello'),size:5};},
  async messageFlagsAdd(uid,flags,options){events.push(`flag:${uid}:${flags[0]}`);assert.deepEqual(options,{uid:true});},
  async list(){return [{path:'INBOX'},{path:'Archive'}];},async logout(){events.push('logout');}};},async pop3(){throw Error('unexpected');}};
 const receiver=createEmailReceiver({accounts:[imapAccount()],store,parse,sanitizeHtml,connections});
 await receiver.poll('support');const row=(await store.page('support',null,5)).items[0];
 assert.deepEqual((await receiver.folders('support')).map(i=>i.path),['INBOX','Archive']);
 validity=6n;await assert.rejects(receiver.markSeen('support',row.id),/UIDVALIDITY changed/);
 validity=5n;assert.equal(await receiver.markSeen('support',row.id),true);
 assert.ok(events.includes('lock:false'));assert.ok(events.includes('flag:23:\\Seen'));
});
