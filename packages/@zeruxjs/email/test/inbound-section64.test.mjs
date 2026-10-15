import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createEmailReceiver,createDatabaseMailboxSync,createIncomingSyncProcessor,createDatabaseInboxStore,createMemoryInboxStore,sweepInboundRetention,inspectInboundSafety} from '../dist/index.js';
const require=createRequire(import.meta.url);
const {createConnector}=require('../../db-sqllite/dist/index.js');
const context={connection:{slug:'main',name:'main',connector:'@zeruxjs/db-sqlite',options:{}}};
const dbFrom=c=>Object.fromEntries(['createTable','createIndex','insert','select','update','delete'].map(op=>[op,input=>c.execute({op,...input},context)]));
const account={name:'inbox',protocol:'imap',host:'mail.example.test',auth:{user:'mail@example.test',password:'secret'},maxMessagesPerPoll:2,maxMailboxMessages:6};
function fakeImap(items,validity=12n){let searched=[];return {searched,connections:{async imap(){return {
 mailbox:{exists:items.length,uidValidity:validity,uidNext:BigInt(Math.max(0,...items.map(i=>i.uid))+1)},
 async connect(){},async getMailboxLock(){return {release(){}};},
 async search(query){searched.push(query);return items.map(i=>i.uid);},
 async fetchOne(uid){const found=items.find(item=>item.uid===uid);return found?{source:Buffer.from(`M${uid}`),size:2}:false;},async logout(){}
 };},async pop3(){throw Error('wrong protocol');}}};}
const parse=async raw=>({subject:'Verify password urgently',text:'Hi',html:'<script>alert(1)</script><a href="https://evil.test">https://bank.example</a><img src="https://tracker.test/a">',
 from:{value:[{address:'sender@example.test'}]},attachments:[{filename:'setup.exe',contentType:'application/octet-stream',content:Buffer.from([0,255,2])}]});
test('JSON-only IMAP needs no tables and returns untrusted content flags and capped attachment bytes',async()=>{
 const observed=[],d=fakeImap([{uid:3},{uid:4},{uid:5}]);
 const receiver=createEmailReceiver({accounts:[account],mode:'json',connections:d.connections,parse,sanitizeHtml:async()=>'<p>sanitized</p>',
   attachmentContent:'base64',onMessage:m=>{observed.push(m);}});
 const first=await receiver.poll('inbox',{cursor:{afterUid:0}});
 assert.equal(first.stored,2);assert.equal(first.messages.length,2);assert.equal(first.nextCursor.afterUid,4);
 assert.equal(first.messages[0].html,'<p>sanitized</p>');assert.equal(first.messages[0].attachments[0].contentBase64,Buffer.from([0,255,2]).toString('base64'));
 assert.ok(first.messages[0].safety.flags.includes('active_html'));
 assert.ok(first.messages[0].safety.flags.includes('executable_attachment'));
 assert.ok(first.messages[0].safety.flags.includes('suspicious_link'));
 assert.equal(first.messages[0].safety.authentication,'unverified');
 assert.equal(first.messages[0].protocol,'imap');assert.equal(JSON.stringify(first).includes('secret'),false);
 const second=await receiver.poll('inbox',{cursor:first.nextCursor});
 assert.equal(second.stored,1);assert.equal(second.messages[0].remoteId,'5');
 assert.equal(observed.length,3);
 assert.ok(d.searched.every(s=>'uid'in s));
 assert.throws(()=>receiver.page('inbox'),/No inbox store/);
 await assert.rejects(receiver.poll('inbox',{cursor:{uidValidity:'9',afterUid:2}}),/UIDVALIDITY changed/);
});
test('JSON-mode POP3 exposes parsed fields with user-owned persistence and never deletes',async()=>{
 let n=0;const commands=[];
 const receiver=createEmailReceiver({accounts:[{name:'pop',protocol:'pop3',host:'pop.example.test',auth:{user:'a',password:'b'}}],
   mode:'json',parse:async raw=>({text:`bytes:${raw.toString('hex')}`,attachments:[]}),
   connections:{async imap(){throw Error('not IMAP')},async pop3(){return {
     async UIDL(){return [['1','one']]},async RETR(){return (async function*(){yield Buffer.from([0,255]);})()},
     async QUIT(){commands.push('QUIT')}
   }}},onMessage:async msg=>{n++;assert.equal(msg.text,'bytes:00ff');}});
 assert.equal((await receiver.poll('pop')).messages.length,1);
 assert.equal((await receiver.poll('pop')).messages.length,1);
 assert.equal(n,2);assert.deepEqual(commands,['QUIT','QUIT']);
});
test('strict inline attachment bound reports omissions instead of dumping payloads',async()=>{
 const receiver=createEmailReceiver({accounts:[account],connections:fakeImap([{uid:1}]).connections,mode:'json',attachmentContent:'base64',maxInlineAttachmentBytes:1024,
   parse:async()=>({attachments:[{filename:'giant.bin',content:Buffer.alloc(2048)}]})});
 const row=(await receiver.poll('inbox')).messages[0];assert.equal(row.attachments[0].contentBase64,undefined);
 assert.equal(row.attachments[0].contentOmitted,true);assert.ok(row.safety.flags.includes('attachment_content_omitted'));
});
test('heuristic signals are advisory and do not claim genuine authentication or malware detection',()=>{
 const low=inspectInboundSafety({subject:'Normal',from:['sender@example.test'],html:'<p>ok</p>'});
 assert.equal(low.risk,'low');assert.equal(low.authentication,'unverified');
 const high=inspectInboundSafety({subject:'Verify password urgently',from:[],html:'<iframe src="x"></iframe>',attachments:[{filename:'runner.ps1'}]});
 assert.equal(high.risk,'high');assert.ok(high.flags.includes('executable_attachment'));
});
test('database mailbox checkpoint fences workers, resumes after lease expiry and preserves UID cursor',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'zerux-inbound64-')),path=join(directory,'inbox.db');
 const a=await createConnector({filename:path,driver:'node'}),b=await createConnector({filename:path,driver:'node'});
 let time=10_000,block=false;let resolvePoll;
 const receiver={poll:async(_account,{cursor})=>{if(block)return new Promise(resolve=>{resolvePoll=()=>resolve({stored:1,nextCursor:{uidValidity:'5',afterUid:cursor.afterUid+1}});});
   return {stored:2,nextCursor:{uidValidity:'5',afterUid:cursor.afterUid+2}};}};
 try{
   const first=createDatabaseMailboxSync({db:dbFrom(a),id:'worker-job',account:'inbox',receiver,now:()=>time,leaseMs:3000});
   const second=createDatabaseMailboxSync({db:dbFrom(b),id:'worker-job',account:'inbox',receiver,now:()=>time,leaseMs:3000});
   const page=await first.runOnce('a');assert.equal(page.state.cursor.afterUid,2);
   assert.equal((await second.get()).cursor.afterUid,2);
   block=true;const stalled=first.runOnce('a');
   // Allow the async worker to acquire the lease and begin its remote poll.
   for(let i=0;i<40&&!resolvePoll;i++)await new Promise(resolve=>setTimeout(resolve,2));
   assert.equal(typeof resolvePoll,'function');
   assert.equal((await second.runOnce('b')).busy,true);
   time+=3001;block=false;const takeover=await second.runOnce('b');assert.equal(takeover.state.cursor.afterUid,4);
   resolvePoll();await assert.rejects(stalled,/lease lost/);
   assert.equal((await first.get()).cursor.afterUid,4);
   const reset=await first.resetCursor();assert.equal(reset.cursor.afterUid,0);
 }finally{await a.disconnect();await b.disconnect();await rm(directory,{recursive:true,force:true});}
});
test('external spam and attachment scanners annotate messages without persisting unsafe binary data',async()=>{
 let uploads=0;
 const receiver=createEmailReceiver({accounts:[account],mode:'json',connections:fakeImap([{uid:1}]).connections,parse,
   sanitizeHtml:async()=>'<p>safe</p>',attachmentContent:'base64',
   inspectRaw:async()=> 'malware',inspectAttachment:async()=> 'blocked',
   saveAttachment:async()=>{uploads++;return 'private://asset';}});
 const msg=(await receiver.poll('inbox')).messages[0];
 assert.ok(msg.safety.flags.includes('external_malware'));
 assert.ok(msg.safety.flags.includes('attachment_scanner_blocked'));
 assert.equal(msg.safety.externalVerdict,'malware');
 assert.equal(msg.attachments[0].contentOmitted,true);
 assert.equal(msg.attachments[0].contentBase64,undefined);
 assert.equal(uploads,0);
});
test('scanner failures propagate rather than being interpreted as clean',async()=>{
 const receiver=createEmailReceiver({accounts:[account],mode:'json',connections:fakeImap([{uid:1}]).connections,parse,
   inspectRaw:async()=>{throw Error('scan unavailable')}});
 await assert.rejects(receiver.poll('inbox'),/scan unavailable/);
});

test('dry-run retention and explicit local erasure preserve remote messages and respect host legal holds',async()=>{
 const store=createMemoryInboxStore(),receiver=createEmailReceiver({accounts:[account],store,connections:fakeImap([{uid:1},{uid:2},{uid:3}]).connections,
   parse:async raw=>({subject:raw.toString('utf8')}),now:()=>1000});
 assert.equal((await receiver.poll('inbox')).stored,2);
 let shouldErase=false;
 const policy={store,account:'inbox',olderThan:2000,canErase:async()=>shouldErase};
 assert.equal((await sweepInboundRetention(policy)).eligible,0);
 shouldErase=true;
 const dry=await sweepInboundRetention(policy);assert.equal(dry.eligible,2);assert.equal(dry.erased,0);
 const erased=await sweepInboundRetention({...policy,dryRun:false});assert.equal(erased.erased,2);
 assert.equal((await store.page('inbox',null,20)).items.length,0);
 assert.equal((await receiver.poll('inbox')).stored,2); // local cleanup does not delete server mail
});
test('real SQLite inbox retention requires explicit opt-in and database delete',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'zerux-inbox-retain-')),path=join(directory,'mail.db');
 const c=await createConnector({filename:path,driver:'node'});
 try{
  const db=dbFrom(c),store=createDatabaseInboxStore(db),receiver=createEmailReceiver({accounts:[account],store,
    connections:fakeImap([{uid:10}]).connections,parse:async()=>({subject:'mail'}),now:()=>1000});
  assert.equal((await receiver.poll('inbox')).stored,1);
  const report=await sweepInboundRetention({store,account:'inbox',olderThan:2000,dryRun:false,canErase:async()=>true});
  assert.equal(report.erased,1);assert.equal((await store.page('inbox',null,20)).items.length,0);
 }finally{await c.disconnect();await rm(directory,{recursive:true,force:true});}
});
test('JSON mode can explicitly set IMAP seen using immutable remote identity without inbox table',async()=>{
 let marked=0;
 const con={async imap(){return {mailbox:{exists:1,uidValidity:12n,uidNext:2n},async connect(){},
  async getMailboxLock(_name,{readOnly}){return {release(){}};},async search(){return [1]},
  async fetchOne(){return {source:Buffer.from('x')}},async messageFlagsAdd(){marked++},async logout(){}}},
  async pop3(){throw Error('POP3 not expected')}};
 const receiver=createEmailReceiver({accounts:[account],mode:'json',connections:con,parse:async()=>({})});
 const item=(await receiver.poll('inbox')).messages[0];
 assert.equal(await receiver.markSeen('inbox',item),true);assert.equal(marked,1);
 await assert.rejects(receiver.markSeen('inbox',{...item,remoteId:'55'}),/identity/);
});

test('mailbox sync queue adapter never accepts credentials or message content',async()=>{
 const task=createIncomingSyncProcessor(async()=>({runOnce:async worker=>({owner:worker})}));
 assert.deepEqual(await task({data:{id:'imap-sync',account:'inbox'}},'worker-a'),{owner:'worker-a'});
 await assert.rejects(task({data:{id:'imap-sync',account:'inbox',password:'secret'}},'worker-a'),/only id and account/);
});
test('unsafe MIME attachment filenames are normalized before host callbacks receive them',async()=>{
 let filename;
 const receiver=createEmailReceiver({accounts:[account],mode:'json',connections:fakeImap([{uid:8}]).connections,
   parse:async()=>({attachments:[{filename:'../../some\\\\escape.exe',content:Buffer.from('x')}] }),
   saveAttachment:async ctx=>{filename=ctx.attachment.filename;return 'opaque:1';}});
 const row=(await receiver.poll('inbox')).messages[0];
 assert.equal(row.attachments[0].filename,'escape.exe');assert.equal(filename,'escape.exe');
 assert.ok(row.safety.flags.includes('executable_attachment'));
});
